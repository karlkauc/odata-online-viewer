+++
title = "SAP OData metadata viewer — Gateway, RAP and CAP services as tree and diagram"
heading = "View SAP Gateway OData services"
description = "Inspect SAP Gateway, RAP and CAP OData services: entity sets, sap:label and sap:creatable annotations, UI and Capabilities vocabularies, ER diagram, live data with sap-client and Basic Auth."
lastmod = 2026-10-19
cta_label = "Open the viewer"
cta_href = "/"

[[faq]]
q = "Where is the $metadata of my Gateway service?"
a = "`https://<host>:<port>/sap/opu/odata/sap/<SERVICE_NAME>/$metadata` for V2 services registered in `/IWFND/MAINT_SERVICE`, and `/sap/opu/odata4/sap/<group>/srvd_a2x/sap/<service>/0001/$metadata` for V4 (RAP) services. Add `?sap-client=100` if your system needs a client."

[[faq]]
q = "Can the viewer reach our on-premise system?"
a = "Only if the Gateway is reachable from the internet. Intranet hosts are blocked on purpose. For internal systems, run the viewer as a Docker container inside your network — it is open source."

[[faq]]
q = "Is it safe to enter my SAP user?"
a = "The credentials are forwarded per request over HTTPS and never stored or logged, but they do pass through this site's server. Prefer a technical user with read-only roles, or self-host the viewer."
+++

SAP services are OData too, but they carry a lot more than the plain model: `sap:label` texts in the logon
language, `sap:creatable`/`sap:updatable`/`sap:deletable` flags, `sap:filterable` and `sap:sortable` per
property, and — in V4 and Fiori elements apps — `UI`, `Common` and `Capabilities` annotations. The viewer reads
all of them.

## URL patterns

| Service type | `$metadata` URL |
|---|---|
| SEGW / Gateway V2 | `/sap/opu/odata/sap/ZMY_SRV/$metadata` |
| RAP V4 | `/sap/opu/odata4/sap/zui_my_o4/srvd_a2x/sap/zui_my/0001/$metadata` |
| CAP (Node/Java) | `/odata/v4/<service>/$metadata` |
| SuccessFactors | `https://<api-server>/odata/v2/$metadata` |
| Business Accelerator Hub sandbox | the URL shown in the API's "API Reference" with your API key |

Paste the service root or the `$metadata` URL; `sap-client` is kept, `$format` is dropped.

## What you see

- Labels from `sap:label` / `Common.Label` next to every technical name, in the tree and in the tables.
- An overview per entity set of what it allows: create, update, delete, filter, sort, paging — combined from
  `sap:` attributes and `Capabilities` restrictions.
- `UI.LineItem`, `UI.HeaderInfo` and `UI.SelectionFields` as tables, so you can check what a Fiori elements
  list report will show before you start the app.
- The ER diagram of the service, and live data with `sap-client` and Basic Auth.

## Typical problems

- **CORS** does not matter here: the viewer calls the service from its backend, not from your browser.
- **HTTP 403 with a CSRF message** only happens for write requests; the viewer only reads.
- **V2 vs V4:** the same business object often exists in both; see [V2 vs V4 side by side](/guides/odata-v2-vs-v4).
