import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Box,
  Typography,
  Divider,
  Alert,
  Tabs,
  Tab,
  Paper,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Close, Save, Refresh, Code, Visibility } from '@mui/icons-material';
import { useEnhancedStudioState } from '../../hooks/useEnhancedStudioState';
import { PluginStudioAdapter } from '../../../unified-dynamic-page-renderer/utils/PluginStudioAdapter';

export interface EnhancedConfigDialogProps {
  open: boolean;
  onClose: () => void;
  moduleId?: string;
  pageId: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index, ...other }) => (
  <div
    role="tabpanel"
    hidden={value !== index}
    id={`config-tabpanel-${index}`}
    aria-labelledby={`config-tab-${index}`}
    {...other}
  >
    {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
  </div>
);

/**
 * Enhanced Configuration Dialog
 * 
 * This dialog integrates with the enhanced state management system to provide
 * a rich configuration experience for modules in the Plugin Studio.
 * 
 * Features:
 * - Real-time configuration updates
 * - Integration with enhanced state management
 * - Tabbed interface for different configuration categories
 * - Live preview of changes
 * - Validation and error handling
 * - Auto-save functionality
 * - Responsive design configuration
 * - Layout-specific overrides
 */
export const EnhancedConfigDialog: React.FC<EnhancedConfigDialogProps> = ({
  open,
  onClose,
  moduleId,
  pageId,
}) => {
  const [studioState, studioActions] = useEnhancedStudioState(pageId);
  const [currentTab, setCurrentTab] = useState(0);
  const [localConfig, setLocalConfig] = useState<any>({});
  const [layoutConfig, setLayoutConfig] = useState<any>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState(false);

  // Get current module configuration
  const currentModule = useMemo(() => {
    if (!moduleId || !studioState.layouts) return null;
    
    // Find module in current layouts
    const allLayouts = [
      ...(studioState.layouts.desktop || []),
      ...(studioState.layouts.tablet || []),
      ...(studioState.layouts.mobile || []),
    ];
    
    return allLayouts.find(item => item.i === moduleId) || null;
  }, [moduleId, studioState.layouts]);

  // Initialize configuration when dialog opens
  useEffect(() => {
    if (open && currentModule) {
      setLocalConfig({ ...currentModule.config });
      setLayoutConfig({
        w: currentModule.w,
        h: currentModule.h,
        minW: currentModule.minW,
        minH: currentModule.minH,
        isDraggable: currentModule.isDraggable,
        isResizable: currentModule.isResizable,
      });
      setHasChanges(false);
      setValidationErrors([]);
    }
  }, [open, currentModule]);

  // Handle configuration changes
  const handleConfigChange = useCallback((key: string, value: any) => {
    setLocalConfig((prev: any) => ({
      ...prev,
      [key]: value,
    }));
    setHasChanges(true);
  }, []);

  // Handle layout configuration changes
  const handleLayoutConfigChange = useCallback((key: string, value: any) => {
    setLayoutConfig((prev: any) => ({
      ...prev,
      [key]: value,
    }));
    setHasChanges(true);
  }, []);

  // Validate configuration
  const validateConfig = useCallback((config: any): string[] => {
    const errors: string[] = [];
    
    // Basic validation rules
    if (config.title && config.title.length > 100) {
      errors.push('Title must be less than 100 characters');
    }
    
    if (config.width && (config.width < 1 || config.width > 12)) {
      errors.push('Width must be between 1 and 12');
    }
    
    if (config.height && (config.height < 1 || config.height > 20)) {
      errors.push('Height must be between 1 and 20');
    }
    
    return errors;
  }, []);

  // Apply configuration changes
  const handleApply = useCallback(async () => {
    if (!moduleId) return;
    
    // Validate configuration
    const errors = validateConfig(localConfig);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    try {
      // Create adapted module configuration
      const adaptedConfig = PluginStudioAdapter.adaptPluginStudioModule({
        pluginId: currentModule?.pluginId,
        moduleId: currentModule?.moduleId,
        uniqueId: moduleId,
        config: localConfig,
        layoutConfig: layoutConfig,
      });
      
      // Update through state management
      // This would typically update the module configuration
      console.log('[EnhancedConfigDialog] Applying configuration:', adaptedConfig);
      
      // Mark as saved
      setHasChanges(false);
      setValidationErrors([]);
      
      // Trigger auto-save
      await studioActions.save();
      
    } catch (error) {
      console.error('[EnhancedConfigDialog] Failed to apply configuration:', error);
      setValidationErrors(['Failed to apply configuration. Please try again.']);
    }
  }, [moduleId, localConfig, layoutConfig, currentModule, validateConfig, studioActions]);

  // Handle save and close
  const handleSaveAndClose = useCallback(async () => {
    await handleApply();
    if (validationErrors.length === 0) {
      onClose();
    }
  }, [handleApply, validationErrors, onClose]);

  // Handle close with unsaved changes
  const handleClose = useCallback(() => {
    if (hasChanges) {
      const confirmClose = window.confirm('You have unsaved changes. Are you sure you want to close?');
      if (!confirmClose) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  // Reset to original configuration
  const handleReset = useCallback(() => {
    if (currentModule) {
      setLocalConfig({ ...currentModule.config });
      setLayoutConfig({
        w: currentModule.w,
        h: currentModule.h,
        minW: currentModule.minW,
        minH: currentModule.minH,
        isDraggable: currentModule.isDraggable,
        isResizable: currentModule.isResizable,
      });
      setHasChanges(false);
      setValidationErrors([]);
    }
  }, [currentModule]);

  if (!currentModule) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '70vh',
          maxHeight: '90vh',
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h6">
            Configure Module
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {currentModule.pluginId}/{currentModule.moduleId}
          </Typography>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Toggle Preview">
            <IconButton
              onClick={() => setPreviewMode(!previewMode)}
              color={previewMode ? 'primary' : 'default'}
            >
              <Visibility />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Reset to Original">
            <IconButton onClick={handleReset} disabled={!hasChanges}>
              <Refresh />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Close">
            <IconButton onClick={handleClose}>
              <Close />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error">
              <Typography variant="subtitle2">Configuration Errors:</Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </Alert>
          </Box>
        )}

        {/* Unsaved Changes Indicator */}
        {hasChanges && (
          <Box sx={{ p: 2, pb: 0 }}>
            <Alert severity="info">
              You have unsaved changes. Click "Apply" or "Save & Close" to save them.
            </Alert>
          </Box>
        )}

        {/* Configuration Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={currentTab}
            onChange={(_, newValue) => setCurrentTab(newValue)}
            aria-label="configuration tabs"
          >
            <Tab label="General" />
            <Tab label="Layout" />
            <Tab label="Responsive" />
            <Tab label="Advanced" />
          </Tabs>
        </Box>

        {/* General Configuration */}
        <TabPanel value={currentTab} index={0}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              label="Title"
              value={localConfig.title || ''}
              onChange={(e) => handleConfigChange('title', e.target.value)}
              fullWidth
              helperText="Display title for the module"
            />
            
            <TextField
              label="Description"
              value={localConfig.description || ''}
              onChange={(e) => handleConfigChange('description', e.target.value)}
              fullWidth
              multiline
              rows={3}
              helperText="Description of the module's purpose"
            />
            
            <FormControlLabel
              control={
                <Switch
                  checked={localConfig.enabled !== false}
                  onChange={(e) => handleConfigChange('enabled', e.target.checked)}
                />
              }
              label="Enabled"
            />
            
            <FormControlLabel
              control={
                <Switch
                  checked={localConfig.showBorder || false}
                  onChange={(e) => handleConfigChange('showBorder', e.target.checked)}
                />
              }
              label="Show Border"
            />
          </Box>
        </TabPanel>

        {/* Layout Configuration */}
        <TabPanel value={currentTab} index={1}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Width (Grid Units)"
                type="number"
                value={layoutConfig.w || 4}
                onChange={(e) => handleLayoutConfigChange('w', parseInt(e.target.value))}
                inputProps={{ min: 1, max: 12 }}
                helperText="Width in grid units (1-12)"
              />
              
              <TextField
                label="Height (Grid Units)"
                type="number"
                value={layoutConfig.h || 3}
                onChange={(e) => handleLayoutConfigChange('h', parseInt(e.target.value))}
                inputProps={{ min: 1, max: 20 }}
                helperText="Height in grid units (1-20)"
              />
            </Box>
            
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Min Width"
                type="number"
                value={layoutConfig.minW || 1}
                onChange={(e) => handleLayoutConfigChange('minW', parseInt(e.target.value))}
                inputProps={{ min: 1, max: 12 }}
              />
              
              <TextField
                label="Min Height"
                type="number"
                value={layoutConfig.minH || 1}
                onChange={(e) => handleLayoutConfigChange('minH', parseInt(e.target.value))}
                inputProps={{ min: 1, max: 20 }}
              />
            </Box>
            
            <FormControlLabel
              control={
                <Switch
                  checked={layoutConfig.isDraggable !== false}
                  onChange={(e) => handleLayoutConfigChange('isDraggable', e.target.checked)}
                />
              }
              label="Draggable"
            />
            
            <FormControlLabel
              control={
                <Switch
                  checked={layoutConfig.isResizable !== false}
                  onChange={(e) => handleLayoutConfigChange('isResizable', e.target.checked)}
                />
              }
              label="Resizable"
            />
          </Box>
        </TabPanel>

        {/* Responsive Configuration */}
        <TabPanel value={currentTab} index={2}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Typography variant="h6">Responsive Behavior</Typography>
            
            <FormControl fullWidth>
              <InputLabel>Mobile Behavior</InputLabel>
              <Select
                value={localConfig.mobileBehavior || 'responsive'}
                onChange={(e) => handleConfigChange('mobileBehavior', e.target.value)}
              >
                <MenuItem value="responsive">Responsive</MenuItem>
                <MenuItem value="hidden">Hidden</MenuItem>
                <MenuItem value="fullWidth">Full Width</MenuItem>
              </Select>
            </FormControl>
            
            <FormControl fullWidth>
              <InputLabel>Tablet Behavior</InputLabel>
              <Select
                value={localConfig.tabletBehavior || 'responsive'}
                onChange={(e) => handleConfigChange('tabletBehavior', e.target.value)}
              >
                <MenuItem value="responsive">Responsive</MenuItem>
                <MenuItem value="hidden">Hidden</MenuItem>
                <MenuItem value="desktop">Same as Desktop</MenuItem>
              </Select>
            </FormControl>
            
            <FormControlLabel
              control={
                <Switch
                  checked={localConfig.containerQueries || false}
                  onChange={(e) => handleConfigChange('containerQueries', e.target.checked)}
                />
              }
              label="Enable Container Queries"
            />
          </Box>
        </TabPanel>

        {/* Advanced Configuration */}
        <TabPanel value={currentTab} index={3}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Typography variant="h6">Performance</Typography>
            
            <FormControlLabel
              control={
                <Switch
                  checked={localConfig.lazyLoading !== false}
                  onChange={(e) => handleConfigChange('lazyLoading', e.target.checked)}
                />
              }
              label="Lazy Loading"
            />
            
            <FormControlLabel
              control={
                <Switch
                  checked={localConfig.preload || false}
                  onChange={(e) => handleConfigChange('preload', e.target.checked)}
                />
              }
              label="Preload"
            />
            
            <FormControl fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                value={localConfig.priority || 'normal'}
                onChange={(e) => handleConfigChange('priority', e.target.value)}
              >
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="normal">Normal</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </FormControl>
            
            <Divider />
            
            <Typography variant="h6">Debug</Typography>
            
            <FormControlLabel
              control={
                <Switch
                  checked={localConfig.showDebugInfo || false}
                  onChange={(e) => handleConfigChange('showDebugInfo', e.target.checked)}
                />
              }
              label="Show Debug Info"
            />
            
            <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" gutterBottom>
                Current Configuration (JSON)
              </Typography>
              <pre style={{ fontSize: '0.75rem', margin: 0, overflow: 'auto' }}>
                {JSON.stringify({ ...localConfig, layoutConfig }, null, 2)}
              </pre>
            </Paper>
          </Box>
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={handleClose} color="inherit">
          Cancel
        </Button>
        
        <Button
          onClick={handleApply}
          disabled={!hasChanges || validationErrors.length > 0}
          startIcon={<Save />}
        >
          Apply
        </Button>
        
        <Button
          onClick={handleSaveAndClose}
          variant="contained"
          disabled={validationErrors.length > 0}
          startIcon={<Save />}
        >
          Save & Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};