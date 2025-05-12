import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Box,
  TextField,
  Alert,
  Snackbar
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { GridItem, LayoutItem, ModuleDefinition, Page } from '../types/index';

interface JsonViewDialogProps {
  open: boolean;
  onClose: () => void;
  item?: GridItem;
  layouts?: any;
  onLayoutChange?: (newLayouts: any) => void;
  page?: Page;
  onPageChange?: (page: Page) => void;
}

export const JsonViewDialog: React.FC<JsonViewDialogProps> = ({
  open,
  onClose,
  item,
  layouts,
  onLayoutChange,
  page,
  onPageChange
}) => {
  const [jsonContent, setJsonContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showCopySuccess, setShowCopySuccess] = useState(false);

  useEffect(() => {
    if (open) {
      // If a page is provided, use it directly
      if (page) {
        setJsonContent(JSON.stringify(page, null, 2));
      } else {
        // Otherwise, use the new format with modules
        const content = {
          id: layouts?.pageId || '',
          name: layouts?.pageName || '',
          description: layouts?.pageDescription || '',
          layouts: layouts?.layouts || layouts,
          modules: layouts?.modules || {}
        };
        setJsonContent(JSON.stringify(content, null, 2));
      }
      setError(null);
    }
  }, [open, layouts, page]);

  const handleJsonChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonContent(event.target.value);
    setError(null);
  };

  const validateAndLoadJson = () => {
    try {
      const parsedJson = JSON.parse(jsonContent);
      
      // Validate page structure
      if (!parsedJson.id || !parsedJson.name) {
        throw new Error('Invalid page configuration. Required fields: id, name');
      }
      
      // Check if we're using the new module-based format
      if (parsedJson.modules) {
        // Validate modules
        if (typeof parsedJson.modules !== 'object') {
          throw new Error('Invalid modules configuration. Must be an object');
        }
        
        // Validate each module
        Object.entries(parsedJson.modules).forEach(([moduleId, module]: [string, any]) => {
          if (!module.pluginId || !module.moduleId || !module.moduleName || !module.config) {
            throw new Error(`Invalid module definition for ${moduleId}. Required fields: pluginId, moduleId, moduleName, config`);
          }
        });
        
        // Validate layouts
        if (!parsedJson.layouts || !parsedJson.layouts.desktop) {
          throw new Error('Invalid layout configuration. Must include at least desktop layout');
        }
        
        // Validate each layout item
        Object.entries(parsedJson.layouts).forEach(([key, layout]: [string, any]) => {
          if (Array.isArray(layout)) {
            layout.forEach((item: any, index: number) => {
              if (!item.moduleUniqueId || typeof item.x !== 'number' || typeof item.y !== 'number' ||
                  typeof item.w !== 'number' || typeof item.h !== 'number') {
                throw new Error(`Invalid layout item at index ${index}. Required fields: moduleUniqueId, x, y, w, h`);
              }
              
              // Validate that the moduleUniqueId exists in the modules object
              if (!parsedJson.modules[item.moduleUniqueId]) {
                throw new Error(`Module with ID ${item.moduleUniqueId} not found in modules object`);
              }
            });
          }
        });
        
        // If validation passes, update the page
        if (onPageChange) {
          onPageChange(parsedJson);
          onClose();
          return;
        }
      } else {
        // Legacy format validation
        const layoutsData = parsedJson.layouts;
        if (!layoutsData || !layoutsData.desktop) {
          throw new Error('Invalid layout configuration. Must include at least desktop layout');
        }
        
        // Validate each layout item
        Object.entries(layoutsData).forEach(([key, layout]: [string, any]) => {
          if (Array.isArray(layout)) {
            layout.forEach((item: any, index: number) => {
              if (!item.i || typeof item.x !== 'number' || typeof item.y !== 'number' ||
                  typeof item.w !== 'number' || typeof item.h !== 'number' || !item.pluginId) {
                throw new Error(`Invalid layout item at index ${index}. Required fields: i, x, y, w, h, pluginId`);
              }
            });
          }
        });
      }

      // If validation passes, update the layout (legacy format)
      if (onLayoutChange) {
        onLayoutChange(parsedJson.layouts);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON format');
    }
  };

  const handleCopy = async () => {
    if (!jsonContent) {
      setError('No content to copy');
      return;
    }
  
    try {
      if (navigator.clipboard && (window.isSecureContext || location.hostname === "localhost")) {
        await navigator.clipboard.writeText(jsonContent);
        setShowCopySuccess(true);
        return;
      }
    } catch (error) {
      console.error("Clipboard API failed, trying fallback...");
    }
  
    // Fallback for HTTP
    copyWithExecCommand();
  };
  
  const copyWithExecCommand = () => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = jsonContent;

      // Ensure the textarea is visible (some browsers ignore `select()` on hidden elements)
      textArea.style.position = 'absolute';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '1px';
      textArea.style.height = '1px';
      textArea.style.opacity = '0';

      document.body.appendChild(textArea);

      // Ensure text is fully selected
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, textArea.value.length);

      // Try copying
      const success = document.execCommand('copy');

      // Remove the textarea after copying
      document.body.removeChild(textArea);

      if (success) {
        setShowCopySuccess(true);
      } else {
        setError('Clipboard copy failed.');
      }
    } catch (error) {
      setError('Clipboard copy failed.');
      console.error('Error copying text: ', error);
    }
  };

  return (
    <>
      <Dialog 
        open={open} 
        onClose={onClose}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ 
          m: 0, 
          p: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          Page Layout JSON
          <IconButton
            aria-label="close"
            onClick={onClose}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            multiline
            fullWidth
            value={jsonContent}
            onChange={handleJsonChange}
            variant="outlined"
            sx={{
              '& .MuiInputBase-root': {
                fontFamily: 'monospace',
                fontSize: '0.875rem'
              }
            }}
            minRows={15}
            maxRows={30}
            error={!!error}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handleCopy} color="info">
            Copy to Clipboard
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={validateAndLoadJson}
            disabled={!onLayoutChange && !onPageChange}
          >
            Apply Changes
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={showCopySuccess}
        autoHideDuration={2000}
        onClose={() => setShowCopySuccess(false)}
        message="Copied to clipboard"
      />
    </>
  );
};
