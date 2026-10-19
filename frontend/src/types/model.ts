// Mirrors the Pydantic models in backend/app/odata/model.py and the API
// responses in backend/app/api/{metadata,data,samples}.py. Kept in sync by hand.

export type ODataVersion = "2.0" | "3.0" | "4.0" | "4.01";
export type Multiplicity = "1" | "0..1" | "*";

export interface Annotation {
  term: string;
  qualifier: string | null;
  value: string | null;
}

export interface Property {
  id: string;
  name: string;
  type: string;
  is_collection: boolean;
  nullable: boolean;
  is_key: boolean;
  max_length: number | null;
  max_length_is_max: boolean;
  precision: number | null;
  scale: number | string | null;
  default_value: string | null;
  unicode: boolean | null;
  srid: string | null;
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface ReferentialConstraint {
  property: string;
  referenced_property: string;
}

export interface NavigationProperty {
  id: string;
  name: string;
  target_type: string;
  is_collection: boolean;
  nullable: boolean;
  multiplicity: Multiplicity;
  source_multiplicity: Multiplicity | null;
  partner: string | null;
  contains_target: boolean;
  referential_constraints: ReferentialConstraint[];
  relationship: string | null;
  on_delete: string | null;
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

interface StructuredTypeBase {
  id: string;
  name: string;
  namespace: string;
  qualified_name: string;
  base_type: string | null;
  abstract: boolean;
  open_type: boolean;
  properties: Property[];
  navigation_properties: NavigationProperty[];
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface EntityType extends StructuredTypeBase {
  kind: "entity";
  key: string[];
  key_inherited: boolean;
  has_stream: boolean;
}

export interface ComplexType extends StructuredTypeBase {
  kind: "complex";
}

export type StructuredType = EntityType | ComplexType;

export interface EnumMember {
  name: string;
  value: number | null;
  label: string | null;
}

export interface EnumType {
  id: string;
  kind: "enum";
  name: string;
  namespace: string;
  qualified_name: string;
  underlying_type: string;
  is_flags: boolean;
  members: EnumMember[];
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface TypeDefinition {
  id: string;
  kind: "typedef";
  name: string;
  namespace: string;
  qualified_name: string;
  underlying_type: string;
  max_length: number | null;
  precision: number | null;
  scale: number | string | null;
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface Parameter {
  name: string;
  type: string;
  is_collection: boolean;
  nullable: boolean;
  mode: string | null;
  max_length: number | null;
  precision: number | null;
  scale: number | string | null;
  annotations: Annotation[];
}

export interface ReturnType {
  type: string;
  is_collection: boolean;
  nullable: boolean;
}

export type OperationKind = "function" | "action" | "function_import";

export interface Operation {
  id: string;
  kind: OperationKind;
  name: string;
  namespace: string;
  qualified_name: string;
  is_bound: boolean;
  bound_to: string | null;
  is_composable: boolean;
  entity_set_path: string | null;
  entity_set: string | null;
  http_method: string | null;
  parameters: Parameter[];
  return_type: ReturnType | null;
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface NavigationBinding {
  path: string;
  target: string;
}

export interface EntitySet {
  id: string;
  kind: "set";
  name: string;
  entity_type: string;
  navigation_bindings: NavigationBinding[];
  include_in_service_document: boolean;
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface Singleton {
  id: string;
  kind: "singleton";
  name: string;
  entity_type: string;
  navigation_bindings: NavigationBinding[];
  label: string | null;
  description: string | null;
  annotations: Annotation[];
  line: number | null;
}

export interface OperationImport {
  id: string;
  kind: "function_import" | "action_import";
  name: string;
  operation: string;
  entity_set: string | null;
  include_in_service_document: boolean;
  annotations: Annotation[];
  line: number | null;
}

export interface EntityContainer {
  id: string;
  name: string;
  namespace: string;
  qualified_name: string;
  extends: string | null;
  is_default: boolean;
  entity_sets: EntitySet[];
  singletons: Singleton[];
  operation_imports: OperationImport[];
  operations: Operation[];
  annotations: Annotation[];
  line: number | null;
}

export interface Schema {
  id: string;
  namespace: string;
  alias: string | null;
  entity_types: EntityType[];
  complex_types: ComplexType[];
  enum_types: EnumType[];
  type_definitions: TypeDefinition[];
  operations: Operation[];
  containers: EntityContainer[];
  annotations: Annotation[];
  line: number | null;
}

export interface Reference {
  uri: string;
  includes: { namespace: string; alias: string | null }[];
}

export interface ServiceStats {
  schema_count: number;
  entity_type_count: number;
  complex_type_count: number;
  enum_type_count: number;
  type_definition_count: number;
  entity_set_count: number;
  singleton_count: number;
  operation_count: number;
  property_count: number;
  navigation_count: number;
  annotation_count: number;
}

export interface ServiceModel {
  metadata_id: string;
  filename: string;
  source: "upload" | "text" | "url" | "sample";
  format: "xml" | "json";
  odata_version: ODataVersion;
  edmx_version: string | null;
  data_service_version: string | null;
  metadata_url: string | null;
  service_root: string | null;
  auth_used: boolean;
  default_container: string | null;
  schemas: Schema[];
  references: Reference[];
  stats: ServiceStats;
  notices: string[];
  source_bytes: number;
  source_lines: number;
  source_reformatted: boolean;
}

// --- API payloads -----------------------------------------------------------

export interface Auth {
  username: string;
  password: string;
}

export interface QueryOptions {
  top: number;
  skip: number;
  filter: string | null;
  select: string[];
  orderby: string | null;
  expand: string | null;
  search: string | null;
  count: boolean;
  extra: string | null;
}

export type Cell = string | number | boolean | null | Cell[] | { [key: string]: Cell };

export interface QueryResponse {
  request_url: string;
  status_code: number;
  columns: string[];
  rows: Record<string, Cell>[];
  count: number | null;
  next_link: string | null;
  duration_ms: number;
  notices: string[];
  /** False for single values and collection properties: no further pages, no $skip offset. */
  paged?: boolean;
}

export interface RawResponse {
  request_url: string;
  status_code: number;
  content_type: string | null;
  body: unknown;
  duration_ms: number;
}

export interface Sample {
  id: string;
  name: string;
  description: string;
  odata_version: string;
  service_url: string | null;
  data: boolean;
  auth: boolean;
}
