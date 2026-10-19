import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ApiError, listSamples } from "../api/client";
import { splitCredentials, urlOrigin } from "../lib/serviceUrl";
import type { Auth, Sample } from "../types/model";

export type UploadMode = "url" | "text" | "file" | "samples";

interface UploaderProps {
  status: ReactNode;
  /** Mode to open with (the /samples route opens the sample list). */
  defaultMode?: UploadMode;
  initialUrl?: string;
  /** Credentials remembered for the current service (memory only). */
  auth: Auth | null;
  /** Service root the remembered credentials belong to. */
  serviceRoot?: string | null;
  onUrl: (url: string, auth: Auth | null) => Promise<void>;
  onText: (content: string) => Promise<void>;
  onFile: (file: File) => Promise<void>;
  onSample: (sample: Sample) => Promise<void>;
  /** Set when the last URL load failed with 401: open the credential fields. */
  authRequired: boolean;
}

const TABS: { mode: UploadMode; label: string }[] = [
  { mode: "url", label: "Service URL" },
  { mode: "text", label: "Paste" },
  { mode: "file", label: "File" },
  { mode: "samples", label: "Samples" },
];

const INPUT =
  "w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono";

export function Uploader({
  status,
  defaultMode = "url",
  initialUrl = "",
  auth,
  serviceRoot = null,
  onUrl,
  onText,
  onFile,
  onSample,
  authRequired,
}: UploaderProps) {
  const [mode, setMode] = useState<UploadMode>(defaultMode);
  const [url, setUrl] = useState(initialUrl);
  const [withAuth, setWithAuth] = useState(Boolean(auth));
  const [username, setUsername] = useState(auth?.username ?? "");
  const [password, setPassword] = useState(auth?.password ?? "");
  // Origin the password was typed for: a URL pointing elsewhere must not get it.
  const [passwordOrigin, setPasswordOrigin] = useState(auth ? urlOrigin(serviceRoot ?? initialUrl) : null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (authRequired) setWithAuth(true);
  }, [authRequired]);

  useEffect(() => {
    if (mode !== "samples" || samples !== null) return;
    listSamples()
      .then(setSamples)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [mode, samples]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const changeUrl = (next: string) => {
    setUrl(next);
    if (password && passwordOrigin && urlOrigin(next) !== passwordOrigin) {
      setPassword("");
      setPasswordOrigin(null);
      setError(`Password cleared: it was entered for ${passwordOrigin}.`);
    }
  };

  const submitUrl = () => {
    let trimmed = url.trim();
    if (!trimmed) return;
    let credentials = withAuth && username.trim() ? { username: username.trim(), password } : null;
    // user:password@ in the URL would end up in share links and the service root.
    const embedded = splitCredentials(trimmed);
    if (embedded) {
      trimmed = embedded.url;
      credentials = { username: embedded.username, password: embedded.password };
      setUrl(trimmed);
      setWithAuth(true);
      setUsername(embedded.username);
      setPassword(embedded.password);
      setPasswordOrigin(urlOrigin(trimmed));
    }
    const target = trimmed;
    void run("Loading $metadata…", () => onUrl(target, credentials));
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void run(`Reading ${file.name}…`, () => onFile(file));
  };

  return (
    <div className="panel rounded-lg p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <div className="flex gap-1" role="tablist" aria-label="How to load the service">
          {TABS.map((tab) => (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={mode === tab.mode}
              className={clsx(
                "px-2.5 py-1 touch:py-2 text-xs font-medium rounded-md",
                mode === tab.mode
                  ? "bg-accent text-white dark:bg-accent-dark dark:text-slate-950"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700",
              )}
              onClick={() => {
                setMode(tab.mode);
                setError(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate min-w-0 ml-auto">{status}</div>
      </div>

      {mode === "url" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitUrl();
          }}
          className="space-y-2"
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={INPUT}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://services.odata.org/V4/Northwind/Northwind.svc/  (service root or …/$metadata)"
              value={url}
              onChange={(e) => changeUrl(e.target.value)}
              aria-label="OData service URL"
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={busy !== null || !url.trim()}>
              {busy && mode === "url" ? "Loading…" : "Load"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={withAuth} onChange={(e) => setWithAuth(e.target.checked)} />
              The service needs a login (HTTP Basic)
            </label>
            {authRequired && !withAuth && <span className="text-amber-700 dark:text-amber-400">The service asked for credentials.</span>}
          </div>
          {withAuth && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className={INPUT}
                type="text"
                autoComplete="username"
                placeholder="User name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                aria-label="User name"
              />
              <input
                className={INPUT}
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordOrigin(urlOrigin(url));
                }}
                aria-label="Password"
              />
              <p className="sm:col-span-2 text-[11px] text-slate-500 dark:text-slate-400">
                Sent to the service with each request through this site's backend (HTTPS only), kept in this browser tab's
                memory, never stored or logged.
              </p>
            </div>
          )}
        </form>
      )}

      {mode === "text" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void run("Parsing…", () => onText(text));
          }}
          className="space-y-2"
        >
          <textarea
            className={clsx(INPUT, "h-32 resize-y text-xs")}
            placeholder={'Paste the $metadata document here (<edmx:Edmx …> or CSDL JSON {"$Version": "4.01", …})'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="Metadata document"
          />
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy !== null || !text.trim()}>
              {busy && mode === "text" ? "Parsing…" : "Parse"}
            </button>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Pasted or uploaded metadata is explored offline; the data explorer needs the service URL.
            </span>
          </div>
        </form>
      )}

      {mode === "file" && (
        <div
          className={clsx(
            "rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
            dragging
              ? "border-accent bg-blue-50 dark:bg-blue-950/30"
              : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>
            Drop a <code>$metadata.xml</code>, <code>.edmx</code> or CSDL <code>.json</code> file here, or
          </p>
          <button type="button" className="btn mt-2" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
            {busy && mode === "file" ? busy : "Choose a file"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xml,.edmx,.json,.csdl,application/xml,text/xml,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run(`Reading ${file.name}…`, () => onFile(file));
              e.target.value = "";
            }}
          />
        </div>
      )}

      {mode === "samples" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {samples === null && !error && <p className="text-sm text-slate-500">Loading samples…</p>}
          {samples?.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className="text-left rounded-md border border-slate-200 dark:border-slate-800 p-3 hover:border-accent hover:bg-blue-50/40 dark:hover:bg-blue-950/20 disabled:opacity-60"
              disabled={busy !== null}
              onClick={() => void run(`Loading ${sample.name}…`, () => onSample(sample))}
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-sm">{sample.name}</span>
                <span className="chip bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">V{sample.odata_version}</span>
              </span>
              <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">{sample.description}</span>
            </button>
          ))}
        </div>
      )}

      {busy && mode !== "url" && mode !== "text" && mode !== "file" && (
        <p className="mt-2 text-xs text-slate-500" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400 break-words" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
