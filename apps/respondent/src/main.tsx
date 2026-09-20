import { ErrorBoundary } from "@qp/ui/error-boundary";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./index.css";
import { EntryFailedScreen } from "./screens/terminal-screens";
import { reportRenderError, startRespondentTelemetry } from "./telemetry/start";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

startRespondentTelemetry({ page: window, performance, pathname: window.location.pathname });

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<EntryFailedScreen />} onError={reportRenderError}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
