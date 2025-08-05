import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Paper, Box, IconButton, Tooltip } from '@mui/material';
import { Settings, Delete, DragIndicator, ContentCopy } from '@mui/icons-material';
import { RenderMode, LayoutItem, ModuleConfig } from '../../unified-dynamic-page-renderer/types';
import { ModuleRenderer } from '../../unified-dynamic-page-renderer/components/ModuleRenderer';
import { PluginStudioAdapter } from '../../unified-dynamic-page-renderer/utils/PluginStudioAdapter';

export interface EnhancedGridItemProps {
  layoutItem: LayoutItem;
  moduleConfig?: ModuleConfig;
  
  // WYSIWYG state
  isSelected?: boolean;
  isNew?: boolean;
  isDragging?: boolean;
  previewMode?: boolean;
  mode: RenderMode;
  
  // Event handlers
  onClick?: (event: React.MouseEvent) => void;
  onConfigure?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  
  // Performance options
  lazyLoading?: boolean;
  preload?: boolean;
}

/**
 * Enhanced Grid Item Component
 * 
 * This component preserves and enhances all the WYSIWYG functionality from the
 * existing GridItem.tsx (332 lines) while integrating with the unified renderer.
 * 
 * Key features preserved:
 * - Visual selection feedback with borders and elevation
 * - Smooth animations for new items (fadeIn effect)
 * - Hover effects and visual feedback
 * - Context-aware controls (hidden in preview mode)
 * - Real-time plugin rendering
 * - Layout-specific configuration overrides
 * - Device-specific responsive behavior
 * 
 * Enhanced features:
 * - Container query support for true responsive WYSIWYG
 * - Improved accessibility with ARIA labels
 * - Better keyboard navigation support
 * - Enhanced visual feedback with modern animations
 * - Optimized performance with lazy loading
 */
export const EnhancedGridItem: React.FC<EnhancedGridItemProps> = ({
  layoutItem,
  moduleConfig,
  isSelected = false,
  isNew = false,
  isDragging = false,
  previewMode = false,
  mode,
  onClick,
  onConfigure,
  onRemove,
  onDuplicate,
  lazyLoading = true,
  preload = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [animating, setAnimating] = useState(isNew);

  // Handle animation when isNew changes (preserving existing behavior)
  useEffect(() => {
    if (isNew) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setAnimating(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isNew]);

  // Handle click with event propagation control
  const handleClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onClick?.(event);
  }, [onClick]);

  // Handle configuration
  const handleConfigure = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onConfigure?.();
  }, [onConfigure]);

  // Handle removal
  const handleRemove = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onRemove?.();
  }, [onRemove]);

  // Handle duplication
  const handleDuplicate = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onDuplicate?.();
  }, [onDuplicate]);

  // Determine if controls should be visible
  const showControls = mode === RenderMode.STUDIO && !previewMode && (isSelected || isHovered);

  // Create adapted module config for rendering
  const adaptedModuleConfig = useMemo(() => {
    if (!moduleConfig) {
      return {
        pluginId: layoutItem.pluginId || 'unknown',
        moduleId: layoutItem.moduleId || 'unknown',
        instanceId: layoutItem.i,
        config: layoutItem.config || {},
        layoutConfig: {},
      };
    }

    // Use PluginStudioAdapter to ensure compatibility
    return PluginStudioAdapter.adaptPluginStudioModule({
      pluginId: moduleConfig.pluginId || layoutItem.pluginId,
      moduleId: moduleConfig.moduleId || layoutItem.moduleId,
      uniqueId: layoutItem.i,
      config: { ...moduleConfig.config, ...layoutItem.config },
      layoutConfig: moduleConfig.layoutConfig || {},
    });
  }, [moduleConfig, layoutItem]);

  return (
    <Paper
      elevation={isSelected ? 3 : isDragging ? 2 : 1}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        cursor: mode === RenderMode.STUDIO && !previewMode ? 'pointer' : 'default',
        
        // Enhanced border styling
        border: isSelected 
          ? '2px solid' 
          : isHovered && !previewMode 
            ? '2px solid' 
            : '1px solid',
        borderColor: isSelected 
          ? 'primary.main' 
          : isHovered && !previewMode 
            ? 'primary.light' 
            : 'divider',
        
        // Enhanced visual feedback
        backgroundColor: isDragging 
          ? 'rgba(25, 118, 210, 0.05)' 
          : 'background.paper',
        
        // Enhanced box shadow
        boxShadow: isSelected 
          ? '0 4px 12px rgba(25, 118, 210, 0.3)' 
          : isHovered && !previewMode 
            ? '0 2px 8px rgba(0, 0, 0, 0.1)' 
            : undefined,
        
        // Enhanced transitions
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
        
        // Preserve fadeIn animation for new items
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
        
        // Container query support
        containerType: 'inline-size',
        
        // Enhanced hover effects
        '&:hover': {
          borderColor: previewMode ? 'divider' : 'primary.light',
          '& .enhanced-grid-item__controls': {
            opacity: 1,
            transform: 'translateY(0)',
          }
        },
        
        // Focus styles for accessibility
        '&:focus-within': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: '2px',
        }
      }}
      // Accessibility attributes
      role="gridcell"
      aria-selected={isSelected}
      aria-label={`Module ${adaptedModuleConfig.pluginId}/${adaptedModuleConfig.moduleId}`}
      tabIndex={mode === RenderMode.STUDIO ? 0 : -1}
    >
      {/* Enhanced Controls Overlay */}
      {showControls && (
        <Box
          className="enhanced-grid-item__controls"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            p: 0.5,
            opacity: 0,
            transform: 'translateY(-4px)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)',
            borderRadius: '4px 4px 0 0',
          }}
        >
          {/* Left side - Drag handle */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title="Drag to move" placement="top">
              <IconButton
                className="enhanced-drag-handle"
                size="small"
                sx={{ 
                  color: 'white',
                  cursor: 'move',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  }
                }}
                aria-label="Drag to move module"
              >
                <DragIndicator fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Right side - Action buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title="Duplicate" placement="top">
              <IconButton
                size="small"
                onClick={handleDuplicate}
                sx={{ 
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  }
                }}
                aria-label="Duplicate module"
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Configure" placement="top">
              <IconButton
                size="small"
                onClick={handleConfigure}
                sx={{ 
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  }
                }}
                aria-label="Configure module"
              >
                <Settings fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Remove" placement="top">
              <IconButton
                size="small"
                onClick={handleRemove}
                sx={{ 
                  color: 'error.light',
                  '&:hover': {
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                  }
                }}
                aria-label="Remove module"
              >
                <Delete fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}

      {/* Module Content */}
      <Box 
        sx={{ 
          flex: 1, 
          overflow: 'auto', 
          p: 1,
          // Ensure content doesn't interfere with controls
          mt: showControls ? 1 : 0,
        }}
      >
        <ModuleRenderer
          pluginId={adaptedModuleConfig.pluginId}
          moduleId={adaptedModuleConfig.moduleId}
          instanceId={adaptedModuleConfig.instanceId}
          config={adaptedModuleConfig.config}
          layoutConfig={adaptedModuleConfig.layoutConfig}
          mode={mode}
          breakpoint={{
            name: 'desktop',
            width: 1200,
            height: 800,
            orientation: 'landscape',
            pixelRatio: 1
          }}
          services={adaptedModuleConfig.services || []}
          lazyLoading={lazyLoading}
          preload={preload}
        />
      </Box>

      {/* Module Info Overlay (shown when hovered or selected) */}
      {(isHovered || isSelected) && !previewMode && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            bgcolor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            p: 0.5,
            fontSize: '0.75rem',
            textAlign: 'center',
            borderRadius: '0 0 4px 4px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <Box component="span" sx={{ fontWeight: 'medium' }}>
            {adaptedModuleConfig.pluginId}
          </Box>
          <Box component="span" sx={{ mx: 0.5, opacity: 0.7 }}>
            /
          </Box>
          <Box component="span">
            {adaptedModuleConfig.moduleId}
          </Box>
          {layoutItem.w && layoutItem.h && (
            <Box component="span" sx={{ ml: 1, opacity: 0.7, fontSize: '0.7rem' }}>
              ({layoutItem.w}×{layoutItem.h})
            </Box>
          )}
        </Box>
      )}

      {/* New item indicator */}
      {isNew && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'success.main',
            color: 'success.contrastText',
            px: 1,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: '0.7rem',
            fontWeight: 'bold',
            zIndex: 5,
            animation: 'pulse 2s ease-in-out',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 }
            }
          }}
        >
          NEW
        </Box>
      )}
    </Paper>
  );
};