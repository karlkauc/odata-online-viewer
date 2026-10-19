# Technical reference

Operator- and developer-facing notes for self-hosting, configuring, securing and developing the
OData Online Viewer. For a feature tour, see the [README](../README.md). For deployment to
Google Cloud Run specifically, see [DEPLOY_CLOUD_RUN.md](DEPLOY_CLOUD_RUN.md).

The app is a single container: a multi-stage image builds the React/Vite frontend (Node) and
serves the static SPA together with the FastAPI + lxml backend from one Python runtime.

## Why a backend

Most OData services send no CORS headers and many need authentication, so the browser cannot
call them directly. The backend fetches `$metadata` and data on the visitor's behalf:

- **SSRF guards** — public addresses only, the resolved IP is pinned for the connection, every
  resolved address is tried IPv4-first, redirects and response sizes are capped.
  `ALLOWED_SCHEMA_HOSTS` can restrict the URL loader to a host allow-list.
- **Credentials** (HTTP Basic) are forwarded per request, only over HTTPS, dropped when a redirect
  changes the host, and never stored or logged. The frontend keeps them in memory only.
- **Hardened XML parsing** — no DTDs/entities (XXE, billion laughs), node and size limits.
- **Nothing on disk.** Parsed metadata lives in a short-lived, size-capped memory cache keyed by a
  content hash; the frontend transparently reloads an entry that has expired.

## How OData versions are handled

- **Metadata:** EDMX 1.0 (V2/V3), EDMX 4.0 (V4/V4.01) and CSDL JSON are parsed into one
  version-neutral model. V2 associations become navigation properties with multiplicities,
  association sets become navigation bindings, function imports become operations, `sap:` and
  `m:` attributes become annotations. Labels come from `Common.Label`, `Core.Description`,
  `sap:label` and `sap:quickinfo`.
- **Data explorer:** V2 queries use `$inlinecount=allpages` and `$format=json`, V4 uses `$count`.
  Answers in `{"d": {"results": …}}` and `{"value": …}` form are normalised; `/Date(ms)/` values
  become ISO dates, `__metadata` is stripped and `__deferred` turns into a link. `$top` is capped
  at 500; next links must stay on the same service.
- **Excel export:** scope *page* writes the rows shown, scope *all* pages through the set (next
  links, then `$skip`) up to `DATA_EXPORT_MAX_ROWS` (50,000) within
  `DATA_EXPORT_DEADLINE_SECONDS` (90 s, below Cloud Run's 120 s request timeout). Cells are typed
  from the model's Edm types; strings never become formulas.

## Self-hosting

Run the published image:

```bash
docker run --rm -p 8080:8080 ghcr.io/karlkauc/odata-online-viewer:latest
```

Open <http://localhost:8080>.

With the bundled `docker-compose.yml` (binds to `127.0.0.1:8094`, intended as a local sandbox):

```bash
docker compose up --build
```

A local instance behind Apache is described in
[`deploy/odata-viewer.status20.net/README.md`](../deploy/odata-viewer.status20.net/README.md).

## Configuration

All settings are environment variables (see `backend/app/config.py`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | listen port |
| `MAX_UPLOAD_MB` | `50` | upload / paste limit |
| `ALLOWED_SCHEMA_HOSTS` | *(any public host)* | comma-separated host regexes the URL loader may fetch from |
| `FETCH_TIMEOUT_SECONDS` / `FETCH_DEADLINE_SECONDS` | `10` / `60` | metadata fetch timeouts |
| `FETCH_MAX_RESPONSE_MB` / `FETCH_MAX_REDIRECTS` | `10` / `3` | metadata fetch caps |
| `DATA_TIMEOUT_SECONDS` / `DATA_MAX_RESPONSE_MB` | `30` / `5` | data explorer requests |
| `DATA_EXPORT_MAX_ROWS` / `DATA_EXPORT_DEADLINE_SECONDS` / `DATA_EXPORT_MAX_MB` | `50000` / `90` / `100` | Excel export of all rows |
| `CACHE_TTL_MIN` / `CACHE_MAX_ENTRIES` / `CACHE_MAX_MB` | `60` / `64` / `256` | parsed-metadata cache (sliding expiry) |
| `MAX_XML_NODES` | `500000` | parser node limit |
| `SITE_ORIGIN` | `https://www.odata-viewer.online` | canonical URLs; other hosts redirect here on the public site |
| `CORS_ALLOW_ORIGINS` | *(none)* | extra origins allowed to call the API |
| `TRUSTED_PROXY_HOPS` | `1` | proxies in front of the app (client IP for rate limits/stats) |
| `INDEXNOW_KEY` | empty | served as `/<key>.txt` for IndexNow; `tools/indexnow_ping.py` submits the sitemap |
| `STATIC_DIR` | `/app/static` | built frontend |
| `LOG_LEVEL` | `INFO` | |
| `USAGE_DB_URL` & co. | *(off)* | anonymous usage statistics, see [USAGE_STATS.md](USAGE_STATS.md) |
| `FEEDBACK_DB_URL` | `USAGE_DB_URL` | feedback form storage, see [FEEDBACK.md](FEEDBACK.md) |

## HTTP API

Interactive docs at `/api/docs`. Main endpoints:

| Method & path | Purpose |
|---|---|
| `POST /api/metadata/url` `{url, auth?}` | fetch and parse `$metadata` of a service |
| `POST /api/metadata/text` · `POST /api/metadata/upload` | parse pasted / uploaded CSDL (XML or JSON) |
| `GET /api/metadata/{id}` · `/source` · `/export/{markdown,mermaid,source}` | model, raw document, exports |
| `GET /api/samples` · `POST /api/samples/{id}/load` | built-in services (live, with bundled fallback) |
| `POST /api/data/query` | one page of an entity set, normalised V2/V4 |
| `POST /api/data/raw` | any resource path below the service root, JSON as is |
| `POST /api/data/export` | Excel export of the shown page or of all matching rows |
| `GET /api/content/faq` | the home FAQ (same source as the static shell) |
| `POST /api/usage/share?source=` | counts a copied share link (no body) |

Ids are content hashes; an expired cache entry is transparently reloaded by the frontend.

## Content pages

Besides the SPA, the backend serves plain HTML pages that work without JavaScript, so search
engines and visitors from a search see real text: `backend/app/content/pages/**/*.md` (TOML front
matter between `+++` lines: `title`, `description`, `heading`, `lastmod`, `cta_label`/`cta_href`,
`[[faq]]`) at the matching path, and one page per bundled sample at `/samples/<id>`
(`app/odata/sample_pages.py`). They share `template.html` and `/content.css`. `/sitemap.xml` is
generated from `ROUTE_META` plus these pages. The home FAQ (`app/content/faq.toml`) goes into the
static shell (with FAQPage JSON-LD) and is fetched by the React landing page.

## Repository layout

```
backend/   FastAPI app — app/odata/ (CSDL parser, data client, exports, Excel export),
           app/api/ (metadata, data, samples, feedback, go), app/parser/ (hardened lxml, SSRF-guarded fetch),
           app/spa.py (SPA shell with per-route meta, sitemap), app/content/ (server-rendered Markdown pages
           and the home FAQ), app/usage/ (anonymous usage statistics), tests/
frontend/  React 18 + TypeScript + Vite + Tailwind — src/components/{ModelTree,DetailPanel,DiagramView,TextView,DataExplorer,…},
           src/lib/modelIndex.ts (flat index over the model), src/stores/appStore.ts (zustand), tests/ (vitest)
e2e/       Playwright (desktop, phone, tablet); scripts/ for README screenshots and the overview GIF
deploy/    local test instance behind Apache (odata-viewer.status20.net)
scripts/   deploy.sh (Google Cloud Run)
tools/     usage and feedback reports, IndexNow ping
docs/      this page, Cloud Run, usage statistics, feedback
```

## Local development

```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8080            # API only, http://127.0.0.1:8080/api/docs

cd frontend && npm install && npm run dev             # http://localhost:5173, proxies /api → 8080

cd backend && pytest && ruff check .
cd frontend && npm run lint && npm test && npm run build
cd e2e && npm install && npx playwright install chromium && npx playwright test   # needs frontend/dist

docker compose up --build                             # full image at http://127.0.0.1:8094
```

The E2E specs use the bundled sample snapshots, so they run offline.

### README media

Both scripts drive a running instance (default `http://127.0.0.1:8094`) with Playwright:

```bash
cd e2e && node scripts/screenshots.mjs [baseUrl]       # docs/media/*.png + frontend/public/og-image.png
cd e2e && node scripts/record-overview.mjs [baseUrl]   # docs/media/overview.gif (needs ffmpeg and network)
```

## Deployment

The public site runs on Google Cloud Run — see `scripts/deploy.sh` and
[DEPLOY_CLOUD_RUN.md](DEPLOY_CLOUD_RUN.md). CI (`.github/workflows/ci.yml`) runs ruff, pytest,
lint and build and publishes the image to GHCR on `main` and tags.
