import { useState, useEffect, useCallback, useRef } from 'react';
import { BreakpointConfig, ResponsiveState, UseResponsiveOptions } from '../types';

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

export function useResponsive(options: UseResponsiveOptions = {}): ResponsiveState {
  const {
    containerRef,
    containerName,
    breakpoints = defaultBreakpoints,
    debounceMs = 100,
    throttleMs = 16,
    fallbackToViewport = true,
    ssrBreakpoint = 'desktop'
  } = options;

  const [state, setState] = useState<ResponsiveState>(() => ({
    breakpoint: ssrBreakpoint,
    width: 0,
    height: 0,
    orientation: 'landscape',
    pixelRatio: 1,
    touchDevice: false,
    supportsContainerQueries: false,
    supportsViewportUnits: false,
    supportsClamp: false
  }));

  const debounceTimeoutRef = useRef<NodeJS.Timeout>();
  const throttleTimeoutRef = useRef<NodeJS.Timeout>();

  // Throttle function
  const throttle = useCallback((func: Function, delay: number) => {
    return (...args: any[]) => {
      if (throttleTimeoutRef.current) return;
      
      throttleTimeoutRef.current = setTimeout(() => {
        func(...args);
        throttleTimeoutRef.current = undefined;
      }, delay);
    };
  }, []);

  // Debounce function
  const debounce = useCallback((func: Function, delay: number) => {
    return (...args: any[]) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      debounceTimeoutRef.current = setTimeout(() => {
        func(...args);
      }, delay);
    };
  }, []);

  // Get breakpoint from width
  const getBreakpointFromWidth = useCallback((width: number): string => {
    const sortedBreakpoints = Object.entries(breakpoints.breakpoints)
      .sort(([, a], [, b]) => b - a); // Sort descending

    for (const [name, minWidth] of sortedBreakpoints) {
      if (width >= minWidth) {
        return name;
      }
    }

    return sortedBreakpoints[sortedBreakpoints.length - 1][0]; // Fallback to smallest
  }, [breakpoints.breakpoints]);

  useEffect(() => {
    // Feature detection
    const supportsContainerQueries = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('container-type', 'inline-size');
    const supportsViewportUnits = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('width', '100vw');
    const supportsClamp = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('font-size', 'clamp(1rem, 2vw, 2rem)');

    // Container query observer
    let containerObserver: ResizeObserver | null = null;

    if (supportsContainerQueries && containerRef?.current) {
      containerObserver = new ResizeObserver(
        throttle((entries: ResizeObserverEntry[]) => {
          const entry = entries[0];
          if (!entry.contentBoxSize || !entry.contentBoxSize[0]) return;
          
          const { inlineSize, blockSize } = entry.contentBoxSize[0];
          const breakpoint = getBreakpointFromWidth(inlineSize);

          setState(prev => ({
            ...prev,
            breakpoint,
            containerWidth: inlineSize,
            containerHeight: blockSize,
            supportsContainerQueries,
            supportsViewportUnits,
            supportsClamp
          }));
        }, throttleMs)
      );

      containerObserver.observe(containerRef.current);
    }

    // Viewport observer (fallback)
    const handleViewportChange = debounce(() => {
      if (typeof window === 'undefined') return;
      
      const width = window.innerWidth;
      const height = window.innerHeight;
      const orientation = width > height ? 'landscape' : 'portrait';
      const pixelRatio = window.devicePixelRatio || 1;
      const touchDevice = 'ontouchstart' in window;

      const breakpoint = getBreakpointFromWidth(
        width,
      );

      setState(prev => ({
        ...prev,
        breakpoint: containerObserver ? prev.breakpoint : breakpoint,
        width,
        height,
        orientation,
        pixelRatio,
        touchDevice,
        supportsContainerQueries,
        supportsViewportUnits,
        supportsClamp
      }));
    }, debounceMs);

    if (fallbackToViewport || !supportsContainerQueries) {
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('orientationchange', handleViewportChange);
        handleViewportChange(); // Initial call
      }
    }

    return () => {
      containerObserver?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleViewportChange);
        window.removeEventListener('orientationchange', handleViewportChange);
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, [containerRef, breakpoints, debounceMs, throttleMs, fallbackToViewport, getBreakpointFromWidth, throttle, debounce]);

  return state;
}

export default useResponsive;