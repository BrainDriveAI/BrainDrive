import React, { useEffect, useState } from 'react';
import { remotePluginService } from '../services/remotePluginService';
import { DynamicPluginConfig } from '../types/index';
import { LoadedRemotePlugin } from '../types/remotePlugin';
import { DynamicPluginRenderer } from './DynamicPluginRenderer';

interface PluginLoaderProps {
  onPluginsLoaded: (plugins: LoadedRemotePlugin[]) => void;
  renderPlugin?: (plugin: LoadedRemotePlugin) => React.ReactNode;
  renderMode?: 'all' | 'first' | 'none';
}

export const PluginLoader: React.FC<PluginLoaderProps> = ({ 
  onPluginsLoaded, 
  renderPlugin,
  renderMode = 'none'
}) => {
  const [loadedPlugins, setLoadedPlugins] = useState<LoadedRemotePlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPlugins = async () => {
      try {
        setLoading(true);
        // console.log('[PluginLoader] Starting plugin loading process...');
        
        // Get the manifest of available remote plugins
        // console.log('[PluginLoader] Getting remote plugin manifest...');
        const manifest = await remotePluginService.getRemotePluginManifest();
        // console.log('[PluginLoader] Manifest received:', manifest);
        
        // Load all plugins in parallel
        // console.log('[PluginLoader] Loading plugins in parallel...');
        const loadedPlugins = await Promise.all(
          manifest.map(plugin => {
            // console.log(`[PluginLoader] Loading plugin: ${plugin.id || plugin.name}`);
            return remotePluginService.loadRemotePlugin(plugin);
          })
        );
        // console.log('[PluginLoader] All plugins loaded:', loadedPlugins);

        // Filter out any failed loads (null results)
        const successfullyLoaded = loadedPlugins.filter((p): p is LoadedRemotePlugin => p !== null);
        // console.log('[PluginLoader] Successfully loaded plugins:', successfullyLoaded);
        
        setLoadedPlugins(successfullyLoaded);
        onPluginsLoaded(successfullyLoaded);
      } catch (err) {
        // console.error('[PluginLoader] Plugin loading error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error loading plugins');
        // Still call onPluginsLoaded with empty array to indicate completion
        onPluginsLoaded([]);
      } finally {
        setLoading(false);
      }
    };

    loadPlugins();
  }, [onPluginsLoaded]);

  // If we're not rendering anything, return null
  if (renderMode === 'none' || loading) {
    return null;
  }

  if (error) {
    return <div className="plugin-loader-error">Error loading plugins: {error}</div>;
  }

  // If custom rendering is provided, use that
  if (renderPlugin) {
    return (
      <div className="plugin-container">
        {loadedPlugins.map(plugin => (
          <div key={plugin.id} className="plugin-wrapper">
            {renderPlugin(plugin)}
          </div>
        ))}
      </div>
    );
  }

  // Default rendering based on renderMode
  return (
    <div className="plugin-container">
      {loadedPlugins.map(plugin => (
        <div key={plugin.id} className="plugin-wrapper">
          <h3>{plugin.name}</h3>
          {renderMode === 'all' ? (
            // Render all modules
            plugin.loadedModules.map((module, index) => (
              <div key={`${plugin.id}-${module.name}-${index}`} className="plugin-module">
                <h4>{module.name}</h4>
                <DynamicPluginRenderer 
                  module={module}
                  onError={(error) => console.error(`Error in plugin ${plugin.id}, module ${module.name}:`, error)}
                />
              </div>
            ))
          ) : (
            // Render just the first module
            plugin.loadedModules.length > 0 && (
              <DynamicPluginRenderer 
                module={plugin.loadedModules[0]}
                onError={(error) => console.error(`Error in plugin ${plugin.id}:`, error)}
              />
            )
          )}
        </div>
      ))}
    </div>
  );
};
