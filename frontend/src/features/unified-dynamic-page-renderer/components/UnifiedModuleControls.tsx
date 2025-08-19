import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { useShowControls } from '../../../hooks/useControlVisibility';

interface UnifiedModuleControlsProps {
  moduleId: string;
  isSelected: boolean;
  onConfig: (moduleId: string) => void;
  onDelete: (moduleId: string) => void;
  onSelect: (moduleId: string) => void;
}

/**
 * Unified Module Controls Component
 * 
 * Provides the four control icons for Plugin Studio modules in the unified renderer:
 * - Config (⚙) - Top left, visible when selected
 * - Delete (🗑) - Top left, visible when selected  
 * - Move (⋮⋮) - Top right, always visible on hover
 * - Resize (↘) - Bottom right, handled by React Grid Layout
 */
export const UnifiedModuleControls: React.FC<UnifiedModuleControlsProps> = ({
  moduleId,
  isSelected,
  onConfig,
  onDelete,
  onSelect
}) => {
  const showControls = useShowControls();
  
  // Early return if controls should not be shown
  if (!showControls) {
    return null;
  }
  
  return (
    <>
      {/* Move handle - top right, always visible on hover */}
      <Box
        className="react-grid-dragHandleExample"
        sx={{
          position: 'absolute',
          top: 4,
          right: 4,
          zIndex: 1000,
          cursor: 'move',
          padding: '4px',
          borderRadius: '4px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          display: 'none', // Hidden by default
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          '&:hover': {
            background: 'rgba(0, 0, 0, 0.8)'
          }
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: '12px' }} />
      </Box>
      
      {/* Config and delete buttons - only visible when selected */}
      {isSelected && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            left: 4,
            zIndex: 1000,
            display: 'flex',
            gap: '4px'
          }}
        >
          {/* Config button */}
          <Tooltip title="Configure Module">
            <Box
              onClick={(e) => {
                e.stopPropagation();
                onConfig(moduleId);
              }}
              sx={{
                width: '24px',
                height: '24px',
                background: 'rgba(25, 118, 210, 0.9)',
                color: 'white',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                '&:hover': {
                  background: '#1976d2'
                }
              }}
            >
              <SettingsIcon sx={{ fontSize: '12px' }} />
            </Box>
          </Tooltip>
          
          {/* Delete button */}
          <Tooltip title="Delete Module">
            <Box
              onClick={(e) => {
                e.stopPropagation();
                onDelete(moduleId);
              }}
              sx={{
                width: '24px',
                height: '24px',
                background: 'rgba(211, 47, 47, 0.9)',
                color: 'white',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                '&:hover': {
                  background: '#d32f2f'
                }
              }}
            >
              <DeleteIcon sx={{ fontSize: '12px' }} />
            </Box>
          </Tooltip>
        </Box>
      )}
      
      {/* 
        Resize handle is provided by React Grid Layout automatically
        It appears in the bottom-right corner when hovering over modules
      */}
    </>
  );
};

export default UnifiedModuleControls;