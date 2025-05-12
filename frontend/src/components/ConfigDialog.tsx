import React, { useState, useEffect } from 'react';
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
  Box,
  Typography,
  Divider,
  Grid,
  Switch,
  FormControlLabel
} from '@mui/material';
import { ConfigField, GridItem } from '../types';
import { LayoutItem, ModuleDefinition } from '../types/index';
import { plugins, getModuleById } from '../plugins';

interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onSave?: (config: Record<string, any>, newId?: string) => void;
  item?: GridItem;
  moduleUniqueId?: string;
  moduleDefinition?: ModuleDefinition;
  layoutItem?: LayoutItem;
  currentDeviceType?: string;
}

export const ConfigDialog: React.FC<ConfigDialogProps> = ({
  open,
  onClose,
  onSave,
  item,
  moduleUniqueId,
  moduleDefinition,
  layoutItem,
  currentDeviceType = 'desktop'
}) => {
  // Handle legacy GridItem format
  if (item) {
    // If no item is selected, or plugin is not found, close the dialog
    if (!plugins[item.pluginId]) {
      return null;
    }

    const plugin = plugins[item.pluginId];
    const moduleId = item.args?.moduleId;
    
    // Try to get moduleInfo by moduleId, or fall back to the first module of the plugin
    let moduleInfo = moduleId ? getModuleById(item.pluginId, moduleId) : null;
    
    // If no moduleInfo was found but the plugin has modules, use the first module
    if (!moduleInfo && plugin.modules && plugin.modules.length > 0) {
      moduleInfo = plugin.modules[0];
    }
    
    const [config, setConfig] = useState<Record<string, any>>(item.args || {});
    const [newPluginId, setNewPluginId] = useState(item.i);
    const [newModuleId, setNewModuleId] = useState(moduleInfo?.id || moduleInfo?.name || '');

    useEffect(() => {
      setConfig(item.args || {});
      setNewPluginId(item.i);
      setNewModuleId(moduleInfo?.id || moduleInfo?.name || '');
    }, [item, moduleInfo]);

    const handleChange = (key: string, value: any) => {
      // Check if this is a module-specific field
      const moduleField = moduleInfo?.configFields?.[key];
      const field = moduleField;
      
      const transformedValue = field?.transform ? field.transform(value) : value;
      
      setConfig(prev => ({
        ...prev,
        [key]: transformedValue
      }));
    };

    const handleSave = () => {
      if (!onSave) return;

      const transformedConfig = Object.entries(config).reduce((acc, [key, value]) => {
        // Check if this is a module-specific field
        const moduleField = moduleInfo?.configFields?.[key];
        const field = moduleField;
        
        return {
          ...acc,
          [key]: field?.transform ? field.transform(value) : value
        };
      }, {} as Record<string, any>);
      
      // Add moduleId to the config
      if (moduleInfo) {
        transformedConfig.moduleId = newModuleId;
      }
      
      onSave(transformedConfig, newPluginId !== item.i ? newPluginId : undefined);
      onClose();
    };

    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {moduleInfo ? 
            `Configure ${moduleInfo.displayName || moduleInfo.name} (${plugin.name} v${plugin.version})` : 
            `Configure ${plugin.name} (v${plugin.version})`
          }
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Plugin Identity Section */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {moduleInfo ? 'Module Identity' : 'Plugin Identity'}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {moduleInfo && (
                  <TextField
                    fullWidth
                    size="small"
                    label="Module Type"
                    value={moduleInfo.name}
                    disabled
                    helperText="The type of this module"
                  />
                )}
                <TextField
                  fullWidth
                  size="small"
                  label="Plugin Type"
                  value={plugin.name}
                  disabled
                  helperText="The type of this plugin instance"
                />
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Plugin ID"
                      value={newPluginId}
                      onChange={(e) => setNewPluginId(e.target.value)}
                      helperText="Unique identifier for this plugin instance. Change with caution!"
                    />
                  </Grid>
                  {moduleInfo && (
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Module ID"
                        value={newModuleId}
                        onChange={(e) => setNewModuleId(e.target.value)}
                        helperText="Unique identifier for this module instance"
                      />
                    </Grid>
                  )}
                </Grid>
              </Box>
            </Box>

            <Divider />

            {/* Plugin Configuration Section */}
            {moduleInfo?.configFields && (
              <>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Plugin Configuration
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Only use module-level config fields */}
                  {Object.entries(moduleInfo.configFields).map(([key, field]) => {
                    const value = config[key] ?? field.default;
                    
                    if ((field as any).enum || field.type === 'select') {
                      return (
                        <FormControl key={key} fullWidth size="small">
                          <InputLabel>{field.label}</InputLabel>
                          <Select
                            value={value || ''}
                            label={field.label}
                            onChange={(e) => handleChange(key, e.target.value)}
                          >
                            {(field as any).enum ? (field as any).enum.map((option: string) => (
                              <MenuItem key={option} value={option}>
                                {option}
                              </MenuItem>
                            )) : field.options?.map((option: any) => (
                              <MenuItem key={String(option.value)} value={String(option.value)}>
                                {String(option.label)}
                              </MenuItem>
                            ))}
                          </Select>
                          {field.description && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                              {field.description}
                            </Typography>
                          )}
                        </FormControl>
                      );
                    }

                    return (
                      <Box key={key}>
                        <TextField
                          fullWidth
                          size="small"
                          label={field.label}
                          value={value || ''}
                          onChange={(e) => handleChange(key, e.target.value)}
                          multiline={field.type === 'string' && field.description?.includes('comma-separated')}
                          rows={field.type === 'string' && field.description?.includes('comma-separated') ? 3 : 1}
                        />
                        {field.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                            {field.description}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" color="primary">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
  
  // Handle new module-based format
  if (moduleUniqueId && moduleDefinition && layoutItem) {
    const [globalConfig, setGlobalConfig] = useState<Record<string, any>>(moduleDefinition.config || {});
    const [layoutConfig, setLayoutConfig] = useState<Record<string, any>>(layoutItem.configOverrides || {});
    const [configMode, setConfigMode] = useState<Record<string, 'global' | 'layout'>>({});
    
    // Initialize config modes - determine which properties are global vs layout-specific
    useEffect(() => {
      const initialConfigMode: Record<string, 'global' | 'layout'> = {};
      
      // For each property in the global config, check if it's overridden in the layout
      Object.keys(globalConfig).forEach(key => {
        initialConfigMode[key] = layoutConfig[key] !== undefined ? 'layout' : 'global';
      });
      
      setConfigMode(initialConfigMode);
    }, [globalConfig, layoutConfig]);
    
    // Get module info from the plugin
    const plugin = plugins[moduleDefinition.pluginId];
    const moduleInfo = getModuleById(moduleDefinition.pluginId, moduleDefinition.moduleId);
    
    if (!plugin || !moduleInfo) {
      return null;
    }
    
    // Handle changes to global config
    const handleGlobalChange = (key: string, value: any) => {
      // Check if this is a module-specific field
      const moduleField = moduleInfo?.configFields?.[key];
      const field = moduleField;
      
      const transformedValue = field?.transform ? field.transform(value) : value;
      
      setGlobalConfig(prev => ({
        ...prev,
        [key]: transformedValue
      }));
    };

    // Handle changes to layout config
    const handleLayoutChange = (key: string, value: any) => {
      // Check if this is a module-specific field
      const moduleField = moduleInfo?.configFields?.[key];
      const field = moduleField;
      
      const transformedValue = field?.transform ? field.transform(value) : value;
      
      setLayoutConfig(prev => ({
        ...prev,
        [key]: transformedValue
      }));
    };

    // Handle toggling between global and layout-specific config
    const handleConfigModeToggle = (key: string) => {
      const newMode = configMode[key] === 'global' ? 'layout' : 'global';
      
      // Update the config mode
      setConfigMode(prev => ({
        ...prev,
        [key]: newMode
      }));
      
      // If switching from layout to global, remove the layout override
      if (newMode === 'global') {
        setLayoutConfig(prev => {
          const newConfig = { ...prev };
          delete newConfig[key];
          return newConfig;
        });
      }
      // If switching from global to layout, add the layout override with the global value
      else {
        setLayoutConfig(prev => ({
          ...prev,
          [key]: globalConfig[key]
        }));
      }
    };

    const handleSave = () => {
      if (!onSave) return;
      
      // Create a merged config for the legacy onSave handler
      const mergedConfig = {
        ...globalConfig,
        ...layoutConfig,
        moduleId: moduleDefinition.moduleId,
        moduleName: moduleDefinition.moduleName
      };
      
      // Call the legacy onSave handler
      onSave(mergedConfig);
      onClose();
    };

    // Render a config field with toggle between global and layout-specific
    const renderConfigField = (key: string, field: any) => {
      const isLayoutSpecific = configMode[key] === 'layout';
      const value = isLayoutSpecific ? layoutConfig[key] : globalConfig[key];
      const handleChange = isLayoutSpecific ? handleLayoutChange : handleGlobalChange;
      
      // Determine text color based on whether it's global or layout-specific
      const textColor = isLayoutSpecific ? 'success.main' : 'text.primary';
      
      if ((field as any).enum || field.type === 'select') {
        return (
          <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FormControl fullWidth size="small" sx={{ flex: 1 }}>
              <InputLabel sx={{ color: textColor }}>{field.label}</InputLabel>
              <Select
                value={value || ''}
                label={field.label}
                onChange={(e) => handleChange(key, e.target.value)}
                sx={{ color: textColor }}
              >
                {(field as any).enum ? (field as any).enum.map((option: string) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                )) : field.options?.map((option: any) => (
                  <MenuItem key={String(option.value)} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              {field.description && (
                <Typography variant="caption" color={textColor} sx={{ mt: 0.5 }}>
                  {field.description}
                </Typography>
              )}
            </FormControl>
            <Button
              size="small"
              variant="outlined"
              onClick={() => handleConfigModeToggle(key)}
              sx={{ minWidth: '120px' }}
            >
              {isLayoutSpecific ? `${currentDeviceType} Only` : 'All Layouts'}
            </Button>
          </Box>
        );
      }

      return (
        <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <TextField
              fullWidth
              size="small"
              label={field.label}
              value={value || ''}
              onChange={(e) => handleChange(key, e.target.value)}
              multiline={field.type === 'string' && field.description?.includes('comma-separated')}
              rows={field.type === 'string' && field.description?.includes('comma-separated') ? 3 : 1}
              InputProps={{
                sx: { color: textColor }
              }}
              InputLabelProps={{
                sx: { color: textColor }
              }}
            />
            {field.description && (
              <Typography variant="caption" color={textColor} sx={{ mt: 0.5 }}>
                {field.description}
              </Typography>
            )}
          </Box>
          <Button
            size="small"
            variant="outlined"
            onClick={() => handleConfigModeToggle(key)}
            sx={{ minWidth: '120px' }}
          >
            {isLayoutSpecific ? `${currentDeviceType} Only` : 'All Layouts'}
          </Button>
        </Box>
      );
    };

    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {moduleInfo ? 
            `Configure ${moduleInfo.displayName || moduleInfo.name} (${plugin.name} v${plugin.version})` : 
            `Configure ${plugin.name} (v${plugin.version})`
          }
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Module Identity Section */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Module Identity
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Module Type"
                  value={moduleDefinition.moduleName}
                  disabled
                  helperText="The type of this module"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Plugin Type"
                  value={plugin.name}
                  disabled
                  helperText="The type of this plugin instance"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Module Unique ID"
                  value={moduleUniqueId}
                  disabled
                  helperText="Unique identifier for this module instance"
                />
              </Box>
            </Box>

            <Divider />

            {/* Module Configuration Section */}
            {moduleInfo?.configFields && (
              <>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Module Configuration
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Object.entries(moduleInfo.configFields).map(([key, field]) => 
                    renderConfigField(key, field)
                  )}
                </Box>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" color="primary">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
  
  // If neither format is provided, return null
  return null;
};
