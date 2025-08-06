import React, { useRef, useEffect, useState } from 'react';
import { Box, Button, Snackbar, Alert } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { GridToolbar } from '../grid-toolbar';
import { GridContainer } from './GridContainer';
import { DropZone } from './DropZone';
import { usePluginStudio, useViewMode } from '../../hooks';

/**
 * Component that renders the grid layout where plugins are placed
 * @returns The plugin canvas component
 */
export const PluginCanvas: React.FC = () => {
  const { layouts, handleLayoutChange, handleResizeStart, handleResizeStop, currentPage, savePage } = usePluginStudio();
  const { viewMode, viewWidth, setContainerWidth } = useViewMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [key, setKey] = useState(0); // Add a key to force re-render
  const [newItemId, setNewItemId] = useState<string | null>(null);
  
  // Log layouts whenever they change
  useEffect(() => {
    //console.log('PluginCanvas received layouts:', layouts);
    if (layouts) {
    //  console.log('Desktop layouts:', layouts.desktop);
    //  console.log('Tablet layouts:', layouts.tablet);
    //  console.log('Mobile layouts:', layouts.mobile);
      
      // Force a re-render when layouts change
      setKey(prevKey => prevKey + 1);
    }
  }, [layouts]);
  
  // Handle save button click
  const handleSave = async () => {
    if (!currentPage) return;
    
    try {
      await savePage(currentPage.id);
      setSaveSuccess(true);
    } catch (error) {
      console.error('Error saving page:', error);
      setSaveError(true);
    }
  };
  
  // Update container width when it changes
  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
        const { width } = entries[0].contentRect;
        setContainerWidth(width);
      });
      
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [setContainerWidth]);
  
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <GridToolbar onSave={handleSave} />
      
      <Box
        ref={containerRef}
        sx={{ p: 3, flex: 1, overflow: 'auto' }}
      >
        <DropZone onNewItem={setNewItemId}>
          <GridContainer
            key={key} // Add key to force re-render
            layouts={layouts}
            onLayoutChange={handleLayoutChange}
            onResizeStart={handleResizeStart}
            onResizeStop={handleResizeStop}
            viewMode={viewMode}
            viewWidth={viewWidth}
            newItemId={newItemId}
          />
        </DropZone>
      </Box>
      
      {/* Success Snackbar */}
      <Snackbar
        open={saveSuccess}
        autoHideDuration={3000}
        onClose={() => setSaveSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setSaveSuccess(false)} severity="success">
          Page saved successfully!
        </Alert>
      </Snackbar>
      
      {/* Error Snackbar */}
      <Snackbar
        open={saveError}
        autoHideDuration={3000}
        onClose={() => setSaveError(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setSaveError(false)} severity="error">
          Failed to save page. Please try again.
        </Alert>
      </Snackbar>
    </Box>
  );
};