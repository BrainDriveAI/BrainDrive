import React, { useState, useEffect } from 'react';
import { Switch, FormControlLabel, Box, Chip, Tooltip } from '@mui/material';
import { PluginStudioLayoutUnified } from './PluginStudioLayoutUnified'; // Current system
import { PluginStudioLayoutDirect } from './PluginStudioLayoutDirect'; // New system

/**
 * Migration wrapper component that allows switching between legacy and direct integration
 * 
 * This component provides:
 * - Safe migration path with easy rollback
 * - Side-by-side testing of both systems
 * - Development toggle for testing
 * - Production-ready feature flag support
 */
export const PluginStudioLayoutMigration: React.FC = () => {
  // Check for feature flag or localStorage preference
  const [useDirect, setUseDirect] = useState(() => {
    // Check environment variable first (production feature flag)
    if (import.meta.env.VITE_PLUGIN_STUDIO_DIRECT === 'true') {
      return true;
    }
    
    // Check localStorage for development preference
    if (import.meta.env.MODE === 'development') {
      return localStorage.getItem('plugin-studio-use-direct') === 'true';
    }
    
    // Default to legacy system for safety
    return false;
  });

  const [migrationError, setMigrationError] = useState<Error | null>(null);

  // Handle toggle between systems
  const handleToggle = (checked: boolean) => {
    try {
      setUseDirect(checked);
      setMigrationError(null);
      
      // Save preference in development
      if (import.meta.env.MODE === 'development') {
        localStorage.setItem('plugin-studio-use-direct', checked.toString());
      }
      
      console.log(`[PluginStudioMigration] Switched to ${checked ? 'Direct' : 'Legacy'} system`);
    } catch (error) {
      console.error('[PluginStudioMigration] Toggle failed:', error);
      setMigrationError(error as Error);
    }
  };

  // Handle errors from the direct system and fallback to legacy
  const handleDirectSystemError = (error: Error) => {
    console.error('[PluginStudioMigration] Direct system failed, falling back to legacy:', error);
    setMigrationError(error);
    setUseDirect(false);
    
    // Clear localStorage preference on error
    if (import.meta.env.MODE === 'development') {
      localStorage.removeItem('plugin-studio-use-direct');
    }
  };

  // Log system status for debugging
  useEffect(() => {
    console.log(`[PluginStudioMigration] Using ${useDirect ? 'Direct Integration' : 'Legacy Adapter'} system`);
  }, [useDirect]);

  return (
    <Box sx={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Development Controls */}
      {import.meta.env.MODE === 'development' && (
        <Box sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'background.paper',
          p: 1,
          borderRadius: 1,
          boxShadow: 2
        }}>
          <FormControlLabel
            control={
              <Switch
                checked={useDirect}
                onChange={(e) => handleToggle(e.target.checked)}
                size="small"
                color="primary"
              />
            }
            label={
              <Tooltip title="Toggle between direct UnifiedPageRenderer integration and legacy PluginStudioAdapter">
                <span style={{ fontSize: '0.75rem', fontWeight: 'medium' }}>
                  Direct Integration
                </span>
              </Tooltip>
            }
          />
          
          <Chip
            label={useDirect ? 'DIRECT' : 'LEGACY'}
            size="small"
            color={useDirect ? 'success' : 'warning'}
            variant="filled"
            sx={{ fontSize: '0.7rem', fontWeight: 'bold' }}
          />
          
          {migrationError && (
            <Tooltip title={`Error: ${migrationError.message}`}>
              <Chip
                label="ERROR"
                size="small"
                color="error"
                variant="filled"
                sx={{ fontSize: '0.7rem', fontWeight: 'bold' }}
              />
            </Tooltip>
          )}
        </Box>
      )}

      {/* Production Status Indicator */}
      {import.meta.env.MODE === 'production' && useDirect && (
        <Box sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1000,
          bgcolor: 'success.main',
          color: 'white',
          px: 1,
          py: 0.5,
          borderRadius: 1,
          fontSize: '0.75rem',
          fontWeight: 'bold'
        }}>
          DIRECT INTEGRATION
        </Box>
      )}

      {/* Error Display */}
      {migrationError && (
        <Box sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 9999,
          bgcolor: 'error.light',
          color: 'error.contrastText',
          p: 2,
          borderRadius: 1,
          maxWidth: 400,
          fontSize: '0.875rem'
        }}>
          <strong>Migration Error:</strong> {migrationError.message}
          <br />
          <em>Automatically switched to legacy system.</em>
        </Box>
      )}

      {/* Render appropriate system */}
      {useDirect ? (
        <ErrorBoundary onError={handleDirectSystemError}>
          <PluginStudioLayoutDirect />
        </ErrorBoundary>
      ) : (
        <PluginStudioLayoutUnified />
      )}
    </Box>
  );
};

/**
 * Error boundary specifically for the direct system
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError: (error: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[PluginStudioMigration] Direct system error:', error, errorInfo);
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          p: 3,
          color: 'error.main'
        }}>
          <h2>Direct Integration Failed</h2>
          <p>Switching back to legacy system...</p>
          {this.state.error && (
            <pre style={{ fontSize: '0.875rem', marginTop: 16 }}>
              {this.state.error.message}
            </pre>
          )}
        </Box>
      );
    }

    return this.props.children;
  }
}

export default PluginStudioLayoutMigration;