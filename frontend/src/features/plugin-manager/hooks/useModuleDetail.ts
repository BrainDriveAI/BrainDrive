import { useState, useEffect, useCallback, useRef } from 'react';
import { Module, Plugin } from '../types';
import moduleService from '../services/moduleService';

interface UseModuleDetailResult {
  module: Module | null;
  plugin: Plugin | null;
  relatedModules: Module[];
  loading: boolean;
  error: Error | null;
  toggleModuleStatus: (enabled: boolean) => Promise<void>;
}

/**
 * Hook for fetching module details
 * 
 * Note: Currently using mock data until backend API is implemented
 */
export const useModuleDetail = (pluginId: string, moduleId: string): UseModuleDetailResult => {
  const [module, setModule] = useState<Module | null>(null);
  const [plugin, setPlugin] = useState<Plugin | null>(null);
  const [relatedModules, setRelatedModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchCount = useRef(0);

  const fetchModuleDetail = useCallback(async () => {
    try {
      // Increment fetch count to track how many times this function is called
      fetchCount.current += 1;
      console.log(`Fetching module detail (call #${fetchCount.current}) for pluginId: ${pluginId}, moduleId: ${moduleId}`);
      
      setLoading(true);
      setError(null);
      
      // Get module and plugin details
      const result = await moduleService.getModule(pluginId, moduleId);
      setModule(result.module);
      setPlugin(result.plugin);
      console.log(`Fetched module: ${result.module.name}`);
      
      // Get related modules (other modules from the same plugin)
      const related = await moduleService.getModulesByPlugin(pluginId);
      const filteredRelated = related.filter(m => m.id !== moduleId);
      setRelatedModules(filteredRelated);
      console.log(`Fetched ${filteredRelated.length} related modules`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch module details'));
      console.error('Error fetching module details:', err);
    } finally {
      setLoading(false);
    }
  }, [pluginId, moduleId]);

  useEffect(() => {
    console.log('useEffect in useModuleDetail triggered');
    fetchModuleDetail();
  }, [fetchModuleDetail]);

  const toggleModuleStatus = useCallback(async (enabled: boolean) => {
    if (!module) return;
    
    try {
      await moduleService.toggleModuleStatus(pluginId, moduleId, enabled);
      
      // Update the local state
      setModule(prevModule => 
        prevModule ? { ...prevModule, enabled } : null
      );
    } catch (err) {
      console.error(`Error toggling module ${moduleId} status:`, err);
      throw err;
    }
  }, [pluginId, moduleId, module]);

  return {
    module,
    plugin,
    relatedModules,
    loading,
    error,
    toggleModuleStatus
  };
};

export default useModuleDetail;
