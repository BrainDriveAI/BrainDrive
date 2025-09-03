import React from 'react';
import { Box, IconButton } from '@mui/material';
import { Settings, Delete, DragIndicator } from '@mui/icons-material';
import { useShowControls } from '../../../hooks/useControlVisibility';

export interface GridItemControlsProps {
  isSelected: boolean;
  onConfig?: () => void;
  onDelete?: () => void;
  onRemove?: () => void; // Alias for onDelete for compatibility
  onSelect?: () => void;
}

/**
 * Grid Item Controls for Studio Mode
 * Provides basic controls for grid items in the unified renderer
 */
export const GridItemControls: React.FC<GridItemControlsProps> = ({
  isSelected,
  onConfig,
  onDelete,
  onRemove,
  onSelect
}) => {
  const showControls = useShowControls();
  
  // Early return if controls should not be shown
  if (!showControls) {
    return null;
  }
  
  // Use onRemove if provided, otherwise use onDelete
  const handleDelete = onRemove || onDelete;
  
  if (process.env.NODE_ENV === 'development' && isSelected) {
    console.log(`[GridItemControls] RENDERING CONTROLS FOR SELECTED ITEM:`, {
      isSelected,
      hasOnConfig: !!onConfig,
      hasOnDelete: !!handleDelete,
      hasOnSelect: !!onSelect
    });
  }
  if (!isSelected) {
    return (
      <Box
        onClick={onSelect}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          border: '2px dashed transparent',
          borderRadius: 1,
          cursor: 'pointer',
          '&:hover': {
            border: '2px dashed #1976d2',
            backgroundColor: 'rgba(25, 118, 210, 0.04)'
          }
        }}
      />
    );
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        border: '2px solid #1976d2',
        borderRadius: 1,
        backgroundColor: 'rgba(25, 118, 210, 0.04)',
        pointerEvents: 'none',
        zIndex: 999 // Ensure selection overlay is above content
      }}
    >
      {/* Control buttons */}
      <Box
        sx={{
          position: 'absolute',
          top: -12, // Move further outside the border
          right: -12, // Move further outside the border
          display: 'flex',
          gap: 0.5,
          pointerEvents: 'auto',
          zIndex: 1001 // Ensure controls are above everything
        }}
      >
        {/* Drag handle */}
        <IconButton
          size="small"
          className="react-grid-dragHandleExample drag-handle"
          sx={{
            backgroundColor: '#1976d2',
            color: 'white',
            width: 24,
            height: 24,
            cursor: 'move',
            '&:hover': {
              backgroundColor: '#1565c0'
            }
          }}
        >
          <DragIndicator fontSize="small" />
        </IconButton>

        {/* Config button */}
        {onConfig && (
          <IconButton
            size="small"
            onClick={onConfig}
            sx={{
              backgroundColor: '#1976d2',
              color: 'white',
              width: 24,
              height: 24,
              '&:hover': {
                backgroundColor: '#1565c0'
              }
            }}
          >
            <Settings fontSize="small" />
          </IconButton>
        )}

        {/* Delete button */}
        {handleDelete && (
          <IconButton
            size="small"
            onClick={handleDelete}
            sx={{
              backgroundColor: '#d32f2f',
              color: 'white',
              width: 24,
              height: 24,
              '&:hover': {
                backgroundColor: '#c62828'
              }
            }}
          >
            <Delete fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Box>
  );
};