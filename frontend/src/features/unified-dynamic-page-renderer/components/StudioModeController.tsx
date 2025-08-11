import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RenderMode, PageData } from '../types';
import { BreakpointInfo } from '../types/responsive';
import { usePluginStudioDevMode } from '../../../hooks/usePluginStudioDevMode';
import {
  StudioModeFeatures,
  type StudioContext as StudioContextType,
  StudioActions,
  DragDropState,
  MultiSelectState,
  UndoRedoState,
  GridEditingState,
  StudioEvent,
  StudioConfig
} from '../types/studio';

export interface StudioModeControllerProps {
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  pageData: PageData;
  breakpoint: BreakpointInfo;
  
  // Studio configuration
  studioConfig?: Partial<StudioConfig>;
  
  // Event handlers
  onFeatureToggle?: (feature: keyof StudioModeFeatures, enabled: boolean) => void;
  onModeTransition?: (fromMode: RenderMode, toMode: RenderMode) => void;
  onStudioEvent?: (event: StudioEvent) => void;
  
  // Children
  children: React.ReactNode;
}

const defaultStudioFeatures: StudioModeFeatures = {
  // Core editing capabilities
  dragAndDrop: true,
  resize: true,
  configure: true,
  delete: true,
  
  // UI elements
  toolbar: true,
  contextMenu: true,
  propertyPanel: true,
  gridOverlay: false,
  
  // Advanced features
  undo: true,
  redo: true,
  copy: true,
  paste: true,
  multiSelect: true,
  keyboardShortcuts: true,
  
  // Grid features
  snapToGrid: true,
  gridAlignment: true,
  collisionDetection: true,
  
  // Collaboration
  realTimeEditing: false,
  comments: false,
  versionHistory: false,
  
  // Performance
  autoSave: true,
  previewMode: true
};

const defaultDragDropState: DragDropState = {
  isDragging: false,
  dragData: null,
  dropZones: [],
  activeDropZone: null,
  dragPreview: null
};

const defaultMultiSelectState: MultiSelectState = {
  enabled: true,
  selectedItems: [],
  selectionBounds: null,
  selectionMode: 'single'
};

const defaultUndoRedoState: UndoRedoState = {
  history: {
    commands: [],
    currentIndex: -1,
    maxSize: 50,
    canUndo: false,
    canRedo: false
  },
  isExecuting: false,
  lastCommand: null
};

const defaultGridEditingState: GridEditingState = {
  snapToGrid: true,
  gridSize: 10,
  showGrid: false,
  alignmentGuides: true,
  collisionDetection: true,
  autoArrange: false
};

export const StudioModeController: React.FC<StudioModeControllerProps> = ({
  mode,
  onModeChange,
  pageData,
  breakpoint,
  studioConfig = {},
  onFeatureToggle,
  onModeTransition,
  onStudioEvent,
  children
}) => {
  // Plugin Studio Dev Mode
  const { isPluginStudioDevMode } = usePluginStudioDevMode();
  
  // Debug logging utility - only logs when Plugin Studio dev mode is enabled
  const debugLog = useCallback((message: string, ...args: any[]) => {
    if (isPluginStudioDevMode) {
      debugLog(message, ...args);
    }
  }, [isPluginStudioDevMode]);

  // State management
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [features, setFeatures] = useState<StudioModeFeatures>({
    ...defaultStudioFeatures,
    ...studioConfig.features
  });
  const [dragDropState, setDragDropState] = useState<DragDropState>(defaultDragDropState);
  const [multiSelectState, setMultiSelectState] = useState<MultiSelectState>(defaultMultiSelectState);
  const [undoRedoState, setUndoRedoState] = useState<UndoRedoState>(defaultUndoRedoState);
  const [gridEditingState, setGridEditingState] = useState<GridEditingState>({
    ...defaultGridEditingState,
    ...studioConfig.grid
  });

  // Handle mode transitions with enhanced studio capabilities
  const handleModeChange = useCallback(async (newMode: RenderMode) => {
    if (newMode === mode || isTransitioning) return;

    setIsTransitioning(true);
    
    try {
      // Emit mode change event
      const event: StudioEvent = {
        type: 'mode-change',
        timestamp: Date.now(),
        data: { fromMode: mode, toMode: newMode }
      };
      onStudioEvent?.(event);
      
      // Notify about transition start
      onModeTransition?.(mode, newMode);
      
      // Perform mode-specific cleanup/setup
      await performModeTransition(mode, newMode);
      
      // Change the mode
      onModeChange(newMode);
    } catch (error) {
      console.error('[StudioModeController] Mode transition failed:', error);
    } finally {
      setIsTransitioning(false);
    }
  }, [mode, isTransitioning, onModeChange, onModeTransition, onStudioEvent]);

  // Toggle feature with enhanced functionality
  const toggleFeature = useCallback((feature: keyof StudioModeFeatures) => {
    setFeatures(prev => {
      const newState = !prev[feature];
      
      // Handle feature-specific logic
      if (feature === 'multiSelect' && !newState) {
        // Clear selection when disabling multi-select
        setMultiSelectState(prev => ({
          ...prev,
          selectedItems: [],
          selectionMode: 'single'
        }));
      }
      
      if (feature === 'snapToGrid') {
        setGridEditingState(prev => ({
          ...prev,
          snapToGrid: newState
        }));
      }
      
      // Emit feature toggle event
      const event: StudioEvent = {
        type: 'feature-toggle',
        timestamp: Date.now(),
        data: { feature, enabled: newState }
      };
      onStudioEvent?.(event);
      
      onFeatureToggle?.(feature, newState);
      return { ...prev, [feature]: newState };
    });
  }, [onFeatureToggle, onStudioEvent]);

  // Studio actions implementation
  const studioActions: StudioActions = useMemo(() => ({
    // Mode management
    switchMode: handleModeChange,
    toggleFeature,
    
    // Drag and drop
    startDrag: (data, event) => {
      setDragDropState(prev => ({
        ...prev,
        isDragging: true,
        dragData: data
      }));
    },
    
    endDrag: () => {
      setDragDropState(prev => ({
        ...prev,
        isDragging: false,
        dragData: null,
        activeDropZone: null,
        dragPreview: null
      }));
    },
    
    handleDrop: (data, position) => {
      // Implementation will be handled by drag-drop system
      debugLog('[StudioModeController] Drop handled:', data, position);
    },
    
    // Selection
    selectItem: (itemId, addToSelection = false) => {
      setMultiSelectState(prev => {
        if (!features.multiSelect || !addToSelection) {
          return {
            ...prev,
            selectedItems: [itemId],
            selectionMode: 'single'
          };
        }
        
        const isSelected = prev.selectedItems.includes(itemId);
        const newSelection = isSelected
          ? prev.selectedItems.filter(id => id !== itemId)
          : [...prev.selectedItems, itemId];
          
        return {
          ...prev,
          selectedItems: newSelection,
          selectionMode: newSelection.length > 1 ? 'multiple' : 'single'
        };
      });
    },
    
    selectMultiple: (itemIds) => {
      if (!features.multiSelect) return;
      
      setMultiSelectState(prev => ({
        ...prev,
        selectedItems: itemIds,
        selectionMode: itemIds.length > 1 ? 'multiple' : 'single'
      }));
    },
    
    clearSelection: () => {
      setMultiSelectState(prev => ({
        ...prev,
        selectedItems: [],
        selectionMode: 'single',
        selectionBounds: null
      }));
    },
    
    // Editing (placeholder implementations)
    copyItems: (itemIds) => {
      debugLog('[StudioModeController] Copy items:', itemIds);
    },
    
    pasteItems: (position) => {
      debugLog('[StudioModeController] Paste items at:', position);
    },
    
    deleteItems: (itemIds) => {
      debugLog('[StudioModeController] Delete items:', itemIds);
    },
    
    duplicateItems: (itemIds) => {
      debugLog('[StudioModeController] Duplicate items:', itemIds);
    },
    
    // Layout (placeholder implementations)
    moveItems: (itemIds, delta) => {
      debugLog('[StudioModeController] Move items:', itemIds, delta);
    },
    
    resizeItem: (itemId, size) => {
      debugLog('[StudioModeController] Resize item:', itemId, size);
    },
    
    alignItems: (itemIds, alignment) => {
      debugLog('[StudioModeController] Align items:', itemIds, alignment);
    },
    
    // Undo/Redo (placeholder implementations)
    undo: () => {
      debugLog('[StudioModeController] Undo');
    },
    
    redo: () => {
      debugLog('[StudioModeController] Redo');
    },
    
    executeCommand: (command) => {
      debugLog('[StudioModeController] Execute command:', command);
    },
    
    // Grid
    toggleGrid: () => {
      setGridEditingState(prev => ({
        ...prev,
        showGrid: !prev.showGrid
      }));
    },
    
    setGridSize: (size) => {
      setGridEditingState(prev => ({
        ...prev,
        gridSize: size
      }));
    },
    
    snapToGrid: (position) => {
      if (!gridEditingState.snapToGrid) return position;
      
      const { gridSize } = gridEditingState;
      return {
        x: Math.round(position.x / gridSize) * gridSize,
        y: Math.round(position.y / gridSize) * gridSize
      };
    }
  }), [
    handleModeChange, 
    toggleFeature, 
    features.multiSelect, 
    gridEditingState.snapToGrid, 
    gridEditingState.gridSize
  ]);

  // Create studio context
  const studioContext: StudioContextType = useMemo(() => ({
    mode,
    features,
    breakpoint,
    dragDropState,
    multiSelectState,
    undoRedoState,
    gridEditingState,
    actions: studioActions
  }), [
    mode,
    features,
    breakpoint,
    dragDropState,
    multiSelectState,
    undoRedoState,
    gridEditingState,
    studioActions
  ]);

  // Perform mode-specific transition logic
  const performModeTransition = async (fromMode: RenderMode, toMode: RenderMode): Promise<void> => {
    // Add transition delay for smooth UX
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Mode-specific transition logic
    if (toMode === 'studio') {
      // Enable studio features
      setFeatures(prev => ({ ...prev, ...defaultStudioFeatures, ...studioConfig.features }));
    } else if (fromMode === 'studio') {
      // Clean up studio-specific state when leaving studio mode
      setMultiSelectState(defaultMultiSelectState);
      setDragDropState(defaultDragDropState);
    }
    
    debugLog(`[StudioModeController] Transitioning from ${fromMode} to ${toMode}`);
  };

  // Keyboard shortcuts effect
  useEffect(() => {
    if (!features.keyboardShortcuts || mode !== 'studio') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + Z - Undo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        studioActions.undo();
      }
      
      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y - Redo
      if (((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Z') ||
          ((event.ctrlKey || event.metaKey) && event.key === 'y')) {
        event.preventDefault();
        studioActions.redo();
      }
      
      // Ctrl/Cmd + C - Copy
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        if (multiSelectState.selectedItems.length > 0) {
          event.preventDefault();
          studioActions.copyItems(multiSelectState.selectedItems);
        }
      }
      
      // Ctrl/Cmd + V - Paste
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        event.preventDefault();
        studioActions.pasteItems();
      }
      
      // Delete/Backspace - Delete selected items
      if ((event.key === 'Delete' || event.key === 'Backspace') && 
          multiSelectState.selectedItems.length > 0) {
        event.preventDefault();
        studioActions.deleteItems(multiSelectState.selectedItems);
      }
      
      // Escape - Clear selection
      if (event.key === 'Escape') {
        studioActions.clearSelection();
      }
      
      // G - Toggle grid
      if (event.key === 'g' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        studioActions.toggleGrid();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [features.keyboardShortcuts, mode, studioActions, multiSelectState.selectedItems]);

  // Auto-save effect
  useEffect(() => {
    if (!features.autoSave || mode !== 'studio') return;

    const autoSaveInterval = setInterval(() => {
      // Auto-save logic would go here
      debugLog('[StudioModeController] Auto-save triggered');
    }, 30000); // Auto-save every 30 seconds

    return () => clearInterval(autoSaveInterval);
  }, [features.autoSave, mode]);

  return (
    <div 
      className={`studio-mode-controller studio-mode-controller--${mode} ${
        isTransitioning ? 'studio-mode-controller--transitioning' : ''
      }`}
      data-studio-features={Object.entries(features)
        .filter(([, enabled]) => enabled)
        .map(([feature]) => feature)
        .join(' ')}
    >
      {/* Provide studio context to children */}
      <StudioContextProvider value={studioContext}>
        {children}
      </StudioContextProvider>

      {/* Mode transition indicator */}
      {isTransitioning && (
        <div className="studio-mode-controller__transition-overlay">
          <div className="studio-mode-controller__transition-spinner" />
          <span className="studio-mode-controller__transition-text">
            Switching to {mode} mode...
          </span>
        </div>
      )}

      {/* Grid overlay */}
      {mode === 'studio' && features.gridOverlay && gridEditingState.showGrid && (
        <div 
          className="studio-mode-controller__grid-overlay"
          style={{
            backgroundSize: `${gridEditingState.gridSize}px ${gridEditingState.gridSize}px`
          }}
        />
      )}
    </div>
  );
};

// Studio Context Provider
const StudioContext = React.createContext<StudioContextType | null>(null);

const StudioContextProvider: React.FC<{
  value: StudioContextType;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <StudioContext.Provider value={value}>
    {children}
  </StudioContext.Provider>
);

// Hook to use studio context
export const useStudioContext = (): StudioContextType => {
  const context = React.useContext(StudioContext);
  if (!context) {
    throw new Error('useStudioContext must be used within a StudioModeController');
  }
  return context;
};

export default StudioModeController;