# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## OData Online Viewer

OData `$metadata` visualizer + data explorer. FastAPI + lxml backend, React/TS/Vite/Tailwind
frontend, served as one container. Third sibling of the **XSD Online Viewer**
(`~/webdav/online_viewer`, <https://www.xsd-viewer.online>) and the **XML Online Viewer**
(`~/webdav/xml-online-viewer`, <https://www.xml-viewer.online>); shares their architecture,
hardening and usage-statistics stack. Shared pieces (Dockerfile, `deploy.sh`, `usage/*`,
`cache.py`, `config.py`, `parser/security.py`, `parser/errors.py`, header/dialog components,
`useMediaQuery`, diagram export) were ported from them — keep the three in step.

## Layout

- `backend/app/odata/` — the domain:
  - `csdl_parser.py` parses EDMX 1.0 (V2/V3), EDMX 4.0 (V4/V4.01) and CSDL JSON into the
    version-neutral `model.py` (pydantic). Namespace-agnostic by local name. V2 associations
    become navigation properties with `multiplicity`/`source_multiplicity`, association sets
    become navigation bindings, `FunctionImport` becomes `Operation(kind="function_import")`,
    `sap:`/`m:` attributes become annotations (`term="sap:label"`); records and collections are
    kept as JSON in `Annotation.structured` (capped) for the Fiori view (`lib/fiori.ts`,
    `FioriSection.tsx`: Capabilities/sap: matrix per set, UI.LineItem/HeaderInfo/SelectionFields
    per type, property hints) and the Markdown export. Labels/descriptions are
    picked from `Common.Label`, `Core.Description`, `sap:label`, `sap:quickinfo`. Node ids are
    stable strings (`type:NS.T`, `prop:NS.T/P`, `set:NS.Container/S`, `op:NS.F#0`, …) shared
    with the frontend (`lib/modelIndex.ts`, deep links: `#/id/<id>?view=data&filter=…&select=…&orderby=…&top=…&skip=…`
    opens the explorer on that set and runs the query — `lib/deepLink.ts`, `odata/sample_pages.py`).
  - `service_url.py` normalises what the visitor pasted (service root ↔ `$metadata`, keeps
    `sap-client`, drops `$format`) and derives the service root *after* redirects (TripPin's
    session segment). `join_service_path` encodes spaces as `%20`, not `+`.
  - `data_client.py` builds entity-set queries (`$inlinecount`/`$format=json` for V2,
    `$count` for V4), normalises `{"d": {"results": …}}` and `{"value": …}` answers, converts
    `/Date(ms)/`, strips `__metadata`, turns `__deferred` into `{"@link": uri}`. `$top ≤ 500`.
    Next links must stay on the service (`same_service`).
  - `exports.py` — Markdown docs and Mermaid `erDiagram`.
  - `xlsx_export.py` — Excel export of the data explorer (`POST /data/export`, scope `page`
    posts the shown rows, scope `all` pages through the set: next links within one `$top=500`
    request, then `$skip`; `DATA_EXPORT_MAX_ROWS` 50k, `DATA_EXPORT_DEADLINE_SECONDS` 90 below
    Cloud Run's 120 s). Cells typed from the model's Edm types; strings never become formulas.
  - `samples/` — bundled `$metadata` snapshots + `samples.json` (live URL per sample; the
    loader tries live first so the data explorer works, falls back to the snapshot with a notice).
- `backend/app/api/` — `metadata.py` (url/text/upload, source, exports; `StoredMetadata` in
  `cache.metadata_cache`, id = sha256(content + service root)), `data.py` (`/data/query`,
  `/data/raw`), `samples.py`, `feedback.py`, `go.py`, `_common.py` (`reject()` — never emit twice).
- `backend/app/spa.py` — SPA shell with per-route title/description/canonical (`ROUTE_META`,
  `SITE_ORIGIN` env). **New client routes must be added there**; everything else is a 404
  (no fake page views from scanners). `index.html` → route `""`. Also `/sitemap.xml` (generated)
  and `/<INDEXNOW_KEY>.txt`; the home FAQ replaces `<!--faq-->`/`<!--faq-jsonld-->` in `index.html`.
- `backend/app/content/` — server-rendered pages without JS (SEO): `pages/**/*.md` with TOML front
  matter between `+++`, served at their path; `faq.toml` (home FAQ, also `GET /api/content/faq`);
  `site.py` holds the per-site constants and the FreeXmlToolkit family list — the rest of the
  package is shared with the sibling viewers, keep it in step. `app/odata/sample_pages.py` adds
  `/samples/<id>` via `register_provider`. Links into the app use the deep-link format above.
- **Content links.** `/guides` is generated from all pages per `site.HUB_SECTIONS`; a test
  fails on any page it cannot reach. The SPA landing links the main pages and `/guides`;
  `GET /api/content/pages` lists the slugs that exist.
- `backend/app/parser/security.py` — hardened lxml parser, `inspect_dtd`, and `fetch_url`
  (SSRF guard: public IPs only, pinned connection, tries every resolved address IPv4-first,
  redirect cap, byte cap, `headers=` for Accept/Authorization, `FetchHttpError` with status).
  **Credentials only ever travel over https and are dropped when a redirect changes the host.**
- `frontend/src/` — `App.tsx` (layout tiers, arrival `?url=`/`?sample=`, hash sync),
  `stores/appStore.ts` (model + `ModelIndex`, selection, `viewMode`, diagram options, data
  explorer state, `auth` in memory only), `lib/modelIndex.ts` (byId, typesByName, setsByType,
  derivedTypes, boundOperations, usedBy), `lib/deepLink.ts`, components:
  `Uploader` (URL+Basic Auth / paste / file / samples), `Landing`, `ModelTree` (react-virtuoso
  rows from `treeRows.ts`), `DetailPanel` (per node kind), `DiagramView` (`buildGraph.ts` →
  `layout.ts` ELK layered, lazy-loaded; `EntityNode.tsx`; focus mode; cap 150 nodes),
  `TextView` (CodeMirror, jump to `line`), `DataExplorer` (Copy as … via `lib/copyAsCode.ts`,
  credentials only as placeholders; Share query), `SearchPalette`. "Open in XML Viewer"
  (`lib/xmlViewerHandoff.ts`) posts the EDMX to xml-viewer.online `?from=odata-viewer`; the shell
  sends `Cross-Origin-Opener-Policy: same-origin-allow-popups` so the popup keeps its opener.
  Icons: `components/Icon.tsx` (inline Lucide paths, `currentColor`, `KeyIcon` for keys) —
  no emoji as icons, they ignore text colour and render differently per platform.
- **Responsive tiers.** Phone `< md` (768): one pane at a time via the bottom `MobileNav`
  (Tree / Details / Diagram / Data / Source). Tablet `md`–`lg`: tab strip + a tree drawer
  (Escape / tap outside / picking a node closes it). Desktop `≥ lg`: tree column + tabbed
  content; the column folds away (« in its header, 🌳 Tree brings it back, `odv-tree-hidden` in
  localStorage). `lib/useMediaQuery.ts` must stay in sync with the Tailwind screens.
- **Expired cache entries.** `TtlCache` expiry is sliding; `api/client.ts` remembers the last
  loader and `withReload` repeats it on "Metadata not found or expired" (ids are content hashes).
- **Usage statistics** (`docs/USAGE_STATS.md`): off unless `USAGE_DB_URL` is set. Events:
  `page_view`, `metadata_load` (source url|text|upload|sample, `schema_name` = requested
  `$metadata` URL without query or file name, `target_namespace` = first schema namespace,
  `element_count` = entity types, `type_count` = complex+enum, `odata_version`), `data_query`
  (source query|next|raw, `schema_name` = service root, `target_namespace` = entity set,
  `element_count` = rows), `export` (source markdown|mermaid|source; `xlsx_page`|`xlsx_all`
  with `schema_name` = service root, `target_namespace` = entity set, `element_count` = rows),
  `share` (source service|query, pinged by the share buttons). `page_view` stores `utm_source`/
  `utm_medium`/`utm_campaign` (slugs only); `/go/xsd-viewer` etc. send visitors to the sister
  sites with `utm_source=odata-viewer` (the sites send no Referer). **New usage columns must be
  added to the DB (`backend/sql/usage_stats.sql`) before deploying** — the insert names every column.
  Never URLs with
  credentials, never document content. Column `odata_version` is new compared to the siblings
  (`backend/sql/usage_stats.sql`). Feedback columns: `service_name`, `entity_name`.

## Local dev / test

```bash
cd backend && pip install -e ".[dev]" && uvicorn app.main:app --reload --port 8080
cd frontend && npm install && npm run dev          # proxies /api -> 8080
cd backend && pytest && ruff check .
cd frontend && npm run lint && npm test && npm run build
docker compose up --build                          # full image at http://127.0.0.1:8094
```

Single tests: `cd backend && pytest tests/test_csdl_parser.py -k <name>`;
`cd frontend && npx vitest run tests/modelIndex.test.ts` (vitest only picks up
`frontend/tests/**/*.test.{ts,tsx}`, setup in `tests/setup.ts`); `cd e2e && npx playwright test
tests/viewer.spec.ts --project=desktop` (projects: `desktop`, `phone`, `tablet`; `npm run test:mobile`
runs the last two). Ruff line length is 110; `tests/*` may exceed it for inline fixtures.

E2E (Playwright: desktop, phone, tablet in Chromium): build the frontend first, then
`cd e2e && npm install && npx playwright install chromium && npx playwright test`. The config
boots the backend with `STATIC_DIR=../frontend/dist`; set `E2E_PORT=8097` if 8080 is taken, or
`E2E_EXTERNAL=1 E2E_BASE_URL=http://127.0.0.1:8094` against the compose image. The specs use
the bundled samples (`?live=false`), so they run offline.

`npm install` on Node 20 / npm 10 may hit npm's `edgesOut` arborist bug; `--legacy-peer-deps`
works. lxml is pinned `<7` (wheels for Python 3.12 in the image and 3.14 locally).

## Deployment

- **Local test instance:** <https://odata-viewer.status20.net> — `docker compose up -d --build`
  on the status20 host (port 127.0.0.1:8094), Apache vhost in
  `deploy/odata-viewer.status20.net/`. No usage DB there.
- **Public site:** Google Cloud Run, project **`odata-viewer-online`**, service
  `odata-online-viewer`, region `europe-west1`, domain mapping `www.odata-viewer.online` (+ apex,
  which `main.py` redirects to the www `SITE_ORIGIN`: 301 for GET/HEAD, 308 otherwise).
  `scripts/deploy.sh` passes the COMPLETE env-var list and the secrets `odataviewer-*`.
  **Always pass `--project odata-viewer-online` explicitly** — the active gcloud config may point
  at another project. Session affinity is on because parsed metadata lives per instance.
- `tools/usage_report.py`, `tools/feedback_report.py` — reports over the usage DB; operations docs
  in `docs/` (`DEPLOY_CLOUD_RUN.md`, `USAGE_STATS.md`, `FEEDBACK.md`).
- `README.md` is user-facing (what the tool is for, `docs/media/overview.gif`); technical content
  goes to `docs/TECHNICAL.md`. Regenerate the GIF with `cd e2e && node scripts/record-overview.mjs`
  (needs ffmpeg, loads Northwind live), the PNGs with `scripts/screenshots.mjs`.
- CI (`.github/workflows/ci.yml`): backend ruff+pytest, frontend lint+build, image to GHCR on main/tags.

## Conventions

English in code, comments and UI; commit messages like the sibling repos (imperative subject,
short body). Keep comments about *why*, not *what*. Do not add tracking, ads or external
scripts (CSP is `script-src 'self'`).
