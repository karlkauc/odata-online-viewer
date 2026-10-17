import { GROUP_LABELS, shortType, type ModelIndex, type NodeKind } from "../../lib/modelIndex";
import type { Multiplicity, ServiceModel } from "../../types/model";

export interface TreeRow {
  id: string;
  /** Node to select when the row is clicked (group rows select nothing). */
  selectId: string | null;
  depth: number;
  kind: NodeKind | "group" | "member" | "param";
  label: string;
  secondary: string | null;
  hasChildren: boolean;
  expanded: boolean;
  isKey: boolean;
  badge: string | null;
}

function multiplicityArrow(source: Multiplicity | null, target: Multiplicity): string {
  return `${source ?? "?"} → ${target}`;
}

/** Flatten the model into visible rows given the expanded set. */
export function buildTreeRows(model: ServiceModel, index: ModelIndex, expanded: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];

  const group = (id: string, key: string, depth: number, count: number, children: () => void) => {
    if (count === 0) return;
    const isOpen = expanded.has(id);
    rows.push({
      id,
      selectId: null,
      depth,
      kind: "group",
      label: GROUP_LABELS[key] ?? key,
      secondary: String(count),
      hasChildren: true,
      expanded: isOpen,
      isKey: false,
      badge: null,
    });
    if (isOpen) children();
  };

  for (const schema of model.schemas) {
    const schemaOpen = expanded.has(schema.id);
    rows.push({
      id: schema.id,
      selectId: schema.id,
      depth: 0,
      kind: "schema",
      label: schema.namespace,
      secondary: schema.alias ? `alias ${schema.alias}` : null,
      hasChildren: true,
      expanded: schemaOpen,
      isKey: false,
      badge: null,
    });
    if (!schemaOpen) continue;

    for (const container of schema.containers) {
      const open = expanded.has(container.id);
      rows.push({
        id: container.id,
        selectId: container.id,
        depth: 1,
        kind: "container",
        label: container.name,
        secondary: null,
        hasChildren: true,
        expanded: open,
        isKey: false,
        badge: container.is_default && model.schemas.reduce((n, s) => n + s.containers.length, 0) > 1 ? "default" : null,
      });
      if (!open) continue;
      group(`group:${container.id}/entity_sets`, "entity_sets", 2, container.entity_sets.length, () => {
        for (const set of container.entity_sets) {
          rows.push({
            id: set.id,
            selectId: set.id,
            depth: 3,
            kind: "set",
            label: set.name,
            secondary: shortType(set.entity_type),
            hasChildren: false,
            expanded: false,
            isKey: false,
            badge: null,
          });
        }
      });
      group(`group:${container.id}/singletons`, "singletons", 2, container.singletons.length, () => {
        for (const s of container.singletons) {
          rows.push({
            id: s.id,
            selectId: s.id,
            depth: 3,
            kind: "singleton",
            label: s.name,
            secondary: shortType(s.entity_type),
            hasChildren: false,
            expanded: false,
            isKey: false,
            badge: null,
          });
        }
      });
      group(`group:${container.id}/imports`, "imports", 2, container.operation_imports.length, () => {
        for (const imp of container.operation_imports) {
          rows.push({
            id: imp.id,
            selectId: imp.id,
            depth: 3,
            kind: "import",
            label: imp.name,
            secondary: shortType(imp.operation),
            hasChildren: false,
            expanded: false,
            isKey: false,
            badge: imp.kind === "action_import" ? "action" : null,
          });
        }
      });
      group(`group:${container.id}/function_imports`, "function_imports", 2, container.operations.length, () => {
        for (const op of container.operations) {
          const open = expanded.has(op.id);
          rows.push({
            id: op.id,
            selectId: op.id,
            depth: 3,
            kind: "op",
            label: op.name,
            secondary: op.return_type ? shortType(op.return_type.type) : null,
            hasChildren: op.parameters.length > 0,
            expanded: open,
            isKey: false,
            badge: op.http_method,
          });
          if (open) {
            for (const p of op.parameters) {
              rows.push({
                id: `param:${op.id}/${p.name}`,
                selectId: op.id,
                depth: 4,
                kind: "param",
                label: p.name,
                secondary: shortType(p.type),
                hasChildren: false,
                expanded: false,
                isKey: false,
                badge: null,
              });
            }
          }
        }
      });
    }

    const structuredRows = (types: (typeof schema.entity_types)[number][] | typeof schema.complex_types, kind: "entity" | "complex") => {
      for (const type of types) {
        const open = expanded.has(type.id);
        const badges = [type.abstract ? "abstract" : null, type.kind === "entity" && type.has_stream ? "stream" : null].filter(Boolean);
        rows.push({
          id: type.id,
          selectId: type.id,
          depth: 2,
          kind,
          label: type.name,
          secondary: type.base_type ? `: ${shortType(type.base_type)}` : null,
          hasChildren: type.properties.length + type.navigation_properties.length > 0,
          expanded: open,
          isKey: false,
          badge: badges.join(" ") || null,
        });
        if (!open) continue;
        const key = type.kind === "entity" ? new Set(type.key) : new Set<string>();
        for (const prop of type.properties) {
          rows.push({
            id: prop.id,
            selectId: prop.id,
            depth: 3,
            kind: "prop",
            label: prop.name,
            secondary: shortType(prop.type) + (prop.nullable ? "" : " !"),
            hasChildren: false,
            expanded: false,
            isKey: key.has(prop.name),
            badge: null,
          });
        }
        for (const nav of type.navigation_properties) {
          rows.push({
            id: nav.id,
            selectId: nav.id,
            depth: 3,
            kind: "nav",
            label: nav.name,
            secondary: `${shortType(nav.target_type)} (${multiplicityArrow(nav.source_multiplicity, nav.multiplicity)})`,
            hasChildren: false,
            expanded: false,
            isKey: false,
            badge: null,
          });
        }
      }
    };

    group(`group:${schema.id}/entity_types`, "entity_types", 1, schema.entity_types.length, () =>
      structuredRows(schema.entity_types, "entity"),
    );
    group(`group:${schema.id}/complex_types`, "complex_types", 1, schema.complex_types.length, () =>
      structuredRows(schema.complex_types, "complex"),
    );
    group(`group:${schema.id}/enum_types`, "enum_types", 1, schema.enum_types.length, () => {
      for (const en of schema.enum_types) {
        const open = expanded.has(en.id);
        rows.push({
          id: en.id,
          selectId: en.id,
          depth: 2,
          kind: "enum",
          label: en.name,
          secondary: shortType(en.underlying_type),
          hasChildren: en.members.length > 0,
          expanded: open,
          isKey: false,
          badge: en.is_flags ? "flags" : null,
        });
        if (open) {
          for (const m of en.members) {
            rows.push({
              id: `member:${en.id}/${m.name}`,
              selectId: en.id,
              depth: 3,
              kind: "member",
              label: m.name,
              secondary: m.value === null ? null : String(m.value),
              hasChildren: false,
              expanded: false,
              isKey: false,
              badge: null,
            });
          }
        }
      }
    });
    group(`group:${schema.id}/type_definitions`, "type_definitions", 1, schema.type_definitions.length, () => {
      for (const td of schema.type_definitions) {
        rows.push({
          id: td.id,
          selectId: td.id,
          depth: 2,
          kind: "typedef",
          label: td.name,
          secondary: shortType(td.underlying_type),
          hasChildren: false,
          expanded: false,
          isKey: false,
          badge: null,
        });
      }
    });
    group(`group:${schema.id}/operations`, "operations", 1, schema.operations.length, () => {
      for (const op of schema.operations) {
        const open = expanded.has(op.id);
        rows.push({
          id: op.id,
          selectId: op.id,
          depth: 2,
          kind: "op",
          label: op.name,
          secondary: op.bound_to ? `on ${shortType(op.bound_to)}` : op.return_type ? shortType(op.return_type.type) : null,
          hasChildren: op.parameters.length > 0,
          expanded: open,
          isKey: false,
          badge: op.kind === "action" ? "action" : op.is_bound ? "bound" : null,
        });
        if (open) {
          for (const p of op.parameters) {
            rows.push({
              id: `param:${op.id}/${p.name}`,
              selectId: op.id,
              depth: 3,
              kind: "param",
              label: p.name,
              secondary: shortType(p.type),
              hasChildren: false,
              expanded: false,
              isKey: false,
              badge: null,
            });
          }
        }
      }
    });
  }
  void index;
  return rows;
}

/** Every id that has children, for "Expand all". */
export function expandableIds(model: ServiceModel): string[] {
  const ids: string[] = [];
  for (const schema of model.schemas) {
    ids.push(schema.id);
    for (const container of schema.containers) {
      ids.push(container.id, `group:${container.id}/entity_sets`, `group:${container.id}/singletons`);
      ids.push(`group:${container.id}/imports`, `group:${container.id}/function_imports`);
      for (const op of container.operations) ids.push(op.id);
    }
    for (const key of ["entity_types", "complex_types", "enum_types", "type_definitions", "operations"]) {
      ids.push(`group:${schema.id}/${key}`);
    }
    for (const t of [...schema.entity_types, ...schema.complex_types, ...schema.enum_types]) ids.push(t.id);
    for (const op of schema.operations) ids.push(op.id);
  }
  return ids;
}
