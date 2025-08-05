/**
 * Legacy Plugin Adapter
 * 
 * Provides default behavior and property mapping for legacy plugins
 * to work with the unified dynamic page renderer system.
 */

import { ModuleConfig, PageData } from '../types';

// Define ModuleDefinition interface locally since it's not exported from types
interface ModuleDefinition {
  pluginId: string;
  moduleId: string;
  moduleName: string;
  config: Record<string, any>;
}

export interface LegacyPluginConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  scope: string;
  modules: LegacyModuleConfig[];
  type: string;
  bundlemethod: string;
  bundlelocation: string;
  islocal: boolean;
  icon: string;
  category: string;
  status: string;
  official: boolean;
  author: string;
  lastUpdated: string;
  compatibility: string;
  downloads: number;
}

export interface LegacyModuleConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  enabled: boolean;
  props: Record<string, any>;
  configFields: Record<string, any>;
  requiredServices: Record<string, any>;
  messages: {
    sends?: any[];
    receives?: any[];
  };
  priority: number;
  dependencies: string[];
  layout: {
    minWidth: number;
    minHeight: number;
    defaultWidth: number;
    defaultHeight: number;
  };
}

/**
 * Default properties for legacy plugins that don't have new system properties
 */
export const DEFAULT_PLUGIN_PROPERTIES = {
  long_description: (description: string) => `Enhanced version of ${description}`,
  source_type: 'local' as const,
  source_url: '',
  update_check_url: '',
  installation_type: 'local' as const,
  permissions: ['storage.read', 'storage.write', 'api.access'],
  bundle_method: 'webpack' as const,
  is_local: true,
};

export const DEFAULT_MODULE_PROPERTIES = {
  messages: {},
  dependencies: [],
  required_services: {
    api: { methods: ['get', 'post'], version: '1.0.0' },
    theme: { methods: ['getCurrentTheme', 'addThemeChangeListener', 'removeThemeChangeListener'], version: '1.0.0' },
  },
};

/**
 * Converts legacy plugin configuration to new unified format
 */
export function adaptLegacyPlugin(legacyPlugin: LegacyPluginConfig): any {
  return {
    // Direct mappings
    plugin_slug: legacyPlugin.id,
    name: legacyPlugin.name,
    description: legacyPlugin.description,
    version: legacyPlugin.version,
    scope: legacyPlugin.scope,
    icon: legacyPlugin.icon,
    category: legacyPlugin.category,
    official: legacyPlugin.official,
    author: legacyPlugin.author,
    compatibility: legacyPlugin.compatibility,
    
    // Property name changes
    bundle_method: legacyPlugin.bundlemethod || DEFAULT_PLUGIN_PROPERTIES.bundle_method,
    bundle_location: legacyPlugin.bundlelocation,
    is_local: legacyPlugin.islocal,
    
    // New properties with defaults
    long_description: DEFAULT_PLUGIN_PROPERTIES.long_description(legacyPlugin.description),
    source_type: DEFAULT_PLUGIN_PROPERTIES.source_type,
    source_url: DEFAULT_PLUGIN_PROPERTIES.source_url,
    update_check_url: DEFAULT_PLUGIN_PROPERTIES.update_check_url,
    installation_type: DEFAULT_PLUGIN_PROPERTIES.installation_type,
    permissions: DEFAULT_PLUGIN_PROPERTIES.permissions,
    
    // Convert modules
    modules: legacyPlugin.modules.map(adaptLegacyModule),
  };
}

/**
 * Converts legacy module configuration to new unified format
 */
export function adaptLegacyModule(legacyModule: LegacyModuleConfig): any {
  return {
    // Property name changes
    name: legacyModule.id, // id becomes name
    display_name: legacyModule.displayName || legacyModule.name,
    
    // Direct mappings
    description: legacyModule.description,
    icon: legacyModule.icon,
    category: legacyModule.category,
    tags: legacyModule.tags,
    priority: legacyModule.priority,
    props: legacyModule.props,
    layout: legacyModule.layout,
    
    // Handle enabled property - preserve it for backward compatibility
    enabled: legacyModule.enabled !== undefined ? legacyModule.enabled : true,
    
    // Enhanced config fields
    config_fields: adaptConfigFields(legacyModule.configFields),
    
    // Enhanced service requirements
    required_services: {
      ...DEFAULT_MODULE_PROPERTIES.required_services,
      ...adaptServiceRequirements(legacyModule.requiredServices),
    },
    
    // New properties with defaults
    messages: legacyModule.messages || DEFAULT_MODULE_PROPERTIES.messages,
    dependencies: legacyModule.dependencies || DEFAULT_MODULE_PROPERTIES.dependencies,
  };
}

/**
 * Adapts legacy config fields to new enhanced format
 */
export function adaptConfigFields(legacyFields: Record<string, any>): Record<string, any> {
  if (!legacyFields) return {};
  
  const adaptedFields: Record<string, any> = {};
  
  for (const [key, field] of Object.entries(legacyFields)) {
    adaptedFields[key] = {
      // Map legacy 'string' type to new 'text' type
      type: field.type === 'string' ? 'text' : field.type,
      description: field.label || field.description || `Configuration for ${key}`,
      default: field.default,
      
      // Preserve options for select fields
      ...(field.options && { options: field.options }),
    };
  }
  
  return adaptedFields;
}

/**
 * Adapts legacy service requirements to new versioned format
 */
export function adaptServiceRequirements(legacyServices: Record<string, any>): Record<string, any> {
  if (!legacyServices) return {};
  
  const adaptedServices: Record<string, any> = {};
  
  for (const [serviceName, serviceConfig] of Object.entries(legacyServices)) {
    adaptedServices[serviceName] = {
      methods: serviceConfig.methods || [],
      version: serviceConfig.version || '1.0.0',
    };
  }
  
  return adaptedServices;
}

/**
 * Converts legacy ModuleDefinition to unified ModuleConfig format
 */
export function convertLegacyModuleDefinition(moduleDefinition: ModuleDefinition): ModuleConfig {
  return {
    // Basic properties
    pluginId: moduleDefinition.pluginId,
    moduleId: moduleDefinition.moduleId,
    moduleName: moduleDefinition.moduleName,
    
    // Configuration
    ...moduleDefinition.config,
    
    // Add responsive configuration if not present
    responsive: {
      mobile: {},
      tablet: {},
      desktop: {},
      wide: {},
    },
    
    // Performance hints
    lazy: true,
    priority: 'normal' as const,
    preload: false,
  };
}

/**
 * Creates a compatibility layer for legacy page modules
 */
export function adaptLegacyPageModules(page: any): ModuleConfig[] {
  if (!page.modules) return [];
  
  // Handle both array and object formats
  let modulesArray: any[] = [];
  
  if (Array.isArray(page.modules)) {
    modulesArray = page.modules;
  } else if (typeof page.modules === 'object') {
    modulesArray = Object.values(page.modules);
  }
  
  return modulesArray.map((module: any) => {
    // If it's already a ModuleDefinition, convert it
    if (module.pluginId && module.moduleId) {
      return convertLegacyModuleDefinition(module as ModuleDefinition);
    }
    
    // Otherwise, create a basic ModuleConfig
    return {
      pluginId: module.pluginId || 'unknown',
      moduleId: module.moduleId || module.id || module.name,
      moduleName: module.moduleName || module.name || module.displayName,
      ...module.config,
      
      // Add defaults
      responsive: {
        mobile: {},
        tablet: {},
        desktop: {},
        wide: {},
      },
      lazy: true,
      priority: 'normal' as const,
      preload: false,
    };
  });
}

/**
 * Provides backward compatibility warnings for deprecated properties
 */
export function logCompatibilityWarnings(legacyConfig: any, context: string): void {
  const warnings: string[] = [];
  
  // Check for deprecated properties
  if (legacyConfig.bundlemethod) {
    warnings.push(`'bundlemethod' is deprecated, use 'bundle_method' instead`);
  }
  
  if (legacyConfig.bundlelocation) {
    warnings.push(`'bundlelocation' is deprecated, use 'bundle_location' instead`);
  }
  
  if (legacyConfig.islocal !== undefined) {
    warnings.push(`'islocal' is deprecated, use 'is_local' instead`);
  }
  
  // Check for missing new properties
  if (!legacyConfig.long_description) {
    warnings.push(`Consider adding 'long_description' for better user experience`);
  }
  
  if (!legacyConfig.permissions) {
    warnings.push(`Consider adding 'permissions' array for security`);
  }
  
  if (warnings.length > 0) {
    console.warn(`[${context}] Compatibility warnings:`, warnings);
  }
}

/**
 * Migration helper to update legacy plugins
 */
export class LegacyPluginMigrator {
  static migratePlugin(legacyPlugin: LegacyPluginConfig): any {
    logCompatibilityWarnings(legacyPlugin, `Plugin: ${legacyPlugin.name}`);
    return adaptLegacyPlugin(legacyPlugin);
  }
  
  static migrateModule(legacyModule: LegacyModuleConfig): any {
    logCompatibilityWarnings(legacyModule, `Module: ${legacyModule.displayName}`);
    return adaptLegacyModule(legacyModule);
  }
  
  static migratePage(legacyPage: any): PageData {
    const adaptedModules = adaptLegacyPageModules(legacyPage);
    
    return {
      id: legacyPage.id,
      name: legacyPage.name,
      route: legacyPage.route || `/${legacyPage.name}`,
      layouts: {
        mobile: legacyPage.layouts?.mobile || [],
        tablet: legacyPage.layouts?.tablet || [],
        desktop: legacyPage.layouts?.desktop || [],
        wide: legacyPage.layouts?.wide || [],
      },
      modules: adaptedModules,
      metadata: {
        title: legacyPage.name,
        description: legacyPage.description || '',
        lastModified: new Date(),
      },
      isPublished: legacyPage.is_published || false,
    };
  }
}

// Export the migrator class as default
export default LegacyPluginMigrator;