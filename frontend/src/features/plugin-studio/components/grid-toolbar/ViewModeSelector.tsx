import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import TabletIcon from '@mui/icons-material/Tablet';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import AspectRatioIcon from '@mui/icons-material/AspectRatio';
import { ViewModeState, DeviceType } from '../../types';
import { VIEW_MODE_TOOLTIPS } from '../../constants';

interface ViewModeSelectorProps {
  viewMode: ViewModeState;
  onViewModeChange: (mode: ViewModeState) => void;
}

/**
 * Component for selecting the view mode (mobile, tablet, desktop, custom)
 * @param props The component props
 * @returns The view mode selector component
 */
export const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({
  viewMode,
  onViewModeChange
}) => {
  /**
   * Handle view mode change
   * @param type The new view mode type
   */
  const handleViewModeChange = (type: 'mobile' | 'tablet' | 'desktop' | 'custom') => {
    onViewModeChange({ type });
  };

  /**
   * Handle double-click on a view mode button to switch to custom mode
   * @param type The view mode type that was double-clicked
   */
  const handleViewModeDoubleClick = (type: DeviceType) => {
    if (type === viewMode.type) {
      onViewModeChange({ type: 'custom' });
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
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
  );
};