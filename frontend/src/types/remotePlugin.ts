import { DynamicPluginConfig, MessageSchema, RequiredServices } from './index';
import React from 'react';

// The backend returns an object with plugin IDs as keys and plugin configs as values
export type RemotePluginResponse = Record<string, DynamicPluginConfig>;

export interface LoadedModule {
  id?: string;                 // Unique identifier for the module
  name: string;                // Name used for loading the module
  displayName?: string;        // Human-readable name for display
  description?: string;        // Description of the module
  icon?: string;               // Icon for the module
  category?: string;           // Category for grouping in the toolbox
  tags?: string[];             // Tags for filtering
  component: React.ComponentType<any>; // The actual React component
  props?: Record<string, any>; // Default props for the module
  
  // Module-specific configuration properties
  configFields?: Record<string, any>; // Configuration fields specific to this module
  messages?: {                        // Message schemas specific to this module
    sends?: MessageSchema[];    
    receives?: MessageSchema[]; 
  };  
  priority?: number;           // Priority for sorting/displaying
  dependencies?: string[];     // Module-specific dependencies
  layout?: {                   // Layout constraints for this module
    minWidth?: number;
    minHeight?: number;
    defaultWidth?: number;
    defaultHeight?: number;
  }
  type?: 'frontend' | 'backend'; // Module type
  requiredServices?: RequiredServices; // Added required services at the module level
}

export interface LoadedRemotePlugin extends DynamicPluginConfig {
  // For backward compatibility
  component: React.ComponentType<any>;
  config: Omit<DynamicPluginConfig, 'component'>;
  // New field for multi-module support
  loadedModules: LoadedModule[];
  islocal: boolean;
}
