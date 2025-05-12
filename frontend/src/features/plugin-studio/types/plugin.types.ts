import { ReactNode } from 'react';
import { Layout } from 'react-grid-layout';

/**
 * Configuration field for plugin settings
 */
export interface ConfigField {
  type: ConfigFieldType;
  label: string;
  description?: string;
  default?: any;
  options?: ConfigFieldOption[];
  transform?: (value: any) => any;
  enum?: string[];
}

/**
 * Types of configuration fields
 */
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select';

/**
 * Option for select-type configuration fields
 */
export interface ConfigFieldOption {
  label: string;
  value: string | number | boolean;
}

/**
 * Service requirement definition for a plugin
 */
export interface ServiceRequirement {
  /**
   * List of methods required from this service
   */
  methods?: string[];
  
  /**
   * Minimum required version of the service
   */
  version?: string;
}

/**
 * Required services for a plugin
 */
export interface RequiredServices {
  [serviceName: string]: ServiceRequirement;
}

/**
 * Message schema for plugin communication
 */
export interface MessageSchema {
  type: string;
  description: string;
  contentSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      required?: boolean;
    }>;
  };
}

/**
 * Configuration for a module within a plugin
 */
export interface DynamicModuleConfig {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  category?: string;
  tags?: string[];
  component?: React.ComponentType<any>;
  props?: Record<string, any>;
  configFields?: Record<string, ConfigField>;
  messages?: {
    sends?: MessageSchema[];
    receives?: MessageSchema[];
  };
  priority?: number;
  dependencies?: string[];
  layout?: {
    minWidth?: number;
    minHeight?: number;
    defaultWidth?: number;
    defaultHeight?: number;
  };
  type?: 'frontend' | 'backend';
  requiredServices?: RequiredServices;
  enabled?: boolean;
}

/**
 * Configuration for a plugin
 */
export interface DynamicPluginConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  scope?: string;
  modules: DynamicModuleConfig[];
  bundlemethod?: 'webpack' | 'vite';
  bundlelocation?: string;
  islocal?: boolean;
  icon?: string;
  category?: string;
  status?: "activated" | "deactivated";
  official?: boolean;
  author?: string;
  lastUpdated?: string;
  compatibility?: string;
  downloads?: number;
}

/**
 * Grid item for the layout
 */
export interface GridItem extends Layout {
  i: string;
  pluginId: string;
  minW?: number;
  minH?: number;
  args?: Record<string, any>;
  islocal?: boolean;
}

/**
 * Data structure for dragging modules
 */
export interface DragData {
  pluginId: string;
  moduleId: string;
  moduleName: string;
  displayName: string;
  category: string;
  isLocal: boolean;
  tags?: string[];
  description?: string;
  icon?: string;
  type?: 'frontend' | 'backend';
  priority?: number;
  dependencies?: string[];
  layout?: {
    minWidth?: number;
    minHeight?: number;
    defaultWidth?: number;
    defaultHeight?: number;
  };
}

/**
 * Definition of a module in a page
 */
export interface ModuleDefinition {
  pluginId: string;
  moduleId: string;
  moduleName: string;
  config: Record<string, any>;
  _lastUpdated?: number;
  _moduleUpdated?: number;
}