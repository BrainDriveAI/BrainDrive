import { Layout } from 'react-grid-layout';

export interface PluginMessage {
  type: string;
  content: Record<string, any>;
  metadata?: {
    timestamp: string;
    sender: string;
    target?: string;
    moduleId?: string; // Added moduleId to track which module sent the message
  };
}

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

export interface PluginConnection {
  from: string;  // Plugin instance ID
  to: string;    // Plugin instance ID or '*' for broadcast
  messageTypes: string[];  // Types of messages this connection handles
  moduleId?: string;  // Optional module ID for module-specific connections
}

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select';

export interface ConfigFieldOption {
  label: string;
  value: string | number | boolean;
}

export interface ConfigField {
  type: ConfigFieldType;
  label: string;
  description?: string;
  default?: any;
  options?: ConfigFieldOption[];
  transform?: (value: any) => any;
}

export interface PluginConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  component: React.ComponentType<any>;
  configFields?: Record<string, ConfigField>;
  messages?: {
    sends?: MessageSchema[];    // Messages this plugin can send
    receives?: MessageSchema[]; // Messages this plugin can receive
  };
}

export interface ServiceRequirement {
  methods?: string[];
  version?: string;
}

export interface RequiredServices {
  [serviceName: string]: ServiceRequirement;
}

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

export interface DynamicPluginConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  scope?: string;
  modules: DynamicModuleConfig[];  // Changed from string[] to ModuleConfig[]
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
  database_id?: string;  // Added for multi-user support - stores the original database ID
  user_id?: string;      // Added for multi-user support - stores the user ID
}

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

export interface GridItem extends Layout {
  i: string;
  pluginId: string;
  minW?: number;
  minH?: number;
  args?: Record<string, any>;
  islocal?: boolean;
}

// New interfaces for the updated page layout system
export interface ModuleDefinition {
  pluginId: string;
  moduleId: string;
  moduleName: string;
  config: Record<string, any>;
}

export interface LayoutItem {
  moduleUniqueId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  configOverrides?: Record<string, any>;
  i: string; // Required by react-grid-layout
}

export interface Layouts {
  desktop: (GridItem | LayoutItem)[];
  tablet?: (GridItem | LayoutItem)[];
  mobile?: (GridItem | LayoutItem)[];
}

export interface Page {
  id: string;
  name: string;
  description: string;
  
  // For backward compatibility, we'll keep the old layouts property
  // but add the new modules and layouts properties for the new structure
  layouts?: Layouts;
  
  // New properties for the updated page layout system
  modules?: Record<string, ModuleDefinition>;
  
  defaultBreakpoints?: {
    tablet?: number;
    mobile?: number;
  };
  route?: string;
  route_segment?: string;         // Just this page's segment of the route
  parent_route?: string;
  parent_type?: string;           // Type of parent: 'page', 'dashboard', 'plugin-studio', 'settings'
  is_published?: boolean;
  publish_date?: string;
  backup_date?: string;
  content?: any;
  content_backup?: any;
  creator_id?: string;
  navigation_route_id?: string;
  
  // Enhanced routing fields for nested routes
  is_parent_page?: boolean;       // Flag indicating if this is a parent page that can have children
  children?: string[];            // Array of child page IDs
  display_in_navigation?: boolean; // Whether to show in navigation menus
  navigation_order?: number;      // Order in navigation menus
  icon?: string;                  // Icon for navigation display
}
