import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { RenderMode } from '../features/unified-dynamic-page-renderer/types';
import { usePluginStudioDevMode } from '../hooks/usePluginStudioDevMode';

interface ControlVisibilityContextType {
  showControls: boolean;
  isPluginStudio: boolean;
  renderMode: RenderMode;
  canEdit: boolean;
  controlsEnabled: boolean;
}

const ControlVisibilityContext = createContext<ControlVisibilityContextType | undefined>(undefined);

interface ControlVisibilityProviderProps {
  children: ReactNode;
  renderMode?: RenderMode;
}

export const ControlVisibilityProvider: React.FC<ControlVisibilityProviderProps> = ({ 
  children, 
  renderMode: propRenderMode 
}) => {
  const location = useLocation();
  const { isPluginStudioDevMode } = usePluginStudioDevMode();

  const contextValue = useMemo(() => {
    // Determine if we're in Plugin Studio based on route
    const isPluginStudio = location.pathname.startsWith('/plugin-studio');
    
    // Determine render mode - prioritize prop, then derive from context
    const renderMode = propRenderMode || (isPluginStudio ? RenderMode.STUDIO : RenderMode.PUBLISHED);
    
    // Controls should only be shown in Plugin Studio with dev mode enabled
    const controlsEnabled = isPluginStudioDevMode && isPluginStudio;
    
    // Additional check for studio mode
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
  }, [location.pathname, isPluginStudioDevMode, propRenderMode]);

  return (
    <ControlVisibilityContext.Provider value={contextValue}>
      {children}
    </ControlVisibilityContext.Provider>
  );
};

export const useControlVisibilityContext = () => {
  const context = useContext(ControlVisibilityContext);
  if (context === undefined) {
    throw new Error('useControlVisibilityContext must be used within a ControlVisibilityProvider');
  }
  return context;
};