# OData Online Viewer

**<https://www.odata-viewer.online>** — visualize the `$metadata` of any OData service (V2, V3, V4, V4.01)
as a tree, an entity-relationship diagram or highlighted source, and query its entity sets live.
Free, open source, no account.

Sister tools by the same author: [Online XSD Viewer](https://www.xsd-viewer.online) and
[XML Online Viewer](https://www.xml-viewer.online).

## What it does

- **Load** a service by URL (service root or `…/$metadata`), paste the document, or upload an
  EDMX/CSDL file. Protected services: HTTP Basic credentials are forwarded per request over HTTPS
  and never stored. Built-in samples: Northwind (V2/V4), TripPin, OData.org demo, JdbcOdata.
- **Tree & details** — schemas, entity containers, entity sets, singletons, entity/complex/enum
  types, type definitions, functions, actions and imports; keys, facets, labels, annotations,
  inherited members, "exposed as", "derived types", "bound operations".
- **ER diagram** (React Flow + ELK) — entity types as boxes, navigations as edges with
  `1 / 0..1 / *` multiplicities, inheritance, optional complex types; focus mode for big models;
  PNG/SVG export.
- **Source** — the raw `$metadata` with jump-to-line from any node.
- **Data explorer** — `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`, `$expand`,
  `$search`, custom parameters, paging via next links; V2 answers are normalised (dates,
  `__deferred`, `__count`). The exact request URL is shown for reuse in Excel / Power BI / curl.
  **Excel export** of the shown page or of all matching rows (paged through by the backend, up
  to 50,000 rows), with numbers and dates typed from the model and a sheet describing the query.
- **Exports** — Markdown documentation, Mermaid `erDiagram`, the source document.
- **Shareable links** — `?url=…` loads a public service on arrival, `#/id/…?view=…` restores the
  selection and view.

Why a backend: most OData services send no CORS headers and many need authentication, so the
browser cannot call them directly. The FastAPI backend fetches metadata and data with SSRF
guards (no private addresses, pinned IPs, size and redirect caps) and keeps parsed metadata in a
short-lived memory cache. Nothing is written to disk.

## Repository layout

```
backend/   FastAPI app — app/odata/ (CSDL parser, data client, exports), app/api/ (metadata, data, samples, feedback, go),
           app/spa.py (SPA shell with per-route meta), app/usage/ (anonymous usage statistics), tests/
frontend/  React 18 + TypeScript + Vite + Tailwind — src/components/{ModelTree,DetailPanel,DiagramView,TextView,DataExplorer,…},
           src/lib/modelIndex.ts (flat index over the model), src/stores/appStore.ts (zustand), tests/ (vitest)
e2e/       Playwright (desktop, phone, tablet)
deploy/    local test instance behind Apache (odata-viewer.status20.net)
scripts/   deploy.sh (Google Cloud Run)
docs/      operations: Cloud Run, usage statistics, feedback, technical notes
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

Configuration is by environment variable (see `backend/app/config.py`): upload and fetch limits,
`DATA_TIMEOUT_SECONDS` / `DATA_MAX_RESPONSE_MB` for the data explorer,
`DATA_EXPORT_MAX_ROWS` / `DATA_EXPORT_DEADLINE_SECONDS` for the Excel export, `ALLOWED_SCHEMA_HOSTS`
to lock the URL loader down to a host allow-list, `SITE_ORIGIN` for canonical URLs,
`USAGE_DB_URL` & co. for statistics (off by default).

## API

Interactive docs at `/api/docs`. Main endpoints:

| Method & path | Purpose |
|---|---|
| `POST /api/metadata/url` `{url, auth?}` | fetch and parse `$metadata` of a service |
| `POST /api/metadata/text` · `POST /api/metadata/upload` | parse pasted / uploaded CSDL (XML or JSON) |
| `GET /api/metadata/{id}` · `/source` · `/export/{markdown,mermaid,source}` | model, raw document, exports |
| `GET /api/samples` · `POST /api/samples/{id}/load` | built-in services (live, with bundled fallback) |
| `POST /api/data/query` | one page of an entity set, normalised V2/V4 |
| `POST /api/data/raw` | any resource path below the service root, JSON as is |

Ids are content hashes; an expired cache entry is transparently reloaded by the frontend.

## Deployment

Public site: Google Cloud Run, see `scripts/deploy.sh` and `docs/DEPLOY_CLOUD_RUN.md`. The CI
workflow also publishes an image to GHCR. A local Docker instance behind Apache is described in
`deploy/odata-viewer.status20.net/README.md`.

## License

MIT — © 2026 Karl Kauc. Sample metadata documents are snapshots of public demo services
(services.odata.org) included for offline use and tests.
