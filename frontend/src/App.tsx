import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ApiError, loadMetadataFile, loadMetadataText, loadMetadataUrl, loadSample } from "./api/client";
import { AboutDialog } from "./components/AboutDialog";
import { DataExplorer } from "./components/DataExplorer/DataExplorer";
import { DetailPanel } from "./components/DetailPanel";
import { DiagramView } from "./components/DiagramView/DiagramView";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { HeaderActions, type HeaderAction } from "./components/HeaderActions";
import { Landing } from "./components/Landing";
import { MobileNav, type MobilePane } from "./components/MobileNav";
import { ModelTree } from "./components/ModelTree/ModelTree";
import { SearchPalette } from "./components/SearchPalette";
import { TextView } from "./components/TextView/TextView";
import { ThemeToggle } from "./components/ThemeToggle";
import { Uploader } from "./components/Uploader";
import { urlOrigin } from "./lib/serviceUrl";
import { readArrival, readHash, writeHash } from "./lib/deepLink";
import { GITHUB_REPO_URL, SPONSOR_GO, XML_VIEWER_URL, XSD_VIEWER_URL, openAbout, openFeedback, openSearch } from "./lib/links";
import { useDismiss } from "./lib/useDismiss";
import { LG_QUERY, MD_QUERY, matchesMediaQuery, useMediaQuery } from "./lib/useMediaQuery";
import { useApp, type ViewMode } from "./stores/appStore";
import type { Auth, Sample, ServiceModel } from "./types/model";
import { Icon, type IconName } from "./components/Icon";

const route = window.location.pathname.replace(/\/+$/, "");
const isSamplesRoute = route === "/samples";
const isAboutRoute = route === "/about";

const VIEW_TABS: { mode: ViewMode; label: string; icon: IconName }[] = [
  { mode: "details", label: "Details", icon: "details" },
  { mode: "diagram", label: "Diagram", icon: "diagram" },
  { mode: "data", label: "Data", icon: "data" },
  { mode: "source", label: "Source", icon: "source" },
];

const TREE_HIDDEN_KEY = "odv-tree-hidden";

function readTreeHidden(): boolean {
  try {
    return localStorage.getItem(TREE_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const model = useApp((s) => s.model);
  const auth = useApp((s) => s.auth);
  const setAuth = useApp((s) => s.setAuth);
  const setModel = useApp((s) => s.setModel);
  const selectedId = useApp((s) => s.selectedId);
  const setSelected = useApp((s) => s.setSelected);
  const viewMode = useApp((s) => s.viewMode);
  const setViewMode = useApp((s) => s.setViewMode);
  const loadInfo = useApp((s) => s.loadInfo);
  const [filesOpen, setFilesOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false); // phones: the tree is a pane; tablets: a drawer
  const [treeHidden, setTreeHidden] = useState(readTreeHidden); // desktop: column folded away
  const [authRequired, setAuthRequired] = useState(false);
  const [arrival, setArrival] = useState<{ status: "loading" | "error"; detail: string } | null>(null);
  const atLeastMd = useMediaQuery(MD_QUERY);
  const wide = useMediaQuery(LG_QUERY);
  const pendingHash = useRef(readHash());
  const asideRef = useRef<HTMLElement | null>(null);
  const closeTree = useCallback(() => setTreeOpen(false), []);
  const toggleTreeColumn = useCallback(() => {
    setTreeHidden((hidden) => {
      try {
        localStorage.setItem(TREE_HIDDEN_KEY, hidden ? "0" : "1");
      } catch {
        // storage blocked: the choice lasts for this page only
      }
      return !hidden;
    });
  }, []);
  // Tablets: the tree is a drawer. Escape, a tap outside or picking a node closes it.
  useDismiss(asideRef, treeOpen && atLeastMd && !wide, closeTree);
  useEffect(() => {
    if (selectedId && atLeastMd && !wide) setTreeOpen(false);
  }, [selectedId, atLeastMd, wide]);

  useEffect(() => {
    if (isAboutRoute) openAbout();
  }, []);

  // Ctrl/Cmd-K opens the search palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (useApp.getState().model) openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Every entry point ends here. On phones the loaders collapse to make room.
  const apply = useCallback(
    (loaded: ServiceModel, info: Parameters<typeof setModel>[1]) => {
      setModel(loaded, info);
      setAuthRequired(false);
      setTreeOpen(false);
      if (!matchesMediaQuery(MD_QUERY)) setFilesOpen(false);
      const hash = pendingHash.current;
      pendingHash.current = { id: null, view: null };
      if (hash.id && useApp.getState().index?.byId.has(hash.id)) setSelected(hash.id);
      if (hash.view) setViewMode(hash.view);
      else setViewMode("details");
    },
    [setModel, setSelected, setViewMode],
  );

  const onUrl = useCallback(
    async (url: string, credentials: Auth | null) => {
      try {
        const loaded = await loadMetadataUrl(url, credentials);
        // Data requests go to the service root; keep the credentials only if it is
        // still the origin the visitor typed them for (the backend refuses a
        // redirect elsewhere, this guards the client side too).
        setAuth(credentials && urlOrigin(loaded.service_root ?? "") === urlOrigin(url) ? credentials : null);
        apply(loaded, { kind: "url", url });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setAuthRequired(true);
        throw err;
      }
    },
    [apply, setAuth],
  );
  const onText = useCallback(async (content: string) => apply(await loadMetadataText(content), { kind: "text", filename: "pasted metadata" }), [apply]);
  const onFile = useCallback(async (file: File) => apply(await loadMetadataFile(file), { kind: "upload", filename: file.name }), [apply]);
  const onSample = useCallback(
    async (sample: Sample) => {
      setAuth(null);
      apply(await loadSample(sample.id), { kind: "sample", sampleId: sample.id, name: sample.name });
    },
    [apply, setAuth],
  );

  // ?url= / ?sample= on arrival.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    const request = readArrival();
    if (!request.url && !request.sample) return;
    setArrival({ status: "loading", detail: request.url ?? request.sample ?? "" });
    const task = request.url
      ? loadMetadataUrl(request.url, null).then((m) => apply(m, { kind: "url", url: request.url! }))
      : loadSample(request.sample!).then((m) => apply(m, { kind: "sample", sampleId: request.sample!, name: request.sample! }));
    task
      .then(() => setArrival(null))
      .catch((err) => {
        setArrival({ status: "error", detail: err instanceof ApiError ? err.message : String(err) });
        if (err instanceof ApiError && err.status === 401) setAuthRequired(true);
      });
  }, [apply]);

  // Selection and view live in the hash so the page is shareable.
  useEffect(() => {
    if (!model) return;
    writeHash(selectedId, viewMode === "details" ? null : viewMode);
  }, [model, selectedId, viewMode]);

  const secondaryActions = useMemo<HeaderAction[]>(
    () => [
      { key: "feedback", label: (
          <>
            <Icon name="feedback" /> Feedback
          </>
        ), title: "Send feedback", ariaLabel: "Send feedback", onClick: openFeedback },
      { key: "xsd", label: "XSD Viewer ↗", title: "Sister tool for XML Schemas", ariaLabel: "Open the XSD Viewer", href: XSD_VIEWER_URL, external: true },
      { key: "xml", label: "XML Viewer ↗", title: "Sister tool for XML documents", ariaLabel: "Open the XML Viewer", href: XML_VIEWER_URL, external: true },
      { key: "sponsor", label: (
          <>
            <Icon name="heart" className="text-rose-500" /> Support ↗
          </>
        ), title: "Support the OData Viewer on GitHub Sponsors", ariaLabel: "Support this project", href: SPONSOR_GO, external: true },
      { key: "github", label: "GitHub", title: "Source code on GitHub", ariaLabel: "Source code on GitHub", href: GITHUB_REPO_URL, external: true },
      { key: "about", label: (
          <>
            <Icon name="info" /> About
          </>
        ), title: "About this app", ariaLabel: "About this app", onClick: openAbout },
    ],
    [],
  );

  const mobilePane: MobilePane = treeOpen && !atLeastMd ? "tree" : viewMode;
  const onMobilePane = useCallback(
    (pane: MobilePane) => {
      if (pane === "tree") {
        setTreeOpen(true);
        return;
      }
      setTreeOpen(false);
      setViewMode(pane);
    },
    [setViewMode],
  );

  const statusText = model
    ? `${loadInfo?.kind === "sample" ? loadInfo.name : (model.service_root ?? model.filename)} · OData ${model.odata_version} · ${model.stats.entity_set_count} sets, ${model.stats.entity_type_count} types`
    : "No service loaded";

  const content = (
    <>
      {viewMode === "details" && (
        <div className="h-full overflow-y-auto">
          <DetailPanel />
        </div>
      )}
      {viewMode === "diagram" && <DiagramView />}
      {viewMode === "data" && <DataExplorer />}
      {viewMode === "source" && <TextView />}
    </>
  );

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 short:py-1 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="flex items-center gap-2 shrink-0" aria-label="Online OData Viewer home">
            <img src="/favicon.svg" alt="" width={24} height={24} className="w-6 h-6" />
            <h1 className="text-base md:text-lg font-semibold">OData Viewer</h1>
          </a>
          <p className="hidden lg:block text-sm text-slate-500 dark:text-slate-400 truncate">
            Visualize $metadata · explore entity sets · V2, V3, V4
          </p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <button type="button" className="btn" onClick={openSearch} disabled={!model} title="Search (Ctrl/Cmd-K)" aria-label="Search">
            <Icon name="search" />
            <span className="hidden sm:inline">Search</span>
          </button>
          <HeaderActions actions={secondaryActions} inline={wide} />
          <ThemeToggle />
        </div>
      </header>

      <div className="border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setFilesOpen((o) => !o)}
          aria-expanded={filesOpen}
          className="w-full min-w-0 flex items-center gap-2 px-3 md:px-4 py-1.5 touch:py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
        >
          <Icon name={filesOpen ? "chevronDown" : "chevronRight"} size={14} className="text-slate-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Service</span>
          {!filesOpen && <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{statusText}</span>}
        </button>
        {arrival && (
          <p
            role="status"
            className={clsx(
              "mx-4 mb-2 rounded px-3 py-1.5 text-xs",
              arrival.status === "error" ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
            )}
          >
            {arrival.status === "loading" ? `Loading ${arrival.detail}…` : `Could not load the requested service: ${arrival.detail}`}
          </p>
        )}
        {filesOpen && (
          <div className="px-3 md:px-4 pb-3 md:pb-4">
            <Uploader
              status={statusText}
              defaultMode={isSamplesRoute ? "samples" : "url"}
              initialUrl={readArrival().url ?? ""}
              auth={auth}
              serviceRoot={model?.service_root ?? null}
              authRequired={authRequired}
              onUrl={onUrl}
              onText={onText}
              onFile={onFile}
              onSample={onSample}
            />
          </div>
        )}
      </div>

      <main className="flex-1 min-h-0">
        {!model ? (
          <Landing onSample={onSample} />
        ) : (
          <div className={clsx("h-full min-h-0 flex flex-col lg:grid", treeHidden ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[22rem_minmax(0,1fr)]")}>
            {/* Tree: column on desktop, drawer on tablets, pane on phones. */}
            {treeOpen && atLeastMd && !wide && <div className="fixed inset-0 z-20 bg-black/30" aria-hidden="true" onClick={() => setTreeOpen(false)} />}
            <aside
              ref={asideRef}
              aria-label="Model tree"
              className={clsx(
                "min-h-0 flex-col bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 lg:border-r",
                treeOpen ? "flex flex-1 md:flex-none md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-[24rem] md:max-w-[90vw] md:shadow-2xl" : "hidden",
                treeHidden ? "lg:hidden" : "lg:flex lg:static lg:inset-auto lg:z-auto lg:w-auto lg:max-w-none lg:shadow-none lg:h-full",
              )}
            >
              <ModelTree onHide={wide ? toggleTreeColumn : undefined} />
            </aside>
            <div className={clsx("min-h-0 h-full flex-col", treeOpen && !atLeastMd ? "hidden" : "flex flex-1")}>
              <div className="hidden md:flex items-center gap-1 px-3 py-2 short:py-1 border-b border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  className={clsx("btn mr-1", !treeHidden && "lg:hidden")}
                  onClick={wide ? toggleTreeColumn : () => setTreeOpen((v) => !v)}
                  aria-pressed={wide ? !treeHidden : treeOpen}
                  title={wide ? "Show the model tree" : "Model tree"}
                >
                  <Icon name="tree" /> Tree
                </button>
                <div className="flex gap-1" role="tablist">
                  {VIEW_TABS.map((tab) => (
                    <button
                      key={tab.mode}
                      type="button"
                      role="tab"
                      aria-selected={viewMode === tab.mode}
                      className={clsx(
                        "inline-flex items-center gap-1.5 px-3 py-1 touch:py-2 text-sm font-medium rounded-md",
                        viewMode === tab.mode
                          ? "bg-accent text-white dark:bg-accent-dark dark:text-slate-950"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700",
                      )}
                      onClick={() => setViewMode(tab.mode)}
                    >
                      <Icon name={tab.icon} size={15} />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0">{content}</div>
            </div>
          </div>
        )}
      </main>

      {model && <MobileNav pane={mobilePane} onChange={onMobilePane} />}

      <SearchPalette />
      <FeedbackDialog />
      <AboutDialog />
    </div>
  );
}
