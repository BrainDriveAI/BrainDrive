import React from 'react';
import { ModuleConfig, RenderMode, BreakpointInfo } from '../types';

export interface PluginLoadResult {
  success: boolean;
  component?: React.ComponentType<any>;
  error?: Error;
  metadata?: PluginMetadata;
  loadTime?: number;
}

export interface PluginMetadata {
  pluginId: string;
  moduleId: string;
  version: string;
  dependencies: string[];
  capabilities: string[];
  isLocal: boolean;
  cacheKey: string;
}

export interface PluginValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  securityIssues: string[];
}

export interface PluginCacheEntry {
  component: React.ComponentType<any>;
  metadata: PluginMetadata;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * Unified Plugin Loader with caching, validation, and lazy loading
 */
export class PluginLoader {
  private static instance: PluginLoader;
  private cache = new Map<string, PluginCacheEntry>();
  private loadingPromises = new Map<string, Promise<PluginLoadResult>>();
  private maxCacheSize = 50;
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  static getInstance(): PluginLoader {
    if (!PluginLoader.instance) {
      PluginLoader.instance = new PluginLoader();
    }
    return PluginLoader.instance;
  }

  /**
   * Load a plugin module with caching and validation
   */
  async loadPlugin(
    pluginId: string,
    moduleId?: string,
    options: PluginLoadOptions = {}
  ): Promise<PluginLoadResult> {
    const cacheKey = this.generateCacheKey(pluginId, moduleId);
    const startTime = performance.now();

    // Check cache first
    if (!options.bypassCache) {
      const cached = this.getCachedPlugin(cacheKey);
      if (cached) {
        console.log(`[PluginLoader] Cache hit for ${cacheKey}`);
        return {
          success: true,
          component: cached.component,
          metadata: cached.metadata,
          loadTime: performance.now() - startTime
        };
      }
    }

    // Check if already loading
    if (this.loadingPromises.has(cacheKey)) {
      console.log(`[PluginLoader] Already loading ${cacheKey}, waiting...`);
      return await this.loadingPromises.get(cacheKey)!;
    }

    // Start loading
    const loadingPromise = this.performPluginLoad(pluginId, moduleId, options, startTime);
    this.loadingPromises.set(cacheKey, loadingPromise);

    try {
      const result = await loadingPromise;
      return result;
    } finally {
      this.loadingPromises.delete(cacheKey);
    }
  }

  /**
   * Validate a plugin before loading
   */
  async validatePlugin(pluginId: string, moduleId?: string): Promise<PluginValidationResult> {
    const result: PluginValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      securityIssues: []
    };

    try {
      // Basic validation checks
      if (!pluginId || pluginId.trim() === '') {
        result.errors.push('Plugin ID is required');
        result.isValid = false;
      }

      // Check for valid plugin ID format
      if (!/^[a-zA-Z0-9_-]+$/.test(pluginId)) {
        result.errors.push('Plugin ID contains invalid characters');
        result.isValid = false;
      }

      // Security checks
      if (pluginId.includes('..') || pluginId.includes('/')) {
        result.securityIssues.push('Plugin ID contains path traversal characters');
        result.isValid = false;
      }

      // Module ID validation if provided
      if (moduleId) {
        if (!/^[a-zA-Z0-9_-]+$/.test(moduleId)) {
          result.errors.push('Module ID contains invalid characters');
          result.isValid = false;
        }
      }

      // Additional validation would go here (plugin manifest, dependencies, etc.)

    } catch (error) {
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * Preload plugins for better performance
   */
  async preloadPlugins(pluginIds: string[]): Promise<void> {
    console.log(`[PluginLoader] Preloading ${pluginIds.length} plugins...`);
    
    const preloadPromises = pluginIds.map(async (pluginId) => {
      try {
        await this.loadPlugin(pluginId, undefined, { priority: 'low' });
      } catch (error) {
        console.warn(`[PluginLoader] Failed to preload plugin ${pluginId}:`, error);
      }
    });

    await Promise.allSettled(preloadPromises);
    console.log(`[PluginLoader] Preloading completed`);
  }

  /**
   * Clear cache for a specific plugin or all plugins
   */
  clearCache(pluginId?: string): void {
    if (pluginId) {
      const keysToDelete = Array.from(this.cache.keys()).filter(key => 
        key.startsWith(`${pluginId}:`)
      );
      keysToDelete.forEach(key => this.cache.delete(key));
      console.log(`[PluginLoader] Cleared cache for plugin: ${pluginId}`);
    } else {
      this.cache.clear();
      console.log(`[PluginLoader] Cleared all plugin cache`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let totalSize = 0;
    let expiredCount = 0;
    let totalAccessCount = 0;

    for (const [key, entry] of this.cache) {
      totalSize++;
      totalAccessCount += entry.accessCount;
      
      if (now - entry.timestamp > this.cacheTimeout) {
        expiredCount++;
      }
    }

    return {
      totalEntries: totalSize,
      expiredEntries: expiredCount,
      totalAccesses: totalAccessCount,
      hitRate: totalAccessCount > 0 ? (totalAccessCount / (totalAccessCount + this.loadingPromises.size)) : 0,
      maxSize: this.maxCacheSize
    };
  }

  /**
   * Perform the actual plugin loading
   */
  private async performPluginLoad(
    pluginId: string,
    moduleId: string | undefined,
    options: PluginLoadOptions,
    startTime: number
  ): Promise<PluginLoadResult> {
    try {
      // Validate plugin first
      const validation = await this.validatePlugin(pluginId, moduleId);
      if (!validation.isValid) {
        return {
          success: false,
          error: new Error(`Plugin validation failed: ${validation.errors.join(', ')}`),
          loadTime: performance.now() - startTime
        };
      }

      // Determine if plugin is local or remote
      const isLocal = await this.isLocalPlugin(pluginId);
      
      let component: React.ComponentType<any>;
      let metadata: PluginMetadata;

      if (isLocal) {
        const result = await this.loadLocalPlugin(pluginId, moduleId);
        component = result.component;
        metadata = result.metadata;
      } else {
        const result = await this.loadRemotePlugin(pluginId, moduleId);
        component = result.component;
        metadata = result.metadata;
      }

      // Cache the result
      const cacheKey = this.generateCacheKey(pluginId, moduleId);
      this.cachePlugin(cacheKey, component, metadata);

      const loadTime = performance.now() - startTime;
      console.log(`[PluginLoader] Successfully loaded ${cacheKey} in ${loadTime.toFixed(2)}ms`);

      return {
        success: true,
        component,
        metadata,
        loadTime
      };

    } catch (error) {
      const loadTime = performance.now() - startTime;
      console.error(`[PluginLoader] Failed to load plugin ${pluginId}:`, error);
      
      return {
        success: false,
        error: error as Error,
        loadTime
      };
    }
  }

  /**
   * Load a local plugin
   */
  private async loadLocalPlugin(pluginId: string, moduleId?: string): Promise<{
    component: React.ComponentType<any>;
    metadata: PluginMetadata;
  }> {
    // This would integrate with the existing local plugin system
    // For now, create a placeholder
    const PlaceholderComponent: React.FC<any> = (props) =>
      React.createElement('div', { className: 'plugin-placeholder plugin-placeholder--local' },
        React.createElement('h3', null, `Local Plugin: ${pluginId}`),
        moduleId && React.createElement('p', null, `Module: ${moduleId}`),
        React.createElement('p', null, 'This is a placeholder for the actual local plugin component')
      );

    const metadata: PluginMetadata = {
      pluginId,
      moduleId: moduleId || 'default',
      version: '1.0.0',
      dependencies: [],
      capabilities: ['render'],
      isLocal: true,
      cacheKey: this.generateCacheKey(pluginId, moduleId)
    };

    return { component: PlaceholderComponent, metadata };
  }

  /**
   * Load a remote plugin
   */
  private async loadRemotePlugin(pluginId: string, moduleId?: string): Promise<{
    component: React.ComponentType<any>;
    metadata: PluginMetadata;
  }> {
    // This would integrate with the existing remote plugin service
    // For now, create a placeholder
    const PlaceholderComponent: React.FC<any> = (props) =>
      React.createElement('div', { className: 'plugin-placeholder plugin-placeholder--remote' },
        React.createElement('h3', null, `Remote Plugin: ${pluginId}`),
        moduleId && React.createElement('p', null, `Module: ${moduleId}`),
        React.createElement('p', null, 'This is a placeholder for the actual remote plugin component')
      );

    const metadata: PluginMetadata = {
      pluginId,
      moduleId: moduleId || 'default',
      version: '1.0.0',
      dependencies: [],
      capabilities: ['render'],
      isLocal: false,
      cacheKey: this.generateCacheKey(pluginId, moduleId)
    };

    return { component: PlaceholderComponent, metadata };
  }

  /**
   * Check if a plugin is local
   */
  private async isLocalPlugin(pluginId: string): Promise<boolean> {
    // This would check the plugin registry or configuration
    // For now, assume plugins starting with 'local-' are local
    return pluginId.startsWith('local-') || pluginId.startsWith('BrainDrive');
  }

  /**
   * Generate cache key for a plugin
   */
  private generateCacheKey(pluginId: string, moduleId?: string): string {
    return `${pluginId}:${moduleId || 'default'}`;
  }

  /**
   * Get cached plugin if available and not expired
   */
  private getCachedPlugin(cacheKey: string): PluginCacheEntry | null {
    const entry = this.cache.get(cacheKey);
    
    if (!entry) {
      return null;
    }

    const now = Date.now();
    
    // Check if expired
    if (now - entry.timestamp > this.cacheTimeout) {
      this.cache.delete(cacheKey);
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = now;
    this.cache.set(cacheKey, entry);

    return entry;
  }

  /**
   * Cache a plugin component
   */
  private cachePlugin(
    cacheKey: string,
    component: React.ComponentType<any>,
    metadata: PluginMetadata
  ): void {
    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLeastRecentlyUsed();
    }

    const entry: PluginCacheEntry = {
      component,
      metadata,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now()
    };

    this.cache.set(cacheKey, entry);
  }

  /**
   * Evict least recently used cache entries
   */
  private evictLeastRecentlyUsed(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`[PluginLoader] Evicted cache entry: ${oldestKey}`);
    }
  }
}

export interface PluginLoadOptions {
  bypassCache?: boolean;
  priority?: 'high' | 'normal' | 'low';
  timeout?: number;
  retries?: number;
}

// Export singleton instance
export const pluginLoader = PluginLoader.getInstance();