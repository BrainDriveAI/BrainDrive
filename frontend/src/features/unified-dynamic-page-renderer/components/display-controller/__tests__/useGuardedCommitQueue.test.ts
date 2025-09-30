import { act, renderHook, waitFor } from '@testing-library/react';
import { useGuardedCommitQueue } from '../useGuardedCommitQueue';
import type { ResponsiveLayouts } from '../../../types';
import type { UnifiedLayoutState } from '../../../hooks/useUnifiedLayoutState';

const recordCommitMock = jest.fn();

jest.mock('../../../utils/layoutCommitTracker', () => ({
  getLayoutCommitTracker: () => ({
    recordCommit: recordCommitMock,
    hasPendingCommits: () => false,
    trackPending: () => Promise.resolve(),
  }),
}));

describe('useGuardedCommitQueue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    recordCommitMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes pending commit state when safe setters register late', async () => {
    const flushResolvers: { resolve?: () => void } = {};

    const unifiedLayoutState = {
      layouts: {
        mobile: [],
        tablet: [],
        desktop: [],
        wide: [],
        ultrawide: [],
      },
      isLayoutChanging: false,
      updateLayouts: jest.fn(),
      resetLayouts: jest.fn(),
      startOperation: jest.fn(),
      stopOperation: jest.fn(),
      getLayoutHash: jest.fn(() => 'hash'),
      compareWithCurrent: jest.fn(() => false),
      getLastCommitMeta: jest.fn(() => null),
      getCommittedLayouts: jest.fn(() => null),
      flush: jest.fn(() => new Promise<void>((resolve) => {
        flushResolvers.resolve = resolve;
      })),
    } as unknown as UnifiedLayoutState;

    const workingLayoutsRef = { current: null } as React.MutableRefObject<ResponsiveLayouts | null>;
    const canonicalLayoutsRef = { current: null } as React.MutableRefObject<ResponsiveLayouts | null>;
    const lastVersionRef = { current: 1 } as React.MutableRefObject<number>;
    const controllerStateRef = { current: 'dragging' as const } as React.MutableRefObject<'dragging'>;
    const currentOperationIdRef = { current: 'drag-1' } as React.MutableRefObject<string | null>;

    const finalLayout = [{
      i: 'item-1',
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      moduleId: 'item-1',
      pluginId: 'plugin-1',
    }];
    const finalAllLayouts = { lg: finalLayout } as Record<string, any>;

    const { result } = renderHook(() =>
      useGuardedCommitQueue({
        ENABLE_LAYOUT_CONTROLLER_V2: true,
        layoutGracePeriod: 150,
        userCommitDelayMs: 10,
        isDebugMode: false,
        logControllerState: jest.fn(),
        transitionToState: jest.fn(),
        unifiedLayoutState,
        workingLayoutsRef,
        canonicalLayoutsRef,
        lastVersionRef,
        controllerStateRef,
        currentOperationIdRef,
        useSafeCommitSetters: true,
      })
    );

    await act(async () => {
      result.current.scheduleCommit(0, finalLayout, finalAllLayouts, 'lg', 'item-1');
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isAwaitingCommit).toBe(true));

    act(() => {
      flushResolvers.resolve?.();
    });

    await waitFor(() => expect(result.current.isAwaitingCommit).toBe(false));

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(unifiedLayoutState.updateLayouts).toHaveBeenCalled();
    expect(recordCommitMock).toHaveBeenCalled();
    expect(result.current.commitHighlightId).toBeNull();
  });
});
