#!/usr/bin/env bash
# Cron entry point for run_semester_refresh.py on the Lightsail box.
#
#   ingestion/cron-wrapper.sh refresh --skip-profs     # the daily cron line
#   ingestion/cron-wrapper.sh profs                    # the weekly cron line
#   ingestion/cron-wrapper.sh notify --test            # the setup check, run before the crontab goes in
#
# Cron starts jobs with an almost empty environment, so this script:
#   1. loads the repo's .env into the environment (ENV_FILE overrides the path);
#   2. REFUSES TO RUN (exit 2) if DISCORD_WEBHOOK_URL is empty after that. Without
#      it the orchestrator only prints a warning, so an unattended run would fail
#      silently. This check is the only guard, and it can't alert either (there's
#      no URL to alert with), so its refusal goes to stderr (cron.log), and the
#      daily ✅ stops arriving;
#   3. points USC_DB_HOST at the db container's IP on the compose network. The
#      container publishes no port, and the host can't resolve the name "db".
#      If the lookup fails, the run goes ahead and the orchestrator's DB
#      preflight fails it with an alert;
#   4. runs the orchestrator from ingestion/ with the repo's venv Python.
# It never prints a value from .env. The exit code is the orchestrator's, or 2 for
# a refusal here.
#
# Overrides (for tests and odd layouts): ENV_FILE, REFRESH_PYTHON, REFRESH_DB_CONTAINER.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${ENV_FILE:-$REPO/.env}
PYTHON=${REFRESH_PYTHON:-$REPO/.venv/bin/python}
DB_CONTAINER=${REFRESH_DB_CONTAINER:-usc_scheduler_db}

say() { printf '%s cron-wrapper: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
refuse() { say "REFUSING TO RUN: $*"; exit 2; }

[ $# -gt 0 ] || refuse "no arguments (usage: cron-wrapper.sh refresh|probe|profs|notify [options])"
[ -r "$ENV_FILE" ] || refuse "can't read $ENV_FILE, so DISCORD_WEBHOOK_URL and the DB settings are missing"

# Its output is discarded: an error message from a malformed line could echo a value.
# errexit is off explicitly: bash 3.2 exits on a failing line inside `.` even within `if !`.
set +eu -a
# shellcheck disable=SC1090
. "$ENV_FILE" >/dev/null 2>&1
loaded=$?
set -eu +a
[ "$loaded" -eq 0 ] || refuse "$ENV_FILE didn't load cleanly (check it with: bash -n $ENV_FILE)"

[ -n "${DISCORD_WEBHOOK_URL:-}" ] || refuse "DISCORD_WEBHOOK_URL is empty after loading $ENV_FILE; \
without it, failed runs would go unreported. Add the line to that file (setup steps: ingestion/notify_discord.py)"
[ -x "$PYTHON" ] || refuse "no Python at $PYTHON (create it: python3 -m venv .venv && \
.venv/bin/pip install -r ingestion/requirements.txt, in $REPO)"

# The standard dirs go last, so an explicit PATH (tests, a manual run) wins.
export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin"
# Unbuffered, so cron.log shows the run as it happens and keeps its last lines if it's killed.
export PYTHONUNBUFFERED=1

db_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$DB_CONTAINER" \
        2>/dev/null || true)
db_ip=${db_ip%% *}
if [ -n "$db_ip" ]; then
    export USC_DB_HOST=$db_ip
else
    say "warning: couldn't find the IP of container $DB_CONTAINER; USC_DB_HOST stays ${USC_DB_HOST:-unset}" \
        "(a run that needs the DB will fail its preflight and alert)"
fi

say "run_semester_refresh.py $*"
cd "$REPO/ingestion"
exec "$PYTHON" run_semester_refresh.py "$@"
