import { useState, useEffect } from 'react';

export interface FeatureDetectionResult {
  supportsContainerQueries: boolean;
  supportsViewportUnits: boolean;
  supportsClamp: boolean;
  supportsGrid: boolean;
  supportsFlexbox: boolean;
  supportsCustomProperties: boolean;
  supportsResizeObserver: boolean;
  supportsIntersectionObserver: boolean;
  supportsWebP: boolean;
  supportsAvif: boolean;
  touchDevice: boolean;
  reducedMotion: boolean;
}

export function useFeatureDetection(): FeatureDetectionResult {
  const [features, setFeatures] = useState<FeatureDetectionResult>(() => {
    // Server-side rendering defaults
    if (typeof window === 'undefined') {
      return {
        supportsContainerQueries: false,
        supportsViewportUnits: false,
        supportsClamp: false,
        supportsGrid: false,
        supportsFlexbox: false,
        supportsCustomProperties: false,
        supportsResizeObserver: false,
        supportsIntersectionObserver: false,
        supportsWebP: false,
        supportsAvif: false,
        touchDevice: false,
        reducedMotion: false,
      };
    }

    // Client-side feature detection
    return detectFeatures();
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setFeatures(detectFeatures());
    }
  }, []);

  return features;
}

function detectFeatures(): FeatureDetectionResult {
  const hasCSS = typeof CSS !== 'undefined' && CSS.supports;
  
  return {
    // CSS Features
    supportsContainerQueries: hasCSS && CSS.supports('container-type', 'inline-size'),
    supportsViewportUnits: hasCSS && CSS.supports('width', '100vw'),
    supportsClamp: hasCSS && CSS.supports('font-size', 'clamp(1rem, 2vw, 2rem)'),
    supportsGrid: hasCSS && CSS.supports('display', 'grid'),
    supportsFlexbox: hasCSS && CSS.supports('display', 'flex'),
    supportsCustomProperties: hasCSS && CSS.supports('--custom-property', 'value'),

    // JavaScript APIs
    supportsResizeObserver: typeof ResizeObserver !== 'undefined',
    supportsIntersectionObserver: typeof IntersectionObserver !== 'undefined',

    // Image formats
    supportsWebP: checkImageFormat('webp'),
    supportsAvif: checkImageFormat('avif'),

    // Device capabilities
    touchDevice: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

function checkImageFormat(format: 'webp' | 'avif'): boolean {
  if (typeof document === 'undefined') return false;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  try {
    const dataURL = canvas.toDataURL(`image/${format}`);
    return dataURL.indexOf(`data:image/${format}`) === 0;
  } catch {
    return false;
  }
}

export default useFeatureDetection;