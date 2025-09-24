import { useCallback, useEffect, useRef, useState } from 'react';
import { ResponsiveLayouts, LayoutItem } from '../../types';
import { generateLayoutHash } from '../../utils/layoutChangeManager';
import { getLayoutCommitTracker } from '../../utils/layoutCommitTracker';
import { ControllerState } from './useDisplayLayoutController';
import { UnifiedLayoutState } from '../../hooks/useUnifiedLayoutState';

interface UseGuardedCommitQueueArgs {
  ENABLE_LAYOUT_CONTROLLER_V2: boolean;
  layoutGracePeriod: number;
  userCommitDelayMs: number;
  isDebugMode: boolean;
  logControllerState: (action: string, data?: any) => void;
  transitionToState: (newState: ControllerState, data?: any) => void;
  unifiedLayoutState: UnifiedLayoutState;
  workingLayoutsRef: React.MutableRefObject<ResponsiveLayouts | null>;
  canonicalLayoutsRef: React.MutableRefObject<ResponsiveLayouts | null>;
  lastVersionRef: React.MutableRefObject<number>;
  controllerStateRef: React.MutableRefObject<ControllerState>;
  currentOperationIdRef: React.MutableRefObject<string | null>;
  useSafeCommitSetters: boolean;
}

interface UseGuardedCommitQueueResult {
  scheduleCommit: (delayMs?: number, finalLayout?: any, finalAllLayouts?: any, breakpoint?: string, activeItemId?: string) => void;
  isAwaitingCommit: boolean;
  commitHighlightId: string | null;
}

export const useGuardedCommitQueue = ({
  ENABLE_LAYOUT_CONTROLLER_V2,
  layoutGracePeriod,
  userCommitDelayMs,
  isDebugMode,
  logControllerState,
  transitionToState,
  unifiedLayoutState,
  workingLayoutsRef,
  canonicalLayoutsRef,
  lastVersionRef,
  controllerStateRef,
  currentOperationIdRef,
  useSafeCommitSetters,
}: UseGuardedCommitQueueArgs): UseGuardedCommitQueueResult => {
  const commitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const awaitingCommitSetterRef = useRef<React.Dispatch<React.SetStateAction<boolean>> | null>(null);
  const commitHighlightSetterRef = useRef<React.Dispatch<React.SetStateAction<string | null>> | null>(null);
  const pendingAwaitingCommitRef = useRef<boolean | null>(null);
  const pendingHighlightRef = useRef<string | null>(null);
  const commitHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tracker = getLayoutCommitTracker();

  const [isAwaitingCommit, setIsAwaitingCommit] = useState(false);
  const [commitHighlightId, setCommitHighlightId] = useState<string | null>(null);

  const setIsAwaitingCommitSafe = useCallback((value: boolean) => {
    if (!useSafeCommitSetters) {
      setIsAwaitingCommit(value);
      return;
    }

    if (awaitingCommitSetterRef.current) {
      awaitingCommitSetterRef.current(value);
    } else {
      pendingAwaitingCommitRef.current = value;
    }
  }, [useSafeCommitSetters]);

  const setCommitHighlightSafe = useCallback((value: string | null) => {
    if (!useSafeCommitSetters) {
      setCommitHighlightId(value);
      return;
    }

    if (commitHighlightSetterRef.current) {
      commitHighlightSetterRef.current(value);
    } else {
      pendingHighlightRef.current = value;
    }
  }, [useSafeCommitSetters]);

  useEffect(() => {
    if (!useSafeCommitSetters) {
      awaitingCommitSetterRef.current = null;
      commitHighlightSetterRef.current = null;
      pendingAwaitingCommitRef.current = null;
      pendingHighlightRef.current = null;
      return;
    }

    awaitingCommitSetterRef.current = setIsAwaitingCommit;
    commitHighlightSetterRef.current = setCommitHighlightId;

    if (pendingAwaitingCommitRef.current !== null) {
      setIsAwaitingCommit(pendingAwaitingCommitRef.current);
      pendingAwaitingCommitRef.current = null;
    }

    if (pendingHighlightRef.current !== null) {
      setCommitHighlightId(pendingHighlightRef.current);
      pendingHighlightRef.current = null;
    }

    return () => {
      if (awaitingCommitSetterRef.current === setIsAwaitingCommit) {
        awaitingCommitSetterRef.current = null;
      }
      if (commitHighlightSetterRef.current === setCommitHighlightId) {
        commitHighlightSetterRef.current = null;
      }
    };
  }, [useSafeCommitSetters]);

  useEffect(() => () => {
    if (commitHighlightTimeoutRef.current) {
      clearTimeout(commitHighlightTimeoutRef.current);
    }
  }, []);

  const commitLayoutChanges = useCallback(async (
    finalLayout?: any,
    finalAllLayouts?: any,
    breakpoint?: string,
    activeItemId?: string
  ) => {
    if (!ENABLE_LAYOUT_CONTROLLER_V2) {
      logControllerState('COMMIT_SKIPPED', {
        reason: 'Controller disabled'
      });
      return;
    }

    const version = lastVersionRef.current;
    let layouts: ResponsiveLayouts;

    if (finalLayout && finalAllLayouts) {
      const convertedLayouts: ResponsiveLayouts = {
        mobile: [],
        tablet: [],
        desktop: [],
        wide: [],
        ultrawide: []
      };
      const toOurBreakpoint = (bp: string): keyof ResponsiveLayouts | undefined => {
        const map: Record<string, keyof ResponsiveLayouts> = {
          xs: 'mobile', sm: 'tablet', lg: 'desktop', xl: 'wide', xxl: 'ultrawide',
          mobile: 'mobile', tablet: 'tablet', desktop: 'desktop', wide: 'wide', ultrawide: 'ultrawide'
        };
        return map[bp];
      };

      const normalizeItems = (items: any[] = []): LayoutItem[] => {
        return (items || []).map((it: any) => {
          const id = it?.i ?? '';
          let pluginId = it?.pluginId;
          if (!pluginId && typeof id === 'string' && id.includes('_')) {
            pluginId = id.split('_')[0];
          }
          return {
            i: id,
            x: it?.x ?? 0,
            y: it?.y ?? 0,
            w: it?.w ?? 2,
            h: it?.h ?? 2,
            moduleId: it?.moduleId || id,
            pluginId: pluginId || 'unknown',
            minW: it?.minW,
            minH: it?.minH,
            isDraggable: it?.isDraggable ?? true,
            isResizable: it?.isResizable ?? true,
            static: it?.static ?? false,
            config: it?.config
          } as LayoutItem;
        });
      };

      if (finalLayout && breakpoint) {
        const ourBreakpoint = toOurBreakpoint(breakpoint);
        if (ourBreakpoint) {
          convertedLayouts[ourBreakpoint] = normalizeItems(finalLayout as any[]);

          console.log('[RECODE_V2_BLOCK] commitLayoutChanges - using finalLayout for commit', {
            breakpoint: ourBreakpoint,
            itemDimensions: finalLayout.map((item: any) => ({
              id: item.i,
              dimensions: { w: item.w, h: item.h, x: item.x, y: item.y }
            })),
            version,
            timestamp: Date.now()
          });
        }
      }

      Object.entries(finalAllLayouts).forEach(([gridBreakpoint, gridLayout]: [string, any]) => {
        const ourBreakpoint = toOurBreakpoint(gridBreakpoint);
        if (ourBreakpoint && Array.isArray(gridLayout)) {
          if (toOurBreakpoint(gridBreakpoint) !== toOurBreakpoint(breakpoint || '') || !finalLayout) {
            convertedLayouts[ourBreakpoint] = normalizeItems(gridLayout as any[]);
          }
        }
      });

      layouts = convertedLayouts;
      workingLayoutsRef.current = convertedLayouts;
    } else if (workingLayoutsRef.current) {
      layouts = workingLayoutsRef.current;
      console.log('[RECODE_V2_BLOCK] commitLayoutChanges - using workingLayoutsRef', {
        version,
        hasLayouts: !!workingLayoutsRef.current,
        breakpoints: Object.keys(workingLayoutsRef.current || {}),
        itemCounts: Object.entries(workingLayoutsRef.current || {}).map(([bp, items]) => ({
          breakpoint: bp,
          count: (items as any[])?.length || 0
        })),
        timestamp: Date.now()
      });
    } else {
      console.error('[RECODE_V2_BLOCK] COMMIT SKIPPED - No layouts available!', {
        hasWorkingBuffer: !!workingLayoutsRef.current,
        hasCanonicalBuffer: !!canonicalLayoutsRef.current,
        version
      });
      logControllerState('COMMIT_SKIPPED', {
        reason: 'No layouts available'
      });
      return;
    }

    const hash = generateLayoutHash(layouts);

    console.log('[RECODE_V2_BLOCK] COMMIT - About to persist layouts', {
      version,
      hash,
      hasLayouts: !!layouts,
      breakpoints: Object.keys(layouts || {}),
      itemCounts: Object.entries(layouts || {}).map(([bp, items]) => ({
        breakpoint: bp,
        count: (items as any[])?.length || 0,
        items: (items as any[])?.map((item: any) => ({
          id: item.i,
          dimensions: { w: item.w, h: item.h, x: item.x, y: item.y }
        }))
      }))
    });

    if (isDebugMode) {
      console.log(`[LayoutEngine] Commit v${version} hash:${hash}`, {
        source: controllerStateRef.current === 'resizing' ? 'user-resize' : 'user-drag',
        timestamp: Date.now()
      });
    }

    logControllerState('COMMIT_START', {
      version,
      hash,
      layoutsPresent: !!layouts,
      currentState: controllerStateRef.current
    });

    if (activeItemId) {
      setCommitHighlightSafe(activeItemId);
      if (commitHighlightTimeoutRef.current) {
        clearTimeout(commitHighlightTimeoutRef.current);
      }
      commitHighlightTimeoutRef.current = setTimeout(() => {
        setCommitHighlightSafe(null);
        commitHighlightTimeoutRef.current = null;
      }, 400);
    }

    transitionToState('commit', { version });

    const originSource = controllerStateRef.current === 'resizing' ? 'user-resize' : 'user-drag';
    const origin = {
      source: originSource,
      version,
      timestamp: Date.now(),
      operationId: currentOperationIdRef.current || `commit-${Date.now()}`
    };

    const debounceMs = originSource.startsWith('user-') ? Math.min(userCommitDelayMs, 20) : undefined;

    unifiedLayoutState.updateLayouts(layouts, origin, { debounceMs });

    canonicalLayoutsRef.current = JSON.parse(JSON.stringify(layouts));

    const commitStart = performance.now();
    const flushPromise = unifiedLayoutState.flush();
    const safetyWindowMs = Math.max(layoutGracePeriod * 2, 600);

    setIsAwaitingCommitSafe(true);

    let flushTimedOut = false;
    let flushError: unknown = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        flushTimedOut = true;
        resolve();
      }, safetyWindowMs);
    });

    try {
      await Promise.race([
        flushPromise.catch(error => {
          flushError = error;
          return Promise.reject(error);
        }),
        timeoutPromise
      ]);

      if (!flushTimedOut) {
        try {
          await flushPromise;
        } catch (error) {
          flushError = error;
        }
      }
    } catch (error) {
      flushError = error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      setIsAwaitingCommitSafe(false);

      const flushDuration = Math.round(performance.now() - commitStart);
      const transitionSource = flushTimedOut ? 'flush_timeout' : flushError ? 'flush_error' : 'commit_complete';
      transitionToState('idle', { version, source: transitionSource });

      if (flushTimedOut) {
        console.warn('[LayoutEngine] Commit flush window exceeded, falling back to idle', {
          version,
          hash,
          safetyWindowMs
        });
        logControllerState('COMMIT_FLUSH_TIMEOUT', { version, hash, safetyWindowMs });
      } else if (flushError) {
        console.error('[LayoutEngine] Commit flush failed', flushError);
        logControllerState('COMMIT_FLUSH_ERROR', { version, hash, error: (flushError as Error)?.message });
      } else {
        logControllerState('COMMIT_COMPLETE', { version, hash, flushDuration });
      }

      if (isDebugMode) {
        console.log(`[LayoutEngine] Commit ${transitionSource} v${version} hash:${hash}`, {
          flushDuration,
          flushTimedOut,
          hasError: !!flushError,
          debounceMs
        });
      }

      tracker.recordCommit({
        version,
        hash,
        timestamp: Date.now()
      });
    }
  }, [
    ENABLE_LAYOUT_CONTROLLER_V2,
    canonicalLayoutsRef,
    commitHighlightTimeoutRef,
    isDebugMode,
    layoutGracePeriod,
    logControllerState,
    setCommitHighlightSafe,
    setIsAwaitingCommitSafe,
    tracker,
    transitionToState,
    unifiedLayoutState,
    userCommitDelayMs,
    workingLayoutsRef,
    lastVersionRef,
    controllerStateRef,
    currentOperationIdRef
  ]);

  const scheduleCommit = useCallback((delayMs: number = userCommitDelayMs, finalLayout?: any, finalAllLayouts?: any, breakpoint?: string, activeItemId?: string) => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
    }

    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      void commitLayoutChanges(finalLayout, finalAllLayouts, breakpoint, activeItemId);
    }, delayMs);

    logControllerState('COMMIT_SCHEDULED', { delayMs, activeItemId });
  }, [commitLayoutChanges, logControllerState, userCommitDelayMs]);

  useEffect(() => () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
    }
  }, []);

  return {
    scheduleCommit,
    isAwaitingCommit,
    commitHighlightId
  };
};
