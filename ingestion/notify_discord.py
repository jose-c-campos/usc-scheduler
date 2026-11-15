"""Discord alerts for run_semester_refresh.py: one message per run that needs a person.

Quiet by default. A run with no events (a success) sends nothing; it only goes to
logs/history.log. A message goes out for a new USC term and for every failure:
term_failed, profs_failed, probe_failed, config_failed, crashed.

The webhook URL comes from $DISCORD_WEBHOOK_URL. It's a secret (anyone who has it
can post to the channel), so it never appears in output, logs or summaries:
every error passes through redact() first. notify() never raises, and a failed
delivery never changes the run's exit code. That code describes the data.

Setup (once; a webhook is not a bot: no developer portal, no token, nothing to host):
    1. Discord desktop app or browser: hover the alerts channel → gear (Edit Channel)
       → Integrations → Webhooks → New Webhook → name it → Copy Webhook URL.
    2. Right-click the channel → Notification Settings → All Messages (these
       messages mention nobody, so "only @mentions" would never buzz your phone).
    3. Put DISCORD_WEBHOOK_URL=<the URL> in the box's .env (never commit it). If it
       leaks: delete the webhook in the same menu and make a new one.
    4. cd ingestion && python run_semester_refresh.py notify --test
"""
from __future__ import annotations

import re
import socket
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import requests

ENV_VAR = "DISCORD_WEBHOOK_URL"
MAX_CONTENT = 2000       # Discord's limit for a message's text
MAX_ERROR = 300          # one event's error text; the summary and log keep the rest
TIMEOUT = 10             # seconds per attempt
ATTEMPTS = 3
MAX_RETRY_AFTER = 30     # seconds; a longer 429 wait isn't worth holding cron for
SEASONS = {"1": "Spring", "2": "Summer", "3": "Fall"}  # as in frontend/src/lib/semester.ts
LOOPBACK = {"127.0.0.1", "localhost", "::1"}          # plain http is allowed only here (tests)
_MARKDOWN = re.compile(r"([\\*_~`|])")  # what formats mid-line; our lines never start with free text


class NotifyError(Exception):
    """Delivery failed. The message is already redacted."""


# ─── message ─────────────────────────────────────────────────────────────────

def term_label(code: str) -> str:
    """'20271' → '20271 (Spring 2027)'; anything unexpected is returned as is."""
    code = str(code)
    season = SEASONS.get(code[4:5]) if re.fullmatch(r"\d{5}", code) else None
    return f"{code} ({season} {code[:4]})" if season else code


def md(text) -> str:
    """Escape Discord markdown in free text (paths and errors are full of `_`)."""
    return _MARKDOWN.sub(r"\\\1", str(text))


def clip(text, limit: int = MAX_ERROR) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def duration(summary: dict) -> str | None:
    try:
        seconds = (datetime.fromisoformat(summary["finished"])
                   - datetime.fromisoformat(summary["started"])).total_seconds()
    except (KeyError, TypeError, ValueError):
        return None
    seconds = max(0, int(seconds))
    return f"{seconds // 60}m{seconds % 60:02d}s" if seconds >= 60 else f"{seconds}s"


def sections_text(res: dict) -> str:
    sections, prev = res.get("sections"), res.get("prev_sections")
    if not isinstance(sections, int):
        return ""
    if isinstance(prev, int):
        return f"{sections} sections ({sections - prev:+d})"
    return f"{sections} sections (no previous snapshot)"


def describe_event(event: dict, summary: dict) -> str:
    kind = event.get("event")
    if kind == "term_failed":
        return (f"• {term_label(event.get('term'))} failed at {event.get('step')}: "
                f"{md(clip(event.get('error')))}")
    if kind == "profs_failed":
        return (f"• professor ratings failed (load_profs.py exit {event.get('exit_code')}). "
                "Course data that loaded is unaffected")
    if kind == "probe_failed":
        tail = ". Nothing was refreshed" if summary.get("command", "refresh") == "refresh" else ""
        return f"• couldn't read USC's term list: {md(clip(event.get('error')))}{tail}"
    if kind == "config_failed":
        problems = "; ".join(clip(p, 200) for p in event.get("problems") or []) or "unknown"
        return f"• didn't run, configuration problem: {md(problems)}"
    if kind == "crashed":
        return f"• the orchestrator crashed: {md(clip(event.get('error')))}"
    rest = {k: v for k, v in event.items() if k != "event"}
    return f"• {md(kind)}: {md(clip(rest))}"


def new_term_note(term: str, summary: dict) -> str:
    probe = summary.get("probe") or {}
    if term in (probe.get("active_not_configured") or []):
        return "Not configured for refresh: add it to ACTIVE\\_SEMESTERS to scrape it."
    res = (summary.get("terms") or {}).get(term)
    if res and res.get("status") == "ok":
        return "Configured, and refreshed in this run."
    if res:
        return "Configured, but its refresh failed (below)."
    return "Already configured: the next refresh scrapes it."


def build_message(summary: dict, *, summary_path=None, host: str | None = None) -> str | None:
    """The Discord message for a run summary, or None when there's nothing to report."""
    events = summary.get("events") or []
    if not events:
        return None
    command = summary.get("command", "refresh")
    new_terms = [e.get("term") for e in events if e.get("event") == "new_term"]
    failures = [e for e in events if e.get("event") != "new_term"]

    lines = []
    if failures:
        lines.append(f"🔴 **USC {command} failed** (exit {summary.get('exit_code')})")
    if new_terms:
        head = "New USC term live" if len(new_terms) == 1 else "New USC terms live"
        lines.append(f"🆕 **{head}: {', '.join(term_label(t) for t in new_terms)}**")
        lines += [f"{t}: {new_term_note(t, summary)}" if len(new_terms) > 1 else new_term_note(t, summary)
                  for t in new_terms]
        lines.append("The live site's SEMESTER is unchanged; switching it stays a manual step.")
    lines += [describe_event(e, summary) for e in failures]
    if failures:
        lines += [f"• {term_label(t)} ok: {sections_text(r)}" for t, r in (summary.get("terms") or {}).items()
                  if r.get("status") == "ok"]

    footer = [f"{command} on {md(host or socket.gethostname())}"]
    options = summary.get("options") or {}
    footer += [f"--{k.replace('_', '-')}" + (f" {md(v)}" if not isinstance(v, bool) else "")
               for k, v in options.items() if v]
    if duration(summary):
        footer.append(duration(summary))
    footer = [" · ".join(footer)]
    if summary_path:
        footer.append(f"summary: `{summary_path}`")
    if summary.get("log"):
        footer.append(f"log: `{summary['log']}`")
    text = "\n".join(lines + footer)
    if len(text) > MAX_CONTENT:
        cut = "\n…(truncated; the summary has everything)"
        text = text[: MAX_CONTENT - len(cut)] + cut
    return text


# ─── delivery ────────────────────────────────────────────────────────────────

def redact(text, url: str | None) -> str:
    """Remove the webhook URL and its token from text (requests puts the path in its errors)."""
    text = str(text)
    if not url:
        return text
    text = text.replace(url, "<webhook URL>")
    token = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]
    if len(token) >= 8:
        text = text.replace(token, "<redacted>")
    return text


def check_url(url: str) -> None:
    """Catch a mis-pasted value (an invite or channel link) before sending anything."""
    parts = urlsplit(url)
    secure = parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOOPBACK)
    if not (secure and parts.hostname and "/api/webhooks/" in parts.path):
        raise NotifyError(f"{ENV_VAR} doesn't look like a Discord webhook URL "
                          "(https://discord.com/api/webhooks/<id>/<token>). Copy it again from "
                          "Edit Channel → Integrations → Webhooks → Copy Webhook URL")


def _discord_detail(response) -> str:
    try:
        body = response.json()
        return f": {clip(body.get('message'), 120)}" if body.get("message") else ""
    except (ValueError, AttributeError):
        return ""


def _retry_after(response) -> float:
    for source in (lambda: response.json()["retry_after"], lambda: response.headers["Retry-After"]):
        try:
            return max(0.0, float(source()))
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    return 1.0


def send(url: str, content: str, *, post=None, sleep=time.sleep, attempts: int = ATTEMPTS) -> None:
    """POST one message to the webhook. Raises NotifyError (redacted) if it isn't delivered."""
    check_url(url)
    post = post or requests.post
    payload = {"content": content, "allowed_mentions": {"parse": []}}
    last = "no attempt made"
    for attempt in range(1, attempts + 1):
        try:
            response = post(url, json=payload, timeout=TIMEOUT)
        except requests.RequestException as e:
            last, wait = f"{type(e).__name__}: {e}", 2 ** (attempt - 1)
        else:
            code = response.status_code
            if 200 <= code < 300:
                return
            detail = _discord_detail(response)
            if code == 429:
                last, wait = f"rate limited by Discord (429{detail})", min(_retry_after(response), MAX_RETRY_AFTER)
            elif code >= 500:
                last, wait = f"Discord returned {code}{detail}", 2 ** (attempt - 1)
            elif code in (401, 404):
                raise NotifyError(f"Discord rejected the webhook ({code}{detail}): it was deleted or the "
                                  f"URL is mistyped. Copy it again from Edit Channel → Integrations → "
                                  f"Webhooks into {ENV_VAR}")
            else:
                raise NotifyError(redact(f"Discord refused the message ({code}{detail})", url))
        if attempt < attempts:
            sleep(wait)
    raise NotifyError(redact(f"not delivered after {attempts} attempts; last error: {last}", url))


def webhook_url(env) -> str:
    return (env.get(ENV_VAR) or "").strip()


def notify(summary: dict, env, *, summary_path=None, post=None, sleep=time.sleep, host=None) -> dict:
    """Send the run's message if it needs one. Returns the summary's `notify` block. Never raises."""
    url = webhook_url(env)
    if not url:
        return {"status": "disabled", "reason": f"{ENV_VAR} is not set"}
    try:
        content = build_message(summary, summary_path=summary_path, host=host)
        if content is None:
            return {"status": "quiet"}
        send(url, content, post=post, sleep=sleep)
    except NotifyError as e:
        return {"status": "failed", "error": redact(e, url)}
    except Exception as e:  # an alerting bug must never break the run it reports on
        return {"status": "failed", "error": redact(f"{type(e).__name__}: {e}", url)}
    return {"status": "sent"}


def setup_check_message(host: str | None = None, now: datetime | None = None) -> str:
    """What `run_semester_refresh.py notify --test` sends."""
    now = now or datetime.now(timezone.utc)
    return (f"✅ **USC Scheduler refresh alerts work.** Test from {md(host or socket.gethostname())} at "
            f"{now.isoformat(timespec='seconds')}.\n"
            "Alerts come here when USC opens a new term and when a run fails. Successful runs stay quiet.")
