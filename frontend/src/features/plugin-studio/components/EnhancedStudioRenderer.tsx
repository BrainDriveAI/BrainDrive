import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box } from '@mui/material';
import { UnifiedPageRenderer } from '../../unified-dynamic-page-renderer/components/UnifiedPageRenderer';
import { StudioModeController } from '../../unified-dynamic-page-renderer/components/StudioModeController';
import { RenderMode, PageData, ResponsiveLayouts } from '../../unified-dynamic-page-renderer/types';
import { PluginStudioAdapter } from '../../unified-dynamic-page-renderer/utils/PluginStudioAdapter';
import { useEnhancedStudioState } from '../hooks/useEnhancedStudioState';
import { EnhancedLayoutEngine } from './EnhancedLayoutEngine';
// Studio components will be imported once created

export interface EnhancedStudioRendererProps {
  pageData: PageData;
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  onPageLoad: (page: PageData) => void;
  onError: (error: Error) => void;
  
  // Studio-specific handlers
  onLayoutChange?: (layouts: ResponsiveLayouts) => void;
  onModuleAdd?: (moduleConfig: any) => void;
  onModuleRemove?: (moduleId: string) => void;
  onModuleConfig?: (moduleId: string, config: any) => void;
  onSave?: () => Promise<void>;
  onPageChange?: (pageId: string) => void;
}

/**
 * Enhanced Studio Renderer
 * 
 * This component wraps the UnifiedPageRenderer with studio-specific functionality
 * to provide the rich WYSIWYG experience that Plugin Studio users expect.
 * 
 * Features preserved and enhanced:
 * - Advanced drag-and-drop with visual feedback
 * - Real-time layout editing with react-grid-layout
 * - Selection states with animations
 * - Context-aware controls and tooltips
 * - Auto-save functionality
 * - Preview mode toggle
 * - Responsive layout management
 * 
 * This follows the migration strategy from MIGRATION_PLAN_FINAL.md by:
 * - Leveraging existing LegacyPluginAdapter.ts
 * - Using proven service bridge patterns
 * - Preserving all WYSIWYG functionality
 * - Adding container query support
 */
export const EnhancedStudioRenderer: React.FC<EnhancedStudioRendererProps> = ({
  pageData,
  mode,
  onModeChange,
  onPageLoad,
  onError,
  onLayoutChange,
  onModuleAdd,
  onModuleRemove,
  onModuleConfig,
  onSave,
  onPageChange,
}) => {
  // Use enhanced state management hook
  const [studioState, studioActions] = useEnhancedStudioState(
    pageData.id,
    'PluginStudio',
    'EnhancedRenderer'
  );

  // Enhanced layout change handler using state management
  const handleLayoutChange = useCallback(async (layouts: ResponsiveLayouts) => {
    console.log('[EnhancedStudioRenderer] Layout changed:', layouts);
    
    // Update state through enhanced state management
    await studioActions.updateLayouts(layouts);
    
    // Call the parent handler
    onLayoutChange?.(layouts);
  }, [onLayoutChange, studioActions]);

  // Enhanced module addition using state management
  const handleModuleAdd = useCallback(async (moduleConfig: any) => {
    console.log('[EnhancedStudioRenderer] Module added:', moduleConfig);
    
    // Calculate position from drop event (would be passed from drop zone)
    const position = { x: 0, y: 0 }; // Default position, should be calculated from actual drop
    
    // Add module through state management
    const moduleId = await studioActions.addModule(moduleConfig, position);
    
    // Temporarily select the new module for visual feedback
    studioActions.selectModules([moduleId]);
    
    // Call the parent handler
    onModuleAdd?.(moduleConfig);
    
    // Clear selection after animation
    setTimeout(() => {
      studioActions.clearSelection();
    }, 1000);
  }, [onModuleAdd, studioActions]);

  // Enhanced module removal using state management
  const handleModuleRemove = useCallback(async (moduleId: string) => {
    console.log('[EnhancedStudioRenderer] Module removed:', moduleId);
    
    // Remove module through state management
    await studioActions.removeModule(moduleId);
    
    // Call the parent handler
    onModuleRemove?.(moduleId);
  }, [onModuleRemove, studioActions]);

  // Enhanced module configuration using state management
  const handleModuleConfig = useCallback((moduleId: string, config: any) => {
    console.log('[EnhancedStudioRenderer] Module configured:', moduleId, config);
    
    // Select the module being configured
    studioActions.selectModules([moduleId]);
    
    // Call the parent handler
    onModuleConfig?.(moduleId, config);
  }, [onModuleConfig, studioActions]);

  // Module selection handler
  const handleModuleSelect = useCallback((moduleId: string, addToSelection = false) => {
    studioActions.selectModules([moduleId], addToSelection);
  }, [studioActions]);

  // Clear selection handler
  const handleClearSelection = useCallback(() => {
    studioActions.clearSelection();
  }, [studioActions]);

  // Studio configuration
  const studioConfig = useMemo(() => ({
    features: {
      // Core editing capabilities
      dragAndDrop: true,
      resize: true,
      configure: true,
      delete: true,
      
      // UI elements
      toolbar: true,
      contextMenu: true,
      propertyPanel: false, // We'll use dialogs instead
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
      
      // Performance
      autoSave: true,
      previewMode: true
    },
    grid: {
      snapToGrid: true,
      gridSize: 10,
      showGrid: false,
      alignmentGuides: true,
      collisionDetection: true,
      autoArrange: false
    }
  }), []);

  // Studio event handler
  const handleStudioEvent = useCallback((event: any) => {
    console.log('[EnhancedStudioRenderer] Studio event:', event);
    
    switch (event.type) {
      case 'module-select':
        handleModuleSelect(event.data.moduleId, event.data.addToSelection);
        break;
      case 'module-configure':
        handleModuleConfig(event.data.moduleId, event.data.config);
        break;
      case 'module-remove':
        handleModuleRemove(event.data.moduleId);
        break;
      case 'clear-selection':
        handleClearSelection();
        break;
    }
  }, [handleModuleSelect, handleModuleConfig, handleModuleRemove, handleClearSelection]);

  return (
    <Box sx={{ height: '100%', position: 'relative' }}>
      {/* Auto-save indicator */}
      {studioState.isAutoSaving && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 1000,
            bgcolor: 'info.main',
            color: 'info.contrastText',
            px: 2,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          <Box
            sx={{
              width: 16,
              height: 16,
              border: '2px solid currentColor',
              borderTop: '2px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              '@keyframes spin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' }
              }
            }}
          />
          Saving...
        </Box>
      )}

      {/* Last saved indicator */}
      {studioState.lastSaved && !studioState.isAutoSaving && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 1000,
            bgcolor: 'success.main',
            color: 'success.contrastText',
            px: 2,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.875rem',
            opacity: 0.8
          }}
        >
          Saved {studioState.lastSaved.toLocaleTimeString()}
        </Box>
      )}

      {/* Studio Mode Controller wraps the unified renderer */}
      <StudioModeController
        mode={mode}
        onModeChange={onModeChange}
        pageData={pageData}
        breakpoint={{
          name: 'desktop',
          width: 1200,
          height: 800,
          orientation: 'landscape',
          pixelRatio: 1
        }}
        studioConfig={studioConfig}
        onStudioEvent={handleStudioEvent}
      >
        {/* Enhanced drop zone wrapper for drag-and-drop functionality */}
        <Box
          sx={{
            height: '100%',
            position: 'relative',
            // Enhanced drop zone styling
            '&.drag-over': {
              backgroundColor: 'rgba(25, 118, 210, 0.1)',
              border: '2px dashed rgba(25, 118, 210, 0.5)',
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('drag-over');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            
            try {
              const moduleData = JSON.parse(e.dataTransfer.getData('module') || e.dataTransfer.getData('text/plain'));
              handleModuleAdd(moduleData);
            } catch (error) {
              console.error('[EnhancedStudioRenderer] Drop error:', error);
            }
          }}
        >
          {/* The actual unified page renderer */}
          <UnifiedPageRenderer
            pageId={pageData.id}
            mode={mode}
            allowUnpublished={true}
            responsive={true}
            containerQueries={true}
            lazyLoading={true}
            preloadPlugins={[]}
            onModeChange={onModeChange}
            onPageLoad={onPageLoad}
            onError={onError}
          />
        </Box>
      </StudioModeController>

      {/* Studio-specific overlays and controls */}
      {mode === RenderMode.STUDIO && (
        <>
          {/* Selection overlay */}
          {studioState.selectedModules.length > 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
                zIndex: 100
              }}
            >
              {/* Selection indicators would be rendered here */}
            </Box>
          )}

          {/* Multi-select info */}
          {studioState.selectedModules.length > 1 && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                px: 2,
                py: 1,
                borderRadius: 1,
                fontSize: '0.875rem',
                zIndex: 1000
              }}
            >
              {studioState.selectedModules.length} modules selected
            </Box>
          )}
        </>
      )}
    </Box>
  );
};