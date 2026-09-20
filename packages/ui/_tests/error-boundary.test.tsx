import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/error-boundary";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Boom({ message }: { readonly message: string }): never {
  throw new TypeError(message);
}

describe("ErrorBoundary", () => {
  it("renders its children while nothing throws, and does not call onError", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <p>children</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("children")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("renders the fallback and hands onError the error that was thrown", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <Boom message="broken" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  it("still renders the fallback when onError throws", () => {
    render(
      <ErrorBoundary
        fallback={<p>fallback</p>}
        onError={() => {
          throw new Error("reporter is broken");
        }}
      >
        <Boom message="broken" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fallback")).toBeInTheDocument();
  });
});
