import "@testing-library/jest-dom/vitest";
import { fillJsdomLayoutGaps } from "@qp/ui/testing";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

fillJsdomLayoutGaps();

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});
