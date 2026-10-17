import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { json } from "@codemirror/lang-json";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { ApiError, downloadExport, fetchMetadataSource } from "../../api/client";
import { useApp } from "../../stores/appStore";

const isDark = () => document.documentElement.classList.contains("dark");

// A single full-line highlight for the targeted source location.
const setHighlightedLine = StateEffect.define<number | null>();

const highlightedLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlightedLine)) {
        if (e.value == null) return Decoration.none;
        const clamped = Math.max(1, Math.min(e.value, tr.state.doc.lines));
        const line = tr.state.doc.line(clamped);
        return Decoration.set([Decoration.line({ class: "cm-src-highlight" }).range(line.from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const XML_EXTENSIONS = [xml(), EditorView.lineWrapping, highlightedLineField];
const JSON_EXTENSIONS = [json(), EditorView.lineWrapping, highlightedLineField];

/** The raw $metadata document, loaded on first open, with jump-to-line for
 * the selected node (XML only: CSDL JSON carries no line numbers). */
export function TextView() {
  const model = useApp((s) => s.model);
  const index = useApp((s) => s.index);
  const selectedId = useApp((s) => s.selectedId);
  const sourceLine = useApp((s) => s.sourceLine);
  const [source, setSource] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [viewReady, setViewReady] = useState(false);

  const metadataId = model?.metadata_id ?? null;
  useEffect(() => {
    if (!metadataId || source?.id === metadataId) return;
    let cancelled = false;
    setError(null);
    fetchMetadataSource(metadataId)
      .then((text) => {
        if (!cancelled) setSource({ id: metadataId, text });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [metadataId, source?.id]);

  const targetLine = useMemo(() => {
    if (sourceLine) return sourceLine;
    if (!selectedId || !index) return null;
    return index.byId.get(selectedId)?.line ?? null;
  }, [sourceLine, selectedId, index]);

  const attachView = useCallback((view: EditorView | null) => {
    viewRef.current = view;
    setViewReady(view != null);
  }, []);

  // Deferred one frame so CodeMirror has measured before scrollIntoView.
  useEffect(() => {
    if (!viewReady || !source) return;
    const view = viewRef.current;
    if (!view) return;
    const id = requestAnimationFrame(() => {
      if (targetLine == null) {
        view.dispatch({ effects: setHighlightedLine.of(null) });
        return;
      }
      const clamped = Math.max(1, Math.min(targetLine, view.state.doc.lines));
      const docLine = view.state.doc.line(clamped);
      view.dispatch({
        effects: [setHighlightedLine.of(clamped), EditorView.scrollIntoView(docLine.from, { y: "start", yMargin: 40 })],
      });
    });
    return () => cancelAnimationFrame(id);
  }, [targetLine, viewReady, source]);

  if (!model) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-200 dark:border-slate-800 text-xs">
        <span className="font-mono truncate">{model.metadata_url ?? model.filename}</span>
        <span className="text-slate-500 shrink-0">
          {model.format.toUpperCase()} · {model.source_lines.toLocaleString()} lines · {(model.source_bytes / 1024).toFixed(1)} KB
          {model.source_reformatted && " · pretty-printed for display"}
        </span>
        <button type="button" className="btn ml-auto text-xs py-0.5" onClick={() => void downloadExport(model.metadata_id, "source")}>
          Download
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {error && (
          <p className="p-4 text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        {!error && !source && <p className="p-4 text-sm text-slate-500">Loading source…</p>}
        {source && (
          <CodeMirror
            value={source.text}
            extensions={model.format === "json" ? JSON_EXTENSIONS : XML_EXTENSIONS}
            editable={false}
            theme={isDark() ? "dark" : "light"}
            height="100%"
            onCreateEditor={attachView}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
          />
        )}
      </div>
    </div>
  );
}
