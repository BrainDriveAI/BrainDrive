import React, { useState } from 'react';
import { Box, IconButton, Tooltip, Divider, Chip } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteIcon from '@mui/icons-material/Delete';
import CodeIcon from '@mui/icons-material/Code';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import TabletIcon from '@mui/icons-material/Tablet';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import AspectRatioIcon from '@mui/icons-material/AspectRatio';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import PublishIcon from '@mui/icons-material/Publish';
import AddIcon from '@mui/icons-material/Add';
import WarningIcon from '@mui/icons-material/Warning';
import SaveIcon from '@mui/icons-material/Save';
import RouteIcon from '@mui/icons-material/AccountTree';
import { ViewModeState, DeviceType, Page } from '../pages';
import { PageSelector } from './PageSelector';

interface GridToolbarProps {
  viewMode: ViewModeState;
  onViewModeChange: (mode: ViewModeState) => void;
  selectedItem?: { i: string };
  onConfigOpen?: (item: { i: string }) => void;
  onJsonViewOpen?: () => void;
  onRemoveItem?: (id: string) => void;
  onCopyLayout?: (from: DeviceType, to: DeviceType) => void; // Keeping this to avoid breaking the interface
  previewMode: boolean;
  onPreviewModeChange: (preview: boolean) => void;
  pages: Page[];
  currentPage: Page | null;
  onPageChange: (page: Page) => void;
  onCreatePage: (pageName: string) => void;
  onDeletePage: (pageId: string) => void;
  onRenamePage: (pageId: string, newName: string) => void;
  onSavePage?: (pageId: string) => void;
  onPublishDialogOpen?: () => void;
  onRouteManagementOpen?: () => void;
  isPagePublished?: boolean;
}

export const GridToolbar: React.FC<GridToolbarProps> = ({
  viewMode,
  onViewModeChange,
  selectedItem,
  onConfigOpen,
  onJsonViewOpen,
  onRemoveItem,
  previewMode,
  onPreviewModeChange,
  pages,
  currentPage,
  onPageChange,
  onCreatePage,
  onDeletePage,
  onRenamePage,
  onSavePage,
  onPublishDialogOpen,
  onRouteManagementOpen,
  isPagePublished
}) => {
  const handleViewModeChange = (type: 'mobile' | 'tablet' | 'desktop' | 'custom') => {
    onViewModeChange({ type });
  };

  const handleViewModeDoubleClick = (type: 'mobile' | 'tablet' | 'desktop') => {
    if (type === viewMode.type) {
      onViewModeChange({ type: 'custom' });
    }
  };

  return (
    <Box sx={{ 
      p: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      borderBottom: 1,
      borderColor: 'divider',
      justifyContent: 'space-between'
    }}>
      {/* Page Management Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {currentPage ? (
          <>
            <PageSelector
              pages={pages}
              currentPage={currentPage}
              onPageChange={onPageChange}
              onCreatePage={onCreatePage}
              onDeletePage={onDeletePage}
              onRenamePage={onRenamePage}
              onSavePage={onSavePage}
            />
            
            {/* Check if this is a local page that hasn't been saved to the backend */}
            {currentPage.is_local === true ? (
              <>
                <Tooltip title="This is a temporary page that hasn't been saved to the backend. Click 'Save As' to create a permanent page.">
                  <Chip
                    icon={<WarningIcon />}
                    label="Unsaved Page"
                    color="warning"
                    size="small"
                    sx={{ ml: 1 }}
                  />
                </Tooltip>
                <Tooltip title="Save as a new page">
                  <IconButton 
                    onClick={() => onSavePage?.(currentPage.id)}
                    size="small"
                    color="primary"
                    sx={{ ml: 1 }}
                  >
                    <SaveIcon />
                  </IconButton>
                </Tooltip>
              </>
            ) : (
              /* Add Publish Icon */
              <>
              <Tooltip title={isPagePublished ? "Manage Published Page" : "Publish Page"}>
                <IconButton 
                  onClick={onPublishDialogOpen}
                  size="small"
                  color={isPagePublished ? "success" : "primary"}
                >
                  <PublishIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Manage Routes">
                <IconButton 
                  onClick={onRouteManagementOpen}
                  size="small"
                  color="primary"
                >
                  <RouteIcon />
                </IconButton>
              </Tooltip>
              </>
            )}
          </>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="Create New Page">
              <IconButton 
                onClick={() => onCreatePage('New Page')}
                size="small"
                sx={{ color: 'primary.main' }}
              >
                <AddIcon />
              </IconButton>
            </Tooltip>
            <Box sx={{ ml: 1 }}>No pages available. Create a new page to get started.</Box>
          </Box>
        )}
      </Box>

      <Divider orientation="vertical" flexItem />

      {/* View Mode Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title="Mobile View (Double-click for custom)">
          <IconButton 
            onClick={() => handleViewModeChange('mobile')}
            onDoubleClick={() => handleViewModeDoubleClick('mobile')}
            color={viewMode.type === 'mobile' ? 'primary' : 'default'}
            size="small"
          >
            <SmartphoneIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Tablet View (Double-click for custom)">
          <IconButton 
            onClick={() => handleViewModeChange('tablet')}
            onDoubleClick={() => handleViewModeDoubleClick('tablet')}
            color={viewMode.type === 'tablet' ? 'primary' : 'default'}
            size="small"
          >
            <TabletIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Desktop View (Double-click for custom)">
          <IconButton 
            onClick={() => handleViewModeChange('desktop')}
            onDoubleClick={() => handleViewModeDoubleClick('desktop')}
            color={viewMode.type === 'desktop' ? 'primary' : 'default'}
            size="small"
          >
            <DesktopWindowsIcon />
          </IconButton>
        </Tooltip>
        {/* Custom view option is hidden but still available via double-click on device views */}
        <Box sx={{ display: 'none' }}>
          <Tooltip title="Custom Size (Resize Browser)">
            <IconButton
              onClick={() => handleViewModeChange('custom')}
              color={viewMode.type === 'custom' ? 'primary' : 'default'}
              size="small"
            >
              <AspectRatioIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Divider orientation="vertical" flexItem />

      {/* Function Controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton
          onClick={() => onPreviewModeChange(!previewMode)}
          color={previewMode ? "primary" : "default"}
          title={previewMode ? "Exit Preview Mode" : "Enter Preview Mode"}
        >
          {previewMode ? <VisibilityIcon /> : <VisibilityOffIcon />}
        </IconButton>
        {!previewMode && (
          <>
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
            <Tooltip title="View Page JSON">
              <IconButton 
                onClick={() => onJsonViewOpen?.()}
                size="small"
              >
                <CodeIcon />
              </IconButton>
            </Tooltip>
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
    </Box>
  );
};
