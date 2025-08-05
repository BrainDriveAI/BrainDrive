import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  FormLabel,
  FormGroup,
  FormControlLabel,
  Switch,
  Select,
  MenuItem,
  InputLabel,
  Chip,
  Box,
  Typography,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  Close,
  Save,
  Refresh,
  Code,
  Visibility,
  Settings,
  Info,
  Warning,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { PageData, ModuleConfig } from '../../types';
import { StudioModuleConfig } from '../../utils/PluginStudioAdapter';
import { ModuleInfo, PluginInfo } from './StudioToolbar';

export interface StudioDialogsProps {
  // Dialog state
  configDialogOpen: boolean;
  jsonViewOpen: boolean;
  pageSettingsOpen: boolean;
  
  // Data
  pageData: PageData;
  selectedModule?: StudioModuleConfig;
  availablePlugins: PluginInfo[];
  
  // Event handlers
  onConfigDialogClose: () => void;
  onJsonViewClose: () => void;
  onPageSettingsClose: () => void;
  onModuleConfigSave: (moduleId: string, config: any) => void;
  onPageDataSave: (pageData: PageData) => void;
  
  // Configuration
  showAdvancedOptions?: boolean;
  enableJsonEditing?: boolean;
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
    id={`studio-tabpanel-${index}`}
    aria-labelledby={`studio-tab-${index}`}
    {...other}
  >
    {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
  </div>
);

/**
 * StudioDialogs - Configuration and management dialogs for Plugin Studio
 * 
 * This component provides:
 * - Module configuration dialog with dynamic form generation
 * - JSON view dialog for advanced editing
 * - Page settings dialog for page-level configuration
 * - Validation and error handling
 * - Tabbed interface for complex configurations
 */
export const StudioDialogs: React.FC<StudioDialogsProps> = ({
  configDialogOpen,
  jsonViewOpen,
  pageSettingsOpen,
  pageData,
  selectedModule,
  availablePlugins,
  onConfigDialogClose,
  onJsonViewClose,
  onPageSettingsClose,
  onModuleConfigSave,
  onPageDataSave,
  showAdvancedOptions = true,
  enableJsonEditing = true,
}) => {
  const [configTabValue, setConfigTabValue] = useState(0);
  const [moduleConfig, setModuleConfig] = useState<any>({});
  const [pageConfig, setPageConfig] = useState<PageData>(pageData);
  const [jsonContent, setJsonContent] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Get module info from plugin data
  const moduleInfo = useMemo(() => {
    if (!selectedModule) return null;
    
    const plugin = availablePlugins.find(p => p.id === selectedModule.pluginId);
    const module = plugin?.modules.find(m => m.id === selectedModule.moduleId);
    
    return { plugin, module };
  }, [selectedModule, availablePlugins]);

  // Initialize module config when dialog opens
  useEffect(() => {
    if (configDialogOpen && selectedModule) {
      setModuleConfig(selectedModule.config || {});
      setHasUnsavedChanges(false);
      setConfigTabValue(0);
    }
  }, [configDialogOpen, selectedModule]);

  // Initialize page config when dialog opens
  useEffect(() => {
    if (pageSettingsOpen) {
      setPageConfig(pageData);
      setHasUnsavedChanges(false);
    }
  }, [pageSettingsOpen, pageData]);

  // Initialize JSON content when dialog opens
  useEffect(() => {
    if (jsonViewOpen) {
      try {
        const content = selectedModule 
          ? JSON.stringify(selectedModule, null, 2)
          : JSON.stringify(pageData, null, 2);
        setJsonContent(content);
        setJsonError(null);
      } catch (error) {
        setJsonError('Failed to serialize data to JSON');
      }
    }
  }, [jsonViewOpen, selectedModule, pageData]);

  // Handle module config changes
  const handleModuleConfigChange = useCallback((field: string, value: any) => {
    setModuleConfig((prev: any) => ({
      ...prev,
      [field]: value,
    }));
    setHasUnsavedChanges(true);
  }, []);

  // Handle page config changes
  const handlePageConfigChange = useCallback((field: string, value: any) => {
    setPageConfig(prev => ({
      ...prev,
      [field]: value,
    }));
    setHasUnsavedChanges(true);
  }, []);

  // Handle JSON content changes
  const handleJsonContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const content = event.target.value;
    setJsonContent(content);
    
    // Validate JSON
    try {
      JSON.parse(content);
      setJsonError(null);
      setHasUnsavedChanges(true);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }, []);

  // Handle module config save
  const handleModuleConfigSave = useCallback(() => {
    if (!selectedModule) return;
    
    onModuleConfigSave(selectedModule.instanceId, moduleConfig);
    setHasUnsavedChanges(false);
    onConfigDialogClose();
  }, [selectedModule, moduleConfig, onModuleConfigSave, onConfigDialogClose]);

  // Handle page config save
  const handlePageConfigSave = useCallback(() => {
    onPageDataSave(pageConfig);
    setHasUnsavedChanges(false);
    onPageSettingsClose();
  }, [pageConfig, onPageDataSave, onPageSettingsClose]);

  // Handle JSON save
  const handleJsonSave = useCallback(() => {
    if (jsonError) return;
    
    try {
      const parsedData = JSON.parse(jsonContent);
      
      if (selectedModule) {
        onModuleConfigSave(selectedModule.instanceId, parsedData.config || parsedData);
      } else {
        onPageDataSave(parsedData);
      }
      
      setHasUnsavedChanges(false);
      onJsonViewClose();
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Failed to parse JSON');
    }
  }, [jsonContent, jsonError, selectedModule, onModuleConfigSave, onPageDataSave, onJsonViewClose]);

  // Render form field based on type
  const renderFormField = useCallback((
    key: string,
    fieldConfig: any,
    value: any,
    onChange: (key: string, value: any) => void
  ) => {
    const { type, label, description, options, required, min, max } = fieldConfig;
    
    switch (type) {
      case 'text':
      case 'string':
        return (
          <TextField
            key={key}
            fullWidth
            label={label || key}
            value={value || ''}
            onChange={(e) => onChange(key, e.target.value)}
            helperText={description}
            required={required}
            margin="normal"
          />
        );
        
      case 'number':
        return (
          <TextField
            key={key}
            fullWidth
            type="number"
            label={label || key}
            value={value || ''}
            onChange={(e) => onChange(key, parseFloat(e.target.value) || 0)}
            helperText={description}
            required={required}
            inputProps={{ min, max }}
            margin="normal"
          />
        );
        
      case 'boolean':
        return (
          <FormControlLabel
            key={key}
            control={
              <Switch
                checked={Boolean(value)}
                onChange={(e) => onChange(key, e.target.checked)}
              />
            }
            label={label || key}
          />
        );
        
      case 'select':
        return (
          <FormControl key={key} fullWidth margin="normal">
            <InputLabel>{label || key}</InputLabel>
            <Select
              value={value || ''}
              onChange={(e) => onChange(key, e.target.value)}
              label={label || key}
            >
              {options?.map((option: any) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label || option.value}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );
        
      case 'array':
        return (
          <Box key={key} sx={{ my: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              {label || key}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {(value || []).map((item: any, index: number) => (
                <Chip
                  key={index}
                  label={item}
                  onDelete={() => {
                    const newArray = [...(value || [])];
                    newArray.splice(index, 1);
                    onChange(key, newArray);
                  }}
                />
              ))}
            </Box>
            <TextField
              fullWidth
              size="small"
              placeholder="Add item and press Enter"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  const input = e.target as HTMLInputElement;
                  const newValue = input.value.trim();
                  if (newValue) {
                    onChange(key, [...(value || []), newValue]);
                    input.value = '';
                  }
                }
              }}
              sx={{ mt: 1 }}
            />
          </Box>
        );
        
      default:
        return (
          <TextField
            key={key}
            fullWidth
            label={label || key}
            value={typeof value === 'object' ? JSON.stringify(value) : value || ''}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onChange(key, parsed);
              } catch {
                onChange(key, e.target.value);
              }
            }}
            helperText={description || 'Complex field - enter JSON or text'}
            multiline
            rows={3}
            margin="normal"
          />
        );
    }
  }, []);

  return (
    <>
      {/* Module Configuration Dialog */}
      <Dialog
        open={configDialogOpen}
        onClose={onConfigDialogClose}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { minHeight: '60vh' } }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h6">
                Configure Module
              </Typography>
              {moduleInfo?.module && (
                <Typography variant="body2" color="text.secondary">
                  {moduleInfo.plugin?.name} • {moduleInfo.module.displayName}
                </Typography>
              )}
            </Box>
            <IconButton onClick={onConfigDialogClose}>
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent>
          {selectedModule && moduleInfo?.module ? (
            <Box>
              <Tabs value={configTabValue} onChange={(_, value) => setConfigTabValue(value)}>
                <Tab label="Configuration" />
                <Tab label="Layout" />
                {showAdvancedOptions && <Tab label="Advanced" />}
              </Tabs>
              
              <TabPanel value={configTabValue} index={0}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {moduleInfo.module.description}
                </Typography>
                
                {/* Render configuration fields */}
                <Box sx={{ mt: 2 }}>
                  {Object.entries(moduleConfig).map(([key, value]) =>
                    renderFormField(key, { type: 'text' }, value, handleModuleConfigChange)
                  )}
                  
                  {/* Add new field */}
                  <Button
                    startIcon={<Settings />}
                    onClick={() => {
                      const fieldName = prompt('Enter field name:');
                      if (fieldName) {
                        handleModuleConfigChange(fieldName, '');
                      }
                    }}
                    sx={{ mt: 2 }}
                  >
                    Add Field
                  </Button>
                </Box>
              </TabPanel>
              
              <TabPanel value={configTabValue} index={1}>
                <Typography variant="subtitle2" gutterBottom>
                  Layout Configuration
                </Typography>
                
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField
                    label="Width"
                    type="number"
                    value={selectedModule.layoutConfig?.w || 4}
                    onChange={(e) => handleModuleConfigChange('layoutConfig', {
                      ...selectedModule.layoutConfig,
                      w: parseInt(e.target.value) || 4
                    })}
                  />
                  <TextField
                    label="Height"
                    type="number"
                    value={selectedModule.layoutConfig?.h || 3}
                    onChange={(e) => handleModuleConfigChange('layoutConfig', {
                      ...selectedModule.layoutConfig,
                      h: parseInt(e.target.value) || 3
                    })}
                  />
                </Box>
              </TabPanel>
              
              {showAdvancedOptions && (
                <TabPanel value={configTabValue} index={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Advanced Options
                  </Typography>
                  
                  <FormGroup>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={selectedModule.studioConfig?.enableDragDrop !== false}
                          onChange={(e) => handleModuleConfigChange('studioConfig', {
                            ...selectedModule.studioConfig,
                            enableDragDrop: e.target.checked
                          })}
                        />
                      }
                      label="Enable Drag & Drop"
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={selectedModule.studioConfig?.enableResize !== false}
                          onChange={(e) => handleModuleConfigChange('studioConfig', {
                            ...selectedModule.studioConfig,
                            enableResize: e.target.checked
                          })}
                        />
                      }
                      label="Enable Resize"
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={selectedModule.studioConfig?.showDebugInfo === true}
                          onChange={(e) => handleModuleConfigChange('studioConfig', {
                            ...selectedModule.studioConfig,
                            showDebugInfo: e.target.checked
                          })}
                        />
                      }
                      label="Show Debug Info"
                    />
                  </FormGroup>
                </TabPanel>
              )}
            </Box>
          ) : (
            <Alert severity="warning">
              No module selected or module information not available.
            </Alert>
          )}
        </DialogContent>
        
        <DialogActions>
          <Button onClick={onConfigDialogClose}>
            Cancel
          </Button>
          <Button
            onClick={handleModuleConfigSave}
            variant="contained"
            startIcon={<Save />}
            disabled={!hasUnsavedChanges}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* JSON View Dialog */}
      <Dialog
        open={jsonViewOpen}
        onClose={onJsonViewClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { minHeight: '70vh' } }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Code />
              <Typography variant="h6">
                JSON Editor
              </Typography>
            </Box>
            <IconButton onClick={onJsonViewClose}>
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent>
          {jsonError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>JSON Error:</strong> {jsonError}
              </Typography>
            </Alert>
          )}
          
          <TextField
            fullWidth
            multiline
            rows={20}
            value={jsonContent}
            onChange={handleJsonContentChange}
            variant="outlined"
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
            disabled={!enableJsonEditing}
          />
        </DialogContent>
        
        <DialogActions>
          <Button onClick={onJsonViewClose}>
            Cancel
          </Button>
          {enableJsonEditing && (
            <Button
              onClick={handleJsonSave}
              variant="contained"
              startIcon={<Save />}
              disabled={!hasUnsavedChanges || Boolean(jsonError)}
            >
              Apply Changes
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Page Settings Dialog */}
      <Dialog
        open={pageSettingsOpen}
        onClose={onPageSettingsClose}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">Page Settings</Typography>
            <IconButton onClick={onPageSettingsClose}>
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Page Name"
              value={pageConfig.name || ''}
              onChange={(e) => handlePageConfigChange('name', e.target.value)}
              margin="normal"
            />
            
            <TextField
              fullWidth
              label="Route"
              value={pageConfig.route || ''}
              onChange={(e) => handlePageConfigChange('route', e.target.value)}
              margin="normal"
              helperText="URL path for this page (e.g., /about, /contact)"
            />
            
            <TextField
              fullWidth
              label="Page Title"
              value={pageConfig.metadata?.title || ''}
              onChange={(e) => handlePageConfigChange('metadata', {
                ...pageConfig.metadata,
                title: e.target.value
              })}
              margin="normal"
            />
            
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Description"
              value={pageConfig.metadata?.description || ''}
              onChange={(e) => handlePageConfigChange('metadata', {
                ...pageConfig.metadata,
                description: e.target.value
              })}
              margin="normal"
            />
            
            <FormControlLabel
              control={
                <Switch
                  checked={pageConfig.isPublished || false}
                  onChange={(e) => handlePageConfigChange('isPublished', e.target.checked)}
                />
              }
              label="Published"
              sx={{ mt: 2 }}
            />
          </Box>
        </DialogContent>
        
        <DialogActions>
          <Button onClick={onPageSettingsClose}>
            Cancel
          </Button>
          <Button
            onClick={handlePageConfigSave}
            variant="contained"
            startIcon={<Save />}
            disabled={!hasUnsavedChanges}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default StudioDialogs;