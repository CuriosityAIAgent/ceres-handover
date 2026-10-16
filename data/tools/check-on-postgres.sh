#!/usr/bin/env bash
# Load the whole package into a throwaway PostgreSQL 16 cluster, run every check, then stop and delete the cluster.
#
#   tools/check-on-postgres.sh
#
# PGBIN: PostgreSQL 16's bin directory (default: Homebrew's postgresql@16). The cluster lives in a new folder under
# /tmp, listens on 127.0.0.1 on the first free port from 55432, and is deleted on exit, pass or fail.
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d /tmp/ceres-pg.XXXXXX)"

cleanup() {
  if [ -f "$WORK/data/postmaster.pid" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  echo "cluster stopped and $WORK deleted"
}
trap cleanup EXIT

PORT=""
for p in $(seq 55432 55499); do
  if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && [ ! -e "/tmp/.s.PGSQL.$p" ]; then PORT="$p"; break; fi
done
[ -n "$PORT" ] || { echo "no free port between 55432 and 55499" >&2; exit 1; }

"$PGBIN/initdb" -D "$WORK/data" -U ceres --auth=trust -E UTF8 --locale=C >"$WORK/initdb.log"
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1 -c timezone=UTC" -l "$WORK/server.log" -w start >/dev/null
"$PGBIN/createdb" -h "$WORK" -p "$PORT" -U ceres ceres
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=ceres PGDATABASE=ceres PSQL="$PGBIN/psql"
echo "$("$PSQL" -X -t -A -c 'SELECT version()') on port $PORT, in $WORK"

run() {
  local file="$1"; shift
  echo "== $file"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@" -f "$HERE/sql/$file"
}
run 01-schema.sql
run 02-questionnaire-v3.sql
run 03-sample-respondent.sql
run 04-analysis-queries.sql -o /dev/null
run 05-checks.sql | grep -E '^(ok|all checks)'
echo "== tools/verify.mjs"
node "$HERE/tools/verify.mjs"

# SHOW="Q2 Q8": also print those queries of 04 with their results
for q in ${SHOW:-}; do
  echo "== 04 [$q]"
  node -e '
    const [file, id] = process.argv.slice(1)
    const block = require("fs").readFileSync(file, "utf8").split(/^(?=-- \[Q\d+\])/m).find((b) => b.startsWith(`-- [${id}]`))
    if (!block) { console.error(`no query ${id}`); process.exit(1) }
    process.stdout.write(block.slice(0, block.lastIndexOf(";") + 1) + "\n")
  ' "$HERE/sql/04-analysis-queries.sql" "$q" | "$PSQL" -X -q -v ON_ERROR_STOP=1 -P pager=off
done
echo "ALL PASSED"
