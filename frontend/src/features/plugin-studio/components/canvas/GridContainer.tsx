import React from 'react';
import { Responsive, WidthProvider, Layout, Layouts as ReactGridLayouts } from 'react-grid-layout';
import { Box, Paper } from '@mui/material';
import { Layouts, ViewModeState, GridItem as GridItemType, LayoutItem } from '../../types';
import { VIEW_MODE_LAYOUTS, VIEW_MODE_COLS } from '../../constants';
import { GridItem } from './GridItem';
import { usePluginStudio } from '../../hooks';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface GridContainerProps {
  layouts: Layouts | null;
  onLayoutChange: (layout: Layout[], newLayouts: Layouts) => void;
  viewMode: ViewModeState;
  viewWidth: number;
  newItemId?: string | null;
}

/**
 * Component that renders the responsive grid layout
 * @param props The component props
 * @returns The grid container component
 */
export const GridContainer: React.FC<GridContainerProps> = ({
  layouts,
  onLayoutChange,
  viewMode,
  viewWidth,
  newItemId = null
}) => {
  const { selectedItem, setSelectedItem, previewMode } = usePluginStudio();
  
  /**
   * Handle item selection
   * @param itemId The ID of the item to select
   */
  const handleItemSelect = (itemId: string) => {
    setSelectedItem({ i: itemId });
  };
  
  // If no layouts, show empty state
  if (!layouts) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 4,
          border: '2px dashed rgba(0, 0, 0, 0.1)',
          borderRadius: 2,
          minHeight: 400,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
          Drag and drop modules from the toolbar to add them to the canvas
        </Box>
      </Paper>
    );
  }
  
  // Get the current layout based on view mode
  const currentViewType = viewMode.type === 'custom' ? 'desktop' : viewMode.type;
  const currentLayout = layouts?.[currentViewType] || [];
  
  // Get the current view mode config
  const currentViewModeConfig = VIEW_MODE_LAYOUTS[viewMode.type];
  
  // Convert our Layouts type to ReactGridLayout.Layouts type
  const convertedLayouts: ReactGridLayouts = layouts ? {
    desktop: layouts.desktop || [],
    tablet: layouts.tablet || [],
    mobile: layouts.mobile || []
  } : { desktop: [], tablet: [], mobile: [] };
  
  // Handle layout change from react-grid-layout
  const handleLayoutChange = (currentLayout: Layout[], allLayouts: ReactGridLayouts) => {
    // Convert back to our Layouts type, preserving the original GridItem properties
    const convertLayoutArray = (layouts: Layout[] | undefined, currentLayouts: (GridItemType | LayoutItem)[] | undefined): (GridItemType | LayoutItem)[] => {
      if (!layouts) return [];
      
      return layouts.map(layout => {
        // Find the original item to preserve its properties
        const originalItem = currentLayouts?.find(item => item.i === layout.i);
        
        if (originalItem) {
          // Preserve all properties but update position and size
          return {
            ...originalItem,
            x: layout.x,
            y: layout.y,
            w: layout.w,
            h: layout.h
          };
        } else {
          // If original item not found, create a basic LayoutItem
          return {
            moduleUniqueId: layout.i,
            i: layout.i,
            x: layout.x,
            y: layout.y,
            w: layout.w,
            h: layout.h
          } as LayoutItem;
        }
      });
    };
    
    const ourLayouts: Layouts = {
      desktop: convertLayoutArray(allLayouts.desktop, layouts?.desktop),
      tablet: convertLayoutArray(allLayouts.tablet, layouts?.tablet),
      mobile: convertLayoutArray(allLayouts.mobile, layouts?.mobile)
    };
    
    onLayoutChange(currentLayout, ourLayouts);
  };
  
  return (
    <Box
      sx={{
        border: '2px dashed rgba(0, 0, 0, 0.1)',
        borderRadius: 2,
        minHeight: 400,
        width: viewWidth,
        mx: 'auto'
      }}
    >
      <ResponsiveGridLayout
        className="layout"
        layouts={convertedLayouts}
        breakpoints={{
          desktop: VIEW_MODE_LAYOUTS.desktop.cols,
          tablet: VIEW_MODE_LAYOUTS.tablet.cols,
          mobile: VIEW_MODE_LAYOUTS.mobile.cols
        }}
        cols={{
          desktop: VIEW_MODE_COLS.desktop,
          tablet: VIEW_MODE_COLS.tablet,
          mobile: VIEW_MODE_COLS.mobile
        }}
        rowHeight={currentViewModeConfig.rowHeight}
        margin={currentViewModeConfig.margin}
        containerPadding={currentViewModeConfig.padding}
        onLayoutChange={handleLayoutChange}
        isDraggable={!previewMode}
        isResizable={!previewMode}
        compactType="vertical"
        useCSSTransforms={true}
        draggableHandle=".react-grid-dragHandleExample"
      >
        {currentLayout
          .filter(item => item && item.i && typeof item.y === 'number' && typeof item.x === 'number' &&
                  typeof item.w === 'number' && typeof item.h === 'number') // Filter out invalid items and ensure all required properties exist
          .map(item => {
            // Ensure item has pluginId (required by GridItem)
            const gridItem = 'pluginId' in item ?
              item as GridItemType :
              { ...item, pluginId: '' } as GridItemType;
              
            return (
              <div key={item.i}>
                <GridItem
                  item={gridItem}
                  isSelected={selectedItem?.i === item.i}
                  onSelect={() => handleItemSelect(item.i)}
                  previewMode={previewMode}
                  isNew={item.i === newItemId}
                />
              </div>
            );
          })}
      </ResponsiveGridLayout>
    </Box>
  );
};