import React, { createContext, useContext, ReactNode } from 'react';
import { config } from '../config';

interface PluginStudioDevModeContextType {
  isPluginStudioDevMode: boolean;
  features: {
    unifiedIndicator: boolean;
    rendererSwitch: boolean;
    debugPanels: boolean;
    moduleDebugInfo: boolean;
    studioToolbar: boolean;
    performanceMetrics: boolean;
  };
}

const PluginStudioDevModeContext = createContext<PluginStudioDevModeContextType | undefined>(undefined);

interface PluginStudioDevModeProviderProps {
  children: ReactNode;
}

export const PluginStudioDevModeProvider: React.FC<PluginStudioDevModeProviderProps> = ({ children }) => {
  const isPluginStudioDevMode = config.devMode.pluginStudio;
  
  const features = {
    unifiedIndicator: isPluginStudioDevMode,
    rendererSwitch: isPluginStudioDevMode,
    debugPanels: isPluginStudioDevMode,
    moduleDebugInfo: isPluginStudioDevMode,
    studioToolbar: isPluginStudioDevMode,
    performanceMetrics: isPluginStudioDevMode,
  };

  return (
    <PluginStudioDevModeContext.Provider value={{ isPluginStudioDevMode, features }}>
      {children}
    </PluginStudioDevModeContext.Provider>
  );
};

export const usePluginStudioDevModeContext = () => {
  const context = useContext(PluginStudioDevModeContext);
  if (context === undefined) {
    throw new Error('usePluginStudioDevModeContext must be used within a PluginStudioDevModeProvider');
  }
  return context;
};