// What an SAP / Fiori developer wants to know from the annotations: which
// operations an entity set allows (V4 Capabilities vocabulary or V2 sap:
// attributes), and what a Fiori elements app will show (UI.LineItem,
// UI.HeaderInfo, UI.SelectionFields, field groups). The raw list stays in the
// detail panel's "Annotations" section; this is the readable summary.

import type { Annotation, AnnotationJson, Property } from "../types/model";

const UI = "com.sap.vocabularies.UI.v1.";
const CAP = "Org.OData.Capabilities.V1.";
const COMMON = "com.sap.vocabularies.Common.v1.";

type JsonRecord = { [key: string]: AnnotationJson };

const isRecord = (v: AnnotationJson | undefined): v is JsonRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: AnnotationJson | undefined): AnnotationJson[] => (Array.isArray(v) ? v : []);
const asText = (v: AnnotationJson | undefined): string | null => (typeof v === "string" ? v : null);

function find(annotations: Annotation[], term: string, qualifier: string | null = null): Annotation | undefined {
  return annotations.find((a) => a.term === term && (a.qualifier ?? null) === qualifier) ?? annotations.find((a) => a.term === term);
}

function sapFlag(annotations: Annotation[], name: string): boolean | null {
  const value = annotations.find((a) => a.term === `sap:${name}`)?.value;
  return value === "true" ? true : value === "false" ? false : null;
}

function capFlag(annotations: Annotation[], term: string, property: string): boolean | null {
  const record = find(annotations, CAP + term)?.structured;
  const value = isRecord(record) ? asText(record[property]) : null;
  return value === "true" ? true : value === "false" ? false : null;
}

function capPaths(annotations: Annotation[], term: string, property: string): string[] {
  const record = find(annotations, CAP + term)?.structured;
  return isRecord(record) ? asList(record[property]).map(asText).filter((s): s is string => !!s) : [];
}

export interface Capability {
  operation: string;
  /** true/false when the service says so; null = not restricted (the OData default). */
  allowed: boolean | null;
  /** Which annotation decided it. */
  source: string | null;
  /** Properties the rule names (not filterable, required in a filter …). */
  details: string[];
}

function capability(operation: string, v4: [boolean | null, string], v2: [boolean | null, string], details: string[] = [], detailSource: string | null = null): Capability {
  const [value, source] = v4[0] !== null ? v4 : v2;
  return { operation, allowed: value, source: value !== null ? source : details.length ? detailSource : null, details };
}

/** Allowed operations of an entity set, from its annotations and (V2) its type's properties. */
export function capabilities(setAnnotations: Annotation[], properties: Property[]): Capability[] {
  const a = setAnnotations;
  const propFlag = (name: string, value: string) => properties.filter((p) => p.annotations.some((x) => x.term === `sap:${name}` && x.value === value)).map((p) => p.name);
  const v4NonFilterable = capPaths(a, "FilterRestrictions", "NonFilterableProperties");
  const v4Required = capPaths(a, "FilterRestrictions", "RequiredProperties");
  const v4NonSortable = capPaths(a, "SortRestrictions", "NonSortableProperties");
  const nonFilterable = [...v4NonFilterable, ...propFlag("filterable", "false")];
  const requiredInFilter = [...v4Required, ...propFlag("required-in-filter", "true")];
  const nonSortable = [...v4NonSortable, ...propFlag("sortable", "false")];
  // Property lists restrict single properties, not the operation as a whole.
  const filterSource = v4NonFilterable.length || v4Required.length ? "Capabilities.FilterRestrictions" : "sap:filterable, sap:required-in-filter";
  const sortSource = v4NonSortable.length ? "Capabilities.SortRestrictions" : "sap:sortable";
  return [
    capability("Create", [capFlag(a, "InsertRestrictions", "Insertable"), "Capabilities.InsertRestrictions"], [sapFlag(a, "creatable"), "sap:creatable"]),
    capability("Update", [capFlag(a, "UpdateRestrictions", "Updatable"), "Capabilities.UpdateRestrictions"], [sapFlag(a, "updatable"), "sap:updatable"]),
    capability("Delete", [capFlag(a, "DeleteRestrictions", "Deletable"), "Capabilities.DeleteRestrictions"], [sapFlag(a, "deletable"), "sap:deletable"]),
    capability(
      "Filter",
      [capFlag(a, "FilterRestrictions", "Filterable"), "Capabilities.FilterRestrictions"],
      [null, ""],
      [...nonFilterable.map((p) => `${p}: not filterable`), ...requiredInFilter.map((p) => `${p}: required in $filter`)],
      filterSource,
    ),
    capability(
      "Sort",
      [capFlag(a, "SortRestrictions", "Sortable"), "Capabilities.SortRestrictions"],
      [null, ""],
      nonSortable.map((p) => `${p}: not sortable`),
      sortSource,
    ),
    capability("Search", [capFlag(a, "SearchRestrictions", "Searchable"), "Capabilities.SearchRestrictions"], [sapFlag(a, "searchable"), "sap:searchable"]),
    capability("Paging ($top/$skip)", [boolTerm(a, "TopSupported"), "Capabilities.TopSupported"], [sapFlag(a, "pageable"), "sap:pageable"]),
    capability("Count", [capFlag(a, "CountRestrictions", "Countable"), "Capabilities.CountRestrictions"], [sapFlag(a, "countable"), "sap:countable"]),
  ];
}

/** Plain boolean terms such as Capabilities.TopSupported. */
function boolTerm(annotations: Annotation[], term: string): boolean | null {
  const value = find(annotations, CAP + term)?.value;
  return value === "true" ? true : value === "false" ? false : null;
}

export function hasCapabilityInfo(rows: Capability[]): boolean {
  return rows.some((r) => r.allowed !== null || r.details.length > 0);
}

export interface Field {
  /** Property path the column/field shows (DataField.Value), or the target of other DataField types. */
  value: string;
  label: string | null;
  /** Short record type: DataField, DataFieldForAction, DataFieldWithNavigationPath … */
  kind: string;
}

function fields(value: AnnotationJson | undefined): Field[] {
  return asList(value)
    .filter(isRecord)
    .map((record) => {
      const type = asText(record.$Type) ?? `${UI}DataField`;
      const target = asText(record.Value) ?? asText(record.Action) ?? asText(record.Target) ?? asText(record.SemanticObject) ?? "";
      return { value: target, label: asText(record.Label), kind: type.startsWith(UI) ? type.slice(UI.length) : type };
    });
}

export interface FieldList {
  title: string;
  fields: Field[];
}

export interface UiSummary {
  header: { typeName: string | null; typeNamePlural: string | null; title: string | null; description: string | null } | null;
  selectionFields: string[];
  lists: FieldList[];
}

const qualified = (title: string, a: Annotation) => (a.qualifier ? `${title} #${a.qualifier}` : title);

/** UI vocabulary annotations of an entity type, as a Fiori elements app reads them. */
export function uiSummary(annotations: Annotation[]): UiSummary | null {
  const headerRecord = find(annotations, UI + "HeaderInfo")?.structured;
  const value = (v: AnnotationJson | undefined) => (isRecord(v) ? asText(v.Value) : asText(v ?? null));
  const header = isRecord(headerRecord)
    ? {
        typeName: asText(headerRecord.TypeName),
        typeNamePlural: asText(headerRecord.TypeNamePlural),
        title: value(headerRecord.Title),
        description: value(headerRecord.Description),
      }
    : null;
  const selectionFields = asList(find(annotations, UI + "SelectionFields")?.structured).map(asText).filter((s): s is string => !!s);
  const lists: FieldList[] = [];
  for (const a of annotations) {
    if (a.term === UI + "LineItem") lists.push({ title: qualified("Table columns (UI.LineItem)", a), fields: fields(a.structured) });
    else if (a.term === UI + "Identification") lists.push({ title: qualified("Object page (UI.Identification)", a), fields: fields(a.structured) });
    else if (a.term === UI + "FieldGroup" && isRecord(a.structured))
      lists.push({ title: qualified(`Field group${asText(a.structured.Label) ? ` “${asText(a.structured.Label)}”` : ""} (UI.FieldGroup)`, a), fields: fields(a.structured.Data) });
  }
  if (!header && selectionFields.length === 0 && lists.length === 0) return null;
  return { header, selectionFields, lists };
}

/** Property-level hints: text arrangement, value help, sap: flags. */
export function propertyHints(annotations: Annotation[]): string[] {
  const hints: string[] = [];
  const text = find(annotations, COMMON + "Text");
  if (text?.value) hints.push(`text from ${text.value}`);
  const valueList = find(annotations, COMMON + "ValueList")?.structured;
  if (isRecord(valueList)) hints.push(`value help: ${asText(valueList.CollectionPath) ?? "yes"}`);
  else if (annotations.some((a) => a.term === COMMON + "ValueListReferences" || a.term === "sap:value-list")) hints.push("value help");
  const flags: [string, string, string][] = [
    ["filterable", "false", "not filterable"],
    ["sortable", "false", "not sortable"],
    ["required-in-filter", "true", "required in $filter"],
    ["creatable", "false", "read-only on create"],
    ["updatable", "false", "read-only on update"],
  ];
  for (const [name, value, hint] of flags) if (annotations.some((a) => a.term === `sap:${name}` && a.value === value)) hints.push(hint);
  if (annotations.some((a) => a.term === "Org.OData.Core.V1.Computed" && a.value !== "false")) hints.push("computed");
  if (annotations.some((a) => a.term === "Org.OData.Core.V1.Immutable" && a.value !== "false")) hints.push("immutable");
  return hints;
}
