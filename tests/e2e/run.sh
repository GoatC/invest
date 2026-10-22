#!/usr/bin/env bash
# End-to-end check: builds the app, runs it against a local stand-in for Supabase (PostgreSQL 16,
# Supabase Auth, PostgREST and a small gateway) loaded with the migrations and demo seed, and
# drives it in Chromium. Made for Claude Code cloud sessions (Linux x86-64, run as root); see
# tests/e2e/README.md. Screenshots and logs go to $E2E_HOME (default /tmp/invest-e2e).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export REPO="$(cd "$HERE/../.." && pwd)"
export E2E_HOME="${E2E_HOME:-/tmp/invest-e2e}"
export BIN="$E2E_HOME/bin" LOGS="$E2E_HOME/logs" SHOTS="$E2E_HOME/shots" CSV="$E2E_HOME/demo-statement-big5.csv"
export PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}" PGDATA="${PGDATA:-/var/lib/postgresql/invest-e2e}" PGPORT="${PGPORT:-55432}"
export GATEWAY_PORT="${GATEWAY_PORT:-54321}" REST_PORT="${REST_PORT:-54330}" AUTH_PORT="${AUTH_PORT:-54331}" APP_PORT="${APP_PORT:-3100}"
export CHROMIUM="${CHROMIUM:-/opt/pw-browsers/chromium}"
POSTGREST_VERSION=v12.2.3
AUTH_VERSION=v2.177.0

# Throwaway credentials, new for every run and never written to the repository.
random() { node -e "console.log(require('node:crypto').randomBytes($1).toString('hex'))"; }
export JWT_SECRET="$(random 32)" PUBLISHABLE_KEY="sb_publishable_e2e_$(random 8)" SECRET_KEY="sb_secret_e2e_$(random 8)"
export OWNER_EMAIL='owner@example.com' OWNER_PASSWORD="$(random 12)"

mkdir -p "$BIN" "$LOGS" "$SHOTS"
rm -f "$SHOTS"/*.png

stop() {
  for name in app gateway postgrest auth; do
    [ -f "$E2E_HOME/$name.pid" ] && kill "$(cat "$E2E_HOME/$name.pid")" 2>/dev/null || true
    rm -f "$E2E_HOME/$name.pid"
  done
  runuser -u postgres -- "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap stop EXIT
stop

echo "1/7 binaries"
if [ ! -x "$BIN/postgrest/postgrest" ]; then
  mkdir -p "$BIN/postgrest"
  curl -sSfL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" | tar -xJ -C "$BIN/postgrest"
fi
if [ ! -x "$BIN/auth/auth" ]; then
  mkdir -p "$BIN/auth"
  curl -sSfL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$BIN/auth"
fi

echo "2/7 database"
rm -f "$PGDATA.log"
runuser -u postgres -- "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >"$LOGS/initdb.log"
runuser -u postgres -- "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" -l "$PGDATA.log" -w start >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$HERE/stand-in/bootstrap.sql"

echo "3/7 auth schema, app migrations, demo seed"
export GOTRUE_API_HOST=127.0.0.1 PORT="$AUTH_PORT" API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" GOTRUE_SITE_URL="http://127.0.0.1:$APP_PORT"
export GOTRUE_DB_DRIVER=postgres GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:auth@127.0.0.1:$PGPORT/postgres?sslmode=disable"
export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
# Gives new users the authenticated role, as on a hosted project (Auth logs a deprecation notice for it).
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=info
# Supabase Auth finds its own migrations relative to the working directory.
(cd "$BIN/auth" && ./auth migrate) >"$LOGS/auth-migrate.log" 2>&1
for file in "$REPO"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$file"; done
"${PSQL[@]}" -f "$REPO/supabase/seed.sql"
# The seed's newest rate again, dated today in Taipei: the trade form defaults to the trade date's
# rate, so the check reads the same whatever day it runs.
"${PSQL[@]}" -c "insert into public.fx_rates (pair, rate_date, rate, source) values ('USD/TWD', (now() at time zone 'Asia/Taipei')::date, 32.40, 'demo') on conflict do nothing;"

echo "4/7 services"
(cd "$BIN/auth" && exec ./auth serve) >"$LOGS/auth.log" 2>&1 &
echo $! >"$E2E_HOME/auth.pid"
PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:$PGPORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$REST_PORT" PGRST_DB_USE_LEGACY_GUCS=false \
  "$BIN/postgrest/postgrest" >"$LOGS/postgrest.log" 2>&1 &
echo $! >"$E2E_HOME/postgrest.pid"
node "$HERE/stand-in/gateway.mjs" >"$LOGS/gateway.log" 2>&1 &
echo $! >"$E2E_HOME/gateway.pid"
wait_for() { for _ in $(seq 1 100); do (echo >"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.2; done; echo "nothing on port $1" >&2; return 1; }
wait_for "$AUTH_PORT"; wait_for "$REST_PORT"; wait_for "$GATEWAY_PORT"

echo "5/7 owner account"
node --input-type=module -e "
  import { sign } from '$HERE/stand-in/jwt.mjs';
  const res = await fetch('http://127.0.0.1:$GATEWAY_PORT/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: process.env.PUBLISHABLE_KEY, authorization: 'Bearer ' + sign({ role: 'service_role' }, process.env.JWT_SECRET), 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD, email_confirm: true }),
  });
  if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
"
"${PSQL[@]}" -c "insert into private.app_owner (user_id) select id from auth.users where email = '$OWNER_EMAIL';"

echo "6/7 app (build and start)"
export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
# Web Push: a fresh VAPID pair for this run, and a stand-in push service on local HTTPS (drive.mjs)
# whose throwaway certificate the app and the push job trust, so a push goes all the way round.
eval "$(cd "$REPO" && node -e "const k = require('web-push').generateVAPIDKeys(); console.log('export NEXT_PUBLIC_VAPID_PUBLIC_KEY=' + k.publicKey + ' VAPID_PUBLIC_KEY=' + k.publicKey + ' VAPID_PRIVATE_KEY=' + k.privateKey)")"
export VAPID_SUBJECT="mailto:e2e@example.com" PUSH_PORT="${PUSH_PORT:-55443}"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" \
  -keyout "$E2E_HOME/push-key.pem" -out "$E2E_HOME/push-cert.pem" >"$LOGS/push-cert.log" 2>&1
# Added to any CA bundle already trusted (a proxy's, in cloud sessions), not in place of it.
{ [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && cat "$NODE_EXTRA_CA_CERTS"; cat "$E2E_HOME/push-cert.pem"; } >"$E2E_HOME/extra-ca.pem"
export PUSH_KEY="$E2E_HOME/push-key.pem" PUSH_CERT="$E2E_HOME/push-cert.pem" NODE_EXTRA_CA_CERTS="$E2E_HOME/extra-ca.pem"
(cd "$REPO" && node node_modules/next/dist/bin/next build) >"$LOGS/next-build.log" 2>&1 || { tail -30 "$LOGS/next-build.log"; exit 1; }
(cd "$REPO" && exec node node_modules/next/dist/bin/next start -p "$APP_PORT" -H 127.0.0.1) >"$LOGS/app.log" 2>&1 &
echo $! >"$E2E_HOME/app.pid"
wait_for "$APP_PORT"

echo "7/7 browser"
iconv -f UTF-8 -t BIG5 "$HERE/demo-statement.csv" >"$CSV"
node "$HERE/drive.mjs"
echo "screenshots: $SHOTS"
