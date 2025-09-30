import React, { forwardRef, useImperativeHandle } from 'react';
import { render, act } from '@testing-library/react';
import { useLayout } from '../useLayout';
import type { Layouts, Page } from '../../../types';

describe('useLayout', () => {
  const createInitialPage = (): Page => ({
    id: 'page-1',
    name: 'Test Page',
    layouts: {
      desktop: [{ i: 'widget-1', x: 0, y: 0, w: 2, h: 2 }],
      tablet: [],
      mobile: []
    },
    content: {
      layouts: {
        desktop: [{ i: 'widget-1', x: 0, y: 0, w: 2, h: 2 }],
        tablet: [],
        mobile: []
      }
    }
  } as unknown as Page);

  type LayoutHookHandle = ReturnType<typeof useLayout>;

  const LayoutHarness = forwardRef<LayoutHookHandle, { page: Page }>((props, ref) => {
    const hook = useLayout(props.page, undefined);
    useImperativeHandle(ref, () => hook, [hook]);

    return <div data-testid="layouts-state">{JSON.stringify(hook.layouts)}</div>;
  });
  LayoutHarness.displayName = 'LayoutHarness';

  it('applies user-driven layout changes in the same render tick', () => {
    const initialPage = createInitialPage();
    const ref = React.createRef<LayoutHookHandle>();

    const { getByTestId } = render(<LayoutHarness ref={ref} page={initialPage} />);

    const baselineLayouts = JSON.parse(getByTestId('layouts-state').textContent || '{}');
    expect(baselineLayouts.desktop[0].x).toBe(0);

    const nextLayout = [{ i: 'widget-1', x: 3, y: 0, w: 2, h: 2 }];
    const nextLayouts: Layouts = {
      desktop: nextLayout,
      tablet: [],
      mobile: []
    };

    act(() => {
      ref.current?.handleLayoutChange(nextLayout, nextLayouts, { origin: { source: 'user-drag' } });
    });

    const updatedLayouts = JSON.parse(getByTestId('layouts-state').textContent || '{}');
    expect(updatedLayouts.desktop[0].x).toBe(3);

    act(() => {
      ref.current?.handleLayoutChange(nextLayout, nextLayouts, { origin: { source: 'user-drag' } });
    });

    const dedupedLayouts = JSON.parse(getByTestId('layouts-state').textContent || '{}');
    expect(dedupedLayouts.desktop[0].x).toBe(3);
  });
});
