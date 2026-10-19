/** External links shared by the header and the About dialog. */
export const GITHUB_REPO_URL = "https://github.com/karlkauc/odata-online-viewer";
export const XSD_VIEWER_URL = "https://www.xsd-viewer.online/";
export const XML_VIEWER_URL = "https://www.xml-viewer.online/";
export const ODATA_VIEWER_URL = "https://www.odata-viewer.online/";
/** Counted redirects (backend/app/api/go.py) that add utm_source for the sister site's stats. */
export const XSD_VIEWER_GO = "/go/xsd-viewer";
export const XML_VIEWER_GO = "/go/xml-viewer";
export const ODATA_VIEWER_GO = "/go/odata-viewer";
export const FREEXMLTOOLKIT_GO = "/go/freexmltoolkit";
export const ODATA_ORG_URL = "https://www.odata.org/";
/** GitHub Sponsors — donations keep the site free of ads; counted via `/go/sponsor`. */
export const SPONSOR_URL = "https://github.com/sponsors/karlkauc";
export const SPONSOR_GO = "/go/sponsor";

/** Window events used to open the global dialogs / focus search from anywhere. */
export const EVENT_OPEN_FEEDBACK = "odv:open-feedback";
export const EVENT_OPEN_ABOUT = "odv:open-about";
export const EVENT_OPEN_SEARCH = "odv:open-search";

export interface FeedbackContext {
  errorDetail?: string;
}

export function openFeedback(detail: FeedbackContext = {}): void {
  window.dispatchEvent(new CustomEvent(EVENT_OPEN_FEEDBACK, { detail }));
}

export function openAbout(): void {
  window.dispatchEvent(new CustomEvent(EVENT_OPEN_ABOUT));
}

export function openSearch(): void {
  window.dispatchEvent(new CustomEvent(EVENT_OPEN_SEARCH));
}
