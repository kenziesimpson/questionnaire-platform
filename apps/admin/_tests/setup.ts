import "@testing-library/jest-dom/vitest";
import { fillJsdomLayoutGaps } from "@qp/ui/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

fillJsdomLayoutGaps();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
