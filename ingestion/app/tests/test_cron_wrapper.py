"""Phase 5: ingestion/cron-wrapper.sh, run for real with bash.

The wrapper is all that stands between cron's empty environment and an
unattended run with alerts silently off, so every refusal is tested. Its Python
and `docker` are fakes, and each run gets an environment built from scratch (as
cron's is), so nothing from the developer's shell, such as a real
DISCORD_WEBHOOK_URL, can leak in.
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

WRAPPER = Path(__file__).resolve().parents[2] / "cron-wrapper.sh"
BASH = shutil.which("bash")
HOOK = "https://discord.com/api/webhooks/123/SECRET-wrapper-token-abcdefghijk"
GOOD_ENV = (f"USC_DB_HOST=db\nUSC_DB_USER=u\nUSC_DB_PASSWORD=pw-secret-1234\n"
            f"ACTIVE_SEMESTERS=20263,20271\nDISCORD_WEBHOOK_URL={HOOK}\n")

FAKE_PYTHON = """#!/bin/sh
echo "argv: $*"
echo "cwd: $(pwd)"
echo "USC_DB_HOST=${USC_DB_HOST-<unset>}"
echo "ACTIVE_SEMESTERS=${ACTIVE_SEMESTERS-<unset>}"
echo "hook: ${DISCORD_WEBHOOK_URL:+set}"
exit ${FAKE_EXIT:-0}
"""
# `docker inspect -f <template> <name>`: prints the IP (with the template's trailing space), or fails.
FAKE_DOCKER = """#!/bin/sh
[ "$1" = inspect ] && [ "$4" = "${EXPECT_CONTAINER:-usc_scheduler_db}" ] || exit 1
[ -n "$FAKE_DB_IP" ] || { echo "Error: No such object: $4" >&2; exit 1; }
printf '%s \\n' "$FAKE_DB_IP"
"""

pytestmark = pytest.mark.skipif(BASH is None, reason="needs bash")


def executable(path: Path, text: str) -> Path:
    path.write_text(text)
    path.chmod(0o755)
    return path


class Box:
    """A throwaway repo layout: <tmp>/repo/ingestion/cron-wrapper.sh, a fake venv Python and docker."""

    def __init__(self, tmp: Path):
        self.repo = tmp / "repo"
        (self.repo / "ingestion").mkdir(parents=True)
        self.wrapper = self.repo / "ingestion" / "cron-wrapper.sh"
        shutil.copy2(WRAPPER, self.wrapper)
        self.bin = tmp / "bin"
        self.bin.mkdir()
        executable(self.bin / "docker", FAKE_DOCKER)
        self.python = executable(tmp / "python", FAKE_PYTHON)
        self.tmp = tmp

    def run(self, *args, env_file=GOOD_ENV, **env):
        if env_file is not None:
            (self.repo / ".env").write_text(env_file)
        base = {"PATH": f"{self.bin}:/usr/bin:/bin", "HOME": str(self.tmp), "REFRESH_PYTHON": str(self.python),
                "FAKE_DB_IP": "172.18.0.2"}
        env = {k: v for k, v in {**base, **env}.items() if v is not None}
        p = subprocess.run([BASH, str(self.wrapper), *args], env=env, capture_output=True, text=True, timeout=30)
        assert HOOK not in p.stdout + p.stderr and "pw-secret-1234" not in p.stdout + p.stderr
        return p


@pytest.fixture
def box(tmp_path):
    return Box(tmp_path)


def test_the_wrapper_is_executable_in_the_repo():
    assert os.access(WRAPPER, os.X_OK)  # cron runs it by path; git keeps the mode


def test_it_loads_env_points_at_the_db_container_and_runs_the_orchestrator(box):
    p = box.run("refresh", "--skip-profs")
    assert p.returncode == 0, p.stderr
    out = p.stdout.splitlines()
    assert out[0] == "argv: run_semester_refresh.py refresh --skip-profs"
    assert out[1].endswith("/repo/ingestion")
    assert "USC_DB_HOST=172.18.0.2" in out  # overrides .env's "db", which the host can't resolve
    assert "ACTIVE_SEMESTERS=20263,20271" in out and "hook: set" in out
    assert "cron-wrapper: run_semester_refresh.py refresh --skip-profs" in p.stderr


@pytest.mark.parametrize("code", [1, 2, 3])
def test_the_orchestrators_exit_code_passes_through(box, code):
    assert box.run("probe", FAKE_EXIT=str(code)).returncode == code


def test_it_refuses_without_a_readable_env_file(box):
    p = box.run("notify", "--test", env_file=None)
    assert p.returncode == 2 and p.stdout == ""
    assert "REFUSING TO RUN: can't read" in p.stderr


@pytest.mark.parametrize("env_file", [
    "USC_DB_USER=u\nUSC_DB_PASSWORD=pw-secret-1234\n",           # no webhook line at all
    "DISCORD_WEBHOOK_URL=\nUSC_DB_USER=u\n",                      # an empty one
    "DISCORD_WEBHOOK_URL=   \n",                                  # whitespace only
    "",                                                          # an empty file (like ENV_FILE=/dev/null)
])
def test_it_refuses_when_the_webhook_is_empty_after_loading(box, env_file):
    p = box.run("refresh", "--skip-profs", env_file=env_file)
    assert p.returncode == 2 and p.stdout == ""  # the orchestrator never started
    assert "REFUSING TO RUN: DISCORD_WEBHOOK_URL is empty" in p.stderr


def test_dev_null_as_the_env_file_refuses(box):
    """The check the spec runs on the box before the crontab goes in."""
    p = box.run("notify", "--test", ENV_FILE="/dev/null")
    assert p.returncode == 2 and "DISCORD_WEBHOOK_URL is empty after loading /dev/null" in p.stderr


def test_a_webhook_in_the_callers_environment_does_not_excuse_a_broken_env_file(box):
    p = box.run("refresh", env_file=None, DISCORD_WEBHOOK_URL=HOOK)
    assert p.returncode == 2 and "can't read" in p.stderr


def test_an_env_file_that_errors_refuses_without_echoing_it(box):
    p = box.run("refresh", env_file=f"DISCORD_WEBHOOK_URL={HOOK}\nnot-a-command-pw-secret-1234\n")
    assert p.returncode == 2 and "didn't load cleanly" in p.stderr
    assert "not-a-command" not in p.stderr


def test_it_refuses_without_the_venv_python(box):
    p = box.run("refresh", REFRESH_PYTHON=str(box.tmp / "missing" / "python"))
    assert p.returncode == 2 and "no Python at" in p.stderr


def test_it_refuses_without_arguments(box):
    p = box.run()
    assert p.returncode == 2 and "no arguments" in p.stderr


def test_a_failed_db_lookup_warns_and_leaves_the_rest_to_the_preflight(box):
    p = box.run("refresh", FAKE_DB_IP=None)
    assert p.returncode == 0 and "USC_DB_HOST=db" in p.stdout.splitlines()
    assert "couldn't find the IP of container usc_scheduler_db" in p.stderr


def test_the_env_file_and_container_can_be_overridden(box):
    other = box.tmp / "prod.env"
    other.write_text(GOOD_ENV.replace("20263,20271", "20271"))
    p = box.run("probe", env_file=None, ENV_FILE=str(other), REFRESH_DB_CONTAINER="other_db",
                EXPECT_CONTAINER="other_db", FAKE_DB_IP="10.0.0.9")
    assert p.returncode == 0
    assert "ACTIVE_SEMESTERS=20271" in p.stdout and "USC_DB_HOST=10.0.0.9" in p.stdout
