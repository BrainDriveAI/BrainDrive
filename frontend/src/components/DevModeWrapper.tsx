import React from 'react';
import { usePluginStudioDevMode } from '../hooks/usePluginStudioDevMode';

interface DevModeWrapperProps {
  children: React.ReactNode;
  feature?: keyof ReturnType<typeof usePluginStudioDevMode>['features'];
}

export const DevModeWrapper: React.FC<DevModeWrapperProps> = ({ children, feature }) => {
  const { isPluginStudioDevMode, features } = usePluginStudioDevMode();
  
  if (!isPluginStudioDevMode) {
    return null;
  }
  
  if (feature && !features[feature]) {
    return null;
  }
  
  return <>{children}</>;
};