import { useUnifiedLayoutState, UnifiedLayoutState, UnifiedLayoutStateOptions } from '../../hooks/useUnifiedLayoutState';

export interface DisplayLayoutStateOptions extends UnifiedLayoutStateOptions {}

export const useDisplayLayoutState = (options: DisplayLayoutStateOptions = {}): UnifiedLayoutState => {
  return useUnifiedLayoutState(options);
};
