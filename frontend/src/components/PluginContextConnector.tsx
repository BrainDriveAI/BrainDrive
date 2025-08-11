import React, { useEffect } from 'react';
import { usePluginLoading } from '../contexts/PluginLoadingContext';
import { setPluginLoadingContext } from '../plugins';

/**
 * PluginContextConnector
 * 
 * This component connects the reactive PluginLoadingContext to the global
 * plugin registry system, enabling backward compatibility while providing
 * reactive updates for plugin loading state.
 */
export const PluginContextConnector: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pluginLoadingContext = usePluginLoading();

  useEffect(() => {
    // Set the context reference in the global plugin registry (only once)
    setPluginLoadingContext(pluginLoadingContext);
    console.log('[PluginContextConnector] Connected plugin loading context to global registry');

    return () => {
      // Clean up on unmount
      setPluginLoadingContext(null);
      console.log('[PluginContextConnector] Disconnected plugin loading context from global registry');
    };
  }, []); // Empty dependency array - only run once on mount

  return <>{children}</>;
};