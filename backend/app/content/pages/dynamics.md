+++
title = "Dynamics 365 and Dataverse OData $metadata viewer — Business Central, F&O, Dataverse"
heading = "Explore Dynamics 365 OData endpoints"
description = "Read the $metadata of Business Central, Finance & Operations and Dataverse OData endpoints as a tree and ER diagram, find entity sets and properties, and test queries."
lastmod = 2026-10-19
cta_label = "Open the viewer"
cta_href = "/"

[[faq]]
q = "My Dynamics endpoint needs OAuth. Can I use it here?"
a = "Not directly — the viewer supports HTTP Basic authentication only. Download the `$metadata` with a tool that has your token (Postman, PowerShell `Invoke-RestMethod`) and paste or upload the file; you then get the tree, diagram and exports without live data."
+++

Business Central, Finance & Operations and Dataverse publish OData V4 services with hundreds of entity
sets. Their `$metadata` documents run to many megabytes, which makes them hard to read in a browser tab.

## URL patterns

| Product | `$metadata` |
|---|---|
| Business Central (API v2.0) | `https://api.businesscentral.dynamics.com/v2.0/<tenant>/<environment>/api/v2.0/$metadata` |
| Business Central (web services) | `…/ODataV4/$metadata` |
| Finance & Operations | `https://<environment>.operations.dynamics.com/data/$metadata` |
| Dataverse | `https://<org>.crm.dynamics.com/api/data/v9.2/$metadata` |

All of them use Microsoft Entra ID (OAuth) tokens. Since the viewer forwards HTTP Basic credentials only, the
practical way is to save the `$metadata` once and **upload the file** — the viewer reads files of tens of
megabytes and stays fast thanks to a virtualised tree.

## What helps with these services

- **Search (Ctrl/⌘ + K)** across all entity sets, types and properties.
- **Focus mode** in the [ER diagram](/features/diagram) to draw only one entity and its neighbours.
- **Markdown export** as a starting point for interface documentation.
- `Core.Description` and `Common.Label` annotations shown next to the technical names.
