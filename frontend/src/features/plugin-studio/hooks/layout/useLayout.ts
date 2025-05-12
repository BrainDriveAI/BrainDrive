import { useState, useCallback, useEffect } from 'react';
import { Layouts, LayoutItem, GridItem, Page } from '../../types';

/**
 * Custom hook for managing layouts
 * @param initialPage The initial page to get layouts from
 * @param getModuleById Optional function to get module definition by ID
 * @returns Layout management functions and state
 */
export const useLayout = (
  initialPage: Page | null,
  getModuleById?: (pluginId: string, moduleId: string) => any
) => {
  const [layouts, setLayouts] = useState<Layouts | null>(initialPage?.layouts || null);
  
  // Update layouts when the page changes
  useEffect(() => {
    if (initialPage?.layouts) {
      // Create a deep copy of the layouts to ensure we're not sharing references
      const layoutsCopy = JSON.parse(JSON.stringify(initialPage.layouts));
      console.log('useLayout: Setting layouts from initialPage:', JSON.stringify(layoutsCopy));
      setLayouts(layoutsCopy);
    } else {
      setLayouts({
        desktop: [],
        tablet: [],
        mobile: []
      });
    }
    // Only depend on initialPage.id to prevent unnecessary re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage?.id, initialPage?.layouts]);
  
  /**
   * Handle layout changes
   * @param layout The new layout
   * @param newLayouts The new layouts for all device types
   */
  const handleLayoutChange = useCallback((layout: any[], newLayouts: Layouts) => {
    console.log('Layout changed:', JSON.stringify(newLayouts));
    
    // Validate and ensure all layout items have required properties
    const validateLayouts = (layouts: Layouts): Layouts => {
      const result: Layouts = { desktop: [], tablet: [], mobile: [] };
      
      // Helper function to validate a single layout item
      const validateItem = (item: any) => {
        if (!item) return null;
        
        // Ensure all required properties exist and are valid numbers
        return {
          ...item,
          x: typeof item.x === 'number' ? item.x : 0,
          y: typeof item.y === 'number' ? item.y : 0,
          w: typeof item.w === 'number' ? item.w : 2,
          h: typeof item.h === 'number' ? item.h : 2,
          i: item.i || item.moduleUniqueId || `item_${Date.now()}`
        };
      };
      
      // Helper function to deduplicate items by ID
      const deduplicateItems = (items: any[]) => {
        const seen = new Set();
        return items.filter(item => {
          if (!item) return false;
          
          const id = item.i || item.moduleUniqueId;
          if (seen.has(id)) return false;
          
          seen.add(id);
          return true;
        });
      };
      
      // Validate each layout array
      Object.entries(layouts).forEach(([deviceType, layoutItems]) => {
        if (deviceType === 'desktop' || deviceType === 'tablet' || deviceType === 'mobile') {
          // First deduplicate items, then validate them
          result[deviceType as keyof Layouts] = deduplicateItems(layoutItems)
            .map(validateItem)
            .filter(Boolean) as (GridItem | LayoutItem)[];
        }
      });
      
      return result;
    };
    
    // Validate and create a deep copy of the layouts
    const validatedLayouts = validateLayouts(newLayouts);
    const layoutsCopy = JSON.parse(JSON.stringify(validatedLayouts));
    
    setLayouts(layoutsCopy);
    
    // If initialPage is provided, update its layouts as well
    if (initialPage) {
      initialPage.layouts = layoutsCopy;
      
      // Also update content.layouts if it exists
      if (initialPage.content) {
        initialPage.content.layouts = layoutsCopy;
      }
    }
  }, [initialPage]);
  
  /**
   * Remove an item from all layouts
   * @param id The ID of the item to remove
   */
  const removeItem = useCallback((id: string) => {
    if (!layouts) return;
    
    const updatedLayouts = Object.entries(layouts).reduce<Layouts>((acc, [deviceType, layout]) => {
      if (deviceType === 'desktop' || deviceType === 'tablet' || deviceType === 'mobile') {
        acc[deviceType as keyof Layouts] = layout.filter((item: GridItem | LayoutItem) =>
          'i' in item ? item.i !== id : (item as LayoutItem).moduleUniqueId !== id
        );
      }
      return acc;
    }, { desktop: [], tablet: [], mobile: [] });
    
    setLayouts(updatedLayouts);
  }, [layouts]);
  
  /**
   * Copy layout from one device type to another
   * @param from Source device type
   * @param to Target device type
   */
  const copyLayout = useCallback((from: keyof Layouts, to: keyof Layouts) => {
    if (!layouts || !layouts[from]) return;
    
    const sourceLayout = layouts[from];
    const colRatio = to === 'mobile' ? 4/12 : to === 'tablet' ? 8/12 : 1;
    
    // Helper function to validate and ensure all required properties
    const validateAndAdjustItem = (item: any) => {
      if (!item) return null;
      
      // Ensure all required properties exist and are valid numbers
      const x = typeof item.x === 'number' ? item.x : 0;
      const y = typeof item.y === 'number' ? item.y : 0;
      const w = typeof item.w === 'number' ? item.w : 2;
      const h = typeof item.h === 'number' ? item.h : 2;
      
      // Adjust width based on column differences
      const adjustedWidth = Math.min(
        Math.floor(w * colRatio),
        to === 'mobile' ? 4 : to === 'tablet' ? 8 : 12
      );
      
      // For mobile and tablet, ensure items are stacked vertically
      const adjustedX = to === 'mobile' ? 0 : to === 'tablet' ? Math.min(x, 4) : x;
      
      return {
        ...item,
        x: adjustedX,
        y: y,
        w: adjustedWidth,
        h: h,
        i: item.i || item.moduleUniqueId || `item_${Date.now()}`
      };
    };
    
    const updatedLayouts = {
      ...layouts,
      [to]: sourceLayout
        .map(validateAndAdjustItem)
        .filter(Boolean) // Remove any null items
    };
    
    setLayouts(updatedLayouts);
  }, [layouts]);
  
  /**
   * Add an item to all layouts
   * @param item The item to add
   * @param activeDeviceType The currently active device type
   */
  const addItem = useCallback((item: GridItem | LayoutItem, activeDeviceType: keyof Layouts) => {
    if (!layouts) return;
    
    // Create a copy of the current layouts
    const currentLayouts = { ...layouts };
    
    // Ensure all layout arrays exist
    if (!currentLayouts.desktop) currentLayouts.desktop = [];
    if (!currentLayouts.tablet) currentLayouts.tablet = [];
    if (!currentLayouts.mobile) currentLayouts.mobile = [];
    
    // Create a layout item with moduleUniqueId for better compatibility
    const layoutItem = {
      ...item,
      moduleUniqueId: item.i, // Add moduleUniqueId for compatibility with LayoutItem
    };
    
    // Helper function to remove any existing items with the same ID
    const removeExistingItems = (layouts: any[], itemId: string) => {
      return layouts.filter(existingItem => {
        const existingId = 'i' in existingItem ? existingItem.i : existingItem.moduleUniqueId;
        return existingId !== itemId;
      });
    };
    
    // Helper function to safely calculate max y position
    const safeCalculateMaxY = (layouts: any[]) => {
      if (layouts.length === 0) return 0;
      
      // Filter out items without valid y and h properties
      const validItems = layouts.filter(i =>
        i && typeof i.y === 'number' && typeof i.h === 'number' &&
        typeof i.x === 'number' && typeof i.w === 'number'
      );
      
      if (validItems.length === 0) return 0;
      return Math.max(...validItems.map(i => i.y + i.h));
    };
    
    // Add the item to all layouts
    // Ensure all required properties are set with valid values
    const ensureValidLayoutItem = (baseItem: any, deviceType: keyof Layouts) => {
      const result = { ...baseItem };
      
      // Ensure x is a valid number
      result.x = activeDeviceType === deviceType ?
        (typeof item.x === 'number' ? item.x : 0) : 0;
      
      // Ensure y is a valid number
      result.y = activeDeviceType === deviceType ?
        (typeof item.y === 'number' ? item.y : 0) :
        safeCalculateMaxY(currentLayouts[deviceType] || []);
      
      // Ensure w is a valid number and fits the device
      if (deviceType === 'mobile') {
        result.w = Math.min(typeof item.w === 'number' ? item.w : 2, 4);
      } else if (deviceType === 'tablet') {
        result.w = Math.min(typeof item.w === 'number' ? item.w : 4, 8);
      } else {
        result.w = typeof item.w === 'number' ? item.w : 3;
      }
      
      // Ensure h is a valid number
      result.h = typeof item.h === 'number' ? item.h : 2;
      
      return result;
    };
    
    // Remove any existing items with the same ID before adding the new one
    const desktopWithoutDuplicates = removeExistingItems(currentLayouts.desktop, item.i);
    const tabletWithoutDuplicates = removeExistingItems(currentLayouts.tablet, item.i);
    const mobileWithoutDuplicates = removeExistingItems(currentLayouts.mobile, item.i);
    
    const updatedLayouts = {
      desktop: [...desktopWithoutDuplicates, ensureValidLayoutItem(layoutItem, 'desktop')],
      tablet: [...tabletWithoutDuplicates, ensureValidLayoutItem(layoutItem, 'tablet')],
      mobile: [...mobileWithoutDuplicates, ensureValidLayoutItem(layoutItem, 'mobile')]
    };
    
    console.log('Updated layouts after adding item:', updatedLayouts);
    
    // Update the layouts state
    setLayouts(updatedLayouts);
    
    // If initialPage is provided, update the page's modules and layouts
    if (initialPage) {
      // Check if the item is a GridItem (has args property)
      const isGridItem = 'pluginId' in item && 'args' in item;
      
      // Use the usePlugins hook to get module information
      // We can't directly import it here since this is inside a callback
      // Instead, we'll need to pass it as a dependency to the useCallback
      
      // Get the module ID and plugin ID
      const moduleId = isGridItem ? (item as GridItem).args?.moduleId || '' : '';
      const pluginId = isGridItem ? (item as GridItem).pluginId : '';
      
      // Get the full module definition from the plugin registry if getModuleById is available
      const moduleDef = getModuleById ? getModuleById(pluginId, moduleId) : null;
      
      // Create a module entry for the page's modules with complete configuration
      const moduleEntry = {
        pluginId: pluginId,
        moduleId: moduleId,
        moduleName: moduleDef?.name || moduleId,
        config: {}
      };
      
      // Add configuration from the module definition
      if (moduleDef) {
        // Add config fields from the module definition
        if (moduleDef.configFields) {
          // Extract default values from configFields
          const defaultConfig: Record<string, any> = {};
          Object.entries(moduleDef.configFields).forEach(([key, field]) => {
            // Add type assertion for field
            const configField = field as Record<string, any>;
            if ('default' in configField) {
              defaultConfig[key] = configField.default;
            }
          });
          moduleEntry.config = { ...defaultConfig };
        }
        // Also check for props if configFields is not available
        else if (moduleDef.props) {
          const defaultConfig: Record<string, any> = {};
          Object.entries(moduleDef.props).forEach(([key, prop]) => {
            const propField = prop as Record<string, any>;
            if ('default' in propField) {
              defaultConfig[key] = propField.default;
            }
          });
          moduleEntry.config = { ...defaultConfig };
        }
        
        // Add any args from the item
        if (isGridItem && (item as GridItem).args) {
          moduleEntry.config = { ...moduleEntry.config, ...(item as GridItem).args };
        }
        
        // Add layoutConfig if available in the module definition
        if (moduleDef.layoutConfig) {
          (moduleEntry as any).layoutConfig = JSON.parse(JSON.stringify(moduleDef.layoutConfig));
        }
      } else {
        // Fallback to just using the args if module definition not found
        moduleEntry.config = isGridItem ? (item as GridItem).args || {} : {};
      }
      
      console.log('Adding module to page with complete config:', moduleEntry);
      
      // Update the initialPage's modules (this won't persist until savePage is called)
      // Create a consistent module ID format - replace underscore with nothing between pluginId and moduleId
      const moduleKey = item.i.replace(/_/g, '');
      
      console.log('Adding module with key:', moduleKey, 'original item.i:', item.i);
      
      if (initialPage.modules) {
        initialPage.modules[moduleKey] = moduleEntry;
      } else {
        initialPage.modules = { [moduleKey]: moduleEntry };
      }
      
      // Create a layout item with moduleUniqueId
      const layoutItem = {
        moduleUniqueId: item.i,
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: 'minW' in item ? item.minW : undefined,
        minH: 'minH' in item ? item.minH : undefined
      };
      
      // Update the initialPage's layouts
      if (!initialPage.layouts) {
        initialPage.layouts = { desktop: [], tablet: [], mobile: [] };
      }
      
      // Ensure all layout arrays exist
      if (!initialPage.layouts.desktop) initialPage.layouts.desktop = [];
      if (!initialPage.layouts.tablet) initialPage.layouts.tablet = [];
      if (!initialPage.layouts.mobile) initialPage.layouts.mobile = [];
      
      // Remove any existing items with the same ID before adding the new one
      initialPage.layouts.desktop = removeExistingItems(initialPage.layouts.desktop, item.i);
      initialPage.layouts.tablet = removeExistingItems(initialPage.layouts.tablet, item.i);
      initialPage.layouts.mobile = removeExistingItems(initialPage.layouts.mobile, item.i);
      
      // Add the item to all layouts in initialPage.layouts
      initialPage.layouts.desktop.push(ensureValidLayoutItem(layoutItem, 'desktop'));
      initialPage.layouts.tablet.push(ensureValidLayoutItem(layoutItem, 'tablet'));
      initialPage.layouts.mobile.push(ensureValidLayoutItem(layoutItem, 'mobile'));
      
      // Update the initialPage's content.layouts as well
      if (initialPage.content) {
        if (!initialPage.content.layouts) {
          initialPage.content.layouts = { desktop: [], tablet: [], mobile: [] };
        }
        
        // Add the item to all content layouts
        if (!initialPage.content.layouts.desktop) initialPage.content.layouts.desktop = [];
        if (!initialPage.content.layouts.tablet) initialPage.content.layouts.tablet = [];
        if (!initialPage.content.layouts.mobile) initialPage.content.layouts.mobile = [];
        
        // Remove any existing items with the same ID before adding the new one
        initialPage.content.layouts.desktop = removeExistingItems(initialPage.content.layouts.desktop, item.i);
        initialPage.content.layouts.tablet = removeExistingItems(initialPage.content.layouts.tablet, item.i);
        initialPage.content.layouts.mobile = removeExistingItems(initialPage.content.layouts.mobile, item.i);
        
        initialPage.content.layouts.desktop.push(ensureValidLayoutItem(layoutItem, 'desktop'));
        initialPage.content.layouts.tablet.push(ensureValidLayoutItem(layoutItem, 'tablet'));
        initialPage.content.layouts.mobile.push(ensureValidLayoutItem(layoutItem, 'mobile'));
      }
      
      // Log the updated modules and layouts
      console.log('Updated page modules:', initialPage.modules);
      console.log('Updated page layouts:', initialPage.layouts);
      console.log('Updated page content.layouts:', initialPage.content?.layouts);
    }
  }, [layouts, initialPage, getModuleById]);
  
  /**
   * Update an item in all layouts
   * @param id The ID of the item to update
   * @param updates The updates to apply to the item
   */
  const updateItem = useCallback((id: string, updates: Partial<GridItem | LayoutItem>) => {
    if (!layouts) return;
    
    // Helper function to validate a layout item
    const validateItem = (item: any) => {
      if (!item) return null;
      
      // Ensure all required properties exist and are valid numbers
      return {
        ...item,
        x: typeof item.x === 'number' ? item.x : 0,
        y: typeof item.y === 'number' ? item.y : 0,
        w: typeof item.w === 'number' ? item.w : 2,
        h: typeof item.h === 'number' ? item.h : 2,
        i: item.i || item.moduleUniqueId || `item_${Date.now()}`
      };
    };
    
    const updatedLayouts = Object.entries(layouts).reduce<Layouts>((acc, [deviceType, layout]) => {
      if (deviceType === 'desktop' || deviceType === 'tablet' || deviceType === 'mobile') {
        acc[deviceType as keyof Layouts] = layout.map((item: GridItem | LayoutItem) => {
          const itemId = 'i' in item ? item.i : (item as LayoutItem).moduleUniqueId;
          if (itemId === id) {
            // Apply updates and validate the result
            return validateItem({ ...item, ...updates });
          }
          // Validate existing items as well
          return validateItem(item);
        }).filter(Boolean) as (GridItem | LayoutItem)[];
      }
      return acc;
    }, { desktop: [], tablet: [], mobile: [] });
    
    setLayouts(updatedLayouts);
  }, [layouts]);
  
  return {
    layouts,
    setLayouts,
    handleLayoutChange,
    removeItem,
    copyLayout,
    addItem,
    updateItem
  };
};