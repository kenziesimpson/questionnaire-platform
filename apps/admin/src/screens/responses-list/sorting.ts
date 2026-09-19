import { DEFAULT_SESSION_SORT, DEFAULT_SORT_ORDER, type SessionSort, type SortOrder } from "@qp/shared";

export interface SortSearch {
  readonly sort?: SessionSort;
  readonly order?: SortOrder;
}

export interface Sorting {
  readonly sort: SessionSort;
  readonly order: SortOrder;
}

export function sortingOf({ sort, order }: SortSearch): Sorting {
  return { sort: sort ?? DEFAULT_SESSION_SORT, order: order ?? DEFAULT_SORT_ORDER };
}

export function sortSearch({ sort, order }: Sorting): { sort?: "submitted"; order?: "asc" } {
  return {
    sort: sort === DEFAULT_SESSION_SORT ? undefined : sort,
    order: order === DEFAULT_SORT_ORDER ? undefined : order,
  };
}

export function nextSorting(current: Sorting, column: SessionSort): Sorting {
  if (current.sort !== column) return { sort: column, order: "desc" };
  return { sort: column, order: current.order === "asc" ? "desc" : "asc" };
}

export function ariaSortOf(current: Sorting, column: SessionSort): "ascending" | "descending" | undefined {
  if (current.sort !== column) return undefined;
  return current.order === "asc" ? "ascending" : "descending";
}

export function sortDescription({ sort, order }: Sorting): string {
  const first = order === "desc" ? "newest" : "oldest";
  return sort === "started" ? `${first} started first` : `${first} submitted first, in-progress sessions last`;
}
