import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
  readonly onError: (error: Error) => void;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    try {
      this.props.onError(error);
    } catch {
      return;
    }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
