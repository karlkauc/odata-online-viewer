+++
title = "XOData alternative: a free online OData visualizer with Basic Auth and live data"
heading = "Looking for an XOData alternative?"
description = "Comparison of the Online OData Viewer and XOData: OData V2–V4.01, ER diagram, private services with Basic Auth, data explorer, exports, open source and self-hostable."
lastmod = 2026-10-19
cta_label = "Try it with Northwind"
cta_href = "/?sample=northwind-v4"
+++

XOData by PragmatiQa was for years *the* way to look at an OData service as a diagram, and it is still listed
on odata.org and Microsoft Learn. Its online version only works with publicly accessible services; private
ones needed the Chrome App, and Chrome Apps are no longer supported on Windows, macOS and Linux. If you landed
here looking for something that works with private services too, this page is for you (as of October 2026).

What the Online OData Viewer offers:

| | Online OData Viewer |
|---|---|
| OData versions | V2, V3, V4, V4.01 (EDMX XML and CSDL JSON) |
| Private services | HTTP Basic Auth, forwarded over HTTPS, never stored |
| Input | service URL, `$metadata` URL, pasted text, uploaded file |
| ER diagram | multiplicities on both ends, inheritance, complex types, focus mode |
| Live data explorer | `$filter`, `$select`, `$orderby`, `$expand`, `$search`, paging, count, Excel export |
| SAP annotations, UI/Capabilities vocabularies | summarised per entity set and property |
| Exports | PNG, SVG, Mermaid `erDiagram`, Markdown, raw source |
| Shareable links | to a service, node, view and query |
| Licence | open source (MIT), self-hostable with Docker |
| Price | free, no account |

For XOData's current feature set, see [pragmatiqa.com](https://pragmatiqa.com/xodata/).

## When XOData may still be the better fit

If XOData already works for your public services, keep it. The two tools coexist happily — paste the same
`$metadata` URL into both and compare.

## Moving over

There is nothing to migrate: paste the service URL (or the `$metadata` URL) into the field on the
[start page](/). Bookmark the result — the link reloads the same service and node.
