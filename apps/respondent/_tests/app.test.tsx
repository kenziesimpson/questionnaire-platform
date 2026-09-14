import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/app.tsx";

describe("App", () => {
  it("renders through @qp/ui under jsdom", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Questionnaire" })).toBeInTheDocument();
  });
});
