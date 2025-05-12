import React from 'react';
import { Paper, Box } from '@mui/material';
import { GridItem as GridItemType } from '../../types';
import { PluginModuleRenderer } from './PluginModuleRenderer';
import { GridItemControls } from './GridItemControls';
import { usePluginStudio } from '../../hooks';
import { ModuleDefinition } from '../../types/plugin.types';
import { normalizeObjectKeys } from '../../../../utils/caseConversion';

interface GridItemProps {
  item: GridItemType;
  isSelected: boolean;
  onSelect: () => void;
  previewMode: boolean;
  isNew?: boolean;
}

/**
 * Component that represents a single module in the grid
 * @param props The component props
 * @returns The grid item component
 */
export const GridItem: React.FC<GridItemProps> = ({
  item,
  isSelected,
  onSelect,
  previewMode,
  isNew = false
}) => {
  const [animating, setAnimating] = React.useState(isNew);
  
  // Handle animation when isNew changes
  React.useEffect(() => {
    if (isNew) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setAnimating(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isNew]);
  const { removeItem, setConfigDialogOpen, currentPage, viewMode } = usePluginStudio();
  
  // Get module information from the current page
  const moduleInfo = React.useMemo(() => {
    if (!currentPage || !item || !item.i) return null;
    
    // Try to find the module in the page's modules object
    // First check if the item has a moduleUniqueId (LayoutItem) or if it's the item.i (GridItem)
    const moduleId = 'moduleUniqueId' in item ? item.moduleUniqueId : item.i;
    
    // CRITICAL DEBUG: Log when moduleInfo is recalculated
    // console.log(`GridItem - moduleInfo recalculation triggered for ${moduleId}`);
    // console.log(`GridItem - currentPage reference:`, Object.prototype.toString.call(currentPage));
    // console.log(`GridItem - currentPage._lastUpdated:`, (currentPage as any)._lastUpdated);
    
    // console.log(`GridItem - moduleInfo recalculation triggered for ${moduleId}`);
    // console.log(`GridItem - currentPage reference:`, Object.prototype.toString.call(currentPage));
    
    // Check if the page has a _lastUpdated timestamp
    if ((currentPage as any)._lastUpdated) {
      // console.log(`GridItem - currentPage has _lastUpdated timestamp:`, (currentPage as any)._lastUpdated);
    }
    
    // console.log(`GridItem - moduleInfo recalculation triggered for ${moduleId}`);
    // console.log(`GridItem - currentPage reference:`, currentPage);
    
    // console.log(`GridItem - Looking for module ${moduleId} in currentPage.modules:`, currentPage.modules);
    
    // Try to find the module in the page's modules object
    // First try with the exact moduleId
    let moduleData = currentPage.modules ? currentPage.modules[moduleId as string] : undefined;
    
    // If not found, try with different formats of the moduleId
    if (!moduleData && typeof moduleId === 'string') {
      // Try with camelCase version (pluginAModel-selection-v2_1745425172863)
      const camelCaseId = moduleId.replace(/[_-](\w)/g, (_: string, c: string) => c.toUpperCase());
      moduleData = currentPage.modules ? currentPage.modules[camelCaseId] : undefined;
      
      if (moduleData) {
        // console.log(`GridItem - Found module with camelCase ID ${camelCaseId} in currentPage.modules:`, moduleData);
      }
      
      // Try with underscore removed (pluginA_ai-prompt-chat-v2_1745434553977 -> pluginAai-prompt-chat-v2_1745434553977)
      if (!moduleData) {
        const noUnderscoreId = moduleId.replace(/_/g, '');
        moduleData = currentPage.modules ? currentPage.modules[noUnderscoreId] : undefined;
        
        if (moduleData) {
          // console.log(`GridItem - Found module with no underscore ID ${noUnderscoreId} in currentPage.modules:`, moduleData);
        }
      }
    }
    
    // If still not found, try with different separators
    if (!moduleData && typeof moduleId === 'string') {
      // Try all possible module IDs in the modules object
      const possibleModuleIds = Object.keys(currentPage.modules || {});
      
      // Find a module ID that might match by comparing parts
      const moduleIdParts = moduleId.split(/[_-]/);
      const matchingId = possibleModuleIds.find(id => {
        const idParts = id.split(/[_-]/);
        // Check if the important parts match (plugin ID and module ID)
        return idParts.length >= 2 &&
               (idParts[0].toLowerCase() === moduleIdParts[0].toLowerCase() ||
                idParts[0].replace(/[A-Z]/g, (m: string) => `-${m.toLowerCase()}`).toLowerCase() === moduleIdParts[0].toLowerCase()) &&
               idParts[1].toLowerCase() === moduleIdParts[1].toLowerCase();
      });
      
      if (matchingId) {
        moduleData = currentPage.modules ? currentPage.modules[matchingId] : undefined;
        // console.log(`GridItem - Found module with similar ID ${matchingId} in currentPage.modules:`, moduleData);
      }
    }
    
    if (moduleData) {
      // console.log(`GridItem - Found module ${moduleId} in currentPage.modules:`, moduleData);
      // console.log(`GridItem - Module config:`, moduleData.config);
      // console.log(`GridItem - Module layoutConfig:`, (moduleData as any).layoutConfig);
      return moduleData;
    }
    
    // If not found, try to extract information from the item itself
    // console.log(`GridItem - Module ${moduleId} not found in currentPage.modules, using item.args:`, item.args);
    
    return {
      pluginId: item.pluginId,
      moduleId: item.args?.moduleId || item.i.split('_')[1] || '',
      moduleName: '',
      config: item.args || {}
    } as ModuleDefinition;
  }, [currentPage, item]);
  
  // Get layout-specific config overrides
  const layoutConfigOverrides = React.useMemo(() => {
    if (!currentPage || !item || !item.i) return {};
    
    const deviceType = viewMode?.type || 'desktop';
    // console.log(`GridItem - layoutConfigOverrides recalculation triggered for ${item.i}`);
    // console.log(`GridItem - Getting layout config overrides for device type: ${deviceType}`);
    // console.log(`GridItem - currentPage reference in layoutConfigOverrides:`, currentPage);
    // console.log(`GridItem - currentPage._lastUpdated:`, (currentPage as any)._lastUpdated);
    
    // First priority: Check if this is a layout item with configOverrides
    if ('configOverrides' in item && item.configOverrides) {
      // console.log(`GridItem - Found configOverrides in layout item:`, item.configOverrides);
      return JSON.parse(JSON.stringify(item.configOverrides)); // Create a new reference
    }
    
    // Second priority: Check if there are layout-specific overrides in the current layout
    if (currentPage.layouts && typeof deviceType === 'string' &&
        (deviceType === 'desktop' || deviceType === 'tablet' || deviceType === 'mobile')) {
      const layoutItems = currentPage.layouts[deviceType as 'desktop' | 'tablet' | 'mobile'];
      // console.log(`GridItem - Checking layout items for device type ${deviceType}:`, layoutItems);
      
      const layoutItem = layoutItems?.find((li: any) =>
        li.i === item.i || li.moduleUniqueId === item.i
      );
      
      if (layoutItem && 'configOverrides' in layoutItem && layoutItem.configOverrides) {
        // console.log(`GridItem - Found configOverrides in current layout:`, layoutItem.configOverrides);
        return JSON.parse(JSON.stringify(layoutItem.configOverrides)); // Create a new reference
      }
    }
    
    // Third priority: Check if the module has layoutConfig for the current device type
    if (moduleInfo && (moduleInfo as any).layoutConfig && typeof deviceType === 'string' &&
        (deviceType === 'desktop' || deviceType === 'tablet' || deviceType === 'mobile') &&
        (moduleInfo as any).layoutConfig[deviceType]) {
      // console.log(`GridItem - Found layoutConfig in module:`, (moduleInfo as any).layoutConfig[deviceType]);
      return JSON.parse(JSON.stringify((moduleInfo as any).layoutConfig[deviceType])); // Create a new reference
    }
    
    // console.log(`GridItem - No layout config overrides found for ${item.i}`);
    return {};
  }, [currentPage, item, moduleInfo, viewMode, (currentPage as any)?._lastUpdated]); // Add _lastUpdated to dependencies
  
  // Log the config when moduleInfo changes
  React.useEffect(() => {
    if (moduleInfo) {
      const config = moduleInfo?.config || item.args || {};
      // console.log(`GridItem - Module ${moduleInfo?.moduleId || item.args?.moduleId || item.i.split('_')[1] || ''} (${item.i}) config (before normalization):`, config);
      
      // Check if there are any snake_case properties
      const hasSnakeCaseProps = Object.keys(config).some(key => key.includes('_'));
      if (hasSnakeCaseProps) {
        console.warn(`GridItem - Module ${item.i} has snake_case properties in config:`,
          Object.keys(config).filter(key => key.includes('_')));
      }
    }
  }, [moduleInfo, item]);
  
  // Log the layout config overrides when they change
  React.useEffect(() => {
    if (Object.keys(layoutConfigOverrides).length > 0) {
      // console.log(`GridItem - Layout config overrides for ${item.i}:`, layoutConfigOverrides);
      
      // Check for important properties like label and labelPosition
      if ('label' in layoutConfigOverrides) {
        // console.log(`GridItem - Layout config override for label: ${layoutConfigOverrides.label}`);
      }
      if ('labelPosition' in layoutConfigOverrides) {
        // console.log(`GridItem - Layout config override for labelPosition: ${layoutConfigOverrides.labelPosition}`);
      }
    }
  }, [layoutConfigOverrides, item]);
  
  /**
   * Handle click on the grid item
   * @param e The click event
   */
  const handleClick = (e: React.MouseEvent) => {
    // Prevent click from propagating to parent elements
    e.stopPropagation();
    onSelect();
  };
  
  /**
   * Handle configuration
   */
  const handleConfig = () => {
    setConfigDialogOpen(true);
  };
  
  /**
   * Handle removal
   */
  const handleRemove = () => {
    removeItem(item.i);
  };
  
  return (
    <Paper
      elevation={isSelected ? 3 : 1}
      onClick={handleClick}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: isSelected ? '2px solid' : '1px solid',
        borderColor: isSelected ? 'primary.main' : 'divider',
        position: 'relative',
        transition: 'all 0.2s',
        animation: animating ? 'fadeIn 0.5s ease-out' : 'none',
        '@keyframes fadeIn': {
          '0%': {
            opacity: 0,
            transform: 'scale(0.9)'
          },
          '100%': {
            opacity: 1,
            transform: 'scale(1)'
          }
        },
        '&:hover': {
          borderColor: previewMode ? 'divider' : 'primary.light'
        }
      }}
    >
      {!previewMode && (
        <GridItemControls
          isSelected={isSelected}
          onConfig={handleConfig}
          onRemove={handleRemove}
        />
      )}
      <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
        {/* Log debugging information */}
        {(() => {
          // Log all the information
          // console.log(`GridItem - Rendering PluginModuleRenderer for ${item.i}`);
          // console.log(`GridItem - moduleInfo:`, moduleInfo);
          // console.log(`GridItem - moduleInfo reference:`, Object.prototype.toString.call(moduleInfo));
          // console.log(`GridItem - Passing config:`, moduleInfo?.config);
          // console.log(`GridItem - Config reference:`, Object.prototype.toString.call(moduleInfo?.config));
          // console.log(`GridItem - Passing layoutConfig:`, layoutConfigOverrides);
          // console.log(`GridItem - LayoutConfig reference:`, Object.prototype.toString.call(layoutConfigOverrides));
          if (currentPage) {
            // console.log(`GridItem - currentPage._lastUpdated:`, (currentPage as any)._lastUpdated);
          }
          return null; // Return null to avoid rendering anything
        })()}
        
        {/* Generate a more reliable key that will change when configs change */}
        {(() => {
          const configString = JSON.stringify(moduleInfo?.config || {});
          const layoutConfigString = JSON.stringify(layoutConfigOverrides || {});
          
          // Create a hash of the config instead of using Date.now()
          const configHash = configString.split('').reduce((hash, char) => {
            return ((hash << 5) - hash) + char.charCodeAt(0) | 0;
          }, 0);
          
          const layoutConfigHash = layoutConfigString.split('').reduce((hash, char) => {
            return ((hash << 5) - hash) + char.charCodeAt(0) | 0;
          }, 0);
          
          // Only include _lastUpdated if it exists, otherwise use a stable hash
          const timestampPart = currentPage && (currentPage as any)._lastUpdated ? `-${(currentPage as any)._lastUpdated}` : '';
          const componentKey = `${item.i}${timestampPart}-${configHash}-${layoutConfigHash}`;
          
          // console.log(`GridItem - Generated component key:`, componentKey);
          
          // Memoize the normalized configs to prevent unnecessary re-renders
          const normalizedConfig = React.useMemo(() =>
            normalizeObjectKeys(moduleInfo?.config || item.args || {}),
            [moduleInfo?.config, item.args]
          );
          
          const normalizedLayoutConfig = React.useMemo(() =>
            normalizeObjectKeys(layoutConfigOverrides),
            [layoutConfigOverrides]
          );
          
          return (
            <PluginModuleRenderer
              pluginId={moduleInfo?.pluginId || item.pluginId}
              moduleId={moduleInfo?.moduleId || item.args?.moduleId || item.i.split('_')[1] || ''}
              uniqueId={item.i}
              config={normalizedConfig}
              layoutConfig={normalizedLayoutConfig}
              key={componentKey}
              currentDeviceType={viewMode?.type || 'desktop'}
            />
          );
        })()}
      </Box>
    </Paper>
  );
};