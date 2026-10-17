// A flat index over the service model: every node by id, type lookups by
// qualified name, and the reverse relations the views keep asking for
// (which sets expose a type, which types derive from it, which operations
// are bound to it). Built once per loaded model.

import type {
  ComplexType,
  EntityContainer,
  EntitySet,
  EntityType,
  EnumType,
  NavigationProperty,
  Operation,
  OperationImport,
  Property,
  Schema,
  ServiceModel,
  Singleton,
  StructuredType,
  TypeDefinition,
} from "../types/model";

export type NodeKind =
  | "schema"
  | "container"
  | "set"
  | "singleton"
  | "import"
  | "entity"
  | "complex"
  | "enum"
  | "typedef"
  | "op"
  | "prop"
  | "nav";

export type NamedType = EntityType | ComplexType | EnumType | TypeDefinition;

export interface IndexEntry {
  id: string;
  kind: NodeKind;
  label: string;
  /** Qualified name for types/operations, `Container/Set` for container members. */
  qualifiedName: string | null;
  /** Ancestors from the root down (schema → … → parent), for revealing in the tree. */
  path: string[];
  node:
    | Schema
    | EntityContainer
    | EntitySet
    | Singleton
    | OperationImport
    | EntityType
    | ComplexType
    | EnumType
    | TypeDefinition
    | Operation
    | Property
    | NavigationProperty;
  /** The structured type a property/navigation belongs to. */
  owner: StructuredType | null;
  /** Lower-cased text the search palette matches against (names, labels, types). */
  searchText: string;
  line: number | null;
}

export interface ModelIndex {
  byId: Map<string, IndexEntry>;
  entries: IndexEntry[];
  typesByName: Map<string, NamedType>;
  entityTypes: EntityType[];
  complexTypes: ComplexType[];
  /** Entity sets (and singletons) that expose a given entity type. */
  setsByType: Map<string, (EntitySet | Singleton)[]>;
  /** Direct subtypes of a structured type. */
  derivedTypes: Map<string, StructuredType[]>;
  /** Operations bound to a type (`NS.T` or `Collection(NS.T)`). */
  boundOperations: Map<string, Operation[]>;
  /** Structured types that use a complex/enum type in a property. */
  usedBy: Map<string, StructuredType[]>;
  /** All entity sets with their container, in document order. */
  entitySets: { set: EntitySet; container: EntityContainer }[];
  /** Group node ids (`group:NS/entity_types`) → child node ids, for the tree. */
  groups: Map<string, string[]>;
}

export const GROUP_LABELS: Record<string, string> = {
  entity_sets: "Entity sets",
  singletons: "Singletons",
  imports: "Function & action imports",
  function_imports: "Function imports",
  entity_types: "Entity types",
  complex_types: "Complex types",
  enum_types: "Enum types",
  type_definitions: "Type definitions",
  operations: "Functions & actions",
};

export function stripCollection(type: string): { base: string; collection: boolean } {
  const match = /^Collection\((.+)\)$/.exec(type);
  return match ? { base: match[1], collection: true } : { base: type, collection: false };
}

/** `NorthwindModel.Product` → `Product`; `Collection(NS.T)` → `Collection(T)`; `Edm.String` stays. */
export function shortType(type: string): string {
  const { base, collection } = stripCollection(type);
  const short = base.startsWith("Edm.") ? base : base.slice(base.lastIndexOf(".") + 1);
  return collection ? `Collection(${short})` : short;
}

function text(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .join(" ")
    .toLowerCase();
}

export function buildIndex(model: ServiceModel): ModelIndex {
  const byId = new Map<string, IndexEntry>();
  const entries: IndexEntry[] = [];
  const typesByName = new Map<string, NamedType>();
  const entityTypes: EntityType[] = [];
  const complexTypes: ComplexType[] = [];
  const setsByType = new Map<string, (EntitySet | Singleton)[]>();
  const derivedTypes = new Map<string, StructuredType[]>();
  const boundOperations = new Map<string, Operation[]>();
  const usedBy = new Map<string, StructuredType[]>();
  const entitySets: { set: EntitySet; container: EntityContainer }[] = [];
  const groups = new Map<string, string[]>();

  const push = (entry: IndexEntry) => {
    byId.set(entry.id, entry);
    entries.push(entry);
  };
  const addTo = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const schema of model.schemas) {
    push({
      id: schema.id,
      kind: "schema",
      label: schema.namespace,
      qualifiedName: schema.namespace,
      path: [],
      node: schema,
      owner: null,
      searchText: text(schema.namespace, schema.alias),
      line: schema.line,
    });
    const schemaPath = [schema.id];

    const structured = (type: StructuredType, kind: "entity" | "complex", groupId: string) => {
      typesByName.set(type.qualified_name, type);
      if (type.kind === "entity") entityTypes.push(type);
      else complexTypes.push(type);
      if (type.base_type) addTo(derivedTypes, type.base_type, type);
      push({
        id: type.id,
        kind,
        label: type.name,
        qualifiedName: type.qualified_name,
        path: [...schemaPath, groupId],
        node: type,
        owner: null,
        searchText: text(type.name, type.qualified_name, type.label, type.description),
        line: type.line,
      });
      addTo(groups, groupId, type.id);
      const typePath = [...schemaPath, groupId, type.id];
      for (const prop of type.properties) {
        push({
          id: prop.id,
          kind: "prop",
          label: prop.name,
          qualifiedName: `${type.qualified_name}/${prop.name}`,
          path: typePath,
          node: prop,
          owner: type,
          searchText: text(prop.name, prop.type, prop.label, prop.description),
          line: prop.line,
        });
        const { base } = stripCollection(prop.type);
        if (!base.startsWith("Edm.")) addTo(usedBy, base, type);
      }
      for (const nav of type.navigation_properties) {
        push({
          id: nav.id,
          kind: "nav",
          label: nav.name,
          qualifiedName: `${type.qualified_name}/${nav.name}`,
          path: typePath,
          node: nav,
          owner: type,
          searchText: text(nav.name, nav.target_type, nav.label, nav.description),
          line: nav.line,
        });
      }
    };

    for (const container of schema.containers) {
      push({
        id: container.id,
        kind: "container",
        label: container.name,
        qualifiedName: container.qualified_name,
        path: schemaPath,
        node: container,
        owner: null,
        searchText: text(container.name, container.qualified_name),
        line: container.line,
      });
      const containerPath = [...schemaPath, container.id];
      const setsGroup = `group:${container.id}/entity_sets`;
      for (const set of container.entity_sets) {
        entitySets.push({ set, container });
        addTo(setsByType, set.entity_type, set);
        addTo(groups, setsGroup, set.id);
        push({
          id: set.id,
          kind: "set",
          label: set.name,
          qualifiedName: `${container.qualified_name}/${set.name}`,
          path: [...containerPath, setsGroup],
          node: set,
          owner: null,
          searchText: text(set.name, set.entity_type, set.label, set.description),
          line: set.line,
        });
      }
      const singletonGroup = `group:${container.id}/singletons`;
      for (const singleton of container.singletons) {
        addTo(setsByType, singleton.entity_type, singleton);
        addTo(groups, singletonGroup, singleton.id);
        push({
          id: singleton.id,
          kind: "singleton",
          label: singleton.name,
          qualifiedName: `${container.qualified_name}/${singleton.name}`,
          path: [...containerPath, singletonGroup],
          node: singleton,
          owner: null,
          searchText: text(singleton.name, singleton.entity_type, singleton.label),
          line: singleton.line,
        });
      }
      const importsGroup = `group:${container.id}/imports`;
      for (const imp of container.operation_imports) {
        addTo(groups, importsGroup, imp.id);
        push({
          id: imp.id,
          kind: "import",
          label: imp.name,
          qualifiedName: `${container.qualified_name}/${imp.name}`,
          path: [...containerPath, importsGroup],
          node: imp,
          owner: null,
          searchText: text(imp.name, imp.operation),
          line: imp.line,
        });
      }
      const fiGroup = `group:${container.id}/function_imports`;
      for (const op of container.operations) {
        addTo(groups, fiGroup, op.id);
        push({
          id: op.id,
          kind: "op",
          label: op.name,
          qualifiedName: op.qualified_name,
          path: [...containerPath, fiGroup],
          node: op,
          owner: null,
          searchText: text(op.name, op.return_type?.type, op.label, op.description),
          line: op.line,
        });
      }
    }

    const etGroup = `group:${schema.id}/entity_types`;
    for (const type of schema.entity_types) structured(type, "entity", etGroup);
    const ctGroup = `group:${schema.id}/complex_types`;
    for (const type of schema.complex_types) structured(type, "complex", ctGroup);

    const enGroup = `group:${schema.id}/enum_types`;
    for (const en of schema.enum_types) {
      typesByName.set(en.qualified_name, en);
      addTo(groups, enGroup, en.id);
      push({
        id: en.id,
        kind: "enum",
        label: en.name,
        qualifiedName: en.qualified_name,
        path: [...schemaPath, enGroup],
        node: en,
        owner: null,
        searchText: text(en.name, en.qualified_name, en.label, ...en.members.map((m) => m.name)),
        line: en.line,
      });
    }
    const tdGroup = `group:${schema.id}/type_definitions`;
    for (const td of schema.type_definitions) {
      typesByName.set(td.qualified_name, td);
      addTo(groups, tdGroup, td.id);
      push({
        id: td.id,
        kind: "typedef",
        label: td.name,
        qualifiedName: td.qualified_name,
        path: [...schemaPath, tdGroup],
        node: td,
        owner: null,
        searchText: text(td.name, td.qualified_name, td.underlying_type),
        line: td.line,
      });
    }
    const opGroup = `group:${schema.id}/operations`;
    for (const op of schema.operations) {
      if (op.bound_to) addTo(boundOperations, op.bound_to, op);
      addTo(groups, opGroup, op.id);
      push({
        id: op.id,
        kind: "op",
        label: op.name,
        qualifiedName: op.qualified_name,
        path: [...schemaPath, opGroup],
        node: op,
        owner: null,
        searchText: text(op.name, op.qualified_name, op.bound_to, op.return_type?.type, op.label, op.description),
        line: op.line,
      });
    }
  }

  return {
    byId,
    entries,
    typesByName,
    entityTypes,
    complexTypes,
    setsByType,
    derivedTypes,
    boundOperations,
    usedBy,
    entitySets,
    groups,
  };
}

/** Operations bound to a type or to a collection of it. */
export function operationsBoundTo(index: ModelIndex, qualifiedName: string): Operation[] {
  return [
    ...(index.boundOperations.get(qualifiedName) ?? []),
    ...(index.boundOperations.get(`Collection(${qualifiedName})`) ?? []),
  ];
}

/** The base-type chain of a structured type, nearest first. */
export function baseChain(index: ModelIndex, type: StructuredType): StructuredType[] {
  const chain: StructuredType[] = [];
  const seen = new Set<string>([type.qualified_name]);
  let base = type.base_type;
  while (base && !seen.has(base)) {
    seen.add(base);
    const parent = index.typesByName.get(base);
    if (!parent || (parent.kind !== "entity" && parent.kind !== "complex")) break;
    chain.push(parent);
    base = parent.base_type;
  }
  return chain;
}

/** Properties and navigations including inherited ones (own first). */
export function effectiveMembers(
  index: ModelIndex,
  type: StructuredType,
): { properties: (Property & { from: StructuredType })[]; navigations: (NavigationProperty & { from: StructuredType })[] } {
  const chain = [type, ...baseChain(index, type)];
  return {
    properties: chain.flatMap((t) => t.properties.map((p) => ({ ...p, from: t }))),
    navigations: chain.flatMap((t) => t.navigation_properties.map((n) => ({ ...n, from: t }))),
  };
}

/** The first entity set exposing a type (for "Browse data" shortcuts). */
export function primarySet(index: ModelIndex, qualifiedName: string): EntitySet | null {
  const sets = index.setsByType.get(qualifiedName) ?? [];
  const set = sets.find((s): s is EntitySet => s.kind === "set");
  return set ?? null;
}
