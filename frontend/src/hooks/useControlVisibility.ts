import { useLocation } from 'react-router-dom';
import { usePluginStudioDevMode } from './usePluginStudioDevMode';
import { RenderMode } from '../features/unified-dynamic-page-renderer/types';

export interface ControlVisibilityState {
  showControls: boolean;
  isPluginStudio: boolean;
  renderMode: RenderMode;
  canEdit: boolean;
  controlsEnabled: boolean;
}

/**
 * Hook to determine if control icons should be visible
 * Controls are only shown in Plugin Studio with dev mode enabled
 */
export const useControlVisibility = (overrideRenderMode?: RenderMode): ControlVisibilityState => {
  const location = useLocation();
  const { isPluginStudioDevMode } = usePluginStudioDevMode();

  // Determine if we're in Plugin Studio based on route
  const isPluginStudio = location.pathname.startsWith('/plugin-studio');
  
  // Determine render mode - use override if provided, otherwise derive from context
  const renderMode = overrideRenderMode || (isPluginStudio ? RenderMode.STUDIO : RenderMode.PUBLISHED);
  
  // Controls should only be enabled in Plugin Studio with dev mode
  const controlsEnabled = isPluginStudioDevMode && isPluginStudio;
  
  // Can edit only in studio mode with controls enabled
  const canEdit = renderMode === RenderMode.STUDIO && controlsEnabled;
  
  // Final decision on showing controls
  const showControls = canEdit && controlsEnabled;

  return {
    showControls,
    isPluginStudio,
    renderMode,
    canEdit,
    controlsEnabled,
  };
};

/**
 * Simple hook that just returns whether controls should be shown
 */
export const useShowControls = (overrideRenderMode?: RenderMode): boolean => {
  const { showControls } = useControlVisibility(overrideRenderMode);
  return showControls;
};