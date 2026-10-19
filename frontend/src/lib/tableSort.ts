// Column sorting for the data explorer: header clicks become `$orderby` for
// paged results and an in-browser sort for complete ones (drilled values).

import type { Cell } from "../types/model";

export type SortDir = "asc" | "desc";

export interface Sort {
  column: string;
  dir: SortDir;
}

/** The first key of an `$orderby` expression, e.g. `"Name desc, Id"` → Name desc. */
export function parseOrderby(orderby: string | null | undefined): Sort | null {
  const first = orderby?.split(",")[0]?.trim();
  if (!first) return null;
  const [column, dir] = first.split(/\s+/);
  return { column, dir: dir?.toLowerCase() === "desc" ? "desc" : "asc" };
}

/** Ascending on a new column, then flip on every further click. */
export function nextSort(current: Sort | null, column: string): Sort {
  return { column, dir: current?.column === column && current.dir === "asc" ? "desc" : "asc" };
}

export function orderbyFor(sort: Sort): string {
  return `${sort.column} ${sort.dir}`;
}

/** Services reject ordering by streams, binaries, spatial values and collections. */
export function sortableType(type: string): boolean {
  return type.startsWith("Edm.") && !/^Edm\.(Stream|Binary|Geography|Geometry)/.test(type);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareCells(a: Cell, b: Cell): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const text = (v: Cell) => (typeof v === "object" ? JSON.stringify(v) : String(v));
  return collator.compare(text(a), text(b));
}

/** Sorted copy; missing values stay last in both directions, ties keep their order. */
export function sortRows<T extends Record<string, Cell>>(rows: T[], sort: Sort): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[sort.column] ?? null;
      const b = y.row[sort.column] ?? null;
      if (a === null || b === null) return a === b ? x.i - y.i : a === null ? 1 : -1;
      return sign * compareCells(a, b) || x.i - y.i;
    })
    .map(({ row }) => row);
}
