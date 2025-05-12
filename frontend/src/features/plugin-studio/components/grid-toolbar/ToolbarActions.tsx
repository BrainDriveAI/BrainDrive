import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteIcon from '@mui/icons-material/Delete';
import CodeIcon from '@mui/icons-material/Code';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import PublishIcon from '@mui/icons-material/Publish';
import SaveIcon from '@mui/icons-material/Save';
import RouteIcon from '@mui/icons-material/AccountTree';

interface ToolbarActionsProps {
  selectedItem?: { i: string } | null;
  previewMode: boolean;
  isPagePublished?: boolean;
  isLocalPage?: boolean;
  onConfigOpen?: (item: { i: string }) => void;
  onJsonViewOpen?: () => void;
  onRemoveItem?: (id: string) => void;
  onPreviewModeChange: (preview: boolean) => void;
  onPublishDialogOpen?: () => void;
  onRouteManagementOpen?: () => void;
  onSavePage?: (pageId: string) => void;
  currentPageId?: string;
}

/**
 * Component for toolbar actions like configure, delete, view JSON, etc.
 * @param props The component props
 * @returns The toolbar actions component
 */
export const ToolbarActions: React.FC<ToolbarActionsProps> = ({
  selectedItem,
  previewMode,
  isPagePublished,
  isLocalPage,
  onConfigOpen,
  onJsonViewOpen,
  onRemoveItem,
  onPreviewModeChange,
  onPublishDialogOpen,
  onRouteManagementOpen,
  onSavePage,
  currentPageId
}) => {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
      {/* Preview Mode Toggle */}
      <Tooltip title={previewMode ? "Exit Preview Mode" : "Enter Preview Mode"}>
        <IconButton
          onClick={() => onPreviewModeChange(!previewMode)}
          color={previewMode ? "primary" : "default"}
          size="small"
        >
          {previewMode ? <VisibilityIcon /> : <VisibilityOffIcon />}
        </IconButton>
      </Tooltip>
      
      {/* Actions only available when not in preview mode */}
      {!previewMode && (
        <>
          {/* Configure Plugin */}
          <Tooltip title="Configure Plugin">
            <span>
              <IconButton
                onClick={() => selectedItem && onConfigOpen?.(selectedItem)}
                disabled={!selectedItem}
                size="small"
              >
                <SettingsIcon />
              </IconButton>
            </span>
          </Tooltip>
          
          {/* View Page JSON */}
          <Tooltip title="View Page JSON">
            <IconButton
              onClick={() => onJsonViewOpen?.()}
              size="small"
            >
              <CodeIcon />
            </IconButton>
          </Tooltip>
          
          {/* Remove Plugin */}
          <Tooltip title="Remove Plugin">
            <span>
              <IconButton
                onClick={() => selectedItem && onRemoveItem?.(selectedItem.i)}
                disabled={!selectedItem}
                color={selectedItem ? "error" : "default"}
                size="small"
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        </>
      )}
    </Box>
  );
};