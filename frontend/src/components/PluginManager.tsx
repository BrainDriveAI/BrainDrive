import React, { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { PluginLoader } from './PluginLoader';
import { registerRemotePlugins } from '../plugins';
import { LoadedRemotePlugin } from '../types/remotePlugin';
import { useAuth } from '../contexts/AuthContext';

interface PluginManagerProps {
  children: React.ReactNode;
}

export const PluginManager: React.FC<PluginManagerProps> = ({ children }) => {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [isPluginsLoading, setIsPluginsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePluginsLoaded = (plugins: LoadedRemotePlugin[]) => {
    try {
      console.log('[PluginManager] Received plugins to register:', plugins);
      registerRemotePlugins(plugins);
      console.log('[PluginManager] Plugins registered successfully');
      setIsPluginsLoading(false);
    } catch (err) {
      console.error('[PluginManager] Error registering remote plugins:', err);
      setError('Failed to register remote plugins');
      setIsPluginsLoading(false);
    }
  };

  // Only show loading spinner when auth is loading
  if (isAuthLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ color: 'error.main', p: 2 }}>
        {error}
      </Box>
    );
  }

  return (
    <>
      {isAuthenticated && <PluginLoader onPluginsLoaded={handlePluginsLoaded} />}
      {children}
    </>
  );
};
