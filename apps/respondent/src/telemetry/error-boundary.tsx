import { Component, type ReactNode } from "react";
import { reportRenderError } from "./start";

interface TelemetryErrorBoundaryProps {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
}

interface TelemetryErrorBoundaryState {
  readonly failed: boolean;
}

export class TelemetryErrorBoundary extends Component<TelemetryErrorBoundaryProps, TelemetryErrorBoundaryState> {
  override state: TelemetryErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): TelemetryErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    reportRenderError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
