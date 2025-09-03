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
    unifiedIndicator: false, // Disable debug indicator
    rendererSwitch: false, // Disable unified renderer switch
    debugPanels: false, // Disable debug panels
    moduleDebugInfo: false, // Disable module debug info
    studioToolbar: isPluginStudioDevMode,
    performanceMetrics: false, // Disable performance metrics display
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