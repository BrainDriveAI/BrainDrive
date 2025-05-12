import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  pluginId: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary component for plugin rendering
 */
export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { pluginId, onError } = this.props;

    // Add plugin context to error
    const contextualError = new Error(
      `[Plugin: ${pluginId}] ${error.message}`
    );
    contextualError.name = error.name;
    contextualError.stack = error.stack;

    // Call error handler if provided
    if (onError) {
      onError(contextualError, errorInfo);
    }

    // Log error for monitoring
    console.error(contextualError);
    console.error('Component stack:', errorInfo.componentStack);
  }

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, pluginId } = this.props;

    if (hasError) {
      return fallback || (
        <div className="plugin-error-boundary">
          <h3>Plugin Error: {pluginId}</h3>
          <p>{error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try Again
          </button>
        </div>
      );
    }

    return children;
  }
}
