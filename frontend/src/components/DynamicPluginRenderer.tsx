import React, { ErrorInfo } from 'react';
import { LoadedModule } from '../types/remotePlugin';

interface DynamicPluginRendererProps {
  module: LoadedModule;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface DynamicPluginRendererState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Component for rendering individual plugin modules with error boundaries
 */
export class DynamicPluginRenderer extends React.Component<
  DynamicPluginRendererProps, 
  DynamicPluginRendererState
> {
  constructor(props: DynamicPluginRendererProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Error rendering plugin module ${this.props.module.name}:`, error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    const { module, fallback } = this.props;
    
    if (this.state.hasError) {
      return fallback || (
        <div className="plugin-error">
          <h3>Plugin Module Error</h3>
          <p>Failed to render module: {module.name}</p>
          <p>{this.state.error?.message || 'Unknown error'}</p>
        </div>
      );
    }

    const Component = module.component;
    return <Component {...module.props} />;
  }
}
