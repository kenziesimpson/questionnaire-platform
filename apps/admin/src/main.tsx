import { ErrorBoundary } from "@qp/ui/error-boundary";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/query-client";
import { App } from "./app";
import { ErrorFallback } from "./components/error-fallback";
import { createAppRouter } from "./router";
import { routeTemplateOf } from "./telemetry/screen";
import { reportRenderError, startAdminTelemetry } from "./telemetry/start";
import { startTracingWhenEnabled } from "./telemetry/tracing";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

await startTracingWhenEnabled();
startAdminTelemetry({ page: window, screen: () => routeTemplateOf(router) });

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<ErrorFallback />} onError={reportRenderError}>
      <App queryClient={queryClient} router={router} />
    </ErrorBoundary>
  </StrictMode>,
);
