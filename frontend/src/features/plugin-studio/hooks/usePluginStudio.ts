import { useContext } from 'react';
import { PluginStudioContext, PluginStudioContextType } from '../context/PluginStudioContext';

/**
 * Custom hook to access the PluginStudio context
 * @returns The PluginStudio context
 * @throws Error if used outside of a PluginStudioProvider
 */
export const usePluginStudio = (): PluginStudioContextType => {
  const context = useContext(PluginStudioContext);
  
  if (!context) {
    throw new Error('usePluginStudio must be used within a PluginStudioProvider');
  }
  
  return context;
};