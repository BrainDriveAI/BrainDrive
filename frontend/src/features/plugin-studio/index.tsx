import React from 'react';
import { PluginStudioProvider } from './context/PluginStudioProvider';
import { PluginStudioLayout } from './components/PluginStudioLayout';

/**
 * Main entry point for the Plugin Studio feature
 * @returns The Plugin Studio page component
 */
export const PluginStudioPage: React.FC = () => {
  return (
    <PluginStudioProvider>
      <PluginStudioLayout />
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