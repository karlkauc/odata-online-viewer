# User feedback (POST /api/feedback)

The 💬 Feedback dialog in the header posts to `POST /api/feedback`
(`backend/app/api/feedback.py`, 5 requests/min/IP, honeypot field `website`).
Message + optional e-mail, the SPA path, the loaded service URL or file name (never credentials), the selected node, an error
detail (when opened from an error), user agent and app version are stored.
**No IP address, no file contents.**

- `USAGE_DB_URL` (or the legacy override `FEEDBACK_DB_URL`) set ⇒ rows go to
  the Postgres `feedback` table (`backend/sql/feedback.sql`, store in
  `backend/app/usage/feedback.py`). Since usage tracking was added
  (`docs/USAGE_STATS.md`) the row also carries `visitor_hash`, `country_code`
  and `device` — the same anonymised visitor columns as `usage_event`
  (`ALTER TABLE … ADD COLUMN IF NOT EXISTS` at the end of `feedback.sql`
  and in `usage_stats.sql`).
- Not set (local dev, tests) ⇒ the feedback is written to the application log
  at WARNING level (`"user feedback (no FEEDBACK_DB_URL configured)"`).

## Production database

Shared **PostgreSQL 18** on the Hetzner VPS `tanzapp-prod` (62.238.116.11),
same pattern as the XSD/XML viewers:

- DB `odataviewer_stats`, role `odataviewer` (owner). Password in
  `/home/deploy/odataviewer-db-password.txt` on the server and in Secret Manager
  `odataviewer-db-password` (project `odata-viewer-online`).
- `pg_hba.conf`: `hostssl odataviewer_stats odataviewer 0.0.0.0/0 scram-sha-256`
  (+ `::/0`) — TLS, this DB/role only. ufw already opens 5432/tcp;
  fail2ban jail `postgresql` bans after failed logins.
- Backups: Hetzner VM snapshots (daily, 7 rolling).

### One-time setup (repeat for a new environment)

```bash
# on the VPS
openssl rand -base64 30 | tr -d "/+=" | cut -c1-32 > /home/deploy/odataviewer-db-password.txt
sudo -u postgres psql -c "CREATE ROLE odataviewer LOGIN PASSWORD '…';" \
                      -c "CREATE DATABASE odataviewer_stats OWNER odataviewer;"
printf "hostssl odataviewer_stats odataviewer 0.0.0.0/0 scram-sha-256\nhostssl odataviewer_stats odataviewer ::/0 scram-sha-256\n" \
  | sudo tee -a /etc/postgresql/18/main/pg_hba.conf && sudo systemctl reload postgresql
PGPASSWORD=… psql -h 127.0.0.1 -U odataviewer -d odataviewer_stats -f backend/sql/feedback.sql
# then usage_stats.sql (docs/USAGE_STATS.md) — it ALTERs feedback, so feedback.sql goes first

# GCP secret (copy the password file's content; the compute service account reads it)
PROJECT_NUMBER=$(gcloud projects describe odata-viewer-online --format='value(projectNumber)')
gcloud services enable secretmanager.googleapis.com --project odata-viewer-online
ssh deploy@62.238.116.11 cat /home/deploy/odataviewer-db-password.txt \
  | tr -d '\n' | gcloud secrets create odataviewer-db-password --data-file=- --project odata-viewer-online
gcloud secrets add-iam-policy-binding odataviewer-db-password --project odata-viewer-online \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor
```

`scripts/deploy.sh` passes the DSN as `USAGE_DB_URL` and the password as
`USAGE_DB_PASSWORD` (secret `odataviewer-db-password`); the feedback store
falls back to those, `FEEDBACK_DB_URL`/`FEEDBACK_DB_PASSWORD` are optional
overrides. `gcloud run deploy … --set-env-vars …` **replaces** all plain env
vars, so always deploy with the script, which carries the complete list.

## Reading feedback

```bash
pip install --user "psycopg[binary]"
python3 tools/feedback_report.py                 # totals, per day, pages, latest 20
python3 tools/feedback_report.py --days 30 --full # last 30 days, full message text
```

Password comes from `$FEEDBACK_DB_PASSWORD` / `$PGPASSWORD` or, if unset,
from Secret Manager via `gcloud`. Direct access:
`psql "postgresql://odataviewer:…@62.238.116.11:5432/odataviewer_stats?sslmode=require"`.
