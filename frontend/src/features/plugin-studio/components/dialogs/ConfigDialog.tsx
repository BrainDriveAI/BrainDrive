import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { usePluginStudio } from '../../hooks';
import {
  ConfigDialogHeader,
  ConfigFieldsSection,
  useConfigDialogState
} from './config-dialog';

interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog for configuring a plugin
 * @param props The component props
 * @returns The config dialog component
 */
export const ConfigDialog: React.FC<ConfigDialogProps> = ({ open, onClose }) => {
  const { selectedItem, currentPage } = usePluginStudio();
  
  const {
    config,
    layoutConfig,
    configMode,
    errors,
    isSaving,
    configFields,
    selectedModule,
    moduleDef,
    pluginDef,
    currentDeviceType,
    handleConfigChange,
    handleConfigModeToggle,
    handleSave,
    handleInputFocus,
    inputRefs
  } = useConfigDialogState({ open, selectedItem, currentPage });

  return (
    <Dialog
      open={open}
      onClose={() => {
        // Only allow closing if not saving
        if (!isSaving) {
          onClose();
        }
      }}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { height: '80vh', display: 'flex', flexDirection: 'column' }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">
            Configure Module
          </Typography>
        </Box>
        <IconButton
          edge="end"
          color="inherit"
          onClick={onClose}
          aria-label="close"
          disabled={isSaving}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ flex: 1, overflow: 'auto' }}>
        {!selectedItem ? (
          <Typography variant="body1">No module selected</Typography>
        ) : !moduleDef ? (
          <Typography variant="body1">Module definition not found</Typography>
        ) : (
          <Box sx={{ py: 1 }}>
            {/* Module information header */}
            <ConfigDialogHeader 
              moduleDef={moduleDef} 
              pluginDef={pluginDef} 
            />

            {/* Configuration fields */}
            <ConfigFieldsSection
              configFields={configFields}
              config={config}
              layoutConfig={layoutConfig}
              configMode={configMode}
              errors={errors}
              currentDeviceType={currentDeviceType}
              handleConfigChange={handleConfigChange}
              handleConfigModeToggle={handleConfigModeToggle}
              handleInputFocus={handleInputFocus}
              inputRefs={inputRefs}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          color="inherit"
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          onClick={() => handleSave(onClose)}
          color="primary"
          variant="contained"
          disabled={isSaving || !selectedItem || Object.keys(errors).length > 0}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};