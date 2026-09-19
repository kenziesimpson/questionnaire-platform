import type { SessionSort } from "@qp/shared";
import { ChevronDownIcon, ChevronsUpDownIcon, ChevronUpIcon } from "@qp/ui/icons";
import { TableHead } from "@qp/ui/primitives/table";
import { ariaSortOf, type Sorting } from "./sorting";

function DirectionIcon({ ariaSort }: { ariaSort: "ascending" | "descending" | undefined }) {
  if (ariaSort === "ascending") return <ChevronUpIcon size={14} aria-hidden="true" />;
  if (ariaSort === "descending") return <ChevronDownIcon size={14} aria-hidden="true" />;
  return <ChevronsUpDownIcon size={14} aria-hidden="true" className="opacity-60" />;
}

export function SortHeader({
  column,
  label,
  current,
  onSort,
  className,
}: {
  column: SessionSort;
  label: string;
  current: Sorting;
  onSort: (column: SessionSort) => void;
  className: string;
}) {
  const ariaSort = ariaSortOf(current, column);
  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <button
        type="button"
        className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => onSort(column)}
      >
        {label}
        <DirectionIcon ariaSort={ariaSort} />
      </button>
    </TableHead>
  );
}
