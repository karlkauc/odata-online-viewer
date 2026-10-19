+++
title = "OData explorer and query builder online — query entity sets with $filter, $select, $expand"
heading = "OData data explorer and query tester"
description = "Query any public or Basic-Auth-protected OData service from the browser: pick an entity set, build $filter, $select, $orderby, $expand and paging, see the request URL, copy it as curl, fetch, C#, Python or Power Query, export to Excel."
lastmod = 2026-10-19
cta_label = "Try it on Northwind"
cta_href = "/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data"

[[faq]]
q = "Can I share a query with a colleague?"
a = "Yes, for services without credentials: the share link contains the service URL, the entity set and the query options, and opens the same result for the recipient."

[[faq]]
q = "How many rows can I export?"
a = "The current page, or all rows of the entity set up to 50,000, as an Excel workbook with typed columns."
+++

Once the viewer has read a service's `$metadata`, the **Data** tab queries its entity sets for you. You pick
the set; the explorer knows its properties and navigations and fills the pickers accordingly.

- **Query options:** `$filter`, `$select` (property picker), `$orderby` (or click a column header), `$top`,
  `$skip`, `$expand`, `$search` (V4) and free custom parameters such as `sap-client`.
- **Counts and paging:** `$count=true` on V4, `$inlinecount=allpages` on V2; next links are followed with one click.
- **Readable results:** V2 `/Date(…)/` values shown as dates, `__metadata` removed, deferred navigations and
  foreign keys turned into links that open the related rows.
- **The exact request URL** is always visible — copy it, or use **Copy as** for curl, JavaScript `fetch`,
  C# `HttpClient`, Python `requests` and Power Query M. Credentials are never put into the snippet, only a placeholder.
- **Excel export** of the current page or the whole set, with columns typed from the model's Edm types.
- **Shareable query links** for public services: the URL carries service, set and query.

## Services behind a login

Enter user and password for HTTP Basic authentication. They stay in the tab's memory, go to the service over
HTTPS only, and are never stored or logged. Intranet addresses cannot be reached from this site; for those,
[run the viewer yourself](https://github.com/karlkauc/odata-online-viewer#self-host-with-docker).

See the [query options cheat sheet](/guides/odata-query-options) for examples you can run with one click.
