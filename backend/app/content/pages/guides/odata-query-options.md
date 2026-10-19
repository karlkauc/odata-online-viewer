+++
title = "OData query options cheat sheet: $filter, $select, $expand, $orderby, $top, $skip, $count"
heading = "OData query options cheat sheet"
description = "Every OData system query option with V2 and V4 syntax and an example you can run live against the public TripPin and Northwind services in the browser."
lastmod = 2026-10-19
cta_label = "Open the TripPin data explorer"
cta_href = "/?sample=trippin-v4#/id/set%3ATrippin.Container%2FPeople?view=data"

[[faq]]
q = "Why does $count not work on my V2 service?"
a = "OData V2 has no `$count=true`. Use `$inlinecount=allpages` to get the total next to the rows, or `/EntitySet/$count` for the number alone. The viewer picks the right one from the service's version."

[[faq]]
q = "Are query options case-sensitive?"
a = "The option names (`$filter`, `$top`) are lower case in the specification; V4.01 services may accept other casings, older ones often do not. Property names are always case-sensitive."
+++

OData services share one URL grammar for querying entity sets. The options below go into the query
string after the entity set, for example `People?$filter=…&$top=10`. Each **Try it** link opens the viewer with
the query already filled in and runs it against the public sample service — no URL typing, and the exact
request URL is shown next to the results.

## $filter — which rows

| Purpose | Expression | Try it |
|---|---|---|
| Equality | `FirstName eq 'Scott'` | [TripPin People](/?sample=trippin-v4#/id/set%3ATrippin.Container%2FPeople?view=data&filter=FirstName%20eq%20'Scott') |
| Comparison | `UnitPrice gt 50` | [Northwind Products](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data&filter=UnitPrice%20gt%2050) |
| Logical | `UnitPrice gt 20 and Discontinued eq false` | [Northwind Products](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data&filter=UnitPrice%20gt%2020%20and%20Discontinued%20eq%20false) |
| String function | `startswith(CompanyName,'A')` (V4), `startswith(CompanyName,'A') eq true` (V2) | [Northwind Customers](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FCustomers?view=data&filter=startswith(CompanyName%2C'A')) |
| Contains | `contains(ProductName,'Chef')` (V4), `substringof('Chef',ProductName)` (V2) | [Northwind Products](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data&filter=contains(ProductName%2C'Chef')) |

Operators: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`, `in` (V4.01). Strings use single quotes;
a quote inside a string is doubled (`'O''Neil'`). Dates are `2026-10-19` (V4) or `datetime'2026-10-19T00:00:00'` (V2).

## $select — which columns

`$select=FirstName,LastName` returns only these properties, which keeps responses small on wide SAP entities.
[Try it on TripPin](/?sample=trippin-v4#/id/set%3ATrippin.Container%2FPeople?view=data&select=FirstName%2CLastName).

## $orderby — sorting

`$orderby=UnitPrice desc` sorts descending; several keys are comma-separated (`Country,City`).
In the viewer you can also click a column header.
[Try it on Northwind](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data&orderby=UnitPrice%20desc).

## $top and $skip — paging

`$top=10&$skip=20` returns rows 21 to 30. Many services also page on their own and add a next link
(`@odata.nextLink` in V4, `__next` in V2); the viewer follows it with **Next ›**.
[Try it](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FOrders?view=data&top=10&skip=20).

## $expand — related entities in one request

`$expand=Category` embeds the navigation property's target. V4 allows nested options:
`$expand=Orders($select=OrderID;$top=3)`. In V2, nested paths use a slash: `$expand=Orders/Order_Details`.
[Try it on Northwind](/?sample=northwind-v4#/id/set%3AODataWebV4.Northwind.Model.NorthwindEntities%2FProducts?view=data&expand=Category).

## $count — how many

V4: `$count=true` adds `@odata.count` to the answer. V2: `$inlinecount=allpages`. The viewer requests the count by
default and shows it above the table.

## $search — free text (V4)

`$search=blue` is a free-text search whose meaning the service defines; many services do not implement it.

## Building the URL by hand

The full request for the first example is

```
https://services.odata.org/TripPinRESTierService/People?$filter=FirstName eq 'Scott'&$count=true
```

Spaces and quotes must be percent-encoded when you paste it into code; the viewer's **Copy as** menu does that
for curl, JavaScript, C#, Python and Power Query.
