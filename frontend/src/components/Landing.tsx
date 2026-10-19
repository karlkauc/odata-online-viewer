import { useEffect, useState } from "react";
import { listSamples } from "../api/client";
import { XML_VIEWER_URL, XSD_VIEWER_URL } from "../lib/links";
import type { Sample } from "../types/model";
import { Icon, type IconName } from "./Icon";

const FEATURED = ["northwind-v4", "trippin-v4", "jdbcodata-demo"];

/** Empty state: what the tool does, one-click samples, and a short FAQ for people (and crawlers) who wonder what OData is. */
export function Landing({ onSample }: { onSample: (sample: Sample) => Promise<void> }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSamples()
      .then(setSamples)
      .catch(() => setSamples([]));
  }, []);

  const featured = FEATURED.map((id) => samples.find((s) => s.id === id)).filter((s): s is Sample => Boolean(s));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <h2 className="text-2xl font-semibold">See what an OData service looks like</h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          Paste a service URL above — or its <code>$metadata</code> — and get the whole model at a glance: entity sets, entity types with
          keys and properties, navigation properties with multiplicities, complex and enum types, functions and actions. Then query the
          live data without writing a single URL by hand.
        </p>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {([
            ["tree", "Tree & details", "Every schema, container, set, type, property and navigation, with labels and annotations."],
            ["diagram", "ER diagram", "Entity types as boxes, navigations as edges with 1 / 0..1 / * multiplicities, inheritance and complex types."],
            ["data", "Data explorer", "$filter, $select, $orderby, $top, $skip and $count, paging via next links, the exact request URL to copy."],
            ["lock", "Protected services", "HTTP Basic credentials are passed through per request over HTTPS and never stored."],
            ["layers", "V2, V3, V4, V4.01", "EDMX 1.0 associations, V4 partners and referential constraints, CSDL JSON — one consistent model."],
            ["download", "Exports", "PNG and SVG of the diagram, Markdown documentation, Mermaid erDiagram, the raw source."],
          ] as [IconName, string, string][]).map(([icon, title, text]) => (
            <li key={title} className="flex gap-3 rounded-md border border-slate-200 dark:border-slate-800 p-3">
              <span className="shrink-0 h-9 w-9 rounded-md flex items-center justify-center bg-blue-50 text-accent dark:bg-blue-950/40 dark:text-accent-dark">
                <Icon name={icon} size={20} />
              </span>
              <span>
                <span className="font-medium">{title}</span>
                <span className="block text-slate-500 dark:text-slate-400 text-xs mt-0.5">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Try a sample</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {featured.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => {
                  setBusy(sample.id);
                  setError(null);
                  onSample(sample)
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setBusy(null));
                }}
              >
                {busy === sample.id ? "Loading…" : sample.name}
              </button>
            ))}
            <a className="btn" href="/samples">
              All samples
            </a>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <section className="mt-10 space-y-4 text-sm text-slate-600 dark:text-slate-400">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Good to know</h3>
          <details className="group">
            <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">What is OData?</summary>
            <p className="mt-1">
              OData (Open Data Protocol) is an OASIS standard for REST APIs over data models. A service publishes a
              <code> $metadata</code> document that describes its entity types, keys, relationships and operations, and clients such as
              Excel, Power BI, SAP Fiori or any HTTP library can query it with a standard URL grammar (<code>$filter</code>,
              <code>$select</code>, <code>$expand</code>, …). Version 2 is still common in SAP landscapes; version 4 is the current standard.
            </p>
          </details>
          <details>
            <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">Where do I find the $metadata URL?</summary>
            <p className="mt-1">
              Append <code>/$metadata</code> to the service root, for example{" "}
              <code>https://services.odata.org/V4/Northwind/Northwind.svc/$metadata</code>. You can paste either form here; the viewer
              figures out the rest and follows redirects.
            </p>
          </details>
          <details>
            <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">Why not call the service from the browser directly?</summary>
            <p className="mt-1">
              Most OData services send no CORS headers, and many require HTTP Basic authentication. This site therefore fetches the
              metadata and the data through its own backend, which only forwards credentials over HTTPS, keeps parsed metadata in memory
              for a short while and stores neither documents nor credentials. Internal or intranet addresses cannot be reached from here.
            </p>
          </details>
          <details>
            <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">Which OData versions are supported?</summary>
            <p className="mt-1">
              OData V2 and V3 (EDMX 1.0 with associations and function imports, SAP annotations), V4 and V4.01 (EDMX 4.0 and CSDL JSON,
              vocabularies, bound functions and actions, singletons, containment).
            </p>
          </details>
          <p className="pt-2 text-xs">
            Sister tools by the same author:{" "}
            <a className="underline" href={XSD_VIEWER_URL} target="_blank" rel="noopener noreferrer">
              Online XSD Viewer
            </a>{" "}
            and{" "}
            <a className="underline" href={XML_VIEWER_URL} target="_blank" rel="noopener noreferrer">
              XML Online Viewer
            </a>
            . Free, open source, no account, no ads.
          </p>
        </section>
      </div>
    </div>
  );
}
