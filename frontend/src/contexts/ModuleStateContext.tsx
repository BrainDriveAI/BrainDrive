import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { debounce, throttle } from 'lodash';

// Define the context type
interface ModuleStateContextType {
  saveModuleState: (moduleId: string, state: any) => void;
  getModuleState: (moduleId: string) => any;
  clearModuleState: (moduleId: string) => void;
  saveAllModuleStates: () => void;
  loadAllModuleStates: () => void;
  clearAllModuleStates: () => void;
}

// Create the context with default values
const ModuleStateContext = createContext<ModuleStateContextType>({
  saveModuleState: () => {},
  getModuleState: () => null,
  clearModuleState: () => {},
  saveAllModuleStates: () => {},
  loadAllModuleStates: () => {},
  clearAllModuleStates: () => {}
});

// Custom hook for using the context
export const useModuleState = () => useContext(ModuleStateContext);

// Provider component
export const ModuleStateProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Use state to store module states in memory
  const [moduleStates, setModuleStates] = useState<Record<string, any>>({});
  
  // Use a ref to track if we're currently updating state to prevent recursive updates
  const isUpdatingRef = useRef<boolean>(false);
  
  // Load saved states from sessionStorage on mount
  useEffect(() => {
    loadAllModuleStates();
  }, []);
  
  // Function to load all module states from sessionStorage
  const loadAllModuleStates = useCallback(() => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    // console.log('Loading module states from sessionStorage');
    
    try {
      const savedStates = sessionStorage.getItem('module_states');
      if (savedStates) {
        const parsedStates = JSON.parse(savedStates);
        setModuleStates(parsedStates);
        
        // Debug: log the loaded states
        const stateCount = Object.keys(parsedStates).length;
        // console.log(`Loaded ${stateCount} module states from sessionStorage`);
        if (stateCount > 0) {
          // console.log(`Loaded module keys: ${Object.keys(parsedStates).join(', ')}`);
        }
      } else {
        // console.log('No saved module states found in sessionStorage');
      }
    } catch (e) {
      console.error('Error loading module states from sessionStorage:', e);
    } finally {
      // Reset the updating flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, []);
  
  // Function to save all module states to sessionStorage
  const saveAllModuleStates = useCallback(() => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    try {
      const stateCount = Object.keys(moduleStates).length;
      if (stateCount > 0) {
        const serializedState = JSON.stringify(moduleStates);
        sessionStorage.setItem('module_states', serializedState);
        // console.log(`Saved all module states to sessionStorage: ${stateCount} modules, size: ${serializedState.length} bytes`);
        // console.log(`Saved module keys: ${Object.keys(moduleStates).join(', ')}`);
      } else {
        // console.log('No module states to save to sessionStorage');
      }
    } catch (e) {
      console.error('Error saving module states to sessionStorage:', e);
    } finally {
      // Reset the updating flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [moduleStates]);
  
  // Function to clear all module states
  const clearAllModuleStates = useCallback(() => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    try {
      sessionStorage.removeItem('module_states');
      setModuleStates({});
      // console.log('Cleared all module states');
    } catch (e) {
      console.error('Error clearing module states:', e);
    } finally {
      // Reset the updating flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, []);
  
  // Create a debounced version of saveAllModuleStates
  const debouncedSaveAllModuleStates = useCallback(
    debounce(() => {
      saveAllModuleStates();
    }, 300),
    [saveAllModuleStates]
  );
  
  // Save module state with safeguards against infinite loops
  const saveModuleState = useCallback((moduleId: string, state: any) => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    // console.log(`Saving state for module ${moduleId}`, state);
    
    setModuleStates(prev => {
      const newStates = {
        ...prev,
        [moduleId]: state
      };
      
      // Save to sessionStorage for persistence across page refreshes
      try {
        const serializedState = JSON.stringify(newStates);
        sessionStorage.setItem('module_states', serializedState);
        // console.log(`Saved module states to sessionStorage: ${Object.keys(newStates).length} modules, size: ${serializedState.length} bytes`);
        
        // Debug: log the keys of saved modules
        // console.log(`Saved module keys: ${Object.keys(newStates).join(', ')}`);
      } catch (e) {
        console.error('Error saving module states to sessionStorage:', e);
      }
      
      return newStates;
    });
    
    // Reset the updating flag after a short delay
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 0);
  }, []);
  
  // Create a debounced version of saveModuleState
  const debouncedSaveModuleState = useCallback(
    debounce((moduleId: string, state: any) => {
      saveModuleState(moduleId, state);
    }, 300),
    [saveModuleState]
  );
  
  // Get module state
  const getModuleState = useCallback((moduleId: string) => {
    const state = moduleStates[moduleId] || null;
    if (state) {
      // console.log(`Retrieved state for module ${moduleId}`);
    } else {
      // console.log(`No state found for module ${moduleId}`);
    }
    return state;
  }, [moduleStates]);
  
  // Clear module state with safeguards
  const clearModuleState = useCallback((moduleId: string) => {
    // Skip if already updating
    if (isUpdatingRef.current) return;
    
    isUpdatingRef.current = true;
    
    setModuleStates(prev => {
      const newStates = { ...prev };
      delete newStates[moduleId];
      
      // Update sessionStorage
      try {
        sessionStorage.setItem('module_states', JSON.stringify(newStates));
      } catch (e) {
        console.error('Error updating module states in sessionStorage:', e);
      }
      
      return newStates;
    });
    
    // Reset the updating flag after a short delay
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 0);
  }, []);
  
  // Add event listeners for page navigation with throttling
  useEffect(() => {
    // Create a throttled version of saveAllModuleStates
    const throttledSaveAllModuleStates = throttle(() => {
      saveAllModuleStates();
    }, 500, { leading: true, trailing: true });
    
    // Save states before unload
    const handleBeforeUnload = () => {
      throttledSaveAllModuleStates();
    };
    
    // Add event listener
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Clean up
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveAllModuleStates]);
  
  return (
    <ModuleStateContext.Provider value={{
      saveModuleState: debouncedSaveModuleState, // Use debounced version
      getModuleState,
      clearModuleState,
      saveAllModuleStates,
      loadAllModuleStates,
      clearAllModuleStates
    }}>
      {children}
    </ModuleStateContext.Provider>
  );
};

export default ModuleStateContext;