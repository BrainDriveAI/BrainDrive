import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Page } from '../pages';
import { debounce, throttle } from 'lodash';
import { useModuleState } from './ModuleStateContext';

// Enhanced cache for storing page states with module states
interface PageCache {
  [pageId: string]: {
    page: Page;
    moduleStates: Record<string, any>;
    scrollPosition: number;
    timestamp: number;
  };
}

interface PageStateContextType {
  cachePage: (pageId: string, page: Page) => void;
  getCachedPage: (pageId: string) => Page | null;
  getScrollPosition: (pageId: string) => number;
  setScrollPosition: (pageId: string, position: number) => void;
  getModuleStatesForPage: (pageId: string) => Record<string, any>;
  savePageToSessionStorage: () => void;
  loadPageFromSessionStorage: () => void;
  clearCache: () => void;
}

const PageStateContext = createContext<PageStateContextType | null>(null);

export const PageStateProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Get module state functions from ModuleStateContext
  const { getModuleState } = useModuleState();
  
  // Use state to store page cache in memory
  const [pageCache, setPageCache] = useState<PageCache>({});
  
  // Use a ref to track if we're currently updating to prevent infinite loops
  const isUpdatingRef = useRef<boolean>(false);
  
  // Load page cache from sessionStorage on mount
  useEffect(() => {
    loadPageFromSessionStorage();
  }, []);
  
  // Function to load page cache from sessionStorage
  const loadPageFromSessionStorage = useCallback(() => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    // console.log('Loading page cache from sessionStorage');
    
    try {
      const savedCache = sessionStorage.getItem('page_cache');
      if (savedCache) {
        const parsedCache = JSON.parse(savedCache);
        
        // Count pages and module states
        const pageCount = Object.keys(parsedCache).length;
        let totalModuleStates = 0;
        let moduleStatesByPage: Record<string, number> = {};
        
        Object.entries(parsedCache).forEach(([pageId, pageData]: [string, any]) => {
          const stateCount = Object.keys(pageData.moduleStates || {}).length;
          totalModuleStates += stateCount;
          moduleStatesByPage[pageId] = stateCount;
        });
        
        setPageCache(parsedCache);
        
        // console.log(`Loaded page cache from sessionStorage: ${pageCount} pages, ${totalModuleStates} total module states, size: ${savedCache.length} bytes`);
        
        // Log details about module states by page
        if (totalModuleStates > 0) {
          // console.log('Module states by page:', moduleStatesByPage);
          
          // Log the keys of the first few module states for debugging
          Object.entries(parsedCache).forEach(([pageId, pageData]: [string, any]) => {
            const moduleStates = pageData.moduleStates || {};
            if (Object.keys(moduleStates).length > 0) {
              // console.log(`Module state keys for page ${pageId}: ${Object.keys(moduleStates).join(', ')}`);
            }
          });
        }
      } else {
        // console.log('No saved page cache found in sessionStorage');
      }
    } catch (e) {
      console.error('Error loading page cache from sessionStorage:', e);
    } finally {
      // Reset the updating flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, []);
  
  // Function to save page cache to sessionStorage
  const savePageToSessionStorage = useCallback(() => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    try {
      // Count pages and module states
      const pageCount = Object.keys(pageCache).length;
      let totalModuleStates = 0;
      let moduleStatesByPage: Record<string, number> = {};
      
      Object.entries(pageCache).forEach(([pageId, pageData]) => {
        const stateCount = Object.keys(pageData.moduleStates || {}).length;
        totalModuleStates += stateCount;
        moduleStatesByPage[pageId] = stateCount;
      });
      
      // Serialize and save
      const serializedCache = JSON.stringify(pageCache);
      sessionStorage.setItem('page_cache', serializedCache);
      
      // console.log(`Saved page cache to sessionStorage: ${pageCount} pages, ${totalModuleStates} total module states, size: ${serializedCache.length} bytes`);
      
      // Log details about module states by page
      if (totalModuleStates > 0) {
        // console.log('Module states by page:', moduleStatesByPage);
      }
    } catch (e) {
      console.error('Error saving page cache to sessionStorage:', e);
    } finally {
      // Reset the updating flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [pageCache]);
  
  // Create a debounced version of savePageToSessionStorage
  const debouncedSavePageToSessionStorage = useCallback(
    debounce(() => {
      savePageToSessionStorage();
    }, 300),
    [savePageToSessionStorage]
  );
  
  // Cache a page with safeguards against infinite loops
  const cachePage = useCallback((pageId: string, page: Page) => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    // Get module states for this page
    const moduleStates: Record<string, any> = {};
    
    if (page.modules) {
      Object.entries(page.modules).forEach(([moduleId, moduleConfig]) => {
        // First check if the module has a savedState in its config
        const savedStateFromConfig = moduleConfig.config?.savedState;
        
        // Then check ModuleStateContext
        const fullModuleId = `${moduleConfig.pluginId}-${moduleConfig.moduleId || moduleConfig.moduleName}`;
        const savedStateFromContext = getModuleState(fullModuleId);
        
        // Use the most up-to-date state
        const effectiveState = savedStateFromConfig || savedStateFromContext;
        
        if (effectiveState) {
          // console.log(`Caching state for module ${moduleId} (${fullModuleId})`);
          moduleStates[moduleId] = effectiveState;
        }
      });
    }
    
    setPageCache(prev => {
      const newCache = {
        ...prev,
        [pageId]: {
          page,
          moduleStates,
          scrollPosition: prev[pageId]?.scrollPosition || 0,
          timestamp: Date.now()
        }
      };
      
      // console.log(`Updated page cache for ${pageId} with ${Object.keys(moduleStates).length} module states`);
      
      // Save to sessionStorage
      try {
        sessionStorage.setItem('page_cache', JSON.stringify(newCache));
      } catch (e) {
        console.error('Error saving page cache to sessionStorage:', e);
      }
      
      return newCache;
    });
    
    // Reset the updating flag after a short delay
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 0);
  }, [getModuleState]);
  
  // Get a cached page
  const getCachedPage = useCallback((pageId: string): Page | null => {
    return pageCache[pageId]?.page || null;
  }, [pageCache]);
  
  // Get module states for a page
  const getModuleStatesForPage = useCallback((pageId: string): Record<string, any> => {
    const moduleStates = pageCache[pageId]?.moduleStates || {};
    const stateCount = Object.keys(moduleStates).length;
    
    // console.log(`Retrieved module states for page ${pageId}: ${stateCount} states`);
    if (stateCount > 0) {
      // console.log(`Module state keys: ${Object.keys(moduleStates).join(', ')}`);
    }
    
    return moduleStates;
  }, [pageCache]);
  
  // Get scroll position for a page
  const getScrollPosition = useCallback((pageId: string): number => {
    return pageCache[pageId]?.scrollPosition || 0;
  }, [pageCache]);
  
  // Set scroll position for a page with safeguards
  const setScrollPosition = useCallback((pageId: string, position: number) => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    setPageCache(prev => {
      if (!prev[pageId]) {
        isUpdatingRef.current = false;
        return prev;
      }
      
      const newCache = {
        ...prev,
        [pageId]: {
          ...prev[pageId],
          scrollPosition: position
        }
      };
      
      // Save to sessionStorage
      try {
        sessionStorage.setItem('page_cache', JSON.stringify(newCache));
      } catch (e) {
        console.error('Error saving page cache to sessionStorage:', e);
      }
      
      return newCache;
    });
    
    // Reset the updating flag after a short delay
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 0);
  }, []);
  
  // Create a debounced version of setScrollPosition
  const debouncedSetScrollPosition = useCallback(
    debounce((pageId: string, position: number) => {
      setScrollPosition(pageId, position);
    }, 300),
    [setScrollPosition]
  );
  
  // Clear the cache with safeguards
  const clearCache = useCallback(() => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    setPageCache({});
    
    // Clear from sessionStorage
    try {
      sessionStorage.removeItem('page_cache');
    } catch (e) {
      console.error('Error clearing page cache from sessionStorage:', e);
    }
    
    // Reset the updating flag after a short delay
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 0);
  }, []);
  
  // Add event listeners for page navigation with throttling
  useEffect(() => {
    // Create a throttled version of savePageToSessionStorage
    const throttledSavePageToSessionStorage = throttle(() => {
      savePageToSessionStorage();
    }, 500, { leading: true, trailing: true });
    
    // Save cache before unload
    const handleBeforeUnload = () => {
      throttledSavePageToSessionStorage();
    };
    
    // Add event listener
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Clear cache on logout
    const handleLogout = () => {
      clearCache();
    };
    
    window.addEventListener('logout', handleLogout);
    
    // Clean up
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('logout', handleLogout);
    };
  }, [savePageToSessionStorage, clearCache]);
  
  return (
    <PageStateContext.Provider value={{
      cachePage,
      getCachedPage,
      getScrollPosition,
      setScrollPosition: debouncedSetScrollPosition, // Use debounced version
      getModuleStatesForPage,
      savePageToSessionStorage,
      loadPageFromSessionStorage,
      clearCache
    }}>
      {children}
    </PageStateContext.Provider>
  );
};

// Custom hook for using the context
export const usePageState = () => {
  const context = useContext(PageStateContext);
  if (!context) {
    throw new Error('usePageState must be used within a PageStateProvider');
  }
  return context;
};