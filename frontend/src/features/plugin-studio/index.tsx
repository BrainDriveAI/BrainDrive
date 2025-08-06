import React from 'react';
import { PluginStudioProvider } from './context/PluginStudioProvider';
import { PluginStudioLayoutUnified } from './components/PluginStudioLayoutUnified';
import { PluginStudioLayout } from './components/PluginStudioLayout';

/**
 * Main entry point for the Plugin Studio feature
 * @returns The Plugin Studio page component
 */
export const PluginStudioPage: React.FC = () => {
  // Use unified layout by default, with fallback to legacy
  // Use import.meta.env for Vite instead of process.env
  const useUnifiedLayout = import.meta.env.VITE_PLUGIN_STUDIO_UNIFIED !== 'false';
  
  return (
    <PluginStudioProvider>
      {useUnifiedLayout ? (
        <PluginStudioLayoutUnified />
      ) : (
        <PluginStudioLayout />
      )}
    </PluginStudioProvider>
  );
};

// Export types
export * from './types';

// Export hooks
export * from './hooks';

// Export context
export * from './context';

// Export constants
export * from './constants';

// Export components
export * from './components';