+++
title = "Debug Power BI and Excel OData.Feed errors with the service's $metadata"
heading = "Power BI OData.Feed: find out why the feed fails"
description = "\"The feed's metadata document appears to be invalid\", HTTP 406, missing columns: load the service's $metadata in the browser to see which entity set, type or property Power Query trips over."
lastmod = 2026-10-19
cta_label = "Load your service"
cta_href = "/"

[[faq]]
q = "Can I copy a working query into Power Query?"
a = "Yes. Build the query in the data explorer, then use Copy as → Power Query M. It produces an `OData.Feed(...)` call with the same URL and query options."
+++

Power BI Desktop, Excel and Dataflows read OData through `OData.Feed`. When that call fails, the message
rarely says which part of the service is the problem. The `$metadata` document usually does.

## "The feed's metadata document appears to be invalid"

Power Query parses the whole `$metadata` before it shows the navigator. Load the same URL here: the viewer
reports parse problems with line numbers and lists the model even when a part of it is odd. Things to look for:

- **Navigation properties pointing to types that do not exist** — shown as unresolved targets.
- **External annotation files** (`edmx:Reference`) that Power Query cannot fetch.
- **Very large services:** Power Query reads every entity set; check the counts on the overview.

## HTTP 406 on SAP Gateway V2

Power Query asks for `application/json;odata.metadata=minimal`, which older Gateway releases reject. The viewer
shows which version the service declares (`DataServiceVersion`) so you know whether to use
`OData.Feed(url, null, [Implementation="2.0"])`.

## Columns missing or of the wrong type

Open the entity type in the detail panel: types, nullability, precision and `sap:` flags are listed per
property. Properties with `sap:visible="false"` or without `sap:filterable` explain many surprises.

## Getting the query right first

Use the [data explorer](/features/explorer) to try `$filter`, `$select` and `$expand` against the live service,
then copy the result as Power Query M. Folding works best when the filter is already in the URL.
