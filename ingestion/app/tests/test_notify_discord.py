"""Phase 4: Discord alerts for the refresh orchestrator.

No network. Delivery goes through a fake `post`, and an autouse fixture makes
any real requests.post fail the test, so a DISCORD_WEBHOOK_URL in the developer's
shell can never reach Discord from here. The real HTTP path was checked by hand
against a local fake webhook server (see the handoff, Phase 4).
"""
import json
from datetime import datetime, timezone

import pytest
import requests

import notify_discord as nd
import run_semester_refresh as rsr
from app.tests.test_run_semester_refresh import DB_ENV, LATER, NOW, FakeApi, FakeRunner

TOKEN = "SECRET-token_abcdefghijklmnopqrstuvwxyz0123456789"
URL = f"https://discord.com/api/webhooks/123456789012345678/{TOKEN}"
HOOK_ENV = {nd.ENV_VAR: URL}


# ─── fakes ───────────────────────────────────────────────────────────────────

class FakeResponse:
    def __init__(self, status_code, body=None, headers=None):
        self.status_code, self.body, self.headers = status_code, body, headers or {}

    def json(self):
        if self.body is None:
            raise ValueError("no JSON body")
        return self.body


class FakePost:
    """Plays back responses (or raises exceptions) in order; 204 once they run out."""

    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def __call__(self, url, json=None, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        r = self.responses.pop(0) if self.responses else FakeResponse(204)
        if isinstance(r, Exception):
            raise r
        return r

    @property
    def messages(self):
        return [c["json"]["content"] for c in self.calls]


class Sleeps(list):
    def __call__(self, seconds):
        self.append(seconds)


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("a test tried to reach Discord for real")
    monkeypatch.setattr(nd.requests, "post", refuse)


def run(argv, env, post=None, api=None, runner=None, now=NOW):
    post = post if post is not None else FakePost()
    runner = runner or FakeRunner()
    code = rsr.main(argv, env=env, api=api or FakeApi(), runner_factory=runner.factory, now=now,
                    post=post, sleep=Sleeps())
    return code, post


def refresh(tmp_path, *extra, env=None, **kw):
    argv = ["refresh", "--runs-dir", str(tmp_path), "--terms", "20263,20271", "--skip-profs", *extra]
    return run(argv, {**DB_ENV, **HOOK_ENV, **(env or {})}, **kw)


def probe(tmp_path, *extra, env=None, **kw):
    return run(["probe", "--runs-dir", str(tmp_path), "--terms", "20263,20271", *extra],
               {**HOOK_ENV, **(env or {})}, **kw)


def summary_at(tmp_path, now=NOW):
    return json.loads((tmp_path / "logs" / f"{now.strftime(rsr.STAMP_FORMAT)}.json").read_text())


def history(tmp_path):
    return (tmp_path / "logs" / "history.log").read_text().splitlines()


def failed_refresh_summary():
    return {"command": "refresh", "exit_code": 1, "started": "2026-11-15T03:00:00+00:00",
            "finished": "2026-11-15T03:14:02+00:00", "options": {"only": None, "no_db": False},
            "log": "/srv/runs/logs/20261115T030000Z.log",
            "terms": {"20271": {"status": "failed", "failed_step": "guard", "prev_sections": 9582,
                                "error": "catalog shrank to 8012 sections from 9582 in the last good snapshot"},
                      "20263": {"status": "ok", "sections": 9110, "prev_sections": 9098}},
            "profs": {"status": "skipped"},
            "events": [{"event": "term_failed", "term": "20271", "step": "guard",
                        "error": "catalog shrank to 8012 sections from 9582 in the last good snapshot"}]}


# ─── messages ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("code,label", [("20271", "20271 (Spring 2027)"), ("20272", "20272 (Summer 2027)"),
                                        ("20263", "20263 (Fall 2026)"), ("20274", "20274"), ("2027", "2027")])
def test_term_labels_match_the_frontend(code, label):
    assert nd.term_label(code) == label


def test_a_probe_with_nothing_new_is_quiet():
    assert nd.build_message({"command": "probe", "exit_code": 0, "events": [], "probe": {"active": ["20271"]}}) is None
    assert nd.build_message({"events": []}) is None  # no exit code: nothing to call a success


def ok_refresh_summary(**options):
    return {"command": "refresh", "exit_code": 0, "started": "2026-11-16T10:00:00+00:00",
            "finished": "2026-11-16T10:25:10+00:00", "log": "/srv/runs/logs/20261116T100000Z.log",
            "options": {"no_db": False, "skip_profs": True, "only": None, **options},
            "terms": {"20263": {"status": "ok", "sections": 9110, "prev_sections": 9098},
                      "20271": {"status": "ok", "sections": 9582, "prev_sections": None}},
            "profs": {"status": "skipped", "reason": "--skip-profs"}, "events": []}


def test_a_successful_refresh_posts_a_check_mark_with_the_counts():
    """User, 2026-11-15: successes alert too (Phase 4 decision 2 changed)."""
    text = nd.build_message(ok_refresh_summary(), summary_path="/srv/runs/logs/20261116T100000Z.json", host="box")
    lines = text.splitlines()
    assert lines[:3] == ["✅ **USC refresh ok**",
                         "• 20263 (Fall 2026): 9110 sections (+12)",
                         "• 20271 (Spring 2027): 9582 sections (no previous snapshot)"]
    assert "refresh on box · --skip-profs · 25m10s" in text and "professor ratings" not in text
    assert "`/srv/runs/logs/20261116T100000Z.json`" in text


def test_a_success_says_when_nothing_was_loaded_or_the_run_was_partial():
    assert nd.build_message(ok_refresh_summary(no_db=True)).splitlines()[0] == \
        "✅ **USC refresh ok** (scrape and checks only: nothing was loaded)"
    assert nd.build_message(ok_refresh_summary(only="CHEM,CSCI")).splitlines()[0] == \
        "✅ **USC refresh ok** (partial run, only CHEM,CSCI: loaded without pruning)"
    with_profs = ok_refresh_summary(skip_profs=False)
    with_profs["profs"] = {"status": "ok", "exit_code": 0}
    assert "• professor ratings refreshed" in nd.build_message(with_profs).splitlines()


def test_a_successful_profs_run_names_its_catalogs():
    summary = {"command": "profs", "exit_code": 0, "catalogs": {"20271": "/x/usc_20271_courses.json"},
               "missing_terms": ["20263"], "profs": {"status": "ok", "exit_code": 0}, "events": []}
    lines = nd.build_message(summary, host="box").splitlines()
    assert lines[0] == "✅ **USC professor ratings refreshed** from 20271 (Spring 2027)"
    assert lines[1] == "• skipped, no catalog yet: 20263 (Fall 2026)"


def test_a_new_term_leads_a_successful_refresh():
    summary = ok_refresh_summary()
    summary["events"] = [{"event": "new_term", "term": "20271"}]
    summary["probe"] = {"active_not_configured": []}
    lines = nd.build_message(summary, host="box").splitlines()
    assert lines[0].startswith("🆕") and "✅ **USC refresh ok**" in lines
    assert lines.index("✅ **USC refresh ok**") > lines.index("Configured, and refreshed in this run.")


def test_failure_message_leads_with_the_failure_and_lists_what_loaded():
    text = nd.build_message(failed_refresh_summary(), summary_path="/srv/runs/logs/20261115T030000Z.json",
                            host="box")
    lines = text.splitlines()
    assert lines[0] == "🔴 **USC refresh failed** (exit 1)"  # what the phone notification shows
    assert "• 20271 (Spring 2027) failed at guard: catalog shrank to 8012 sections from 9582" in text
    assert "• 20263 (Fall 2026) ok: 9110 sections (+12)" in text
    assert "refresh on box · 14m02s" in text
    assert "`/srv/runs/logs/20261115T030000Z.json`" in text and "`/srv/runs/logs/20261115T030000Z.log`" in text


def test_new_term_message_says_what_to_do():
    summary = {"command": "probe", "exit_code": 0, "events": [{"event": "new_term", "term": "20272"}],
               "probe": {"active": ["20263", "20271", "20272"], "active_not_configured": ["20272"]}}
    text = nd.build_message(summary, host="box")
    assert text.splitlines()[0] == "🆕 **New USC term live: 20272 (Summer 2027)**"
    assert "add it to ACTIVE\\_SEMESTERS" in text and "SEMESTER is unchanged" in text
    summary["probe"]["active_not_configured"] = []
    assert "the next refresh scrapes it" in nd.build_message(summary, host="box")


def test_failure_and_new_term_in_one_run_make_one_message_led_by_the_failure():
    summary = failed_refresh_summary()
    summary["events"].insert(0, {"event": "new_term", "term": "20263"})
    summary["probe"] = {"active_not_configured": []}
    lines = nd.build_message(summary, host="box").splitlines()
    assert lines[0].startswith("🔴") and lines[1].startswith("🆕")
    assert "Configured, and refreshed in this run." in lines


@pytest.mark.parametrize("event,expect", [
    ({"event": "profs_failed", "exit_code": 1}, "professor ratings failed (load_profs.py exit 1)"),
    ({"event": "probe_failed", "error": "HTTP 503"}, "couldn't read USC's term list: HTTP 503. Nothing was refreshed"),
    ({"event": "config_failed", "problems": ["missing USC_DB_USER", "no node"]},
     "didn't run, configuration problem: missing USC\\_DB\\_USER; no node"),
    ({"event": "crashed", "error": "JSONDecodeError: Expecting value"}, "the orchestrator crashed: JSONDecodeError"),
    ({"event": "something_new", "detail": 7}, "something\\_new"),
])
def test_every_failure_event_has_a_line(event, expect):
    text = nd.build_message({"command": "refresh", "exit_code": 1, "events": [event]}, host="box")
    assert text.startswith("🔴") and expect in text


def test_markdown_in_errors_is_escaped():
    summary = {"command": "refresh", "exit_code": 1, "events": [
        {"event": "term_failed", "term": "20271", "step": "sections",
         "error": "see usc_20271_courses.summary.json and *** ~~ `x` ||y||"}]}
    text = nd.build_message(summary, host="box")
    assert "usc\\_20271\\_courses" in text and "\\*\\*\\*" in text and "\\|\\|y\\|\\|" in text


def test_long_messages_are_cut_to_discords_limit():
    events = [{"event": "term_failed", "term": f"2027{i % 3 + 1}", "step": "sections", "error": "x" * 1000}
              for i in range(20)]
    text = nd.build_message({"command": "refresh", "exit_code": 1, "events": events}, host="box")
    assert len(text) <= nd.MAX_CONTENT and text.endswith("(truncated; the summary has everything)")
    assert "x" * 300 not in text  # each error is clipped first


# ─── delivery ────────────────────────────────────────────────────────────────

def test_send_posts_plain_content_with_mentions_disabled():
    post = FakePost()
    nd.send(URL, "hello @everyone", post=post, sleep=Sleeps())
    assert post.calls == [{"url": URL, "timeout": nd.TIMEOUT,
                           "json": {"content": "hello @everyone", "allowed_mentions": {"parse": []}}}]


def test_rate_limit_waits_as_told_then_delivers():
    post, sleeps = FakePost(FakeResponse(429, {"message": "You are being rate limited.", "retry_after": 1.5})), Sleeps()
    nd.send(URL, "x", post=post, sleep=sleeps)
    assert len(post.calls) == 2 and sleeps == [1.5]


def test_rate_limit_wait_falls_back_to_the_header_and_is_capped():
    post, sleeps = FakePost(FakeResponse(429, headers={"Retry-After": "600"})), Sleeps()
    nd.send(URL, "x", post=post, sleep=sleeps)
    assert sleeps == [nd.MAX_RETRY_AFTER]


def test_server_and_network_errors_retry_then_give_up():
    post, sleeps = FakePost(FakeResponse(502), requests.ConnectionError("reset"), FakeResponse(503)), Sleeps()
    with pytest.raises(nd.NotifyError, match="not delivered after 3 attempts; last error: Discord returned 503"):
        nd.send(URL, "x", post=post, sleep=sleeps)
    assert len(post.calls) == 3 and sleeps == [1, 2]


@pytest.mark.parametrize("status", [401, 404])
def test_a_deleted_or_mistyped_webhook_fails_at_once_and_says_where_to_fix_it(status):
    post = FakePost(FakeResponse(status, {"message": "Unknown Webhook", "code": 10015}))
    with pytest.raises(nd.NotifyError, match="Integrations → Webhooks"):
        nd.send(URL, "x", post=post, sleep=Sleeps())
    assert len(post.calls) == 1


def test_a_refused_message_is_not_retried():
    post = FakePost(FakeResponse(400, {"message": "Invalid Form Body", "code": 50035}))
    with pytest.raises(nd.NotifyError, match="refused the message \\(400: Invalid Form Body\\)"):
        nd.send(URL, "x", post=post, sleep=Sleeps())
    assert len(post.calls) == 1


@pytest.mark.parametrize("url,ok", [
    ("https://discord.com/api/webhooks/1/abc", True),
    ("https://canary.discord.com/api/webhooks/1/abc", True),
    ("http://127.0.0.1:8765/api/webhooks/1/abc", True),   # local fake server only
    ("http://discord.com/api/webhooks/1/abc", False),     # never send the token over plain http
    ("https://discord.gg/invite123", False),              # an invite link pasted by mistake
    ("https://discord.com/channels/1/2", False),          # a channel link
    ("discord.com/api/webhooks/1/abc", False),
])
def test_webhook_url_shape_is_checked_before_sending(url, ok):
    post = FakePost()
    if ok:
        nd.send(url, "x", post=post, sleep=Sleeps())
    else:
        with pytest.raises(nd.NotifyError, match="doesn't look like a Discord webhook URL"):
            nd.send(url, "x", post=post, sleep=Sleeps())
        assert post.calls == []


def test_the_token_never_appears_in_an_error():
    # requests puts the request path, token included, in its exception messages.
    leak = requests.ConnectionError(f"HTTPSConnectionPool(host='discord.com', port=443): Max retries exceeded "
                                    f"with url: /api/webhooks/123456789012345678/{TOKEN}")
    result = nd.notify({"command": "probe", "exit_code": 1, "events": [{"event": "probe_failed", "error": "x"}]},
                       HOOK_ENV, post=FakePost(leak, leak, leak), sleep=Sleeps())
    assert result["status"] == "failed" and TOKEN not in result["error"] and "<redacted>" in result["error"]


def test_notify_never_raises():
    class Broken(FakePost):
        def __call__(self, *a, **k):
            raise RuntimeError(f"bug near {URL}")
    result = nd.notify(failed_refresh_summary(), HOOK_ENV, post=Broken(), sleep=Sleeps())
    assert result["status"] == "failed" and result["error"].startswith("RuntimeError") and TOKEN not in result["error"]


def test_notify_statuses_without_a_url_and_with_nothing_to_say():
    post = FakePost()
    assert nd.notify(failed_refresh_summary(), {}, post=post)["status"] == "disabled"
    assert nd.notify(failed_refresh_summary(), {nd.ENV_VAR: "  "}, post=post)["status"] == "disabled"
    assert nd.notify({"events": []}, HOOK_ENV, post=post) == {"status": "quiet"}
    assert post.calls == []


# ─── the orchestrator: when it alerts ────────────────────────────────────────

def test_a_successful_refresh_sends_one_check_mark_and_goes_to_history(tmp_path):
    code, post = refresh(tmp_path)
    assert code == 0 and len(post.calls) == 1
    assert post.messages[0].startswith("✅ **USC refresh ok**\n• 20263 (Fall 2026): 100 sections")
    summary = summary_at(tmp_path)
    assert summary["command"] == "refresh" and summary["notify"] == {"status": "sent"}
    [line] = history(tmp_path)
    assert line.startswith(f"{NOW.strftime(rsr.STAMP_FORMAT)}  refresh  exit 0  ")
    assert "20263 ok 100 sections (no previous snapshot) · 20271 ok 100 sections" in line
    assert line.endswith("notify sent")


def test_profs_runs_alert_on_success_and_on_failure(tmp_path, monkeypatch):
    cli = tmp_path / "rmp" / "prof_lookup_cli.js"
    cli.parent.mkdir()
    cli.write_text("")
    monkeypatch.setattr(rsr, "RMP_CLI", cli)
    monkeypatch.setattr(rsr.shutil, "which", lambda name: f"/usr/bin/{name}")
    runs = tmp_path / "runs"
    refresh(runs)
    argv = ["profs", "--runs-dir", str(runs), "--terms", "20263,20271"]
    code, post = run(argv, {**DB_ENV, **HOOK_ENV}, now=LATER)
    assert code == 0 and post.messages[0].startswith(
        "✅ **USC professor ratings refreshed** from 20263 (Fall 2026), 20271 (Spring 2027)")
    line = history(runs)[-1]
    assert "  profs  exit 0  " in line and "catalogs 20263,20271 · profs ok" in line and line.endswith("notify sent")

    code, post = run(argv, {**DB_ENV, **HOOK_ENV}, runner=FakeRunner(fail={"load_profs"}),
                     now=datetime(2026, 11, 21, 3, 0, tzinfo=timezone.utc))
    assert code == 1 and post.messages[0].startswith("🔴 **USC profs failed** (exit 1)")
    assert "professor ratings failed (load_profs.py exit 1)" in post.messages[0]


def test_an_unreachable_db_alerts_before_the_scrape(tmp_path, db_connects):
    db_connects.error = Exception('connection to server at "172.18.0.2", port 5432 failed: Connection refused')
    api = FakeApi()
    code, post = refresh(tmp_path, env={"USC_DB_HOST": "172.18.0.2"}, api=api)
    assert code == 2 and api.calls == 0 and len(post.calls) == 1
    assert post.messages[0].startswith("🔴 **USC refresh failed** (exit 2)")
    assert "can't connect to Postgres at 172.18.0.2:5432" in post.messages[0]


def test_a_failed_term_sends_one_alert(tmp_path):
    code, post = refresh(tmp_path, runner=FakeRunner(fail={("programs", "20263")}))
    assert code == 1 and len(post.calls) == 1
    text = post.messages[0]
    assert "• 20263 (Fall 2026) failed at programs" in text and "• 20271 (Spring 2027) ok: 100 sections" in text
    assert str(tmp_path / "logs") in text  # it points at the summary and the log
    assert summary_at(tmp_path)["notify"] == {"status": "sent"}
    assert "20263 FAILED at programs" in history(tmp_path)[0] and history(tmp_path)[0].endswith("notify sent")


def test_the_shrink_guard_alerts(tmp_path):
    refresh(tmp_path, runner=FakeRunner(sections={"20271": 1000}))
    code, post = refresh(tmp_path, runner=FakeRunner(sections={"20271": 800}), now=LATER)
    assert code == 1 and "20271 (Spring 2027) failed at guard: catalog shrank to 800" in post.messages[0]


def test_probe_writes_a_summary_and_reports_a_new_term_exactly_once(tmp_path):
    code, post = probe(tmp_path, api=FakeApi(["20263", "20271"]))      # first probe seeds the state
    assert code == 0 and post.calls == [] and summary_at(tmp_path)["command"] == "probe"

    code, post = probe(tmp_path, api=FakeApi(["20263", "20271", "20272"]), now=LATER)
    assert code == 0 and len(post.calls) == 1
    assert post.messages[0].startswith("🆕 **New USC term live: 20272 (Summer 2027)**")
    assert "add it to ACTIVE\\_SEMESTERS" in post.messages[0]
    assert {"event": "new_term", "term": "20272"} in summary_at(tmp_path, LATER)["events"]

    third = datetime(2026, 11, 21, 3, 0, tzinfo=timezone.utc)
    code, post = probe(tmp_path, api=FakeApi(["20263", "20271", "20272"]), now=third)
    assert code == 0 and post.calls == []
    assert [line.split("  ")[1] for line in history(tmp_path)] == ["probe", "probe", "probe"]
    assert "NEW TERM 20272" in history(tmp_path)[1]


def test_a_new_term_seen_by_the_probe_is_not_lost(tmp_path):
    """The gap Phase 4 closes: probe used to print the new term and record it, and nothing else."""
    refresh(tmp_path, api=FakeApi(["20263", "20271"]))
    _, post = probe(tmp_path, api=FakeApi(["20263", "20271", "20272"]), now=LATER)
    assert len(post.calls) == 1
    _, post = refresh(tmp_path, api=FakeApi(["20263", "20271", "20272"]),
                      now=datetime(2026, 11, 21, tzinfo=timezone.utc))
    assert len(post.calls) == 1 and post.messages[0].startswith("✅")  # its success, and only that:
    assert "New USC term" not in post.messages[0]                       # the probe already reported 20272


@pytest.mark.parametrize("command", ["probe", "refresh"])
def test_usc_being_down_alerts(tmp_path, command):
    fn = probe if command == "probe" else refresh
    code, post = fn(tmp_path, api=FakeApi(error="HTTP 503 from /api/Terms/Active"))
    assert code == 1 and len(post.calls) == 1
    assert "couldn't read USC's term list: HTTP 503" in post.messages[0]
    assert ("Nothing was refreshed" in post.messages[0]) == (command == "refresh")


def test_a_config_error_alerts_and_still_exits_2_before_any_request(tmp_path):
    api = FakeApi()
    code, post = run(["refresh", "--runs-dir", str(tmp_path), "--terms", "20271"], HOOK_ENV, api=api)
    assert code == 2 and api.calls == 0 and len(post.calls) == 1
    assert "didn't run, configuration problem: missing USC\\_DB\\_USER, USC\\_DB\\_PASSWORD" in post.messages[0]
    assert summary_at(tmp_path)["events"][0]["event"] == "config_failed"

    code, post = run(["probe", "--runs-dir", str(tmp_path)], HOOK_ENV, api=api)   # no terms anywhere
    assert code == 2 and api.calls == 0 and "no terms configured" in post.messages[0]


def test_a_crash_alerts_then_propagates(tmp_path):
    (tmp_path / "state.json").write_text("{corrupt")
    post = FakePost()
    with pytest.raises(json.JSONDecodeError):
        run(["probe", "--runs-dir", str(tmp_path), "--terms", "20271"], HOOK_ENV, post=post)
    assert len(post.calls) == 1 and "the orchestrator crashed: JSONDecodeError" in post.messages[0]
    summary = summary_at(tmp_path)
    assert summary["exit_code"] == 1 and "Traceback" in summary["events"][0]["traceback"]
    assert "CRASHED: JSONDecodeError" in history(tmp_path)[0]


def test_a_failed_delivery_never_changes_the_exit_code_or_leaks_the_token(tmp_path, capsys):
    down = [FakeResponse(500)] * 3
    code, _ = refresh(tmp_path, runner=FakeRunner(fail={("programs", "20263")}), post=FakePost(*down))
    assert code == 1  # the data's result, not the alert's
    code, _ = probe(tmp_path, api=FakeApi(["20263", "20271", "20272"]), post=FakePost(*down), now=LATER)
    assert code == 0  # a new term is good news; the alert failing doesn't make it a failure
    notify = summary_at(tmp_path, LATER)["notify"]
    assert notify["status"] == "failed" and "Discord returned 500" in notify["error"]
    err = capsys.readouterr().err
    assert "Discord alert NOT delivered" in err
    for path in (tmp_path / "logs").iterdir():
        assert TOKEN not in path.read_text()
    assert TOKEN not in err


def test_no_notify_silences_a_manual_run(tmp_path):
    code, post = refresh(tmp_path, "--no-notify", runner=FakeRunner(fail={"sections"}))
    assert code == 1 and post.calls == [] and summary_at(tmp_path)["notify"] == {"status": "off"}


def test_without_a_webhook_alerts_are_off_and_the_run_says_so(tmp_path, capsys):
    code, post = run(["refresh", "--runs-dir", str(tmp_path), "--terms", "20271", "--skip-profs"], DB_ENV)
    assert code == 0 and post.calls == []
    assert summary_at(tmp_path)["notify"]["status"] == "disabled"
    assert "alerts are off: DISCORD_WEBHOOK_URL is not set" in capsys.readouterr().err


def test_a_held_lock_sends_nothing_and_writes_no_summary(tmp_path):
    with rsr.run_lock(tmp_path):
        code, post = refresh(tmp_path)
    assert code == 3 and post.calls == [] and not (tmp_path / "logs").exists()


# ─── the notify command ──────────────────────────────────────────────────────

def test_notify_test_sends_one_message(capsys):
    code, post = run(["notify", "--test"], HOOK_ENV)
    assert code == 0 and post.messages[0].startswith("✅ **USC Scheduler refresh alerts work.**")
    assert "test message delivered" in capsys.readouterr().out


def test_notify_test_without_a_webhook_is_a_config_error():
    code, post = run(["notify", "--test"], {})
    assert code == 2 and post.calls == []


def test_notify_test_reports_a_bad_webhook():
    code, post = run(["notify", "--test"], HOOK_ENV, post=FakePost(FakeResponse(404, {"message": "Unknown Webhook"})))
    assert code == 1 and len(post.calls) == 1


def test_notify_summary_previews_or_resends_a_runs_alert(tmp_path, capsys):
    path = tmp_path / "20261115T030000Z.json"
    path.write_text(json.dumps(failed_refresh_summary()))
    code, post = run(["notify", "--summary", str(path), "--dry-run"], HOOK_ENV)
    assert code == 0 and post.calls == [] and "failed at guard" in capsys.readouterr().out
    code, post = run(["notify", "--summary", str(path)], HOOK_ENV)
    assert code == 0 and len(post.calls) == 1

    path.write_text(json.dumps({"command": "probe", "exit_code": 0, "events": []}))
    code, post = run(["notify", "--summary", str(path)], HOOK_ENV)
    assert code == 0 and post.calls == [] and "nothing to send" in capsys.readouterr().out
