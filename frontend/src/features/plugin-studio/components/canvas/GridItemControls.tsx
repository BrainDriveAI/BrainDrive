import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

interface GridItemControlsProps {
  isSelected: boolean;
  onConfig: () => void;
  onRemove: () => void;
}

/**
 * Component that provides controls for manipulating a grid item
 * @param props The component props
 * @returns The grid item controls component
 */
export const GridItemControls: React.FC<GridItemControlsProps> = ({
  isSelected,
  onConfig,
  onRemove
}) => {
  return (
    <>
      {/* Move handle - top right - only visible when selected */}
      {isSelected && (
        <Box
          className="react-grid-dragHandleExample"
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 2,
            cursor: 'move',
            p: 0.5,
            color: 'primary.main',
            '&:hover': {
              color: 'primary.main'
            }
          }}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
      )}
      
      {/* Config and remove buttons - only visible when selected */}
      {isSelected && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 2,
            display: 'flex',
            p: 0.5
          }}
        >
          <Tooltip title="Configure">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onConfig();
              }}
              sx={{ color: 'primary.main' }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Remove">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              sx={{ color: 'error.main' }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      
      {/* Resize handle is provided by react-grid-layout */}
    </>
  );
};