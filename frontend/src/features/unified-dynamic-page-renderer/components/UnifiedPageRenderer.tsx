import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RenderMode, PageData, BreakpointConfig } from '../types';
import { ResponsiveContainer } from './ResponsiveContainer';
import { LayoutEngine } from './LayoutEngine';
import { ModeController } from './ModeController';
import { ErrorBoundary } from './ErrorBoundary';
import { PageProvider } from '../contexts/PageContext';
import { usePageLoader } from '../hooks/usePageLoader';
import { useErrorHandler } from '../hooks/useErrorHandler';

export interface UnifiedPageRendererProps {
  // Page identification
  pageId?: string;
  route?: string;
  
  // Rendering mode
  mode: RenderMode;
  allowUnpublished?: boolean;
  
  // Responsive configuration
  responsive?: boolean;
  breakpoints?: BreakpointConfig;
  containerQueries?: boolean;
  
  // Performance options
  lazyLoading?: boolean;
  preloadPlugins?: string[];
  
  // Event handlers
  onModeChange?: (mode: RenderMode) => void;
  onPageLoad?: (page: PageData) => void;
  onError?: (error: Error) => void;
}

const defaultBreakpoints: BreakpointConfig = {
  breakpoints: {
    mobile: 0,
    tablet: 768,
    desktop: 1024,
    wide: 1440,
    ultrawide: 1920,
  },
  containerQueries: true,
  containerTypes: ['inline-size'],
  fluidTypography: {
    enabled: true,
    minSize: 0.875,
    maxSize: 1.125,
    minViewport: 320,
    maxViewport: 1440,
  },
  adaptiveSpacing: {
    enabled: true,
    baseUnit: 4,
    scaleRatio: 1.25,
  },
};

export const UnifiedPageRenderer: React.FC<UnifiedPageRendererProps> = ({
  pageId,
  route,
  mode,
  allowUnpublished = false,
  responsive = true,
  breakpoints = defaultBreakpoints,
  containerQueries = true,
  lazyLoading = true,
  preloadPlugins = [],
  onModeChange,
  onPageLoad,
  onError,
}) => {
  // State management
  const [currentMode, setCurrentMode] = useState<RenderMode>(mode);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Custom hooks
  const { pageData, loading: pageLoading, error: pageError } = usePageLoader({
    pageId,
    route,
    mode: currentMode,
    allowUnpublished,
  });

  const { handleError, clearError } = useErrorHandler({
    onError,
  });

  // Mode change handler
  const handleModeChange = useCallback((newMode: RenderMode) => {
    setCurrentMode(newMode);
    onModeChange?.(newMode);
  }, [onModeChange]);

  // Page load effect
  useEffect(() => {
    if (pageData && !pageLoading) {
      setIsLoading(false);
      onPageLoad?.(pageData);
    }
  }, [pageData, pageLoading, onPageLoad]);

  // Error handling effect
  useEffect(() => {
    if (pageError) {
      setError(pageError);
      handleError(pageError);
    }
  }, [pageError, handleError]);

  // Loading state
  if (isLoading || pageLoading) {
    return (
      <div className="unified-page-renderer unified-page-renderer--loading">
        <div className="unified-page-renderer__loading-indicator">
          <div className="unified-page-renderer__spinner" />
          <span className="unified-page-renderer__loading-text">
            Loading page...
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !pageData) {
    return (
      <div className="unified-page-renderer unified-page-renderer--error">
        <div className="unified-page-renderer__error-container">
          <h2 className="unified-page-renderer__error-title">
            Failed to load page
          </h2>
          <p className="unified-page-renderer__error-message">
            {error?.message || 'Page not found or failed to load'}
          </p>
          <button
            className="unified-page-renderer__retry-button"
            onClick={() => {
              setError(null);
              clearError();
              setIsLoading(true);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Context value
  const contextValue = useMemo(() => ({
    pageData,
    mode: currentMode,
    responsive,
    breakpoints,
    containerQueries,
    lazyLoading,
    preloadPlugins,
  }), [
    pageData,
    currentMode,
    responsive,
    breakpoints,
    containerQueries,
    lazyLoading,
    preloadPlugins,
  ]);

  return (
    <ErrorBoundary
      onError={handleError}
      fallback={
        <div className="unified-page-renderer unified-page-renderer--error">
          <div className="unified-page-renderer__error-container">
            <h2 className="unified-page-renderer__error-title">
              Something went wrong
            </h2>
            <p className="unified-page-renderer__error-message">
              An unexpected error occurred while rendering the page.
            </p>
          </div>
        </div>
      }
    >
      <PageProvider value={contextValue}>
        <div
          className={`unified-page-renderer unified-page-renderer--${currentMode}`}
          data-testid="unified-page-renderer"
          data-page-id={pageData.id}
          data-mode={currentMode}
        >
          <ModeController
            mode={currentMode}
            onModeChange={handleModeChange}
            pageData={pageData}
          />
          
          {responsive ? (
            <ResponsiveContainer
              breakpoints={breakpoints}
              containerQueries={containerQueries}
            >
              <LayoutEngine
                layouts={pageData.layouts}
                modules={pageData.modules}
                mode={currentMode}
                lazyLoading={lazyLoading}
                preloadPlugins={preloadPlugins}
              />
            </ResponsiveContainer>
          ) : (
            <LayoutEngine
              layouts={pageData.layouts}
              modules={pageData.modules}
              mode={currentMode}
              lazyLoading={lazyLoading}
              preloadPlugins={preloadPlugins}
            />
          )}
        </div>
      </PageProvider>
    </ErrorBoundary>
  );
};

export default UnifiedPageRenderer;