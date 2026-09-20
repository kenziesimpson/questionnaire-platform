import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/query-client";
import { App } from "./app";
import { ErrorFallback } from "./components/error-fallback";
import { createAppRouter } from "./router";
import { TelemetryErrorBoundary } from "./telemetry/error-boundary";
import { routeTemplateOf } from "./telemetry/screen";
import { startAdminTelemetry } from "./telemetry/start";
import { startTracingWhenEnabled } from "./telemetry/tracing";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

const tracingRequested: unknown = import.meta.env.VITE_TELEMETRY_TRACING;
await startTracingWhenEnabled(tracingRequested === "true");
startAdminTelemetry({ page: window, screen: () => routeTemplateOf(router) });

createRoot(root).render(
  <StrictMode>
    <TelemetryErrorBoundary fallback={<ErrorFallback />}>
      <App queryClient={queryClient} router={router} />
    </TelemetryErrorBoundary>
  </StrictMode>,
);
