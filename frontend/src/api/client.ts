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

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg);
      else if (typeof body?.error === "string") detail = body.error;
    } catch {
      // ignore parse errors; fall back to status
    }
    throw new ApiError(detail, response.status);
  }
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
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return { data: await response.blob(), filename: match?.[1] ?? `metadata.${format === "markdown" ? "md" : format}` };
  });
  const href = URL.createObjectURL(blob.data);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = blob.filename;
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
