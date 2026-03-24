import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("BrainDrive error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-bd-bg-primary px-4">
          <div className="w-full max-w-[400px] text-center">
            <img
              src="/braindrive-logo.svg"
              alt="BrainDrive"
              className="mx-auto mb-6 h-10 w-auto opacity-40"
            />
            <h1 className="font-heading text-lg font-semibold text-bd-text-heading">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-bd-text-muted">
              BrainDrive ran into an unexpected error. Your data is safe.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-xl bg-bd-amber px-6 py-2.5 text-sm font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover"
            >
              Reload BrainDrive
            </button>
            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-xs text-bd-text-muted">
                  Error details
                </summary>
                <pre className="mt-2 overflow-auto rounded-lg bg-bd-bg-secondary p-3 font-mono text-xs text-bd-text-muted">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
