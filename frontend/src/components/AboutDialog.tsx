import { useCallback, useEffect, useState } from "react";
import { fetchHealth } from "../api/client";
import { EVENT_OPEN_ABOUT, GITHUB_REPO_URL, ODATA_ORG_URL, SPONSOR_GO, XML_VIEWER_URL, XSD_VIEWER_URL, openFeedback } from "../lib/links";

/**
 * Modal "About" dialog. Opened from anywhere via `openAbout()` (lib/links) —
 * same window-event mechanism as the feedback dialog.
 */
export function AboutDialog() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(EVENT_OPEN_ABOUT, onOpen);
    return () => window.removeEventListener(EVENT_OPEN_ABOUT, onOpen);
  }, []);

  useEffect(() => {
    if (!open || version !== null) return;
    let cancelled = false;
    fetchHealth()
      .then((h) => {
        if (!cancelled) setVersion(h.version);
      })
      .catch(() => {
        if (!cancelled) setVersion("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;

  const linkClass = "text-blue-600 dark:text-blue-400 hover:underline";

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center pt-4 md:pt-[10vh] px-4 z-50"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="w-full max-w-lg max-h-[85dvh] overflow-y-auto bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 id="about-title" className="text-base font-semibold">
              Online OData Viewer
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {version ? `Version ${version}` : version === "" ? "Version unavailable" : "Loading version…"}
            </p>
          </div>
          <button type="button" className="btn" onClick={close} aria-label="Close about dialog" autoFocus>
            ✕
          </button>
        </div>

        <p className="text-sm">
          Visualize the metadata of any OData service (V2, V3, V4, V4.01) as a tree, an entity-relationship diagram or highlighted source,
          and query its entity sets live. No install, no account.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Privacy</h3>
        <ul className="mt-1 text-sm space-y-1 text-slate-700 dark:text-slate-300 list-disc pl-5">
          <li>Metadata you load is parsed in memory on the server and dropped after a short cache period; it is never stored.</li>
          <li>
            Credentials you enter are kept in this browser tab only and forwarded to the OData service with each request over HTTPS.
            They are never stored, logged or included in usage statistics.
          </li>
          <li>
            Anonymous usage statistics (page views, OData version, number of types, country) help improve the tool; no IP addresses,
            no service content, no credentials.
          </li>
        </ul>

        <ul className="mt-4 text-sm space-y-1">
          <li>
            <a className={linkClass} href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              Source code on GitHub
            </a>
          </li>
          <li>
            <a className={linkClass} href={`${GITHUB_REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
              Report an issue
            </a>
            {" · "}
            <button
              type="button"
              className={linkClass}
              onClick={() => {
                close();
                openFeedback();
              }}
            >
              Send feedback
            </button>
          </li>
          <li>
            <a className={linkClass} href={ODATA_ORG_URL} target="_blank" rel="noopener noreferrer">
              odata.org
            </a>
            {" — the protocol specification and ecosystem"}
          </li>
          <li>
            <a className={linkClass} href={XSD_VIEWER_URL} target="_blank" rel="noopener noreferrer">
              XSD Viewer
            </a>
            {" and "}
            <a className={linkClass} href={XML_VIEWER_URL} target="_blank" rel="noopener noreferrer">
              XML Viewer
            </a>
            {" — sister tools by the same author"}
          </li>
          <li>
            <a className={linkClass} href={SPONSOR_GO} target="_blank" rel="noopener noreferrer">
              Support this project
            </a>
            {" — free, no ads; GitHub Sponsors helps cover hosting"}
          </li>
          <li>
            <a className={linkClass} href={`${GITHUB_REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
              MIT License
            </a>
            {" · © 2026 Karl Kauc"}
          </li>
        </ul>
      </div>
    </div>
  );
}
