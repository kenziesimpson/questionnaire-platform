import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/query-client";
import { App } from "./app.tsx";
import { createAppRouter } from "./router.tsx";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

createRoot(root).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);
