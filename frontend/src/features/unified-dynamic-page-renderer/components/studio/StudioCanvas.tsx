import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Paper, IconButton, Tooltip, Fab } from '@mui/material';
import { 
  ZoomIn, 
  ZoomOut, 
  ZoomOutMap, 
  GridOn, 
  GridOff,
  Visibility,
  VisibilityOff,
  Devices,
  Tablet,
  Phone,
  Computer,
  Tv
} from '@mui/icons-material';
import { RenderMode, ResponsiveLayouts, PageData } from '../../types';
import { BreakpointInfo } from '../../types/responsive';
import { LayoutEngine } from '../LayoutEngine';
import { StudioModeController } from '../StudioModeController';
import { StudioModuleConfig } from '../../utils/PluginStudioAdapter';

export interface StudioCanvasProps {
  // Page data
  pageData: PageData;
  
  // Current state
  currentBreakpoint: BreakpointInfo;
  selectedItems: string[];
  
  // Event handlers
  onLayoutChange: (layouts: ResponsiveLayouts) => void;
  onModuleAdd: (moduleConfig: StudioModuleConfig, position: any) => void;
  onModuleRemove: (moduleId: string) => void;
  onModuleConfigure: (moduleId: string) => void;
  onModuleDuplicate: (moduleId: string) => void;
  onItemSelect: (itemId: string, addToSelection?: boolean) => void;
  onBreakpointChange: (breakpoint: BreakpointInfo) => void;
  
  // Canvas configuration
  showGrid?: boolean;
  snapToGrid?: boolean;
  enableZoom?: boolean;
  enableDevicePreview?: boolean;
  
  // Studio features
  enableDragDrop?: boolean;
  enableResize?: boolean;
  showDebugInfo?: boolean;
}

interface DevicePreset {
  name: string;
  icon: React.ReactNode;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  pixelRatio: number;
}

const devicePresets: DevicePreset[] = [
  {
    name: 'Desktop',
    icon: <Computer />,
    width: 1200,
    height: 800,
    orientation: 'landscape',
    pixelRatio: 1,
  },
  {
    name: 'Laptop',
    icon: <Computer />,
    width: 1024,
    height: 768,
    orientation: 'landscape',
    pixelRatio: 1,
  },
  {
    name: 'Tablet',
    icon: <Tablet />,
    width: 768,
    height: 1024,
    orientation: 'portrait',
    pixelRatio: 2,
  },
  {
    name: 'Mobile',
    icon: <Phone />,
    width: 375,
    height: 667,
    orientation: 'portrait',
    pixelRatio: 2,
  },
  {
    name: 'Large Display',
    icon: <Tv />,
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    pixelRatio: 1,
  },
];

/**
 * StudioCanvas - Main WYSIWYG editing canvas for Plugin Studio
 * 
 * This component provides the main editing surface where users can:
 * - Drag and drop modules
 * - Resize and reposition elements
 * - Preview different device sizes
 * - Zoom in/out for detailed editing
 * - Toggle grid and visual aids
 * 
 * It integrates all the WYSIWYG components we've created and provides
 * a complete editing experience.
 */
export const StudioCanvas: React.FC<StudioCanvasProps> = ({
  pageData,
  currentBreakpoint,
  selectedItems,
  onLayoutChange,
  onModuleAdd,
  onModuleRemove,
  onModuleConfigure,
  onModuleDuplicate,
  onItemSelect,
  onBreakpointChange,
  showGrid = false,
  snapToGrid = true,
  enableZoom = true,
  enableDevicePreview = true,
  enableDragDrop = true,
  enableResize = true,
  showDebugInfo = false,
}) => {
  const [zoom, setZoom] = useState(1);
  const [showGridOverlay, setShowGridOverlay] = useState(showGrid);
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(devicePresets[0]);
  const [canvasSize, setCanvasSize] = useState({ width: '100%', height: '100%' });
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Calculate canvas dimensions based on device preset
  const canvasDimensions = useMemo(() => {
    if (previewMode && enableDevicePreview) {
      return {
        width: selectedDevice.width * zoom,
        height: selectedDevice.height * zoom,
        maxWidth: selectedDevice.width * zoom,
        maxHeight: selectedDevice.height * zoom,
      };
    }
    return {
      width: '100%',
      height: '100%',
      minHeight: '600px',
    };
  }, [previewMode, enableDevicePreview, selectedDevice, zoom]);
  
  // Handle zoom changes
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  }, []);
  
  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.25, 0.25));
  }, []);
  
  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);
  
  // Handle device preset changes
  const handleDeviceChange = useCallback((device: DevicePreset) => {
    setSelectedDevice(device);
    
    // Update breakpoint info
    const newBreakpoint: BreakpointInfo = {
      name: device.name.toLowerCase(),
      width: device.width,
      height: device.height,
      orientation: device.orientation,
      pixelRatio: device.pixelRatio,
    };
    
    onBreakpointChange(newBreakpoint);
  }, [onBreakpointChange]);
  
  // Handle preview mode toggle
  const handlePreviewToggle = useCallback(() => {
    setPreviewMode(prev => !prev);
  }, []);
  
  // Handle grid toggle
  const handleGridToggle = useCallback(() => {
    setShowGridOverlay(prev => !prev);
  }, []);
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when canvas is focused or no input is focused
      const activeElement = document.activeElement as HTMLElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' ||
                            activeElement?.tagName === 'TEXTAREA' ||
                            activeElement?.contentEditable === 'true';
      
      if (isInputFocused) return;
      
      switch (event.key) {
        case '+':
        case '=':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            handleZoomIn();
          }
          break;
        case '-':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            handleZoomOut();
          }
          break;
        case '0':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            handleZoomReset();
          }
          break;
        case 'g':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            handleGridToggle();
          }
          break;
        case 'p':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            handlePreviewToggle();
          }
          break;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleZoomReset, handleGridToggle, handlePreviewToggle]);
  
  return (
    <Box
      ref={containerRef}
      className="studio-canvas"
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: 'grey.100',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Canvas Toolbar */}
      <Box
        className="studio-canvas__toolbar"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1,
          backgroundColor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        {/* Zoom Controls */}
        {enableZoom && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title="Zoom Out (Ctrl/Cmd + -)">
              <IconButton size="small" onClick={handleZoomOut} disabled={zoom <= 0.25}>
                <ZoomOut />
              </IconButton>
            </Tooltip>
            
            <Box
              sx={{
                minWidth: '60px',
                textAlign: 'center',
                fontSize: '0.875rem',
                fontWeight: 'medium',
              }}
            >
              {Math.round(zoom * 100)}%
            </Box>
            
            <Tooltip title="Zoom In (Ctrl/Cmd + +)">
              <IconButton size="small" onClick={handleZoomIn} disabled={zoom >= 3}>
                <ZoomIn />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Reset Zoom (Ctrl/Cmd + 0)">
              <IconButton size="small" onClick={handleZoomReset}>
                <ZoomOutMap />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        
        {/* Grid Toggle */}
        <Tooltip title={`${showGridOverlay ? 'Hide' : 'Show'} Grid (G)`}>
          <IconButton size="small" onClick={handleGridToggle} color={showGridOverlay ? 'primary' : 'default'}>
            {showGridOverlay ? <GridOn /> : <GridOff />}
          </IconButton>
        </Tooltip>
        
        {/* Preview Mode Toggle */}
        <Tooltip title={`${previewMode ? 'Exit' : 'Enter'} Preview Mode (P)`}>
          <IconButton size="small" onClick={handlePreviewToggle} color={previewMode ? 'primary' : 'default'}>
            {previewMode ? <VisibilityOff /> : <Visibility />}
          </IconButton>
        </Tooltip>
        
        {/* Device Presets */}
        {enableDevicePreview && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 2 }}>
            {devicePresets.map((device) => (
              <Tooltip key={device.name} title={`${device.name} (${device.width}×${device.height})`}>
                <IconButton
                  size="small"
                  onClick={() => handleDeviceChange(device)}
                  color={selectedDevice.name === device.name ? 'primary' : 'default'}
                >
                  {device.icon}
                </IconButton>
              </Tooltip>
            ))}
          </Box>
        )}
        
        {/* Current Breakpoint Info */}
        <Box sx={{ ml: 'auto', fontSize: '0.875rem', color: 'text.secondary' }}>
          {currentBreakpoint.name} • {currentBreakpoint.width}×{currentBreakpoint.height}
          {showDebugInfo && (
            <span> • {selectedItems.length} selected</span>
          )}
        </Box>
      </Box>
      
      {/* Canvas Content */}
      <Box
        className="studio-canvas__content"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: previewMode ? 'center' : 'flex-start',
          justifyContent: previewMode ? 'center' : 'flex-start',
          p: previewMode ? 2 : 0,
          overflow: 'auto',
        }}
      >
        <Paper
          ref={canvasRef}
          className="studio-canvas__surface"
          elevation={previewMode ? 3 : 0}
          sx={{
            ...canvasDimensions,
            transform: `scale(${zoom})`,
            transformOrigin: previewMode ? 'center' : 'top left',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            backgroundColor: 'background.paper',
            border: previewMode ? 'none' : '1px solid',
            borderColor: 'divider',
            borderRadius: previewMode ? 2 : 0,
            overflow: 'hidden',
          }}
        >
          {/* Studio Mode Controller provides the context */}
          <StudioModeController
            mode={RenderMode.STUDIO}
            onModeChange={() => {}} // Not used in canvas
            pageData={pageData}
            breakpoint={currentBreakpoint}
          >
            {/* Layout Engine with WYSIWYG capabilities */}
            <LayoutEngine
              layouts={pageData.layouts}
              modules={pageData.modules}
              mode={RenderMode.STUDIO}
              breakpoint={currentBreakpoint}
              onLayoutChange={onLayoutChange}
              onModuleAdd={onModuleAdd}
              onModuleRemove={onModuleRemove}
              onModuleConfigure={onModuleConfigure}
              onItemSelect={onItemSelect}
              onItemDuplicate={onModuleDuplicate}
              enableDragDrop={enableDragDrop && !previewMode}
              enableResize={enableResize && !previewMode}
              showGrid={showGridOverlay}
              snapToGrid={snapToGrid}
              lazyLoading={false} // Disable lazy loading in studio for better UX
            />
          </StudioModeController>
          
          {/* Grid Overlay */}
          {showGridOverlay && (
            <Box
              className="studio-canvas__grid-overlay"
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
                backgroundImage: `
                  linear-gradient(to right, rgba(0,0,0,0.1) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(0,0,0,0.1) 1px, transparent 1px)
                `,
                backgroundSize: '20px 20px',
                opacity: 0.5,
              }}
            />
          )}
          
          {/* Debug Info Overlay */}
          {showDebugInfo && (
            <Box
              className="studio-canvas__debug-overlay"
              sx={{
                position: 'absolute',
                top: 8,
                left: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                p: 1,
                borderRadius: 1,
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                pointerEvents: 'none',
              }}
            >
              <div>Zoom: {Math.round(zoom * 100)}%</div>
              <div>Breakpoint: {currentBreakpoint.name}</div>
              <div>Modules: {pageData.modules.length}</div>
              <div>Selected: {selectedItems.length}</div>
              <div>Grid: {showGridOverlay ? 'ON' : 'OFF'}</div>
              <div>Preview: {previewMode ? 'ON' : 'OFF'}</div>
            </Box>
          )}
        </Paper>
      </Box>
      
      {/* Floating Action Buttons */}
      <Box
        className="studio-canvas__fab-container"
        sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {/* Quick Grid Toggle */}
        <Fab
          size="small"
          color={showGridOverlay ? 'primary' : 'default'}
          onClick={handleGridToggle}
          sx={{ opacity: 0.8 }}
        >
          {showGridOverlay ? <GridOn /> : <GridOff />}
        </Fab>
        
        {/* Quick Preview Toggle */}
        <Fab
          size="small"
          color={previewMode ? 'primary' : 'default'}
          onClick={handlePreviewToggle}
          sx={{ opacity: 0.8 }}
        >
          {previewMode ? <VisibilityOff /> : <Visibility />}
        </Fab>
      </Box>
    </Box>
  );
};

export default StudioCanvas;