#!/usr/bin/env python3
"""Print a read-only overview of user feedback for the OData viewer.

Reads the `feedback` table (backend/sql/feedback.sql) in the Postgres on the
Hetzner VPS and prints: totals, per-day counts, pages, files that were loaded
when feedback was sent, app versions, and the latest messages. No writes.

Connection (env-overridable; defaults match the Cloud Run deploy):
    FEEDBACK_DB_HOST  (default 62.238.116.11)
    FEEDBACK_DB_NAME  (default odataviewer_stats)
    FEEDBACK_DB_USER  (default odataviewer)
Password: $FEEDBACK_DB_PASSWORD or $PGPASSWORD, else
    gcloud secrets versions access latest --secret=odataviewer-db-password --project odata-viewer-online

Requires: pip install --user "psycopg[binary]"

Usage:
    python3 tools/feedback_report.py               # everything, latest 20 messages
    python3 tools/feedback_report.py --days 30     # last N days
    python3 tools/feedback_report.py --limit 100   # more messages
    python3 tools/feedback_report.py --full        # full message text, one per block
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

try:
    import psycopg
except ImportError:
    sys.exit('psycopg not installed. Run:  pip install --user "psycopg[binary]"')

DEFAULT_HOST = "62.238.116.11"
DEFAULT_NAME = "odataviewer_stats"
DEFAULT_USER = "odataviewer"
PW_SECRET = "odataviewer-db-password"
GCP_PROJECT = "odata-viewer-online"


def resolve_password() -> str:
    pw = os.environ.get("FEEDBACK_DB_PASSWORD") or os.environ.get("PGPASSWORD")
    if pw:
        return pw
    try:
        out = subprocess.run(
            ["gcloud", "secrets", "versions", "access", "latest",
             f"--secret={PW_SECRET}", f"--project={GCP_PROJECT}"],
            check=True, capture_output=True, text=True,
        )
        return out.stdout.strip("\n")
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        detail = getattr(exc, "stderr", "") or str(exc)
        sys.exit(f"No DB password. Set $FEEDBACK_DB_PASSWORD or authenticate gcloud.\n{detail}")


def print_table(cur) -> None:
    cols = [d.name for d in cur.description]
    rows = cur.fetchall()
    widths = [len(c) for c in cols]
    for r in rows:
        for i, v in enumerate(r):
            widths[i] = max(widths[i], len("" if v is None else str(v)))
    print("  ".join(c.ljust(widths[i]) for i, c in enumerate(cols)))
    for r in rows:
        print("  ".join(("" if v is None else str(v)).ljust(widths[i]) for i, v in enumerate(r)))
    if not rows:
        print("(no rows)")


def main() -> None:
    ap = argparse.ArgumentParser(description="OData viewer feedback overview (read-only).")
    ap.add_argument("--days", type=int, default=None, help="restrict to the last N days")
    ap.add_argument("--limit", type=int, default=20, help="number of latest messages (default 20)")
    ap.add_argument("--full", action="store_true", help="print full message text, one block per entry")
    args = ap.parse_args()

    where = f"WHERE received_at > now() - interval '{int(args.days)} days'" if args.days else ""

    dsn = (
        f"host={os.environ.get('FEEDBACK_DB_HOST', DEFAULT_HOST)} "
        f"dbname={os.environ.get('FEEDBACK_DB_NAME', DEFAULT_NAME)} "
        f"user={os.environ.get('FEEDBACK_DB_USER', DEFAULT_USER)} "
        f"password={resolve_password()} sslmode=require"
    )
    scope = f"last {args.days} days" if args.days else "all time"
    print(f"OData Online Viewer — feedback overview ({scope})")

    queries = [
        ("Totals", f"""
            SELECT count(*) messages,
                   count(*) FILTER (WHERE email IS NOT NULL) with_email,
                   count(*) FILTER (WHERE error_detail IS NOT NULL) with_error,
                   min(received_at)::date first, max(received_at)::date last
            FROM feedback {where};"""),
        ("Per day (max. 14)", f"""
            SELECT received_at::date d, count(*) n
            FROM feedback {where} GROUP BY 1 ORDER BY 1 DESC LIMIT 14;"""),
        ("Pages", f"""
            SELECT coalesce(page,'?') page, count(*) n
            FROM feedback {where} GROUP BY 1 ORDER BY 2 DESC LIMIT 10;"""),
        ("Services loaded when feedback was sent", f"""
            SELECT coalesce(service_name,'-') service, coalesce(entity_name,'-') node, count(*) n
            FROM feedback {where} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10;"""),
        ("App versions", f"""
            SELECT coalesce(app_version,'?') version, count(*) n
            FROM feedback {where} GROUP BY 1 ORDER BY 2 DESC;"""),
        ("DB size", """
            SELECT pg_size_pretty(pg_total_relation_size('feedback')) table_size,
                   pg_size_pretty(pg_database_size(current_database())) db_size;"""),
    ]

    with psycopg.connect(dsn, connect_timeout=20) as conn:
        for title, sql in queries:
            print(f"\n### {title}")
            with conn.cursor() as cur:
                cur.execute(sql)
                print_table(cur)

        print(f"\n### Latest {args.limit} messages")
        with conn.cursor() as cur:
            if args.full:
                cur.execute(f"""
                    SELECT received_at::timestamp(0), message, email, page, service_name, entity_name,
                           error_detail, user_agent, app_version
                    FROM feedback {where} ORDER BY received_at DESC LIMIT %s;""", (args.limit,))
                rows = cur.fetchall()
                if not rows:
                    print("(no rows)")
                for at, msg, email, page, service, node, err, ua, ver in rows:
                    print(f"\n--- {at}  v{ver or '?'}  page={page or '-'}  email={email or '-'}")
                    if service or node:
                        print(f"    service={service or '-'}  node={node or '-'}")
                    if err:
                        print(f"    error: {err}")
                    if ua:
                        print(f"    ua: {ua}")
                    print("    " + msg.replace("\n", "\n    "))
            else:
                cur.execute(f"""
                    SELECT received_at::timestamp(0) at, left(message, 100) message, email, page,
                           service_name, left(error_detail, 60) error_detail
                    FROM feedback {where} ORDER BY received_at DESC LIMIT %s;""", (args.limit,))
                print_table(cur)


if __name__ == "__main__":
    main()
