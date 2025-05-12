/**
 * Represents a plugin in the system
 */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  type: string;
  enabled: boolean;
  icon?: string;
  category?: string;
  status: string;
  official: boolean;
  author: string;
  lastUpdated: string;
  compatibility: string;
  downloads: number;
  scope?: string;
  bundleMethod?: string;
  bundleLocation?: string;
  isLocal: boolean;
  longDescription?: string;
  configFields?: Record<string, any>;
  messages?: Record<string, any>;
  dependencies?: string[];
  modules: Module[];
}

/**
 * Represents a module within a plugin
 */
export interface Module {
  id: string;
  pluginId: string;
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  category?: string;
  enabled: boolean;
  priority: number;
  props?: Record<string, any>;
  configFields?: Record<string, any>;
  messages?: Record<string, any>;
  requiredServices?: string[];
  dependencies?: string[];
  layout?: Record<string, any>;
  tags?: string[];
  author?: string;
  lastUpdated?: string;
}
