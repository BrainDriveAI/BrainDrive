import React, { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Alert,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
  VisibilityOff as HideIcon,
} from '@mui/icons-material';

interface EnhancedJsonViewDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  data?: any;
  readOnly?: boolean;
  onSave?: (data: any) => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`json-tabpanel-${index}`}
      aria-labelledby={`json-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const EnhancedJsonViewDialog: React.FC<EnhancedJsonViewDialogProps> = ({
  open,
  onClose,
  title = 'JSON Data Viewer',
  data,
  readOnly = false,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prettyPrint, setPrettyPrint] = useState(true);
  const [showMetadata, setShowMetadata] = useState(false);

  // Initialize JSON text when dialog opens or data changes
  React.useEffect(() => {
    if (open && data) {
      try {
        const formatted = prettyPrint 
          ? JSON.stringify(data, null, 2)
          : JSON.stringify(data);
        setJsonText(formatted);
        setError(null);
      } catch (err) {
        setError('Failed to serialize data to JSON');
        setJsonText('');
      }
    }
  }, [open, data, prettyPrint]);

  // Parse JSON text and validate
  const parsedData = useMemo(() => {
    if (!jsonText.trim()) return null;
    
    try {
      return JSON.parse(jsonText);
    } catch (err) {
      return null;
    }
  }, [jsonText]);

  // Handle tab change
  const handleTabChange = useCallback((event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  }, []);

  // Handle JSON text change
  const handleJsonChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setJsonText(value);
    
    // Validate JSON
    if (value.trim()) {
      try {
        JSON.parse(value);
        setError(null);
      } catch (err) {
        setError('Invalid JSON syntax');
      }
    } else {
      setError(null);
    }
  }, []);

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      // Could add a toast notification here
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [jsonText]);

  // Handle download as file
  const handleDownload = useCallback(() => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [jsonText, title]);

  // Handle file upload
  const handleUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setJsonText(content);
      
      // Validate uploaded JSON
      try {
        JSON.parse(content);
        setError(null);
      } catch (err) {
        setError('Uploaded file contains invalid JSON');
      }
    };
    reader.readAsText(file);
    
    // Reset input
    event.target.value = '';
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    if (error || !parsedData) return;
    
    onSave?.(parsedData);
    onClose();
  }, [error, parsedData, onSave, onClose]);

  // Handle refresh/reset
  const handleRefresh = useCallback(() => {
    if (data) {
      try {
        const formatted = prettyPrint 
          ? JSON.stringify(data, null, 2)
          : JSON.stringify(data);
        setJsonText(formatted);
        setError(null);
      } catch (err) {
        setError('Failed to serialize data to JSON');
      }
    }
  }, [data, prettyPrint]);

  // Generate metadata
  const metadata = useMemo(() => {
    if (!parsedData) return null;
    
    const getObjectInfo = (obj: any): any => {
      if (obj === null) return { type: 'null', value: null };
      if (Array.isArray(obj)) return { type: 'array', length: obj.length };
      if (typeof obj === 'object') return { type: 'object', keys: Object.keys(obj).length };
      return { type: typeof obj, value: obj };
    };
    
    return {
      size: jsonText.length,
      lines: jsonText.split('\n').length,
      structure: getObjectInfo(parsedData),
      lastModified: new Date().toISOString(),
    };
  }, [parsedData, jsonText]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: '80vh', display: 'flex', flexDirection: 'column' }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">{title}</Typography>
          <Box display="flex" alignItems="center" gap={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={prettyPrint}
                  onChange={(e) => setPrettyPrint(e.target.checked)}
                  size="small"
                />
              }
              label="Pretty Print"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={showMetadata}
                  onChange={(e) => setShowMetadata(e.target.checked)}
                  size="small"
                />
              }
              label="Metadata"
            />
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={activeTab} onChange={handleTabChange}>
            <Tab label="JSON Editor" />
            <Tab label="Tree View" />
            {showMetadata && <Tab label="Metadata" />}
          </Tabs>
        </Box>

        <TabPanel value={activeTab} index={0}>
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Tooltip title="Copy to clipboard">
                <IconButton onClick={handleCopy} size="small">
                  <CopyIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Download as file">
                <IconButton onClick={handleDownload} size="small">
                  <DownloadIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Upload file">
                <IconButton component="label" size="small">
                  <UploadIcon />
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleUpload}
                    style={{ display: 'none' }}
                  />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Reset to original">
                <IconButton onClick={handleRefresh} size="small" disabled={!data}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Box>

            <TextField
              multiline
              fullWidth
              value={jsonText}
              onChange={handleJsonChange}
              disabled={readOnly}
              variant="outlined"
              sx={{
                flex: 1,
                '& .MuiInputBase-root': {
                  height: '100%',
                  alignItems: 'flex-start',
                },
                '& .MuiInputBase-input': {
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  height: '100% !important',
                  overflow: 'auto !important',
                },
              }}
              placeholder="Enter JSON data..."
            />
          </Box>
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            {parsedData ? (
              <pre style={{ 
                margin: 0, 
                fontFamily: 'monospace', 
                fontSize: '0.875rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {JSON.stringify(parsedData, null, 2)}
              </pre>
            ) : (
              <Typography color="text.secondary">
                No valid JSON data to display
              </Typography>
            )}
          </Box>
        </TabPanel>

        {showMetadata && (
          <TabPanel value={activeTab} index={2}>
            <Box sx={{ height: '100%', overflow: 'auto' }}>
              {metadata ? (
                <Box>
                  <Typography variant="h6" gutterBottom>Document Information</Typography>
                  <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'auto 1fr' }}>
                    <Typography variant="body2" color="text.secondary">Size:</Typography>
                    <Typography variant="body2">{metadata.size} characters</Typography>
                    
                    <Typography variant="body2" color="text.secondary">Lines:</Typography>
                    <Typography variant="body2">{metadata.lines}</Typography>
                    
                    <Typography variant="body2" color="text.secondary">Type:</Typography>
                    <Typography variant="body2">{metadata.structure.type}</Typography>
                    
                    {metadata.structure.length !== undefined && (
                      <>
                        <Typography variant="body2" color="text.secondary">Length:</Typography>
                        <Typography variant="body2">{metadata.structure.length}</Typography>
                      </>
                    )}
                    
                    {metadata.structure.keys !== undefined && (
                      <>
                        <Typography variant="body2" color="text.secondary">Keys:</Typography>
                        <Typography variant="body2">{metadata.structure.keys}</Typography>
                      </>
                    )}
                    
                    <Typography variant="body2" color="text.secondary">Last Modified:</Typography>
                    <Typography variant="body2">{new Date(metadata.lastModified).toLocaleString()}</Typography>
                  </Box>
                </Box>
              ) : (
                <Typography color="text.secondary">
                  No metadata available
                </Typography>
              )}
            </Box>
          </TabPanel>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>
          Cancel
        </Button>
        {!readOnly && onSave && (
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!!error || !parsedData}
          >
            Save Changes
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default EnhancedJsonViewDialog;