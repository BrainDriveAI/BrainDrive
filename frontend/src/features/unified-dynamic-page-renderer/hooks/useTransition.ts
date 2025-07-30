/**
 * useTransition Hook - Unified Dynamic Page Renderer
 * 
 * React hook for managing CSS transitions with reduced motion support
 * and performance monitoring.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import {
  TransitionConfig,
  UseTransitionOptions,
  UseTransitionReturn
} from '../types/animation';
import { animationService } from '../services/AnimationService';

export function useTransition(
  options: UseTransitionOptions = {}
): UseTransitionReturn {
  const elementRef = useRef<HTMLElement | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [progress, setProgress] = useState(0);
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    property = 'all',
    duration = 300,
    easing = 'ease-out',
    delay = 0,
    respectReducedMotion = true
  } = options;

  // Configure reduced motion if needed
  useEffect(() => {
    if (respectReducedMotion) {
      animationService.setReducedMotionConfig({
        respectUserPreference: true,
        fallbackDuration: 200,
        disableAnimations: false,
        alternativeEffects: {
          fade: true,
          scale: false,
          position: false
        }
      });
    }
  }, [respectReducedMotion]);

  // Trigger transition
  const trigger = useCallback(() => {
    if (!elementRef.current) {
      console.warn('Element ref is not set. Make sure to attach the ref to a DOM element.');
      return;
    }

    // Create transition config
    const config: TransitionConfig = {
      property,
      duration,
      easing,
      delay
    };

    // Apply transition to element
    animationService.applyTransition(config, elementRef.current);

    // Set transitioning state
    setIsTransitioning(true);
    setProgress(0);

    // Clear existing timeout
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Start progress tracking
    const startTime = performance.now();
    const totalDuration = duration + delay;

    const updateProgress = () => {
      const elapsed = performance.now() - startTime;
      const currentProgress = Math.min(elapsed / totalDuration, 1);
      setProgress(currentProgress);

      if (currentProgress < 1) {
        requestAnimationFrame(updateProgress);
      } else {
        setIsTransitioning(false);
        setProgress(1);
      }
    };

    // Start progress tracking after delay
    setTimeout(() => {
      requestAnimationFrame(updateProgress);
    }, delay);

    // Set timeout to end transition
    transitionTimeoutRef.current = setTimeout(() => {
      setIsTransitioning(false);
      setProgress(1);
    }, totalDuration);

  }, [property, duration, easing, delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  return {
    trigger,
    isTransitioning,
    progress,
    ref: elementRef
  };
}

export default useTransition;