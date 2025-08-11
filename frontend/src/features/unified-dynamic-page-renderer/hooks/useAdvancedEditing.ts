import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  MultiSelectState, 
  ClipboardData, 
  KeyboardShortcut,
  UseAdvancedEditingReturn,
  GridAlignment,
  AlignmentGuide
} from '../types/studio';
import { LayoutItem } from '../types/core';
import { BreakpointInfo } from '../types/responsive';

export interface UseAdvancedEditingOptions {
  // Layout management
  layouts: Record<string, LayoutItem[]>;
  onLayoutChange: (layouts: Record<string, LayoutItem[]>) => void;
  
  // Current context
  breakpoint: BreakpointInfo;
  
  // Grid settings
  gridSize?: number;
  snapToGrid?: boolean;
  
  // Features
  enableMultiSelect?: boolean;
  enableKeyboardShortcuts?: boolean;
  enableClipboard?: boolean;
  
  // Event handlers
  onSelectionChange?: (selectedItems: string[]) => void;
  onItemsChange?: (action: string, items: LayoutItem[]) => void;
}

/**
 * Hook for advanced editing features including copy/paste, multi-select, and keyboard shortcuts
 */
export const useAdvancedEditing = (options: UseAdvancedEditingOptions): UseAdvancedEditingReturn => {
  const {
    layouts,
    onLayoutChange,
    breakpoint,
    gridSize = 10,
    snapToGrid = false,
    enableMultiSelect = true,
    enableKeyboardShortcuts = true,
    enableClipboard = true,
    onSelectionChange,
    onItemsChange
  } = options;

  // State
  const [multiSelectState, setMultiSelectState] = useState<MultiSelectState>({
    enabled: enableMultiSelect,
    selectedItems: [],
    selectionBounds: null,
    selectionMode: 'single'
  });

  const [clipboardData, setClipboardData] = useState<ClipboardData | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);

  // Get current layout
  const currentLayout = layouts[breakpoint.name] || [];

  // Select item
  const selectItem = useCallback((itemId: string, addToSelection = false) => {
    setMultiSelectState(prev => {
      let newSelectedItems: string[];
      let newSelectionMode: 'single' | 'multiple' | 'range';

      if (!enableMultiSelect || !addToSelection) {
        newSelectedItems = [itemId];
        newSelectionMode = 'single';
      } else {
        const isSelected = prev.selectedItems.includes(itemId);
        if (isSelected) {
          newSelectedItems = prev.selectedItems.filter(id => id !== itemId);
        } else {
          newSelectedItems = [...prev.selectedItems, itemId];
        }
        newSelectionMode = newSelectedItems.length > 1 ? 'multiple' : 'single';
      }

      const newState = {
        ...prev,
        selectedItems: newSelectedItems,
        selectionMode: newSelectionMode,
        selectionBounds: null // Reset bounds when selection changes
      };

      onSelectionChange?.(newSelectedItems);
      return newState;
    });
  }, [enableMultiSelect, onSelectionChange]);

  // Select multiple items
  const selectMultiple = useCallback((itemIds: string[]) => {
    if (!enableMultiSelect) return;

    setMultiSelectState(prev => {
      const newState = {
        ...prev,
        selectedItems: itemIds,
        selectionMode: itemIds.length > 1 ? 'multiple' as const : 'single' as const,
        selectionBounds: null
      };

      onSelectionChange?.(itemIds);
      return newState;
    });
  }, [enableMultiSelect, onSelectionChange]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setMultiSelectState(prev => {
      const newState = {
        ...prev,
        selectedItems: [],
        selectionMode: 'single' as const,
        selectionBounds: null
      };

      onSelectionChange?.([]);
      return newState;
    });
  }, [onSelectionChange]);

  // Copy items to clipboard
  const copyItems = useCallback((itemIds: string[]) => {
    if (!enableClipboard || itemIds.length === 0) return;

    const itemsToCopy = currentLayout.filter(item => itemIds.includes(item.i));
    
    if (itemsToCopy.length === 0) return;

    const clipboardData: ClipboardData = {
      type: 'layout-items',
      items: itemsToCopy.map(item => ({
        ...item,
        // Remove position to allow relative pasting
        x: item.x - Math.min(...itemsToCopy.map(i => i.x)),
        y: item.y - Math.min(...itemsToCopy.map(i => i.y))
      })),
      metadata: {
        timestamp: Date.now(),
        source: 'advanced-editing',
        breakpoint: breakpoint.name
      }
    };

    setClipboardData(clipboardData);
    onItemsChange?.('copy', itemsToCopy);
  }, [enableClipboard, currentLayout, breakpoint.name, onItemsChange]);

  // Paste items from clipboard
  const pasteItems = useCallback((position?: { x: number; y: number }) => {
    if (!enableClipboard || !clipboardData) return;

    const pastePosition = position || { x: 0, y: 0 };
    
    // Apply grid snapping if enabled
    const snappedPosition = snapToGrid ? {
      x: Math.round(pastePosition.x / gridSize) * gridSize,
      y: Math.round(pastePosition.y / gridSize) * gridSize
    } : pastePosition;

    // Create new items with unique IDs
    const newItems = clipboardData.items.map((item, index) => ({
      ...item,
      i: `${item.i}_copy_${Date.now()}_${index}`,
      x: snappedPosition.x + item.x,
      y: snappedPosition.y + item.y
    }));

    // Update layout
    const newLayout = [...currentLayout, ...newItems];
    const newLayouts = {
      ...layouts,
      [breakpoint.name]: newLayout
    };

    onLayoutChange(newLayouts);
    onItemsChange?.('paste', newItems);

    // Select the pasted items
    selectMultiple(newItems.map(item => item.i));
  }, [
    enableClipboard, 
    clipboardData, 
    snapToGrid, 
    gridSize, 
    currentLayout, 
    layouts, 
    breakpoint.name, 
    onLayoutChange, 
    onItemsChange, 
    selectMultiple
  ]);

  // Delete items
  const deleteItems = useCallback((itemIds: string[]) => {
    if (itemIds.length === 0) return;

    const itemsToDelete = currentLayout.filter(item => itemIds.includes(item.i));
    const newLayout = currentLayout.filter(item => !itemIds.includes(item.i));
    
    const newLayouts = {
      ...layouts,
      [breakpoint.name]: newLayout
    };

    onLayoutChange(newLayouts);
    onItemsChange?.('delete', itemsToDelete);

    // Clear selection
    clearSelection();
  }, [currentLayout, layouts, breakpoint.name, onLayoutChange, onItemsChange, clearSelection]);

  // Duplicate items
  const duplicateItems = useCallback((itemIds: string[]) => {
    if (itemIds.length === 0) return;

    const itemsToDuplicate = currentLayout.filter(item => itemIds.includes(item.i));
    
    if (itemsToDuplicate.length === 0) return;

    // Create duplicates with offset
    const duplicatedItems = itemsToDuplicate.map((item, index) => ({
      ...item,
      i: `${item.i}_duplicate_${Date.now()}_${index}`,
      x: item.x + 1,
      y: item.y + 1
    }));

    const newLayout = [...currentLayout, ...duplicatedItems];
    const newLayouts = {
      ...layouts,
      [breakpoint.name]: newLayout
    };

    onLayoutChange(newLayouts);
    onItemsChange?.('duplicate', duplicatedItems);

    // Select the duplicated items
    selectMultiple(duplicatedItems.map(item => item.i));
  }, [currentLayout, layouts, breakpoint.name, onLayoutChange, onItemsChange, selectMultiple]);

  // Move items by delta
  const moveItems = useCallback((itemIds: string[], delta: { x: number; y: number }) => {
    if (itemIds.length === 0) return;

    const newLayout = currentLayout.map(item => {
      if (itemIds.includes(item.i)) {
        let newX = item.x + delta.x;
        let newY = item.y + delta.y;

        // Apply grid snapping if enabled
        if (snapToGrid) {
          newX = Math.round(newX / gridSize) * gridSize;
          newY = Math.round(newY / gridSize) * gridSize;
        }

        // Ensure items stay within bounds
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);

        return { ...item, x: newX, y: newY };
      }
      return item;
    });

    const newLayouts = {
      ...layouts,
      [breakpoint.name]: newLayout
    };

    onLayoutChange(newLayouts);
  }, [currentLayout, layouts, breakpoint.name, snapToGrid, gridSize, onLayoutChange]);

  // Align items
  const alignItems = useCallback((itemIds: string[], alignment: GridAlignment) => {
    if (itemIds.length < 2) return;

    const itemsToAlign = currentLayout.filter(item => itemIds.includes(item.i));
    
    if (itemsToAlign.length < 2) return;

    let referenceValue: number;
    
    // Calculate reference value based on alignment type
    switch (alignment.horizontal) {
      case 'left':
        referenceValue = Math.min(...itemsToAlign.map(item => item.x));
        break;
      case 'center':
        const minX = Math.min(...itemsToAlign.map(item => item.x));
        const maxX = Math.max(...itemsToAlign.map(item => item.x + item.w));
        referenceValue = (minX + maxX) / 2;
        break;
      case 'right':
        referenceValue = Math.max(...itemsToAlign.map(item => item.x + item.w));
        break;
    }

    let verticalReference: number;
    switch (alignment.vertical) {
      case 'top':
        verticalReference = Math.min(...itemsToAlign.map(item => item.y));
        break;
      case 'middle':
        const minY = Math.min(...itemsToAlign.map(item => item.y));
        const maxY = Math.max(...itemsToAlign.map(item => item.y + item.h));
        verticalReference = (minY + maxY) / 2;
        break;
      case 'bottom':
        verticalReference = Math.max(...itemsToAlign.map(item => item.y + item.h));
        break;
    }

    const newLayout = currentLayout.map(item => {
      if (itemIds.includes(item.i)) {
        let newX = item.x;
        let newY = item.y;

        // Apply horizontal alignment
        switch (alignment.horizontal) {
          case 'left':
            newX = referenceValue;
            break;
          case 'center':
            newX = referenceValue - item.w / 2;
            break;
          case 'right':
            newX = referenceValue - item.w;
            break;
        }

        // Apply vertical alignment
        switch (alignment.vertical) {
          case 'top':
            newY = verticalReference;
            break;
          case 'middle':
            newY = verticalReference - item.h / 2;
            break;
          case 'bottom':
            newY = verticalReference - item.h;
            break;
        }

        // Apply grid snapping if enabled
        if (snapToGrid) {
          newX = Math.round(newX / gridSize) * gridSize;
          newY = Math.round(newY / gridSize) * gridSize;
        }

        return { ...item, x: newX, y: newY };
      }
      return item;
    });

    const newLayouts = {
      ...layouts,
      [breakpoint.name]: newLayout
    };

    onLayoutChange(newLayouts);
  }, [currentLayout, layouts, breakpoint.name, snapToGrid, gridSize, onLayoutChange]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const { ctrlKey, metaKey, shiftKey, key } = event;
      const isModifierPressed = ctrlKey || metaKey;

      // Prevent default for our shortcuts
      const shouldPreventDefault = () => {
        if (isModifierPressed) {
          switch (key.toLowerCase()) {
            case 'c':
            case 'v':
            case 'd':
            case 'a':
              return multiSelectState.selectedItems.length > 0 || key === 'v' || key === 'a';
            default:
              return false;
          }
        }
        return ['Delete', 'Backspace', 'Escape'].includes(key);
      };

      if (shouldPreventDefault()) {
        event.preventDefault();
      }

      // Handle shortcuts
      if (isModifierPressed) {
        switch (key.toLowerCase()) {
          case 'c':
            if (multiSelectState.selectedItems.length > 0) {
              copyItems(multiSelectState.selectedItems);
            }
            break;
          case 'v':
            pasteItems();
            break;
          case 'd':
            if (multiSelectState.selectedItems.length > 0) {
              duplicateItems(multiSelectState.selectedItems);
            }
            break;
          case 'a':
            if (currentLayout.length > 0) {
              selectMultiple(currentLayout.map(item => item.i));
            }
            break;
        }
      } else {
        switch (key) {
          case 'Delete':
          case 'Backspace':
            if (multiSelectState.selectedItems.length > 0) {
              deleteItems(multiSelectState.selectedItems);
            }
            break;
          case 'Escape':
            clearSelection();
            break;
          case 'ArrowUp':
            if (multiSelectState.selectedItems.length > 0) {
              event.preventDefault();
              moveItems(multiSelectState.selectedItems, { x: 0, y: -1 });
            }
            break;
          case 'ArrowDown':
            if (multiSelectState.selectedItems.length > 0) {
              event.preventDefault();
              moveItems(multiSelectState.selectedItems, { x: 0, y: 1 });
            }
            break;
          case 'ArrowLeft':
            if (multiSelectState.selectedItems.length > 0) {
              event.preventDefault();
              moveItems(multiSelectState.selectedItems, { x: -1, y: 0 });
            }
            break;
          case 'ArrowRight':
            if (multiSelectState.selectedItems.length > 0) {
              event.preventDefault();
              moveItems(multiSelectState.selectedItems, { x: 1, y: 0 });
            }
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    enableKeyboardShortcuts,
    multiSelectState.selectedItems,
    copyItems,
    pasteItems,
    duplicateItems,
    deleteItems,
    clearSelection,
    moveItems,
    selectMultiple,
    currentLayout
  ]);

  return {
    multiSelectState,
    selectItem,
    selectMultiple,
    clearSelection,
    copyItems,
    pasteItems,
    deleteItems,
    duplicateItems,
    clipboardData
  };
};

export default useAdvancedEditing;