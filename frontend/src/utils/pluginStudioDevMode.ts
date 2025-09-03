import React from 'react';
import { config } from '../config';

export const isPluginStudioDevMode = (): boolean => {
  return config.devMode.pluginStudio;
};

export const withPluginStudioDevMode = <T>(component: T): T | null => {
  return isPluginStudioDevMode() ? component : null;
};

export const PluginStudioDevModeWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return isPluginStudioDevMode() ? React.createElement(React.Fragment, null, children) : null;
};

export const withPluginStudioDevModeControl = <P extends object>(
  Component: React.ComponentType<P>
) => {
  return (props: P) => {
    return isPluginStudioDevMode() ? React.createElement(Component, props) : null;
  };
};