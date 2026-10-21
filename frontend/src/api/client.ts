import type {
  Auth,
  QueryOptions,
  QueryResponse,
  RawResponse,
  Sample,
  ServiceModel,
} from "../types/model";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function failure(response: Response): Promise<ApiError> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") detail = body.detail;
    else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg);
    else if (typeof body?.error === "string") detail = body.error;
  } catch {
    // ignore parse errors; fall back to status
  }
  return new ApiError(detail, response.status);
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// --- Expired metadata -------------------------------------------------------
//
// The server keeps parsed metadata in a per-instance memory cache, so a later
// call can find it gone (idle too long, instance restarted, request routed to
// another instance). Ids are content hashes: repeating the load that produced
// one brings it back under the same id, and the call can simply be retried.

const EXPIRED = "Metadata not found or expired";
const MAX_RELOADS = 2;

let current: { id: string; reload: () => Promise<string> } | null = null;

export function expiredError(): ApiError {
  return new ApiError("The metadata has expired on the server. Please load the service again.", 404);
}

async function remember(load: () => Promise<ServiceModel>): Promise<ServiceModel> {
  const model = await load();
  current = { id: model.metadata_id, reload: async () => (await load()).metadata_id };
  return model;
}

export async function withReload<T>(call: () => Promise<T>): Promise<T> {
  for (let reloads = 0; ; reloads++) {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404 && err.message === EXPIRED)) throw err;
    }
    const source = current;
    if (!source || reloads === MAX_RELOADS) throw expiredError();
    const id = await source.reload().catch(() => null);
    if (id !== source.id) throw expiredError();
  }
}

// --- Metadata ---------------------------------------------------------------

export async function loadMetadataUrl(url: string, auth: Auth | null): Promise<ServiceModel> {
  return remember(() => postJson<ServiceModel>("/metadata/url", { url, auth: auth ?? undefined }));
}

export async function loadMetadataText(content: string, filename = "metadata.xml"): Promise<ServiceModel> {
  return remember(() => postJson<ServiceModel>("/metadata/text", { content, filename }));
}

export async function loadMetadataFile(file: File): Promise<ServiceModel> {
  return remember(async () => {
    const form = new FormData();
    form.append("file", file);
    return handle<ServiceModel>(await fetch(`${API_BASE}/metadata/upload`, { method: "POST", body: form }));
  });
}

export async function loadSample(sampleId: string, live = true): Promise<ServiceModel> {
  return remember(async () =>
    handle<ServiceModel>(
      await fetch(`${API_BASE}/samples/${encodeURIComponent(sampleId)}/load?live=${live ? "true" : "false"}`, {
        method: "POST",
      }),
    ),
  );
}

export async function fetchMetadataSource(metadataId: string): Promise<string> {
  return withReload(async () => {
    const response = await fetch(`${API_BASE}/metadata/${encodeURIComponent(metadataId)}/source`);
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        // ignore
      }
      throw new ApiError(detail, response.status);
    }
    return response.text();
  });
}

export function exportUrl(metadataId: string, format: "markdown" | "mermaid" | "source"): string {
  return `${API_BASE}/metadata/${encodeURIComponent(metadataId)}/export/${format}`;
}

/** Download an export; reloads the metadata first when it has expired. */
export async function downloadExport(
  metadataId: string,
  format: "markdown" | "mermaid" | "source",
): Promise<void> {
  const blob = await withReload(async () => {
    const response = await fetch(exportUrl(metadataId, format));
    if (!response.ok) throw await failure(response);
    return { data: await response.blob(), filename: attachmentName(response) ?? `metadata.${format === "markdown" ? "md" : format}` };
  });
  saveBlob(blob.data, blob.filename);
}

function attachmentName(response: Response): string | undefined {
  const disposition = response.headers.get("content-disposition") ?? "";
  return /filename="([^"]+)"/.exec(disposition)?.[1];
}

function saveBlob(data: Blob, filename: string): void {
  const href = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

// --- Samples ----------------------------------------------------------------

export async function listSamples(): Promise<Sample[]> {
  const response = await handle<{ samples: Sample[] }>(await fetch(`${API_BASE}/samples`));
  return response.samples;
}

// --- Data explorer ----------------------------------------------------------

export async function queryEntitySet(
  metadataId: string,
  entitySet: string,
  options: Partial<QueryOptions>,
  auth: Auth | null,
  nextLink?: string | null,
): Promise<QueryResponse> {
  return withReload(() =>
    postJson<QueryResponse>("/data/query", {
      metadata_id: metadataId,
      entity_set: entitySet,
      options,
      next_link: nextLink ?? undefined,
      auth: auth ?? undefined,
    }),
  );
}

export interface ExportTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Download the shown page (`table`) or every matching row as .xlsx.
 * Returns how many rows went into the file and whether the server stopped early.
 */
export async function exportEntitySet(
  metadataId: string,
  entitySet: string,
  options: QueryOptions,
  auth: Auth | null,
  table?: ExportTable,
): Promise<{ rows: number; truncated: boolean }> {
  const file = await withReload(async () => {
    const response = await fetch(`${API_BASE}/data/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metadata_id: metadataId,
        entity_set: entitySet,
        scope: table ? "page" : "all",
        options,
        auth: auth ?? undefined,
        columns: table?.columns,
        rows: table?.rows,
      }),
    });
    if (!response.ok) throw await failure(response);
    return {
      data: await response.blob(),
      filename: attachmentName(response) ?? "data.xlsx",
      rows: Number(response.headers.get("x-export-rows") ?? 0),
      truncated: response.headers.get("x-export-truncated") === "1",
    };
  });
  saveBlob(file.data, file.filename);
  return { rows: file.rows, truncated: file.truncated };
}

export async function rawRequest(metadataId: string, pathAndQuery: string, auth: Auth | null): Promise<RawResponse> {
  return withReload(() =>
    postJson<RawResponse>("/data/raw", { metadata_id: metadataId, path_and_query: pathAndQuery, auth: auth ?? undefined }),
  );
}

// --- Feedback & health ----------------------------------------------------

export interface FeedbackPayload {
  message: string;
  email?: string;
  page?: string;
  service_name?: string;
  entity_name?: string;
  error_detail?: string;
  /** Honeypot; always empty for real users. */
  website?: string;
}

export async function sendFeedback(payload: FeedbackPayload): Promise<void> {
  const response = await fetch(`${API_BASE}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // ignore
    }
    throw new ApiError(detail, response.status);
  }
}

export interface HealthResponse {
  status: string;
  version: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return handle<HealthResponse>(await fetch(`${API_BASE}/health`));
}

// --- Content and usage ----------------------------------------------------

export interface FaqEntry {
  question: string;
  /** Rendered from the site's own Markdown (backend/app/content/faq.toml). */
  answer_html: string;
}

export async function fetchFaq(): Promise<FaqEntry[]> {
  return handle<FaqEntry[]>(await fetch(`${API_BASE}/content/faq`));
}

/** Count a copied share link (the copy itself never reaches the server). Fire and forget. */
export function pingShare(source: "service" | "query"): void {
  void fetch(`${API_BASE}/usage/share?source=${source}`, { method: "POST", keepalive: true }).catch(() => undefined);
}

/** Browser-only features counted by `POST /api/usage/feature` (F1). Keep in sync with
 * `FEATURE_NAMES` in backend/app/api/usage.py: the server rejects any other name. */
export type FeatureName = "copy_as_code" | "diagram_png" | "diagram_svg" | "search_open";

const pingedFeatures = new Set<FeatureName>();

/** Count the use of a browser-only feature. Fire-and-forget like {@link pingShare}, never
 * throws; with `once` at most one ping per page load (the search palette opens often). */
export function pingFeature(name: FeatureName, { once = false }: { once?: boolean } = {}): void {
  if (once) {
    if (pingedFeatures.has(name)) return;
    pingedFeatures.add(name);
  }
  try {
    void fetch(`${API_BASE}/usage/feature?name=${name}`, { method: "POST", keepalive: true }).catch(() => undefined);
  } catch {
    // No fetch at all (very old browser): statistics are optional.
  }
}
