"""Thin client for the JSON API behind https://classes.usc.edu.

The class-schedule site is a single-page app: its HTML is an empty shell, and
the page's JavaScript fetches every program, course and section from
https://classes.usc.edu/api/... as JSON. This module calls those same read
endpoints directly, so no browser is needed.

The API is undocumented and internal to USC's site. It can change without
notice, so this client fails loudly (UscApiError) on anything unexpected rather
than handing partial data to the caller.

Only these read endpoints are used. The site's bundle also contains admin
endpoints (/api/Users, /api/Configuration, /api/BackgroundJob); never call them.
"""
from __future__ import annotations

import re
import time
from typing import Any

import requests

BASE_URL = "https://classes.usc.edu"

# A generic browser UA. Deliberately carries no project or personal details.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

TERM_CODE = re.compile(r"^\d{5}$")  # YYYYS, S = 1 Spring, 2 Summer, 3 Fall


class UscApiError(RuntimeError):
    """The API could not be reached, or returned something we don't understand."""


def normalize_term(term: Any) -> str:
    """USC returns term codes as ints (20271); the pipeline uses 5-char strings."""
    s = str(term).strip()
    if not TERM_CODE.match(s):
        raise ValueError(f"Not a USC term code (YYYYS, e.g. 20271): {term!r}")
    return s


class UscApi:
    def __init__(
        self,
        base_url: str = BASE_URL,
        delay: float = 0.5,
        timeout: float = 30.0,
        retries: int = 3,
        backoff: float = 2.0,
        session: requests.Session | None = None,
        sleep=time.sleep,
        clock=time.monotonic,
    ):
        """
        delay   -- minimum seconds between the start of consecutive requests (politeness)
        retries -- extra attempts after a timeout, connection error or 5xx/429
        backoff -- seconds before the first retry; doubles on each further retry
        sleep/clock are injectable so tests run instantly.
        """
        self.base_url = base_url.rstrip("/")
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
        self._sleep = sleep
        self._clock = clock
        self._last_request: float | None = None
        self.requests_made = 0

    # ── transport ──────────────────────────────────────────────────────────
    def _wait_politely(self) -> None:
        if self._last_request is not None:
            remaining = self.delay - (self._clock() - self._last_request)
            if remaining > 0:
                self._sleep(remaining)
        self._last_request = self._clock()

    def get_json(self, path: str, params: dict | None = None) -> Any:
        url = f"{self.base_url}{path}"
        last_error: str = ""
        for attempt in range(self.retries + 1):
            if attempt:
                self._sleep(self.backoff * 2 ** (attempt - 1))
            self._wait_politely()
            self.requests_made += 1
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
            except (requests.Timeout, requests.ConnectionError) as e:
                last_error = f"{type(e).__name__}: {e}"
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                last_error = f"HTTP {resp.status_code}"
                continue
            if resp.status_code != 200:
                # 4xx other than 429: retrying won't help (bad params, or access refused).
                raise UscApiError(f"GET {resp.url} -> HTTP {resp.status_code}")
            try:
                return resp.json()
            except ValueError as e:
                raise UscApiError(
                    f"GET {resp.url} -> 200 but not JSON "
                    f"(content-type {resp.headers.get('content-type')!r})"
                ) from e
        raise UscApiError(f"GET {url} params={params} failed after {self.retries + 1} attempts: {last_error}")

    # ── endpoints ──────────────────────────────────────────────────────────
    def active_terms(self) -> list[str]:
        """Term codes USC currently lists as Active, oldest first (e.g. ['20262', '20263', '20271'])."""
        data = self.get_json("/api/Terms/Active")
        if not isinstance(data, list):
            raise UscApiError(f"/api/Terms/Active: expected a list, got {type(data).__name__}")
        try:
            return sorted(normalize_term(t["termCode"]) for t in data if t.get("status") == "Active")
        except (KeyError, TypeError, ValueError) as e:
            raise UscApiError(f"/api/Terms/Active: unexpected item shape: {e}") from e

    def programs(self, term: str) -> list[dict]:
        """Raw program list for a term: [{prefix, name, schools: [{prefix, ...}], ...}, ...]."""
        term = normalize_term(term)
        data = self.get_json("/api/Programs/TermCode", {"termCode": term})
        if not isinstance(data, list):
            raise UscApiError(f"/api/Programs/TermCode {term}: expected a list, got {type(data).__name__}")
        return data

    def courses(self, term: str, school: str, program: str) -> list[dict]:
        """Raw courses (each with its 'sections') for one program in one school."""
        term = normalize_term(term)
        params = {"termCode": term, "school": school, "program": program}
        data = self.get_json("/api/Courses/CoursesByTermSchoolProgram", params)
        if not isinstance(data, dict) or "courses" not in data:
            raise UscApiError(f"CoursesByTermSchoolProgram {params}: no 'courses' key in response")
        courses = data["courses"]
        if courses is None:  # USC uses null for empty collections elsewhere (e.g. the program list)
            return []
        if not isinstance(courses, list):
            raise UscApiError(f"CoursesByTermSchoolProgram {params}: 'courses' is {type(courses).__name__}")
        return courses
