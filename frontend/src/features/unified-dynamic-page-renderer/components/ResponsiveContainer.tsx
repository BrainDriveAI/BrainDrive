import React, { useRef, useEffect, useState, useCallback } from 'react';
import { BreakpointConfig, BreakpointInfo, ContainerDimensions } from '../types';
import { useResponsive } from '../hooks/useResponsive';
import { useFeatureDetection } from '../hooks/useFeatureDetection';

export interface ResponsiveContainerProps {
  children: React.ReactNode;
  breakpoints: BreakpointConfig;
  containerQueries: boolean;
  fluidTypography?: boolean;
  adaptiveSpacing?: boolean;
  
  // Event handlers
  onBreakpointChange?: (breakpoint: BreakpointInfo) => void;
  onResize?: (dimensions: ContainerDimensions) => void;
}

export const ResponsiveContainer: React.FC<ResponsiveContainerProps> = ({
  children,
  breakpoints,
  containerQueries,
  fluidTypography = true,
  adaptiveSpacing = true,
  onBreakpointChange,
  onResize,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<ContainerDimensions>({
    width: 0,
    height: 0,
    availableWidth: 0,
    availableHeight: 0,
  });

  // Feature detection
  const { supportsContainerQueries, supportsClamp } = useFeatureDetection();

  // Responsive hook
  const responsiveState = useResponsive({
    containerRef,
    breakpoints,
    // Only enable container queries when both supported and requested
    containerQueries: containerQueries && supportsContainerQueries,
    // Fall back to viewport when container queries are unsupported OR disabled via prop
    fallbackToViewport: !supportsContainerQueries || !containerQueries,
  });

  // Handle breakpoint changes
  useEffect(() => {
    if (onBreakpointChange) {
      const breakpointInfo: BreakpointInfo = {
        name: responsiveState.breakpoint,
        width: responsiveState.width,
        height: responsiveState.height,
        orientation: responsiveState.orientation,
        pixelRatio: responsiveState.pixelRatio,
        containerWidth: responsiveState.containerWidth,
        containerHeight: responsiveState.containerHeight,
      };
      onBreakpointChange(breakpointInfo);
    }
  }, [responsiveState, onBreakpointChange]);

  // Handle resize
  const handleResize = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const newDimensions: ContainerDimensions = {
        width: rect.width,
        height: rect.height,
        availableWidth: containerRef.current.clientWidth,
        availableHeight: containerRef.current.clientHeight,
      };
      
      setDimensions(newDimensions);
      onResize?.(newDimensions);
    }
  }, [onResize]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Initial measurement
    handleResize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [handleResize]);

  // Generate CSS custom properties for responsive values
  const cssVariables = React.useMemo(() => {
    const vars: Record<string, string> = {};

    // Breakpoint variables
    vars['--current-breakpoint'] = responsiveState.breakpoint;
    vars['--container-width'] = `${dimensions.width}px`;
    vars['--container-height'] = `${dimensions.height}px`;

    // Fluid typography variables
    if (fluidTypography && breakpoints.fluidTypography.enabled) {
      const { minSize, maxSize, minViewport, maxViewport } = breakpoints.fluidTypography;
      vars['--fluid-min-size'] = `${minSize}rem`;
      vars['--fluid-max-size'] = `${maxSize}rem`;
      vars['--fluid-min-viewport'] = `${minViewport}px`;
      vars['--fluid-max-viewport'] = `${maxViewport}px`;
    }

    // Adaptive spacing variables
    if (adaptiveSpacing && breakpoints.adaptiveSpacing.enabled) {
      const { baseUnit, scaleRatio } = breakpoints.adaptiveSpacing;
      const breakpointScale = getBreakpointScale(responsiveState.breakpoint);
      vars['--spacing-base'] = `${baseUnit}px`;
      vars['--spacing-scale'] = `${scaleRatio * breakpointScale}`;
    }

    return vars;
  }, [
    responsiveState.breakpoint,
    dimensions,
    fluidTypography,
    adaptiveSpacing,
    breakpoints,
  ]);

  // Container classes
  const containerClasses = [
    'responsive-container',
    `responsive-container--${responsiveState.breakpoint}`,
    `responsive-container--${responsiveState.orientation}`,
    containerQueries && supportsContainerQueries && 'responsive-container--container-queries',
    fluidTypography && 'responsive-container--fluid-typography',
    adaptiveSpacing && 'responsive-container--adaptive-spacing',
    responsiveState.touchDevice && 'responsive-container--touch',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      style={cssVariables}
      data-testid="responsive-container"
      data-breakpoint={responsiveState.breakpoint}
      data-container-width={dimensions.width}
      data-container-height={dimensions.height}
      data-supports-container-queries={supportsContainerQueries}
      data-supports-clamp={supportsClamp}
    >
      {children}
    </div>
  );
};

// Helper function to get breakpoint scale
function getBreakpointScale(breakpoint: string): number {
  const scales: Record<string, number> = {
    mobile: 0.875,
    tablet: 1,
    desktop: 1.125,
    wide: 1.25,
    ultrawide: 1.5,
  };
  
  return scales[breakpoint] || 1;
}

export default ResponsiveContainer;
