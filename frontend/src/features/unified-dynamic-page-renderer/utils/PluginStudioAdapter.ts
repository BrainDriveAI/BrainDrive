/**
 * Plugin Studio Adapter
 * 
 * Extends the existing LegacyPluginAdapter to provide Plugin Studio specific
 * functionality while maintaining full backward compatibility.
 * 
 * This adapter leverages the proven service bridge patterns from ServiceExample_PluginState
 * and other working service examples.
 */

import { LegacyPluginMigrator } from './LegacyPluginAdapter';
import { ModuleConfig, PageData } from '../types';

export interface StudioModuleConfig extends ModuleConfig {
  // Studio-specific properties
  studioConfig?: {
    showDebugInfo?: boolean;
    autoSave?: boolean;
    validateState?: boolean;
    enableDragDrop?: boolean;
    enableResize?: boolean;
    enableConfigure?: boolean;
    enableDelete?: boolean;
  };
  
  // Layout hints for studio mode
  layoutHints?: {
    defaultWidth?: number;
    defaultHeight?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    aspectRatio?: number;
    resizable?: boolean;
    draggable?: boolean;
  };
}

export interface StudioPageData extends PageData {
  studioMetadata?: {
    lastEditedBy?: string;
    lastEditedAt?: Date;
    version?: string;
    isDraft?: boolean;
    autoSaveEnabled?: boolean;
  };
}

/**
 * Plugin Studio Adapter - extends existing LegacyPluginMigrator
 * 
 * This class provides minimal extensions to the existing proven adapter
 * to support Plugin Studio specific functionality.
 */
export class PluginStudioAdapter extends LegacyPluginMigrator {
  
  /**
   * Adapt Plugin Studio module props to match service bridge example pattern
   * 
   * This method ensures that legacy Plugin Studio modules work with the
   * unified renderer using the same proven pattern as ServiceExample_PluginState
   */
  static adaptPluginStudioModule(legacyModule: any): StudioModuleConfig {
    // Use existing migration logic as base
    const baseModule = this.migrateModule(legacyModule);
    
    return {
      ...baseModule,
      
      // Ensure props match service bridge example pattern (like PluginStateDemoProps)
      moduleId: legacyModule.moduleId || legacyModule.moduleName,
      pluginId: legacyModule.pluginId,
      instanceId: legacyModule.uniqueId || legacyModule.instanceId || `${legacyModule.pluginId}_${Date.now()}`,
      
      // Pass through services (already working in service examples!)
      services: legacyModule.services,
      
      // Studio-specific configuration
      studioConfig: {
        showDebugInfo: legacyModule.currentDeviceType === 'desktop',
        autoSave: legacyModule.autoSave !== false,
        validateState: legacyModule.validateState !== false,
        enableDragDrop: legacyModule.enableDragDrop !== false,
        enableResize: legacyModule.enableResize !== false,
        enableConfigure: legacyModule.enableConfigure !== false,
        enableDelete: legacyModule.enableDelete !== false,
        ...legacyModule.studioConfig,
      },
      
      // Layout hints for WYSIWYG editing
      layoutHints: {
        defaultWidth: legacyModule.layout?.defaultWidth || 4,
        defaultHeight: legacyModule.layout?.defaultHeight || 3,
        minWidth: legacyModule.layout?.minWidth || 1,
        minHeight: legacyModule.layout?.minHeight || 1,
        maxWidth: legacyModule.layout?.maxWidth || 12,
        maxHeight: legacyModule.layout?.maxHeight || 20,
        aspectRatio: legacyModule.layout?.aspectRatio,
        resizable: legacyModule.layout?.resizable !== false,
        draggable: legacyModule.layout?.draggable !== false,
        ...legacyModule.layoutHints,
      },
      
      // Enhanced configuration with studio-specific defaults
      config: {
        ...baseModule.config,
        ...legacyModule.layoutConfig,
        // Add any studio-specific config transformations here
      }
    };
  }
  
  /**
   * Adapt legacy Plugin Studio page data to unified format
   * 
   * Extends the existing migratePage method with studio-specific enhancements
   */
  static migrateStudioPage(legacyPage: any): StudioPageData {
    // Use existing page migration as base
    const basePage = this.migratePage(legacyPage);
    
    return {
      ...basePage,
      
      // Studio-specific metadata
      studioMetadata: {
        lastEditedBy: legacyPage.lastEditedBy || 'unknown',
        lastEditedAt: legacyPage.lastEditedAt ? new Date(legacyPage.lastEditedAt) : new Date(),
        version: legacyPage.version || '1.0.0',
        isDraft: legacyPage.isDraft || !legacyPage.isPublished,
        autoSaveEnabled: legacyPage.autoSaveEnabled !== false,
        ...legacyPage.studioMetadata,
      },
      
      // Adapt modules with studio-specific enhancements
      modules: legacyPage.modules?.map((module: any) => 
        this.adaptPluginStudioModule(module)
      ) || [],
    };
  }
  
  /**
   * Create service bridge configuration for Plugin Studio
   * 
   * Uses the proven pattern from ServiceExample_PluginState to ensure
   * service injection works correctly in studio mode
   */
  static createStudioServiceConfig(
    pluginId: string,
    moduleId: string,
    instanceId: string,
    requiredServices: string[] = ['pluginState', 'pageContext', 'api', 'theme']
  ): any {
    return {
      pluginId,
      moduleId,
      instanceId,
      
      // Use the same service requirements pattern as ServiceExample_PluginState
      services: requiredServices,
      
      // Studio-specific service configuration
      studioServices: {
        pluginState: {
          stateStrategy: 'session',
          preserveKeys: ['layoutData', 'moduleConfig', 'studioPreferences'],
          maxStateSize: 10240, // 10KB like in the example
        },
        pageContext: {
          enableLayoutTracking: true,
          enableModuleTracking: true,
        },
      },
    };
  }
  
  /**
   * Validate that a module is compatible with Plugin Studio
   * 
   * Checks if the module follows the proven service bridge patterns
   */
  static validateStudioCompatibility(moduleConfig: any): {
    isCompatible: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Check for required properties (based on ServiceExample_PluginState pattern)
    if (!moduleConfig.pluginId) {
      issues.push('Missing required pluginId property');
    }
    
    if (!moduleConfig.moduleId) {
      issues.push('Missing required moduleId property');
    }
    
    // Check service bridge compatibility
    if (moduleConfig.services && typeof moduleConfig.services !== 'object') {
      issues.push('Services property must be an object');
    }
    
    // Recommendations based on proven patterns
    if (!moduleConfig.instanceId) {
      recommendations.push('Consider adding instanceId for better state management');
    }
    
    if (!moduleConfig.studioConfig) {
      recommendations.push('Consider adding studioConfig for enhanced studio experience');
    }
    
    if (!moduleConfig.layoutHints) {
      recommendations.push('Consider adding layoutHints for better WYSIWYG editing');
    }
    
    return {
      isCompatible: issues.length === 0,
      issues,
      recommendations,
    };
  }
  
  /**
   * Create a legacy-compatible service bridge for Plugin Studio
   * 
   * This method creates the same service injection pattern that works
   * in ServiceExample_PluginState and other proven examples
   */
  static createLegacyStudioServiceBridge(
    pluginId: string,
    moduleId: string,
    instanceId: string,
    serviceBridgeV2: any,
    requiredServices: string[] = ['pluginState', 'pageContext', 'api', 'theme']
  ): Record<string, any> {
    const legacyBridge: Record<string, any> = {};
    
    requiredServices.forEach(serviceName => {
      try {
        const service = serviceBridgeV2.getService(serviceName, {
          pluginId,
          moduleId,
          instanceId
        });
        
        // Adapt service API to match legacy expectations if needed
        legacyBridge[serviceName] = this.adaptServiceForStudio(serviceName, service);
      } catch (error) {
        console.warn(`[PluginStudioAdapter] Failed to create service bridge for ${serviceName}:`, error);
        // Provide a no-op service to prevent crashes (following proven pattern)
        legacyBridge[serviceName] = this.createNoOpService(serviceName);
      }
    });
    
    return legacyBridge;
  }
  
  /**
   * Adapt service API for Plugin Studio specific needs
   */
  private static adaptServiceForStudio(serviceName: string, service: any): any {
    switch (serviceName) {
      case 'pluginState':
        return {
          ...service,
          // Add studio-specific methods if needed
          saveLayoutState: async (layoutData: any) => {
            return service.saveState({ layoutData, timestamp: new Date().toISOString() });
          },
          getLayoutState: async () => {
            const state = await service.getState();
            return state?.layoutData || null;
          },
        };
        
      case 'pageContext':
        return {
          ...service,
          // Add studio-specific context methods
          getStudioMode: () => 'studio',
          isEditingEnabled: () => true,
        };
        
      default:
        return service; // Return as-is for other services
    }
  }
  
  /**
   * Create a no-op service to prevent crashes (following proven pattern)
   */
  private static createNoOpService(serviceName: string): any {
    const noOpMethods: Record<string, any> = {};
    
    // Common service methods that should be no-ops
    const commonMethods = [
      'configure', 'getConfiguration', 'saveState', 'getState', 'clearState',
      'validateState', 'sanitizeState', 'onSave', 'onRestore', 'onClear'
    ];
    
    commonMethods.forEach(method => {
      noOpMethods[method] = () => {
        console.warn(`[PluginStudioAdapter] No-op service method called: ${serviceName}.${method}`);
        return Promise.resolve(null);
      };
    });
    
    return noOpMethods;
  }
}

// Export the adapter class as default for easy importing
export default PluginStudioAdapter;