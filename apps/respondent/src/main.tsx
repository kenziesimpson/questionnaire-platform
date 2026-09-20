import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./index.css";
import { EntryFailedScreen } from "./screens/terminal-screens";
import { TelemetryErrorBoundary } from "./telemetry/error-boundary";
import { startRespondentTelemetry } from "./telemetry/start";
import { startTracingWhenEnabled } from "./telemetry/tracing";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

await startTracingWhenEnabled();
startRespondentTelemetry({ page: window, performance, pathname: window.location.pathname });

createRoot(root).render(
  <StrictMode>
    <TelemetryErrorBoundary fallback={<EntryFailedScreen />}>
      <App />
    </TelemetryErrorBoundary>
  </StrictMode>,
);
