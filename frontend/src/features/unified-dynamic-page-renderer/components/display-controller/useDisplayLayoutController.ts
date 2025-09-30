import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ResponsiveLayouts } from '../../types';
import { useDisplayLayoutState } from './useDisplayLayoutState';
import { UnifiedLayoutState } from '../../hooks/useUnifiedLayoutState';

export type ControllerState = 'idle' | 'resizing' | 'dragging' | 'grace' | 'commit';

export interface UseDisplayLayoutControllerArgs {
  layouts: ResponsiveLayouts;
  onLayoutChange?: (layouts: ResponsiveLayouts) => void;
  debounceMs?: number;
  onError?: (error: Error) => void;
}

export interface UseDisplayLayoutControllerResult {
  unifiedLayoutState: UnifiedLayoutState;
  currentLayouts: ResponsiveLayouts;
  displayedLayouts: ResponsiveLayouts;
  ENABLE_LAYOUT_CONTROLLER_V2: boolean;
  isDebugMode: boolean;
  layoutGracePeriod: number;
  userCommitDelayMs: number;
  controllerStateRef: React.MutableRefObject<ControllerState>;
  workingLayoutsRef: React.MutableRefObject<ResponsiveLayouts | null>;
  canonicalLayoutsRef: React.MutableRefObject<ResponsiveLayouts | null>;
  lastVersionRef: React.MutableRefObject<number>;
  transitionToState: (newState: ControllerState, data?: any) => void;
  logControllerState: (action: string, data?: any) => void;
}

export const useDisplayLayoutController = ({
  layouts,
  onLayoutChange,
  debounceMs,
  onError,
}: UseDisplayLayoutControllerArgs): UseDisplayLayoutControllerResult => {
  const ENABLE_LAYOUT_CONTROLLER_V2 = import.meta.env.VITE_LAYOUT_CONTROLLER_V2 === 'true' || false;
  const isDebugMode = import.meta.env.VITE_LAYOUT_DEBUG === 'true';
  const layoutGracePeriod = Number(import.meta.env.VITE_LAYOUT_GRACE_PERIOD ?? 150);
  const userCommitDelayMs = Math.min(layoutGracePeriod, 40);

  const workingLayoutsRef = useRef<ResponsiveLayouts | null>(null);
  const canonicalLayoutsRef = useRef<ResponsiveLayouts | null>(null);
  const controllerStateRef = useRef<ControllerState>('idle');
  const lastVersionRef = useRef<number>(0);

  const [, forceUpdate] = useState({});
  const triggerUpdate = useCallback(() => forceUpdate({}), []);

  const logControllerState = useCallback((action: string, data?: any) => {
    if (import.meta.env.MODE === 'development' && ENABLE_LAYOUT_CONTROLLER_V2) {
      console.log(`[LayoutController V2] ${action}`, {
        state: controllerStateRef.current,
        version: lastVersionRef.current,
        workingLayouts: !!workingLayoutsRef.current,
        canonicalLayouts: !!canonicalLayoutsRef.current,
        timestamp: performance.now().toFixed(2),
        ...data
      });
    }
  }, [ENABLE_LAYOUT_CONTROLLER_V2]);

  const transitionToState = useCallback((newState: ControllerState, data?: any) => {
    if (!ENABLE_LAYOUT_CONTROLLER_V2) return;

    const oldState = controllerStateRef.current;
    const validTransitions: Record<ControllerState, ControllerState[]> = {
      idle: ['resizing', 'dragging'],
      resizing: ['grace', 'idle'],
      dragging: ['grace', 'idle'],
      grace: ['commit', 'idle'],
      commit: ['idle']
    };

    if (!validTransitions[oldState].includes(newState)) {
      logControllerState('INVALID_STATE_TRANSITION', {
        from: oldState,
        to: newState,
        allowed: validTransitions[oldState],
        ...data
      });
      return;
    }

    controllerStateRef.current = newState;
    logControllerState(`STATE_TRANSITION: ${oldState} -> ${newState}`, data);
    triggerUpdate();
  }, [ENABLE_LAYOUT_CONTROLLER_V2, logControllerState, triggerUpdate]);

  useEffect(() => {
    if (ENABLE_LAYOUT_CONTROLLER_V2) {
      logControllerState('CONTROLLER_INITIALIZED', {
        featureFlag: ENABLE_LAYOUT_CONTROLLER_V2,
        environment: import.meta.env.MODE
      });
    }
  }, [ENABLE_LAYOUT_CONTROLLER_V2, logControllerState]);

  const unifiedLayoutState = useDisplayLayoutState({
    initialLayouts: layouts,
    debounceMs,
    onLayoutPersist: (persistedLayouts, origin) => {
      onLayoutChange?.(persistedLayouts);
    },
    onError,
  });

  const stableLayoutsRef = useRef<ResponsiveLayouts>({
    mobile: [],
    tablet: [],
    desktop: [],
    wide: [],
    ultrawide: []
  });

  const currentLayouts = useMemo(() => {
    const nextLayouts = unifiedLayoutState.layouts || {
      mobile: [],
      tablet: [],
      desktop: [],
      wide: [],
      ultrawide: []
    };

    const currentHash = JSON.stringify(stableLayoutsRef.current);
    const newHash = JSON.stringify(nextLayouts);

    if (currentHash !== newHash) {
      stableLayoutsRef.current = nextLayouts;
    }

    return stableLayoutsRef.current;
  }, [unifiedLayoutState.layouts]);

  const displayedLayouts = useMemo(() => {
    if (!ENABLE_LAYOUT_CONTROLLER_V2) {
      return currentLayouts;
    }

    const state = controllerStateRef.current;
    if (state === 'resizing' || state === 'dragging' || state === 'grace') {
      logControllerState('DISPLAY_WORKING_BUFFER', { state });
      return workingLayoutsRef.current || currentLayouts;
    }

    logControllerState('DISPLAY_CANONICAL_BUFFER', {
      state,
      usingCurrentLayouts: true
    });
    return currentLayouts;
  }, [ENABLE_LAYOUT_CONTROLLER_V2, currentLayouts, logControllerState]);

  useEffect(() => {
    if (!ENABLE_LAYOUT_CONTROLLER_V2) {
      return;
    }

    if (controllerStateRef.current === 'idle') {
      const layoutsWithUltrawide = {
        ...currentLayouts,
        ultrawide: currentLayouts.ultrawide || []
      };
      canonicalLayoutsRef.current = layoutsWithUltrawide;
      workingLayoutsRef.current = layoutsWithUltrawide;
      logControllerState('BUFFERS_SYNCED', {
        source: 'external_update',
        state: controllerStateRef.current,
        itemCount: currentLayouts?.desktop?.length || 0,
        hasUltrawide: !!layoutsWithUltrawide.ultrawide
      });
    } else {
      logControllerState('BUFFER_SYNC_SKIPPED', {
        reason: 'operation_in_progress',
        state: controllerStateRef.current
      });
    }
  }, [ENABLE_LAYOUT_CONTROLLER_V2, currentLayouts, logControllerState]);

  return {
    unifiedLayoutState,
    currentLayouts,
    displayedLayouts,
    ENABLE_LAYOUT_CONTROLLER_V2,
    isDebugMode,
    layoutGracePeriod,
    userCommitDelayMs,
    controllerStateRef,
    workingLayoutsRef,
    canonicalLayoutsRef,
    lastVersionRef,
    transitionToState,
    logControllerState
  };
};
