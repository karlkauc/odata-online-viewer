/**
 * Hand the loaded EDMX document over to the sibling XML viewer.
 *
 * Same protocol as the XSD viewer's hand-off (and lib/handoff.ts in the XML
 * viewer): we open `XML_VIEWER_URL?from=odata-viewer` in a new tab, wait for
 * its `{type: "xml-viewer:ready"}`, and answer with `{type: "xml-viewer:file",
 * name, content}`. The shell sends `Cross-Origin-Opener-Policy:
 * same-origin-allow-popups` (backend/app/spa.py) so the popup keeps its opener.
 */
import { XML_VIEWER_URL } from "./links";

export const XML_VIEWER_ORIGINS = ["https://www.xml-viewer.online", "https://xml-viewer.online"];
const TIMEOUT_MS = 15_000;

/** Origins the XML viewer accepts a hand-off from (its SENDER_ORIGINS). */
export const HANDOFF_SENDER_ORIGINS = [
  "https://www.odata-viewer.online",
  "https://odata-viewer.online",
  "https://odata-viewer.status20.net",
];

function isLocal(origin: string): boolean {
  return import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function handoffSupported(origin: string = window.location.origin): boolean {
  return HANDOFF_SENDER_ORIGINS.includes(origin) || isLocal(origin);
}

export function handoffUrl(base: string = XML_VIEWER_URL): string {
  const url = new URL(base);
  url.searchParams.set("from", "odata-viewer");
  return url.toString();
}

/** Resolves true once the file was posted, false if the popup was blocked or never answered. */
export async function openInXmlViewer(file: File, target: string = handoffUrl()): Promise<boolean> {
  const content = await file.arrayBuffer();
  const popup = window.open(target, "_blank");
  if (!popup) return false;
  const targetOrigin = new URL(target).origin;
  return new Promise<boolean>((resolve) => {
    let timer = 0;
    const finish = (ok: boolean) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== popup || !(XML_VIEWER_ORIGINS.includes(event.origin) || isLocal(event.origin))) return;
      if ((event.data as { type?: unknown } | null)?.type !== "xml-viewer:ready") return;
      popup.postMessage({ type: "xml-viewer:file", name: file.name, content }, targetOrigin, [content]);
      finish(true);
    };
    window.addEventListener("message", onMessage);
    timer = window.setTimeout(() => finish(false), TIMEOUT_MS);
  });
}
