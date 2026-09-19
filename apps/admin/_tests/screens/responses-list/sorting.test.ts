import { describe, expect, it } from "vitest";
import { ariaSortOf, nextSorting, sortDescription, sortingOf, sortSearch } from "../../../src/screens/responses-list/sorting";

describe("sortingOf", () => {
  it("reads an empty search as started descending, the order the list had before it could be sorted", () => {
    expect(sortingOf({})).toEqual({ sort: "started", order: "desc" });
  });

  it("takes each half of the search alone, leaving the other at its default", () => {
    expect(sortingOf({ sort: "submitted" })).toEqual({ sort: "submitted", order: "desc" });
    expect(sortingOf({ order: "asc" })).toEqual({ sort: "started", order: "asc" });
    expect(sortingOf({ sort: "submitted", order: "asc" })).toEqual({ sort: "submitted", order: "asc" });
  });
});

describe("sortSearch", () => {
  it.each([
    [{ sort: "started", order: "desc" }, {}],
    [{ sort: "started", order: "asc" }, { order: "asc" }],
    [{ sort: "submitted", order: "desc" }, { sort: "submitted" }],
    [{ sort: "submitted", order: "asc" }, { sort: "submitted", order: "asc" }],
  ] as const)("writes %j as %j, leaving a default out of the URL", (sorting, search) => {
    expect({ ...sortSearch(sorting) }).toEqual({ sort: undefined, order: undefined, ...search });
    expect(sortingOf(sortSearch(sorting))).toEqual(sorting);
  });
});

describe("nextSorting", () => {
  it("flips the direction of the column already sorted by", () => {
    expect(nextSorting({ sort: "started", order: "desc" }, "started")).toEqual({ sort: "started", order: "asc" });
    expect(nextSorting({ sort: "started", order: "asc" }, "started")).toEqual({ sort: "started", order: "desc" });
    expect(nextSorting({ sort: "submitted", order: "desc" }, "submitted")).toEqual({ sort: "submitted", order: "asc" });
  });

  it("starts the other column descending, whichever way the current one runs", () => {
    expect(nextSorting({ sort: "started", order: "desc" }, "submitted")).toEqual({ sort: "submitted", order: "desc" });
    expect(nextSorting({ sort: "started", order: "asc" }, "submitted")).toEqual({ sort: "submitted", order: "desc" });
    expect(nextSorting({ sort: "submitted", order: "asc" }, "started")).toEqual({ sort: "started", order: "desc" });
  });
});

describe("ariaSortOf", () => {
  it("is set on the sorted column alone", () => {
    expect(ariaSortOf({ sort: "started", order: "desc" }, "started")).toBe("descending");
    expect(ariaSortOf({ sort: "started", order: "asc" }, "started")).toBe("ascending");
    expect(ariaSortOf({ sort: "started", order: "desc" }, "submitted")).toBeUndefined();
  });
});

describe("sortDescription", () => {
  it.each([
    [{ sort: "started", order: "desc" }, "newest started first"],
    [{ sort: "started", order: "asc" }, "oldest started first"],
    [{ sort: "submitted", order: "desc" }, "newest submitted first, in-progress sessions last"],
    [{ sort: "submitted", order: "asc" }, "oldest submitted first, in-progress sessions last"],
  ] as const)("describes %j as %s", (sorting, description) => {
    expect(sortDescription(sorting)).toBe(description);
  });
});
