import { DynamicPluginConfig } from '../types/index';
import { LoadedRemotePlugin, LoadedModule } from '../types/remotePlugin';
import { remotePluginService } from '../services/remotePluginService';
import { plugins as localPlugins } from './index';

/**
 * Unified plugin registry that handles both local and remote plugins
 */
class PluginRegistry {
  /**
   * Get a plugin by ID (either local or remote)
   */
  getPlugin(pluginId: string): DynamicPluginConfig | LoadedRemotePlugin | undefined {
    // First check local plugins
    if (localPlugins[pluginId]) {
      return localPlugins[pluginId];
    }
    
    // Then check remote plugins
    return remotePluginService.getLoadedPlugin(pluginId);
  }
  
  /**
   * Get a specific module from a plugin
   */
  getPluginModule(pluginId: string, moduleName?: string): LoadedModule | null {
    const plugin = this.getPlugin(pluginId);
    
    if (!plugin) {
      return null;
    }
    
    // Handle local plugin
    if ('component' in plugin) {
      return {
        name: moduleName || plugin.id,
        component: plugin.component,
        props: {}
      };
    }
    
    // Handle remote plugin
    if ('loadedModules' in plugin) {
      if (!moduleName && plugin.loadedModules.length > 0) {
        return plugin.loadedModules[0];
      }
      
      if (moduleName) {
        return plugin.loadedModules.find(m => m.name === moduleName) || null;
      }
    }
    
    return null;
  }
  
  /**
   * Check if a plugin is local based on the islocal flag
   */
  isLocalPlugin(pluginId: string): boolean {
    const plugin = this.getPlugin(pluginId);
    return plugin ? plugin.islocal === true : false;
  }
  
  /**
   * Get all available plugins (both local and remote)
   */
  getAllPlugins(): (DynamicPluginConfig | LoadedRemotePlugin)[] {
    const remotePlugins = remotePluginService.getAllLoadedPlugins();
    return [...Object.values(localPlugins), ...remotePlugins];
  }
}

export const pluginRegistry = new PluginRegistry();
