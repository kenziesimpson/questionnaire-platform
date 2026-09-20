import { Panel } from "./panel";

export function ErrorFallback() {
  return (
    <Panel role="alert">
      <p className="font-medium">Something went wrong.</p>
      <p className="text-muted-foreground">Reload the page to try again.</p>
    </Panel>
  );
}
