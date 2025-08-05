import { useState, useEffect, useCallback, useRef } from 'react';
import { enhancedServiceBridge, StudioServiceContext } from '../services/EnhancedServiceBridge';
import { ResponsiveLayouts } from '../../unified-dynamic-page-renderer/types';
import { usePageState } from '../../../contexts/PageStateContext';

export interface StudioState {
  // Layout state
  layouts: ResponsiveLayouts | null;
  selectedModules: string[];
  draggedModule: string | null;
  
  // UI state
  isAutoSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSaved: Date | null;
  
  // Mode state
  previewMode: boolean;
  currentBreakpoint: string;
  
  // Undo/Redo state
  canUndo: boolean;
  canRedo: boolean;
}

export interface StudioActions {
  // Layout actions
  updateLayouts: (layouts: ResponsiveLayouts) => Promise<void>;
  addModule: (moduleConfig: any, position: { x: number; y: number }) => Promise<string>;
  removeModule: (moduleId: string) => Promise<void>;
  moveModule: (moduleId: string, position: { x: number; y: number }) => Promise<void>;
  resizeModule: (moduleId: string, size: { w: number; h: number }) => Promise<void>;
  
  // Selection actions
  selectModules: (moduleIds: string[], addToSelection?: boolean) => void;
  clearSelection: () => void;
  
  // Save actions
  save: () => Promise<void>;
  enableAutoSave: (enabled: boolean) => Promise<void>;
  setAutoSaveInterval: (intervalMs: number) => Promise<void>;
  
  // Mode actions
  setPreviewMode: (enabled: boolean) => void;
  setCurrentBreakpoint: (breakpoint: string) => void;
  
  // Undo/Redo actions
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * Enhanced Studio State Hook
 * 
 * This hook provides comprehensive state management for the Plugin Studio
 * using the enhanced service bridge. It maintains compatibility with existing
 * Plugin Studio patterns while adding new capabilities.
 * 
 * Features:
 * - Auto-save with debouncing
 * - Real-time layout state management
 * - Multi-select support
 * - Undo/Redo functionality
 * - Service bridge integration
 * - Performance optimizations
 */
export const useEnhancedStudioState = (
  pageId: string,
  pluginId: string = 'PluginStudio',
  moduleId: string = 'StudioCanvas'
): [StudioState, StudioActions] => {
  // Get page state context for cache management
  const { clearCache } = usePageState();

  // State
  const [state, setState] = useState<StudioState>({
    layouts: null,
    selectedModules: [],
    draggedModule: null,
    isAutoSaving: false,
    hasUnsavedChanges: false,
    lastSaved: null,
    previewMode: false,
    currentBreakpoint: 'desktop',
    canUndo: false,
    canRedo: false,
  });

  // Refs for service management
  const serviceContextRef = useRef<StudioServiceContext>({
    pluginId,
    moduleId,
    instanceId: `${pluginId}_${moduleId}_${pageId}`,
    studioMode: true,
    pageId,
  });

  const servicesRef = useRef({
    layout: enhancedServiceBridge.getEnhancedService('studioLayout', serviceContextRef.current),
    autoSave: enhancedServiceBridge.getEnhancedService('studioAutoSave', serviceContextRef.current),
    collaboration: enhancedServiceBridge.getEnhancedService('studioCollaboration', serviceContextRef.current),
  });

  // Debounce timer for auto-save
  const autoSaveTimerRef = useRef<NodeJS.Timeout>();

  // Initialize services and load initial state
  useEffect(() => {
    const initializeState = async () => {
      try {
        // Load saved layout state
        const savedLayouts = await servicesRef.current.layout.getLayoutState();
        if (savedLayouts) {
          setState(prev => ({ ...prev, layouts: savedLayouts }));
        }

        // Get last saved timestamp
        const lastSaved = await servicesRef.current.autoSave.getLastSaved();
        if (lastSaved) {
          setState(prev => ({ ...prev, lastSaved }));
        }

        // Check for unsaved changes
        const hasChanges = await servicesRef.current.autoSave.hasUnsavedChanges();
        setState(prev => ({ ...prev, hasUnsavedChanges: hasChanges }));

        // Initialize undo/redo state
        const canUndo = await servicesRef.current.layout.canUndo();
        const canRedo = await servicesRef.current.layout.canRedo();
        setState(prev => ({ ...prev, canUndo, canRedo }));

        console.log('[useEnhancedStudioState] State initialized for page:', pageId);
      } catch (error) {
        console.error('[useEnhancedStudioState] Failed to initialize state:', error);
      }
    };

    initializeState();
  }, [pageId]);

  // Set up change listeners
  useEffect(() => {
    const serviceKey = `${serviceContextRef.current.pluginId}_${serviceContextRef.current.instanceId}_layout`;
    
    const handleLayoutChange = (event: any) => {
      switch (event.type) {
        case 'layout-saved':
          setState(prev => ({ 
            ...prev, 
            hasUnsavedChanges: false,
            lastSaved: new Date(),
            isAutoSaving: false
          }));
          break;
        case 'module-added':
        case 'module-removed':
        case 'module-moved':
        case 'module-resized':
          setState(prev => ({ ...prev, hasUnsavedChanges: true }));
          break;
        case 'modules-selected':
          setState(prev => ({ ...prev, selectedModules: event.data.moduleIds }));
          break;
        case 'selection-cleared':
          setState(prev => ({ ...prev, selectedModules: [] }));
          break;
        case 'auto-save-triggered':
          setState(prev => ({ ...prev, isAutoSaving: true }));
          break;
      }
    };

    enhancedServiceBridge.addChangeListener(serviceKey, handleLayoutChange);

    return () => {
      enhancedServiceBridge.removeChangeListener(serviceKey, handleLayoutChange);
    };
  }, []);

  // Save function (defined early to avoid circular dependency)
  const saveFunction = useCallback(async () => {
    setState(prev => ({ ...prev, isAutoSaving: true }));
    try {
      if (pageId && state.layouts) {
        // Import pageService dynamically to avoid circular dependencies
        const { pageService } = await import('../../../services/pageService');
        
        // Get current page data to preserve modules
        let currentModules = {};
        try {
          const currentPage = await pageService.getPage(pageId);
          currentModules = currentPage.content?.modules || currentPage.modules || {};
        } catch (error) {
          console.warn('[useEnhancedStudioState] Could not fetch current page modules:', error);
        }
        
        // Prepare the update data with both layouts and content structure
        const updateData = {
          content: {
            layouts: state.layouts,
            modules: currentModules
          }
        };
        
        console.log('[useEnhancedStudioState] Auto-saving page data:', updateData);
        
        // Save to backend
        await pageService.updatePage(pageId, updateData);
        
        console.log('[useEnhancedStudioState] Auto-save completed successfully');
        
        // Clear the page cache to ensure fresh data is loaded in regular page renderer
        // This fixes the synchronization issue between Plugin Studio and "Your Pages"
        console.log('[useEnhancedStudioState] Starting cache clearing process...');
        try {
          // Fetch the current page to get the route for proper cache key generation
          console.log('[useEnhancedStudioState] Fetching page data for cache key generation...');
          const currentPage = await pageService.getPage(pageId);
          const pageRoute = currentPage.route;
          const cacheKey = `route:${pageRoute}`;
          console.log('[useEnhancedStudioState] Clearing page cache for route:', pageRoute, 'cache key:', cacheKey);
          
          // Clear the entire cache to ensure no stale data remains
          // This is safer than trying to clear specific keys since page IDs can vary
          clearCache();
          
          console.log('[useEnhancedStudioState] Page cache cleared successfully');
        } catch (cacheError) {
          console.error('[useEnhancedStudioState] Failed to clear page cache:', cacheError);
          // Don't throw here - cache clearing failure shouldn't break the save
        }
      }
      
      await servicesRef.current.autoSave.markAsSaved();
      setState(prev => ({
        ...prev,
        hasUnsavedChanges: false,
        lastSaved: new Date(),
        isAutoSaving: false
      }));
    } catch (error) {
      console.error('[useEnhancedStudioState] Auto-save failed:', error);
      setState(prev => ({ ...prev, isAutoSaving: false }));
      throw error;
    }
  }, [pageId, state.layouts]);

  // Debounced save function
  const debouncedSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        // Call the actual save function directly
        await saveFunction();
      } catch (error) {
        console.error('[useEnhancedStudioState] Auto-save failed:', error);
      }
    }, 1000); // 1 second debounce
  }, [saveFunction]);

  // Actions
  const actions: StudioActions = {
    updateLayouts: useCallback(async (layouts: ResponsiveLayouts) => {
      setState(prev => ({ ...prev, layouts, hasUnsavedChanges: true }));
      await servicesRef.current.layout.saveLayoutState(layouts);
      debouncedSave();
    }, [debouncedSave]),

    addModule: useCallback(async (moduleConfig: any, position: { x: number; y: number }) => {
      const moduleId = await servicesRef.current.layout.addModule(moduleConfig, position);
      setState(prev => ({ ...prev, hasUnsavedChanges: true }));
      debouncedSave();
      return moduleId;
    }, [debouncedSave]),

    removeModule: useCallback(async (moduleId: string) => {
      await servicesRef.current.layout.removeModule(moduleId);
      setState(prev => ({ 
        ...prev, 
        hasUnsavedChanges: true,
        selectedModules: prev.selectedModules.filter(id => id !== moduleId)
      }));
      debouncedSave();
    }, [debouncedSave]),

    moveModule: useCallback(async (moduleId: string, position: { x: number; y: number }) => {
      await servicesRef.current.layout.moveModule(moduleId, position);
      setState(prev => ({ ...prev, hasUnsavedChanges: true }));
      debouncedSave();
    }, [debouncedSave]),

    resizeModule: useCallback(async (moduleId: string, size: { w: number; h: number }) => {
      await servicesRef.current.layout.resizeModule(moduleId, size);
      setState(prev => ({ ...prev, hasUnsavedChanges: true }));
      debouncedSave();
    }, [debouncedSave]),

    selectModules: useCallback((moduleIds: string[], addToSelection = false) => {
      setState(prev => {
        if (addToSelection) {
          const newSelection = [...new Set([...prev.selectedModules, ...moduleIds])];
          return { ...prev, selectedModules: newSelection };
        } else {
          return { ...prev, selectedModules: moduleIds };
        }
      });
      servicesRef.current.layout.selectModules(moduleIds);
    }, []),

    clearSelection: useCallback(() => {
      setState(prev => ({ ...prev, selectedModules: [] }));
      servicesRef.current.layout.clearSelection();
    }, []),

    save: saveFunction,

    enableAutoSave: useCallback(async (enabled: boolean) => {
      await servicesRef.current.autoSave.enableAutoSave(enabled);
    }, []),

    setAutoSaveInterval: useCallback(async (intervalMs: number) => {
      await servicesRef.current.autoSave.setAutoSaveInterval(intervalMs);
    }, []),

    setPreviewMode: useCallback((enabled: boolean) => {
      setState(prev => ({ ...prev, previewMode: enabled }));
    }, []),

    setCurrentBreakpoint: useCallback((breakpoint: string) => {
      setState(prev => ({ ...prev, currentBreakpoint: breakpoint }));
    }, []),

    undo: useCallback(async () => {
      const success = await servicesRef.current.layout.undo();
      if (success) {
        const canUndo = await servicesRef.current.layout.canUndo();
        const canRedo = await servicesRef.current.layout.canRedo();
        setState(prev => ({ ...prev, canUndo, canRedo, hasUnsavedChanges: true }));
        debouncedSave();
      }
    }, [debouncedSave]),

    redo: useCallback(async () => {
      const success = await servicesRef.current.layout.redo();
      if (success) {
        const canUndo = await servicesRef.current.layout.canUndo();
        const canRedo = await servicesRef.current.layout.canRedo();
        setState(prev => ({ ...prev, canUndo, canRedo, hasUnsavedChanges: true }));
        debouncedSave();
      }
    }, [debouncedSave]),
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return [state, actions];
};