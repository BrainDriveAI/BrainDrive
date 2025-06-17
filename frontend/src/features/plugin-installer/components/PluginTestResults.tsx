import React from 'react';
import {
  Alert,
  AlertTitle,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Divider
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  Storage as StorageIcon,
  Code as CodeIcon,
  CloudDownload as CloudDownloadIcon,
  Extension as ExtensionIcon
} from '@mui/icons-material';
import { PluginTestResponse } from '../types';

interface PluginTestResultsProps {
  result: PluginTestResponse | null;
}

const PluginTestResults: React.FC<PluginTestResultsProps> = ({ result }) => {
  if (!result) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'success';
      case 'error': return 'error';
      case 'partial': return 'warning';
      default: return 'info';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircleIcon />;
      case 'error': return <ErrorIcon />;
      case 'partial': return <WarningIcon />;
      default: return <InfoIcon />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'success': return 'Passed';
      case 'error': return 'Failed';
      case 'partial': return 'Partial Success';
      default: return 'Unknown';
    }
  };

  const TestDetailsDisplay: React.FC<{ details: any }> = ({ details }) => {
    const { backend, frontend, overall } = details;

    return (
      <Box>
        {/* Backend Test Results */}
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', mt: 1 }}>
          Backend Validation
        </Typography>
        <List dense>
          <ListItem>
            <ListItemIcon>
              <StorageIcon color={backend?.plugin_installed ? 'success' : 'error'} />
            </ListItemIcon>
            <ListItemText
              primary="Plugin Installation"
              secondary={backend?.plugin_installed ? 'Plugin is installed in database' : 'Plugin not found in database'}
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <StorageIcon color={backend?.files_exist ? 'success' : 'error'} />
            </ListItemIcon>
            <ListItemText
              primary="Plugin Files"
              secondary={backend?.files_exist ? 'Plugin files exist in storage' : 'Plugin files missing from storage'}
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <CodeIcon color={backend?.manifest_valid ? 'success' : 'error'} />
            </ListItemIcon>
            <ListItemText
              primary="Manifest Validation"
              secondary={backend?.manifest_valid ? 'Plugin manifest is valid' : 'Plugin manifest is invalid or missing'}
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <CloudDownloadIcon color={backend?.bundle_accessible ? 'success' : 'error'} />
            </ListItemIcon>
            <ListItemText
              primary="Bundle Accessibility"
              secondary={backend?.bundle_accessible ? 'Plugin bundle is accessible' : 'Plugin bundle cannot be accessed'}
            />
          </ListItem>
        </List>

        {/* Module Configuration Results */}
        {backend?.modules_configured && backend.modules_configured.length > 0 && (
          <>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', mt: 2 }}>
              Module Configuration
            </Typography>
            <List dense>
              {backend.modules_configured.map((module: any, index: number) => (
                <ListItem key={index}>
                  <ListItemIcon>
                    <ExtensionIcon color={module.configured ? 'success' : 'error'} />
                  </ListItemIcon>
                  <ListItemText
                    primary={module.moduleName}
                    secondary={
                      <>
                        <span>
                          {module.configured ? 'Properly configured' : 'Configuration issues'}
                        </span>
                        {module.issues && module.issues.length > 0 && (
                          <Box sx={{ mt: 0.5 }}>
                            {module.issues.map((issue: string, issueIndex: number) => (
                              <Chip
                                key={issueIndex}
                                label={issue}
                                size="small"
                                color="warning"
                                variant="outlined"
                                sx={{ mr: 0.5, mb: 0.5 }}
                              />
                            ))}
                          </Box>
                        )}
                      </>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Frontend Test Results */}
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold' }}>
          Frontend Loading Test
        </Typography>

        {frontend?.success ? (
          <Box>
            <Typography variant="body2" color="success.main" sx={{ mb: 1 }}>
              ✅ Plugin loaded successfully in frontend
            </Typography>
            {frontend.loadedModules && (
              <Typography variant="body2" color="text.secondary">
                Loaded {frontend.loadedModules} module(s)
              </Typography>
            )}
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" color="error.main" sx={{ mb: 1 }}>
              ❌ Plugin failed to load in frontend
            </Typography>
            {frontend?.error && (
              <Typography variant="body2" color="text.secondary">
                Error: {frontend.error}
              </Typography>
            )}
          </Box>
        )}

        {/* Module Instantiation Results */}
        {frontend?.moduleTests && frontend.moduleTests.length > 0 && (
          <>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', mt: 2 }}>
              Module Instantiation
            </Typography>
            <List dense>
              {frontend.moduleTests.map((moduleTest: any, index: number) => (
                <ListItem key={index}>
                  <ListItemIcon>
                    <ExtensionIcon color={moduleTest.success ? 'success' : 'error'} />
                  </ListItemIcon>
                  <ListItemText
                    primary={moduleTest.moduleName}
                    secondary={
                      <>
                        <span>
                          {moduleTest.success ? 'Successfully instantiated' : 'Failed to instantiate'}
                        </span>
                        {moduleTest.error && (
                          <Box component="div" sx={{ mt: 0.5 }}>
                            <Typography variant="body2" color="error.main">
                              Error: {moduleTest.error}
                            </Typography>
                          </Box>
                        )}
                      </>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}

        {/* Backend Errors and Warnings */}
        {backend?.errors && backend.errors.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', color: 'error.main' }}>
              Errors
            </Typography>
            <Box>
              {backend.errors.map((error: string, index: number) => (
                <Typography key={index} variant="body2" color="error.main" sx={{ mb: 0.5 }}>
                  • {error}
                </Typography>
              ))}
            </Box>
          </>
        )}

        {backend?.warnings && backend.warnings.length > 0 && (
          <>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', color: 'warning.main', mt: 1 }}>
              Warnings
            </Typography>
            <Box>
              {backend.warnings.map((warning: string, index: number) => (
                <Typography key={index} variant="body2" color="warning.main" sx={{ mb: 0.5 }}>
                  • {warning}
                </Typography>
              ))}
            </Box>
          </>
        )}

        {/* Overall Assessment and Recommendations */}
        {overall && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold' }}>
              Overall Assessment
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Chip
                label={overall.canLoad ? 'Can Load' : 'Cannot Load'}
                color={overall.canLoad ? 'success' : 'error'}
                size="small"
                sx={{ mr: 1, mb: 1 }}
              />
              <Chip
                label={overall.canInstantiate ? 'Can Instantiate' : 'Cannot Instantiate'}
                color={overall.canInstantiate ? 'success' : 'error'}
                size="small"
                sx={{ mr: 1, mb: 1 }}
              />
            </Box>

            {overall.recommendations && overall.recommendations.length > 0 && (
              <>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold', color: 'info.main' }}>
                  Recommendations
                </Typography>
                <Box>
                  {overall.recommendations.map((rec: string, index: number) => (
                    <Typography key={index} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      💡 {rec}
                    </Typography>
                  ))}
                </Box>
              </>
            )}
          </>
        )}
      </Box>
    );
  };

  return (
    <Alert
      severity={getStatusColor(result.status)}
      icon={getStatusIcon(result.status)}
      sx={{ mb: 2 }}
    >
      <AlertTitle>
        Plugin Loading Test {getStatusText(result.status)}
      </AlertTitle>

      <Typography variant="body2" sx={{ mb: 2 }}>
        {result.message}
      </Typography>

      {/* Detailed Results */}
      <Accordion sx={{ mt: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            View Detailed Test Results
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TestDetailsDisplay details={result.details} />
        </AccordionDetails>
      </Accordion>
    </Alert>
  );
};

export default PluginTestResults;