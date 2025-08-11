import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { DynamicPluginConfig } from '../types/index';
import { LoadedRemotePlugin } from '../types/remotePlugin';

interface PluginLoadingState {
  pluginConfigs: Record<string, DynamicPluginConfig>;
  loadedPlugins: LoadedRemotePlugin[];
  isLoading: boolean;
  error: string | null;
  pluginsLoaded: boolean;
}

interface PluginLoadingContextType extends PluginLoadingState {
  registerPlugin: (pluginId: string, config: DynamicPluginConfig) => void;
  setLoadedPlugins: (plugins: LoadedRemotePlugin[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getPluginConfig: (pluginId: string) => DynamicPluginConfig | null;
}

const PluginLoadingContext = createContext<PluginLoadingContextType | null>(null);

interface PluginLoadingProviderProps {
  children: ReactNode;
}

export const PluginLoadingProvider: React.FC<PluginLoadingProviderProps> = ({ children }) => {
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, DynamicPluginConfig>>({});
  const [loadedPlugins, setLoadedPlugins] = useState<LoadedRemotePlugin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pluginsLoaded, setPluginsLoaded] = useState(false);

  const registerPlugin = (pluginId: string, config: DynamicPluginConfig) => {
    console.log(`[PluginLoadingContext] Registering plugin: ${pluginId}`);
    setPluginConfigs(prev => {
      const updated = { ...prev, [pluginId]: config };
      console.log(`[PluginLoadingContext] Updated plugin configs:`, Object.keys(updated));
      return updated;
    });
  };

  const getPluginConfig = (pluginId: string): DynamicPluginConfig | null => {
    const config = pluginConfigs[pluginId] || null;
    console.log(`[PluginLoadingContext] Getting plugin config for ${pluginId}:`, config ? 'found' : 'not found');
    return config;
  };

  const handleSetLoadedPlugins = (plugins: LoadedRemotePlugin[]) => {
    console.log(`[PluginLoadingContext] Setting loaded plugins:`, plugins.length);
    setLoadedPlugins(plugins);
    setPluginsLoaded(true);
  };

  const handleSetLoading = (loading: boolean) => {
    console.log(`[PluginLoadingContext] Setting loading:`, loading);
    setIsLoading(loading);
  };

  const handleSetError = (error: string | null) => {
    console.log(`[PluginLoadingContext] Setting error:`, error);
    setError(error);
  };

  const contextValue: PluginLoadingContextType = {
    pluginConfigs,
    loadedPlugins,
    isLoading,
    error,
    pluginsLoaded,
    registerPlugin,
    setLoadedPlugins: handleSetLoadedPlugins,
    setLoading: handleSetLoading,
    setError: handleSetError,
    getPluginConfig,
  };

  return (
    <PluginLoadingContext.Provider value={contextValue}>
      {children}
    </PluginLoadingContext.Provider>
  );
};

export const usePluginLoading = (): PluginLoadingContextType => {
  const context = useContext(PluginLoadingContext);
  if (!context) {
    throw new Error('usePluginLoading must be used within a PluginLoadingProvider');
  }
  return context;
};

// Hook specifically for getting plugin configs with reactive updates
export const usePluginConfig = (pluginId: string): DynamicPluginConfig | null => {
  const { getPluginConfig, pluginConfigs } = usePluginLoading();
  
  // This will cause re-render when pluginConfigs changes
  return React.useMemo(() => {
    return getPluginConfig(pluginId);
  }, [pluginId, pluginConfigs, getPluginConfig]);
};

// Hook for checking if plugins are ready
export const usePluginsReady = (): boolean => {
  const { pluginsLoaded, isLoading } = usePluginLoading();
  return pluginsLoaded && !isLoading;
};