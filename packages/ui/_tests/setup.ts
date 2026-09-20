import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { fillJsdomLayoutGaps } from "../src/testing";

fillJsdomLayoutGaps();

afterEach(cleanup);
