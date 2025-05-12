import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Paper
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { usePluginStudio } from '../../hooks';

interface JsonViewDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog for viewing the JSON representation of the current page
 * @param props The component props
 * @returns The JSON view dialog component
 */
export const JsonViewDialog: React.FC<JsonViewDialogProps> = ({ open, onClose }) => {
  const { currentPage } = usePluginStudio();
  const [tabValue, setTabValue] = useState(0);
  const [copied, setCopied] = useState(false);
  
  // Handle tab change
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };
  
  // Get the JSON to display based on the selected tab
  const getJsonContent = () => {
    if (!currentPage) return '{}';
    
    switch (tabValue) {
      case 0: // Full Page
        return JSON.stringify(currentPage, null, 2);
      case 1: // Layouts
        return JSON.stringify(currentPage.layouts, null, 2);
      case 2: // Modules
        return JSON.stringify(currentPage.modules, null, 2);
      default:
        return '{}';
    }
  };
  
  // Copy JSON to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(getJsonContent());
    setCopied(true);
    
    // Reset copied state after 2 seconds
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };
  
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          height: '80vh',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Page JSON</Typography>
        <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="json view tabs">
          <Tab label="Full Page" />
          <Tab label="Layouts" />
          <Tab label="Modules" />
        </Tabs>
      </Box>
      
      <DialogContent sx={{ flex: 1, overflow: 'auto', p: 0 }}>
        <Box sx={{ position: 'relative', height: '100%' }}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              height: '100%',
              overflow: 'auto',
              backgroundColor: '#f5f5f5',
              borderRadius: 0
            }}
          >
            <pre
              style={{
                margin: 0,
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {getJsonContent()}
            </pre>
          </Paper>
          
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 1
            }}
          >
            <Button
              variant="contained"
              size="small"
              color={copied ? 'success' : 'primary'}
              onClick={handleCopy}
              startIcon={<ContentCopyIcon />}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </Box>
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};