#!/usr/bin/env bash

set -euo pipefail

# ---- staging-only settings (MUST differ from prod) ----------------------
APP_DIR=/opt/mycelium-staging              # where the staging app lives
STAGING_INI=/etc/mycelium/staging.ini      # the config (secrets) — off-repo
STATIC_DIR=/var/www/html/mycelium-staging  # nginx static root (prod: .../mycelium)
SERVICE=mycelium-staging                    # systemd unit (prod: vesta/mycelium)
DB=mycelium_staging                         # prod: mycelium
AUTH_DB=uniauth_staging                     # prod: uniauth
DB_USER=mycelium_staging

# ---- safety: never, ever operate on a non-staging database --------------
case "$DB$AUTH_DB" in
  *staging*staging*) : ;;  # ok, both names contain "staging"
  *) echo "REFUSING: DB names don't look like staging ($DB / $AUTH_DB)"; exit 1 ;;
esac

SRC="$(pwd)"                                # the CI checkout at this commit
echo ">> deploying ${1:-HEAD} from $SRC -> $APP_DIR"

# ---- 1. sync code onto the box (keep venv & uploads across deploys) ------
rsync -a --delete \
  --exclude '.git' \
  --exclude 'venv' \
  --exclude 'node_modules' \
  --exclude 'server.ini' \
  --exclude 'serviceAccountKey.json' \
  "$SRC"/ "$APP_DIR"/

cd "$APP_DIR"

# ---- 2. dependencies (venv persists in APP_DIR) --------------------------
if [ ! -d venv ]; then python3 -m venv venv; fi
source venv/bin/activate
pip install -q -r requirements.txt
vesta install

# ---- 3. stop staging (frees DB connections before the drop) --------------
echo ">> stopping $SERVICE"
sudo systemctl stop "$SERVICE" || true

# ---- 4. drop + recreate the staging databases ----------------------------
echo ">> recreating $DB / $AUTH_DB"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
  DROP DATABASE IF EXISTS ${DB} WITH (FORCE);
  DROP DATABASE IF EXISTS ${AUTH_DB} WITH (FORCE);
  CREATE DATABASE ${DB} OWNER ${DB_USER};
  CREATE DATABASE ${AUTH_DB} OWNER ${DB_USER};
SQL

# ---- 5. schema + demo data ----------------------------------------------
echo ">> loading schema"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f db/schema.sql

if [ -f db/demo_data.sql ]; then
  echo ">> loading demo data"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f db/demo_data.sql
else
  echo "!! db/demo_data.sql not found — starting with an empty DB"
fi

# ---- 6. publish static + apply the staging config, then start ------------
echo ">> publishing static"
mkdir -p "$STATIC_DIR/static"
rsync -a --delete static/ "$STATIC_DIR/static/"

echo ">> applying staging config + starting"
cp "$STAGING_INI" "$APP_DIR/server.ini"

# Firebase Admin SDK key (push notifications) — kept off-repo, provided as a
# masked/protected GitLab CI/CD variable (Settings > CI/CD > Variables).
# Never committed; decoded straight onto the box at deploy time.
if [ -n "${FIREBASE_ADMIN_KEY_BASE64:-}" ]; then
  echo "$FIREBASE_ADMIN_KEY_BASE64" | base64 -d > "$APP_DIR/serviceAccountKey.json"
  chmod 600 "$APP_DIR/serviceAccountKey.json"
else
  echo "!! FIREBASE_ADMIN_KEY_BASE64 not set in CI/CD variables — push notifications will stay disabled"
fi

sudo systemctl start "$SERVICE"

echo ">> deployed: $(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo "$1")"

# -------------------------------------------------------------------------
# ONE-TIME SETUP on this box (not done by CI):
#
#   sudo mkdir -p /opt/mycelium-staging /etc/mycelium /var/www/html/mycelium-staging
#   sudo chown -R gitlab-runner:gitlab-runner /opt/mycelium-staging /var/www/html/mycelium-staging
#
#   # the staging config (secrets) — see misc/staging.ini.example
#   sudo install -m 600 -o gitlab-runner misc/staging.ini.example /etc/mycelium/staging.ini
#   # then edit /etc/mycelium/staging.ini with real values
#
#   # postgres role for staging
#   sudo -u postgres psql -c "CREATE USER mycelium_staging WITH PASSWORD '...';"
#
#   # systemd unit
#   sudo cp misc/mycelium-staging.service /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable mycelium-staging
#
#   # let the runner manage the service + seed postgres without a password:
#   #   /etc/sudoers.d/mycelium-staging
#   #   gitlab-runner ALL=(root) NOPASSWD: /bin/systemctl start mycelium-staging, \
#   #                                       /bin/systemctl stop mycelium-staging, \
#   #                                       /bin/systemctl restart mycelium-staging
#   #   gitlab-runner ALL=(postgres) NOPASSWD: /usr/bin/psql
# -------------------------------------------------------------------------
