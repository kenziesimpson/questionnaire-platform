import { useId } from "react";
import { Pill } from "../../components/pill";
import type { NumberedItem } from "./sample-answers-panel";

export function HiddenByRules({ hiddenItems }: { hiddenItems: readonly NumberedItem[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        Hidden by rules
        <Pill className="border-none bg-muted text-muted-foreground">{hiddenItems.length}</Pill>
      </h2>
      {hiddenItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">The current sample answers hide no questions.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {hiddenItems.map(({ item, label }) => (
            <li key={item.itemId}>{label}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
