import { Button } from "@qp/ui/primitives/button";
import type { ComponentProps, ReactNode } from "react";

export function LoadingLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function RetryNotice({
  message,
  onRetry,
  retrying = false,
  retryLabel = "Try again",
  retryingLabel = "Retrying…",
  size = "sm",
}: {
  message: ReactNode;
  onRetry: () => void;
  retrying?: boolean;
  retryLabel?: string;
  retryingLabel?: string;
  size?: ComponentProps<typeof Button>["size"];
}) {
  return (
    <>
      <p className="font-medium">{message}</p>
      <Button variant="outline" size={size} disabled={retrying} onClick={onRetry}>
        {retrying ? retryingLabel : retryLabel}
      </Button>
    </>
  );
}
