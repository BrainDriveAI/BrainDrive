import { ModuleConfig, RenderMode, BreakpointInfo } from '../types';

export interface ConfigurationHierarchy {
  global: ModuleConfig;
  page?: ModuleConfig;
  module?: ModuleConfig;
  responsive?: ResponsiveConfigOverrides;
  mode?: ModeConfigOverrides;
}

export interface ResponsiveConfigOverrides {
  mobile?: Partial<ModuleConfig>;
  tablet?: Partial<ModuleConfig>;
  desktop?: Partial<ModuleConfig>;
  wide?: Partial<ModuleConfig>;
  ultrawide?: Partial<ModuleConfig>;
}

export interface ModeConfigOverrides {
  studio?: Partial<ModuleConfig>;
  published?: Partial<ModuleConfig>;
  preview?: Partial<ModuleConfig>;
  embed?: Partial<ModuleConfig>;
}

export interface ConfigurationValidationResult {
  isValid: boolean;
  errors: ConfigurationError[];
  warnings: ConfigurationWarning[];
  suggestions: ConfigurationSuggestion[];
}

export interface ConfigurationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  code: string;
}

export interface ConfigurationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

export interface ConfigurationSuggestion {
  path: string;
  message: string;
  suggestedValue: any;
  reason: string;
}

export interface ConfigurationDebugInfo {
  hierarchy: ConfigurationHierarchy;
  resolved: ModuleConfig;
  overrides: ConfigurationOverride[];
  validationResult: ConfigurationValidationResult;
  metadata: {
    resolvedAt: Date;
    breakpoint: string;
    mode: string;
    moduleId: string;
  };
}

export interface ConfigurationOverride {
  source: 'global' | 'page' | 'module' | 'responsive' | 'mode';
  path: string;
  originalValue: any;
  overrideValue: any;
  reason: string;
}

/**
 * Configuration Manager with hierarchy, validation, and debugging
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private globalConfig: ModuleConfig = {};
  private pageConfigs = new Map<string, ModuleConfig>();
  private moduleConfigs = new Map<string, ModuleConfig>();
  private debugMode = false;
  private validationRules = new Map<string, ConfigurationValidationRule>();

  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  constructor() {
    this.setupDefaultValidationRules();
  }

  /**
   * Set global configuration that applies to all modules
   */
  setGlobalConfig(config: ModuleConfig): void {
    this.globalConfig = { ...config };
    console.log('[ConfigurationManager] Global configuration updated');
  }

  /**
   * Set page-specific configuration
   */
  setPageConfig(pageId: string, config: ModuleConfig): void {
    this.pageConfigs.set(pageId, { ...config });
    console.log(`[ConfigurationManager] Page configuration updated for: ${pageId}`);
  }

  /**
   * Set module-specific configuration
   */
  setModuleConfig(moduleId: string, config: ModuleConfig): void {
    this.moduleConfigs.set(moduleId, { ...config });
    console.log(`[ConfigurationManager] Module configuration updated for: ${moduleId}`);
  }

  /**
   * Resolve configuration hierarchy for a specific context
   */
  resolveConfiguration(context: ConfigurationContext): ModuleConfig {
    const startTime = performance.now();
    
    try {
      const hierarchy = this.buildHierarchy(context);
      const resolved = this.mergeConfigurations(hierarchy, context);
      
      if (this.debugMode) {
        this.logConfigurationResolution(hierarchy, resolved, context, startTime);
      }
      
      return resolved;
    } catch (error) {
      console.error('[ConfigurationManager] Failed to resolve configuration:', error);
      return this.globalConfig;
    }
  }

  /**
   * Validate configuration against rules
   */
  validateConfiguration(config: ModuleConfig, context?: ConfigurationContext): ConfigurationValidationResult {
    const result: ConfigurationValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    try {
      // Run validation rules
      for (const [ruleName, rule] of this.validationRules) {
        try {
          const ruleResult = rule.validate(config, context);
          
          if (ruleResult.errors.length > 0) {
            result.errors.push(...ruleResult.errors);
            result.isValid = false;
          }
          
          result.warnings.push(...ruleResult.warnings);
          result.suggestions.push(...ruleResult.suggestions);
        } catch (error) {
          result.errors.push({
            path: 'validation',
            message: `Validation rule '${ruleName}' failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            severity: 'error',
            code: 'VALIDATION_RULE_ERROR'
          });
          result.isValid = false;
        }
      }

      // Basic structure validation
      this.validateBasicStructure(config, result);
      
    } catch (error) {
      result.errors.push({
        path: 'root',
        message: `Configuration validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error',
        code: 'VALIDATION_ERROR'
      });
      result.isValid = false;
    }

    return result;
  }

  /**
   * Get debug information for configuration resolution
   */
  getDebugInfo(context: ConfigurationContext): ConfigurationDebugInfo {
    const hierarchy = this.buildHierarchy(context);
    const resolved = this.mergeConfigurations(hierarchy, context);
    const validationResult = this.validateConfiguration(resolved, context);
    const overrides = this.calculateOverrides(hierarchy, context);

    return {
      hierarchy,
      resolved,
      overrides,
      validationResult,
      metadata: {
        resolvedAt: new Date(),
        breakpoint: context.breakpoint.name,
        mode: context.mode,
        moduleId: context.moduleId
      }
    };
  }

  /**
   * Enable or disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    console.log(`[ConfigurationManager] Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Add custom validation rule
   */
  addValidationRule(name: string, rule: ConfigurationValidationRule): void {
    this.validationRules.set(name, rule);
    console.log(`[ConfigurationManager] Added validation rule: ${name}`);
  }

  /**
   * Remove validation rule
   */
  removeValidationRule(name: string): void {
    this.validationRules.delete(name);
    console.log(`[ConfigurationManager] Removed validation rule: ${name}`);
  }

  /**
   * Get responsive configuration for current breakpoint
   */
  getResponsiveConfig(config: ModuleConfig, breakpoint: BreakpointInfo): ModuleConfig {
    if (!config.responsive) {
      return config;
    }

    const breakpointConfig = config.responsive[breakpoint.name as keyof ResponsiveConfigOverrides];
    if (!breakpointConfig) {
      return config;
    }

    return this.deepMerge(config, breakpointConfig);
  }

  /**
   * Get mode-specific configuration
   */
  getModeConfig(config: ModuleConfig, mode: RenderMode): ModuleConfig {
    if (!config.mode) {
      return config;
    }

    const modeConfig = config.mode[mode as keyof ModeConfigOverrides];
    if (!modeConfig) {
      return config;
    }

    return this.deepMerge(config, modeConfig);
  }

  /**
   * Build configuration hierarchy
   */
  private buildHierarchy(context: ConfigurationContext): ConfigurationHierarchy {
    const hierarchy: ConfigurationHierarchy = {
      global: this.globalConfig
    };

    // Add page config if available
    if (context.pageId) {
      const pageConfig = this.pageConfigs.get(context.pageId);
      if (pageConfig) {
        hierarchy.page = pageConfig;
      }
    }

    // Add module config if available
    const moduleConfig = this.moduleConfigs.get(context.moduleId);
    if (moduleConfig) {
      hierarchy.module = moduleConfig;
    }

    // Add responsive overrides
    if (moduleConfig?.responsive) {
      hierarchy.responsive = moduleConfig.responsive;
    }

    // Add mode overrides
    if (moduleConfig?.mode) {
      hierarchy.mode = moduleConfig.mode;
    }

    return hierarchy;
  }

  /**
   * Merge configurations in hierarchy order
   */
  private mergeConfigurations(hierarchy: ConfigurationHierarchy, context: ConfigurationContext): ModuleConfig {
    let result = { ...hierarchy.global };

    // Merge page config
    if (hierarchy.page) {
      result = this.deepMerge(result, hierarchy.page);
    }

    // Merge module config
    if (hierarchy.module) {
      result = this.deepMerge(result, hierarchy.module);
    }

    // Apply responsive overrides
    if (hierarchy.responsive) {
      const breakpointConfig = hierarchy.responsive[context.breakpoint.name as keyof ResponsiveConfigOverrides];
      if (breakpointConfig) {
        result = this.deepMerge(result, breakpointConfig);
      }
    }

    // Apply mode overrides
    if (hierarchy.mode) {
      const modeConfig = hierarchy.mode[context.mode as keyof ModeConfigOverrides];
      if (modeConfig) {
        result = this.deepMerge(result, modeConfig);
      }
    }

    return result;
  }

  /**
   * Deep merge two configuration objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Calculate configuration overrides
   */
  private calculateOverrides(hierarchy: ConfigurationHierarchy, context: ConfigurationContext): ConfigurationOverride[] {
    const overrides: ConfigurationOverride[] = [];
    
    // This would track which values were overridden at each level
    // Implementation would compare values at each hierarchy level
    
    return overrides;
  }

  /**
   * Validate basic configuration structure
   */
  private validateBasicStructure(config: ModuleConfig, result: ConfigurationValidationResult): void {
    // Check for required fields
    if (config.lazy !== undefined && typeof config.lazy !== 'boolean') {
      result.errors.push({
        path: 'lazy',
        message: 'lazy property must be a boolean',
        severity: 'error',
        code: 'INVALID_TYPE'
      });
      result.isValid = false;
    }

    if (config.priority !== undefined && !['high', 'normal', 'low'].includes(config.priority)) {
      result.errors.push({
        path: 'priority',
        message: 'priority must be one of: high, normal, low',
        severity: 'error',
        code: 'INVALID_VALUE'
      });
      result.isValid = false;
    }
  }

  /**
   * Setup default validation rules
   */
  private setupDefaultValidationRules(): void {
    // Required fields validation
    this.addValidationRule('required-fields', {
      validate: (config, context) => ({
        errors: [],
        warnings: [],
        suggestions: []
      })
    });

    // Performance validation
    this.addValidationRule('performance', {
      validate: (config, context) => {
        const warnings: ConfigurationWarning[] = [];
        
        if (config.lazy === false && config.priority === 'low') {
          warnings.push({
            path: 'lazy',
            message: 'Non-lazy loading with low priority may impact performance',
            suggestion: 'Consider enabling lazy loading or increasing priority'
          });
        }
        
        return {
          errors: [],
          warnings,
          suggestions: []
        };
      }
    });
  }

  /**
   * Log configuration resolution for debugging
   */
  private logConfigurationResolution(
    hierarchy: ConfigurationHierarchy,
    resolved: ModuleConfig,
    context: ConfigurationContext,
    startTime: number
  ): void {
    const duration = performance.now() - startTime;
    
    console.group(`[ConfigurationManager] Configuration resolved in ${duration.toFixed(2)}ms`);
    console.log('Context:', context);
    console.log('Hierarchy:', hierarchy);
    console.log('Resolved:', resolved);
    console.groupEnd();
  }
}

export interface ConfigurationContext {
  moduleId: string;
  pageId?: string;
  mode: RenderMode;
  breakpoint: BreakpointInfo;
}

export interface ConfigurationValidationRule {
  validate(config: ModuleConfig, context?: ConfigurationContext): {
    errors: ConfigurationError[];
    warnings: ConfigurationWarning[];
    suggestions: ConfigurationSuggestion[];
  };
}

// Export singleton instance
export const configurationManager = ConfigurationManager.getInstance();