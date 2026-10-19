+++
title = "OData V2 vs V4 metadata: what changes, side by side"
heading = "OData V2 vs V4 $metadata, side by side"
description = "How associations, function imports, annotations, counts and JSON payloads differ between OData V2 and V4 — with the Northwind service in both versions to compare live."
lastmod = 2026-10-19
cta_label = "Open Northwind V2"
cta_href = "/?sample=northwind-v2"
+++

Many SAP Gateway services still speak OData V2, while new services (RAP, CAP, ASP.NET Core) default to V4.
The data model is the same idea in both — entity types, keys, properties, entity sets — but the `$metadata`
document spells relationships and operations differently. Open both Northwind services and compare:
[Northwind V2](/?sample=northwind-v2) and [Northwind V4](/?sample=northwind-v4).

| Topic | V2 (EDMX 1.0) | V4 (EDMX 4.0 / CSDL JSON) |
|---|---|---|
| Envelope | `edmx:Edmx Version="1.0"`, `m:DataServiceVersion="2.0"` | `edmx:Edmx Version="4.0"` |
| Relationships | `Association` + `AssociationSet`, navigation via `Relationship`/`FromRole`/`ToRole` | `NavigationProperty Type="NS.T"` or `Collection(NS.T)`, `Partner`, `ReferentialConstraint` on the property |
| Bindings | Association sets connect two entity sets | `NavigationPropertyBinding Path=… Target=…` in the entity set |
| Operations | `FunctionImport` with `m:HttpMethod` | `Function` / `Action` (bound or unbound) + `FunctionImport` / `ActionImport` |
| Annotations | `sap:label`, `sap:creatable`, … as XML attributes | `Annotation Term="Common.Label"`, vocabularies, external `Annotations Target=…` |
| Count | `$inlinecount=allpages`, `/$count` | `$count=true` |
| JSON answer | `{"d": {"results": [...], "__count": "…"}}` | `{"value": [...], "@odata.count": …}` |
| Dates | `/Date(1700000000000)/` | ISO 8601 `2026-10-19T08:00:00Z` |
| Containment, singletons, enums | — | yes |

## What the viewer does with the difference

It reads both into one model: V2 associations become navigation properties with multiplicity on both ends,
association sets become navigation bindings, function imports appear as operations, and `sap:` attributes are
listed as annotations next to the V4 vocabulary terms. The ER diagram therefore looks the same for both
versions, which makes a migration check quick: load the old and the new service in two tabs and compare entity
by entity.

## Migrating clients

- Replace `$inlinecount` with `$count=true` and read `@odata.count`.
- `substringof('x',Name)` becomes `contains(Name,'x')`.
- Date literals lose the `datetime'…'` prefix.
- Deferred navigation links (`__deferred`) are gone; use `$expand` or follow the navigation URL.
