+++
title = "OData ER diagram: turn $metadata (EDMX/CSDL) into an entity-relationship diagram"
heading = "Entity-relationship diagram from OData $metadata"
description = "Paste an OData service URL or EDMX file and get an entity-relationship diagram with keys, navigation properties, multiplicities, inheritance and complex types. Export as PNG, SVG or Mermaid."
lastmod = 2026-10-19
cta_label = "See the TripPin diagram"
cta_href = "/?sample=trippin-v4#/id/?view=diagram"

[[faq]]
q = "Can I put the diagram into my documentation?"
a = "Yes. Export PNG or SVG from the diagram toolbar, or the Mermaid `erDiagram` text from the export menu — GitHub, GitLab, Confluence and many wikis render Mermaid directly."

[[faq]]
q = "My service has hundreds of entity types. Does that work?"
a = "Up to 150 types are drawn at once. Pick an entity type and use focus mode to draw only its neighbourhood, which is usually what you want for a large SAP service anyway."
+++

An OData `$metadata` document is a precise data model, but reading the XML of a 200-entity SAP service is
slow going. The viewer draws it instead:

- **Entity types as boxes** with key properties marked, property types and nullability.
- **Navigation properties as edges** labelled with their multiplicities (`1`, `0..1`, `*`) on both ends —
  for V2 taken from the association, for V4 from the property type and its partner.
- **Inheritance** (`BaseType`) as a separate edge style, **complex types** as their own boxes.
- **Focus mode**: select an entity and show only the types within one or two hops.
- The layout is computed automatically (layered, left to right) and leaves room for edge labels.

The diagram is one of five synchronised views. Clicking a box opens the entity type in the detail panel; the
source view jumps to its line in `$metadata`; the data explorer queries its entity set.

## Exports

| Format | Use |
|---|---|
| PNG | slides, tickets, chat |
| SVG | documentation that should stay sharp |
| Mermaid `erDiagram` | Markdown docs, GitHub/GitLab READMEs, Confluence |
| Markdown | a full text description of every type and property |

## Works with every OData version

EDMX 1.0 (V2/V3) with associations, EDMX 4.0 (V4/V4.01) with partners and referential constraints, and CSDL
JSON are read into one model, so a V2 and a V4 version of the same service produce the same diagram.
Try [Northwind V2](/?sample=northwind-v2#/id/?view=diagram) and [Northwind V4](/?sample=northwind-v4#/id/?view=diagram).
