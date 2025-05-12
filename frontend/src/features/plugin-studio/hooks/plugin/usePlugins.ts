import { useState, useEffect, useCallback } from 'react';
import { DynamicPluginConfig, DragData } from '../../types';
import { getAvailablePlugins, onPluginRegistryChange } from '../../../../plugins';
import { normalizeObjectKeys } from '../../../../utils/caseConversion';

/**
 * Custom hook for managing plugins
 * @returns Plugin management functions and state
 */
export const usePlugins = () => {
  const [availablePlugins, setAvailablePlugins] = useState<DynamicPluginConfig[]>(getAvailablePlugins());
  
  // Update plugins when the registry changes
  useEffect(() => {
    // Initialize with available plugins
    setAvailablePlugins(getAvailablePlugins());
    
    // Subscribe to registry changes
    const unsubscribe = onPluginRegistryChange(() => {
      setAvailablePlugins(getAvailablePlugins());
    });
    
    return unsubscribe;
  }, []);
  
  /**
   * Get all modules from all plugins
   * @returns Array of modules with their plugin information
   */
  const getAllModules = useCallback(() => {
    return availablePlugins.flatMap(plugin => 
      plugin.modules.map(module => ({
        pluginId: plugin.id,
        pluginName: plugin.name,
        isLocal: plugin.islocal || false,
        module
      }))
    );
  }, [availablePlugins]);
  
  /**
   * Filter modules by search term and tags
   * @param searchTerm The search term to filter by
   * @param excludeTags Tags to exclude from the results
   * @returns Filtered modules
   */
  const filterModules = useCallback((searchTerm: string = '', excludeTags: string[] = []) => {
    const allModules = getAllModules();
    
    // First filter out modules with excluded tags
    const modulesWithoutExcludedTags = allModules.filter(item => 
      !(item.module.tags || []).some(tag => excludeTags.includes(tag.toLowerCase()))
    );
    
    // Then apply search term filter if one exists
    if (!searchTerm) return modulesWithoutExcludedTags;
    
    const lowerSearchTerm = searchTerm.toLowerCase();
    return modulesWithoutExcludedTags.filter(item =>
      (item.module.displayName || item.module.name).toLowerCase().includes(lowerSearchTerm) ||
      (item.module.description || '').toLowerCase().includes(lowerSearchTerm) ||
      item.pluginName.toLowerCase().includes(lowerSearchTerm) ||
      (item.module.tags || []).some(tag => tag.toLowerCase().includes(lowerSearchTerm))
    );
  }, [getAllModules]);
  
  /**
   * Create drag data for a module
   * @param pluginId The plugin ID
   * @param module The module
   * @returns Drag data for the module
   */
  const createDragData = useCallback((pluginId: string, module: any): DragData => {
    const plugin = availablePlugins.find(p => p.id === pluginId);
    
    return {
      pluginId,
      moduleId: module.id || module.name,
      moduleName: module.name,
      displayName: module.displayName || module.name,
      category: module.category || 'General',
      isLocal: plugin?.islocal || false,
      tags: module.tags || [],
      description: module.description,
      icon: module.icon,
      type: module.type,
      priority: module.priority,
      dependencies: module.dependencies,
      layout: module.layout
    };
  }, [availablePlugins]);
  
  /**
   * Get a module by ID
   * @param pluginId The plugin ID
   * @param moduleId The module ID
   * @returns The module or null if not found
   */
  const getModuleById = useCallback((pluginId: string, moduleId: string) => {
    console.log(`usePlugins.getModuleById - Looking for module ${moduleId} in plugin ${pluginId}`);
    
    const plugin = availablePlugins.find(p => p.id === pluginId);
    if (!plugin) {
      console.log(`usePlugins.getModuleById - Plugin ${pluginId} not found`);
      return null;
    }
    
    const module = plugin.modules.find(m => m.id === moduleId || m.name === moduleId);
    
    if (module) {
      console.log(`usePlugins.getModuleById - Found module ${moduleId}:`, {
        id: module.id,
        name: module.name,
        displayName: module.displayName,
        hasProps: !!module.props,
        props: module.props,
        hasConfigFields: !!module.configFields,
        configFields: module.configFields
      });
      
      // Check for snake_case properties in the module definition
      const hasSnakeCaseProps = Object.keys(module).some(key => key.includes('_'));
      if (hasSnakeCaseProps) {
        console.warn(`usePlugins.getModuleById - Module ${moduleId} has snake_case properties:`,
          Object.keys(module).filter(key => key.includes('_')));
        
        // Log the config_fields property if it exists
        if ('config_fields' in module) {
          console.warn(`usePlugins.getModuleById - Module ${moduleId} has config_fields:`, module.config_fields);
        }
      }
      // Normalize the module definition
      if (module) {
        // Normalize the module definition
        const normalizedModule = normalizeObjectKeys(module);
        
        // Handle special case for config_fields
        if ('config_fields' in module && !('configFields' in normalizedModule)) {
          normalizedModule.configFields = normalizeObjectKeys(module.config_fields);
        }
        
        console.log(`usePlugins.getModuleById - Normalized module ${moduleId}:`, normalizedModule);
        
        return normalizedModule;
      }
    } else {
      console.log(`usePlugins.getModuleById - Module ${moduleId} not found in plugin ${pluginId}`);
    }
    
    return null;
  }, [availablePlugins]);
  
  return {
    availablePlugins,
    getAllModules,
    filterModules,
    createDragData,
    getModuleById
  };
};