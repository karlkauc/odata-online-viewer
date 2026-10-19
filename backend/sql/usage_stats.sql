-- Usage statistics schema for the OData Online Viewer (docs/USAGE_STATS.md).
-- Column set is the XSD/XML viewers' usage_event plus odata_version, so one
-- dashboard can query all three databases; only the event_type list and the
-- meaning of a few columns differ (see the comments). Apply once by hand as the owning role; the
-- app never issues DDL. From the VPS (scp this file there first):
--   PGPASSWORD=$(cat /home/deploy/odataviewer-db-password.txt) \
--     psql "postgresql://odataviewer@127.0.0.1:5432/odataviewer_stats?sslmode=require" -f usage_stats.sql
-- or remotely over TLS:
--   psql "postgresql://odataviewer@62.238.116.11:5432/odataviewer_stats?sslmode=require" -f backend/sql/usage_stats.sql

CREATE TABLE IF NOT EXISTS usage_event (
  event_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at      timestamptz NOT NULL DEFAULT now(),
  event_type       text        NOT NULL CHECK (event_type IN ('page_view','metadata_load','data_query','export','share')),
  visitor_hash     text,                 -- sha256(daily salt | ip | user-agent), first 32 hex chars; no raw IP
  country_code     char(2),              -- ISO-3166-1 alpha-2 via GeoLite2, NULL if unknown
  user_agent       text,                 -- truncated to 255
  device           text,                 -- desktop | mobile | bot | unknown
  status_code      int,
  app_version      text,
  path             text,                 -- page_view: SPA path served
  referrer         text,                 -- scheme://host/path, no query
  source           text,                 -- metadata_load: upload|text|url|sample ; data_query: query|next|raw ; export: markdown|mermaid|source
  schema_name      text,                 -- metadata_load/export: $metadata URL without query, or file name ; data_query: service host (never content, never credentials)
  target_namespace text,                 -- metadata_load: first schema namespace ; data_query: entity set / resource path
  input_bytes      int,
  file_count       int,                  -- metadata_load: 1
  element_count    int,                  -- metadata_load: entity types ; data_query: rows returned
  type_count       int,                  -- metadata_load: complex + enum types
  diagnostic_count int,                  -- unused (NULL) in this app
  error_count      int,                  -- unused (NULL) in this app
  duration_ms      int,
  status           text,                 -- ok | parse_error | rejected | error | http_401 …
  error_detail     text,                 -- exception message, truncated to 255
  odata_version    text,                 -- 2.0 | 3.0 | 4.0 | 4.01 (metadata_load, data_query)
  utm_source       text,                 -- page_view: ?utm_source= slug (sister sites, posts), else NULL
  utm_medium       text,
  utm_campaign     text
);

ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS odata_version text;
-- Apply BEFORE deploying a release that writes them: the insert names every column.
ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS utm_source text;
ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS utm_medium text;
ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS utm_campaign text;
-- 'share' (copied share link) joined the event types later; widen the check in place.
ALTER TABLE usage_event DROP CONSTRAINT IF EXISTS usage_event_event_type_check;
ALTER TABLE usage_event ADD CONSTRAINT usage_event_event_type_check
  CHECK (event_type IN ('page_view','metadata_load','data_query','export','share'));

CREATE INDEX IF NOT EXISTS idx_usage_event_received  ON usage_event (received_at);
CREATE INDEX IF NOT EXISTS idx_usage_event_type_time ON usage_event (event_type, received_at);
CREATE INDEX IF NOT EXISTS idx_usage_event_visitor   ON usage_event (visitor_hash);
CREATE INDEX IF NOT EXISTS idx_usage_event_country   ON usage_event (country_code);

-- The feedback table (backend/sql/feedback.sql) gains the same anonymised
-- visitor columns as usage_event; idempotent for databases created earlier.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS visitor_hash text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS country_code char(2);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS device text;
