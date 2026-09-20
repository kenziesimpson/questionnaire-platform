import { InfoIcon } from "@qp/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@qp/ui/primitives/tooltip";

export function InfoTip({ label, children }: { label: string; children: string }) {
  return (
    <TooltipProvider>
      <Tooltip disableHoverableContent>
        <TooltipTrigger
          type="button"
          aria-label={label}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <InfoIcon size={14} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-72 text-xs leading-normal font-normal">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
