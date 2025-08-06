import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ResponsiveLayouts, LayoutItem } from '../types';
import { 
  LayoutChangeManager, 
  LayoutChangeEvent, 
  LayoutChangeOrigin,
  compareLayoutsSemanticaly,
  generateLayoutHash
} from '../utils/layoutChangeManager';

export interface UnifiedLayoutStateOptions {
  initialLayouts?: ResponsiveLayouts | null;
  debounceMs?: number;
  onLayoutPersist?: (layouts: ResponsiveLayouts, origin: LayoutChangeOrigin) => void;
  onError?: (error: Error) => void;
}

export interface UnifiedLayoutState {
  // Current layout state
  layouts: ResponsiveLayouts | null;
  isLayoutChanging: boolean;
  
  // Layout operations
  updateLayouts: (layouts: ResponsiveLayouts, origin: LayoutChangeOrigin) => void;
  resetLayouts: (layouts: ResponsiveLayouts | null) => void;
  
  // Operation tracking
  startOperation: (operationId: string) => void;
  stopOperation: (operationId: string) => void;
  
  // Utility functions
  getLayoutHash: () => string;
  compareWithCurrent: (layouts: ResponsiveLayouts) => boolean;
}

/**
 * Unified Layout State Hook
 * 
 * This hook provides a single source of truth for layout state management
 * with built-in debouncing, deduplication, and operation tracking.
 */
export function useUnifiedLayoutState(options: UnifiedLayoutStateOptions = {}): UnifiedLayoutState {
  const {
    initialLayouts = null,
    debounceMs = 50,
    onLayoutPersist,
    onError
  } = options;

  // Core state
  const [layouts, setLayouts] = useState<ResponsiveLayouts | null>(initialLayouts);
  const [isLayoutChanging, setIsLayoutChanging] = useState(false);
  
  // Refs for stable references
  const layoutChangeManagerRef = useRef<LayoutChangeManager | null>(null);
  const lastPersistedHashRef = useRef<string | null>(null);
  const initializationCompleteRef = useRef(false);
  const stableLayoutsRef = useRef<ResponsiveLayouts | null>(initialLayouts);

  // Stable refs for callbacks to prevent recreation
  const onLayoutPersistRef = useRef(onLayoutPersist);
  const onErrorRef = useRef(onError);
  
  // Update refs when callbacks change
  useEffect(() => {
    onLayoutPersistRef.current = onLayoutPersist;
  }, [onLayoutPersist]);
  
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Handle processed layout changes - now stable!
  const handleLayoutChangeEvent = useCallback((event: LayoutChangeEvent) => {
    console.log(`[useUnifiedLayoutState] Processing layout change from ${event.origin.source}`);
    
    setIsLayoutChanging(true);
    
    // Update the layouts state only if different
    setLayouts(prevLayouts => {
      if (compareLayoutsSemanticaly(prevLayouts, event.layouts)) {
        console.log('[useUnifiedLayoutState] Layouts are identical, skipping state update');
        setIsLayoutChanging(false); // Reset immediately if no change
        return prevLayouts; // Return same reference to prevent re-render
      }
      
      // Update stable reference only when layouts actually change
      stableLayoutsRef.current = event.layouts;
      return event.layouts;
    });
    
    // Persist the change if it's from a user action and different from last persisted
    if (
      onLayoutPersistRef.current &&
      (event.origin.source === 'user-drag' || event.origin.source === 'user-resize' || event.origin.source === 'user-remove' || event.origin.source === 'drop-add') &&
      event.hash !== lastPersistedHashRef.current
    ) {
      try {
        onLayoutPersistRef.current(event.layouts, event.origin);
        lastPersistedHashRef.current = event.hash;
      } catch (error) {
        console.error('[useUnifiedLayoutState] Error persisting layout:', error);
        onErrorRef.current?.(error as Error);
      }
    }
    
    // Reset changing state after a brief delay
    setTimeout(() => setIsLayoutChanging(false), 100);
  }, []); // Now has no dependencies - completely stable!

  // Initialize layout change manager
  useEffect(() => {
    if (!layoutChangeManagerRef.current) {
      layoutChangeManagerRef.current = new LayoutChangeManager(
        handleLayoutChangeEvent,
        debounceMs
      );
    }
    
    return () => {
      if (layoutChangeManagerRef.current) {
        layoutChangeManagerRef.current.destroy();
        layoutChangeManagerRef.current = null;
      }
    };
  }, [handleLayoutChangeEvent, debounceMs]);

  // Handle initial layouts
  useEffect(() => {
    if (initialLayouts && !initializationCompleteRef.current) {
      console.log('[useUnifiedLayoutState] Setting initial layouts');
      setLayouts(initialLayouts);
      stableLayoutsRef.current = initialLayouts;
      lastPersistedHashRef.current = generateLayoutHash(initialLayouts);
      initializationCompleteRef.current = true;
    }
  }, [initialLayouts]);

  // Update layouts function - now stable!
  const updateLayouts = useCallback((newLayouts: ResponsiveLayouts, origin: LayoutChangeOrigin) => {
    if (!layoutChangeManagerRef.current) {
      console.warn('[useUnifiedLayoutState] Layout change manager not initialized');
      return;
    }

    // Skip if layouts are semantically identical - use stable ref instead of state
    if (compareLayoutsSemanticaly(stableLayoutsRef.current, newLayouts)) {
      console.log('[useUnifiedLayoutState] Skipping identical layout update');
      return;
    }

    console.log(`[useUnifiedLayoutState] Queueing layout update from ${origin.source}`);
    
    // Queue the layout change with appropriate debounce key
    const debounceKey = origin.operationId || origin.source;
    layoutChangeManagerRef.current.queueLayoutChange(newLayouts, origin, debounceKey);
  }, []); // Now has no dependencies - completely stable!

  // Reset layouts function (for page changes, etc.)
  const resetLayouts = useCallback((newLayouts: ResponsiveLayouts | null) => {
    console.log('[useUnifiedLayoutState] Resetting layouts');
    setLayouts(newLayouts);
    stableLayoutsRef.current = newLayouts;
    lastPersistedHashRef.current = newLayouts ? generateLayoutHash(newLayouts) : null;
    
    // Clear any pending changes
    if (layoutChangeManagerRef.current) {
      layoutChangeManagerRef.current.flush();
    }
  }, []);

  // Operation tracking functions
  const startOperation = useCallback((operationId: string) => {
    if (layoutChangeManagerRef.current) {
      layoutChangeManagerRef.current.startOperation(operationId);
    }
  }, []);

  const stopOperation = useCallback((operationId: string) => {
    if (layoutChangeManagerRef.current) {
      layoutChangeManagerRef.current.stopOperation(operationId);
    }
  }, []);

  // Utility functions
  const getLayoutHash = useCallback(() => {
    return generateLayoutHash(stableLayoutsRef.current);
  }, []);

  const compareWithCurrent = useCallback((otherLayouts: ResponsiveLayouts) => {
    return compareLayoutsSemanticaly(stableLayoutsRef.current, otherLayouts);
  }, []);

  // Create a stable layouts reference that only changes when layouts actually change
  const stableLayouts = useMemo(() => {
    return stableLayoutsRef.current;
  }, [layouts]); // This will only change when the layouts state changes

  return {
    layouts: stableLayouts,
    isLayoutChanging,
    updateLayouts,
    resetLayouts,
    startOperation,
    stopOperation,
    getLayoutHash,
    compareWithCurrent
  };
}