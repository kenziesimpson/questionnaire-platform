import { useId, useState } from "react";
import { InfoIcon } from "./icons";

export function InfoTip({ label, children }: { label: string; children: string }) {
  const tipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = (hovered || focused) && !dismissed;

  return (
    <span
      className="relative inline-flex align-middle"
      onPointerEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !visible) return;
          event.stopPropagation();
          setDismissed(true);
        }}
      >
        <InfoIcon />
      </button>
      <span
        role="tooltip"
        id={tipId}
        hidden={!visible}
        className="absolute bottom-full left-1/2 z-50 w-72 -translate-x-1/2 pb-1.5"
      >
        <span className="block rounded-md bg-foreground px-2.5 py-2 text-xs leading-normal font-normal text-background shadow-md">
          {children}
        </span>
      </span>
    </span>
  );
}
