/**
 * Enhanced Session Storage Manager for Plugin State Persistence
 * Provides optimized session storage with cleanup, monitoring, and error handling
 */

import { StateSerializationUtils, SerializationResult, DeserializationResult } from './StateSerializationUtils';

export interface StorageMetadata {
  pluginId: string;
  timestamp: number;
  size: number;
  version: string;
  compressed: boolean;
}

export interface StorageStats {
  totalPlugins: number;
  totalSize: number;
  availableSpace: number;
  oldestEntry: number;
  newestEntry: number;
  pluginStats: Map<string, {
    size: number;
    lastAccessed: number;
    accessCount: number;
  }>;
}

export interface StorageOptions {
  compression?: boolean;
  compressionThreshold?: number;
  maxAge?: number; // Maximum age in milliseconds
  maxSize?: number; // Maximum size per plugin
  enableMetrics?: boolean;
}

export class SessionStorageManager {
  private static readonly STORAGE_PREFIX = 'braindrive_plugin_state_';
  private static readonly METADATA_PREFIX = 'braindrive_plugin_meta_';
  private static readonly GLOBAL_STATS_KEY = 'braindrive_storage_stats';
  
  private static instance: SessionStorageManager;
  private metrics: Map<string, { accessCount: number; lastAccessed: number }> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {
    this.initializeCleanup();
    this.loadMetrics();
  }

  public static getInstance(): SessionStorageManager {
    if (!SessionStorageManager.instance) {
      SessionStorageManager.instance = new SessionStorageManager();
    }
    return SessionStorageManager.instance;
  }

  /**
   * Save plugin state with enhanced options
   */
  async saveState(
    pluginId: string, 
    state: any, 
    options: StorageOptions = {}
  ): Promise<{ success: boolean; error?: string; size?: number }> {
    try {
      const {
        compression = false,
        compressionThreshold = 1024,
        maxSize,
        enableMetrics = true
      } = options;

      // Check if plugin state exceeds size limit
      const stateSize = StateSerializationUtils.calculateStateSize(state);
      if (maxSize && stateSize > maxSize) {
        return {
          success: false,
          error: `State size (${stateSize}) exceeds maximum allowed size (${maxSize})`
        };
      }

      // Determine if compression should be used
      const shouldCompress = compression && stateSize > compressionThreshold;

      // Serialize state
      const serializationResult: SerializationResult = shouldCompress
        ? StateSerializationUtils.serializeCompressed(state)
        : StateSerializationUtils.serialize(state);

      if (!serializationResult.success) {
        return {
          success: false,
          error: serializationResult.error
        };
      }

      // Check available storage space
      const availableSpace = this.getAvailableStorageSpace();
      const requiredSpace = serializationResult.size || 0;
      
      if (requiredSpace > availableSpace) {
        // Try to free up space
        const freedSpace = await this.freeUpSpace(requiredSpace - availableSpace);
        if (freedSpace < requiredSpace - availableSpace) {
          return {
            success: false,
            error: `Insufficient storage space. Required: ${requiredSpace}, Available: ${availableSpace + freedSpace}`
          };
        }
      }

      // Create metadata
      const metadata: StorageMetadata = {
        pluginId,
        timestamp: Date.now(),
        size: serializationResult.size || 0,
        version: '1.0.0',
        compressed: shouldCompress
      };

      // Save to session storage
      const storageKey = this.getStorageKey(pluginId);
      const metadataKey = this.getMetadataKey(pluginId);

      sessionStorage.setItem(storageKey, serializationResult.data!);
      sessionStorage.setItem(metadataKey, JSON.stringify(metadata));

      // Update metrics
      if (enableMetrics) {
        this.updateMetrics(pluginId, 'save');
      }

      // Update global stats
      this.updateGlobalStats();

      console.log(`[SessionStorageManager] Saved state for plugin ${pluginId} (${metadata.size} bytes, compressed: ${shouldCompress})`);

      return {
        success: true,
        size: metadata.size
      };

    } catch (error) {
      console.error(`[SessionStorageManager] Error saving state for plugin ${pluginId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Load plugin state with enhanced options
   */
  async loadState(
    pluginId: string,
    options: StorageOptions = {}
  ): Promise<{ success: boolean; data?: any; error?: string; metadata?: StorageMetadata }> {
    try {
      const { maxAge, enableMetrics = true } = options;

      const storageKey = this.getStorageKey(pluginId);
      const metadataKey = this.getMetadataKey(pluginId);

      // Get stored data and metadata
      const storedData = sessionStorage.getItem(storageKey);
      const storedMetadata = sessionStorage.getItem(metadataKey);

      if (!storedData) {
        return {
          success: true,
          data: null
        };
      }

      // Parse metadata
      let metadata: StorageMetadata | null = null;
      if (storedMetadata) {
        try {
          metadata = JSON.parse(storedMetadata);
        } catch (error) {
          console.warn(`[SessionStorageManager] Invalid metadata for plugin ${pluginId}`);
        }
      }

      // Check age limit
      if (maxAge && metadata && (Date.now() - metadata.timestamp) > maxAge) {
        // Data is too old, remove it
        await this.clearState(pluginId);
        return {
          success: true,
          data: null
        };
      }

      // Deserialize data
      const deserializationResult: DeserializationResult = metadata?.compressed
        ? StateSerializationUtils.deserializeCompressed(storedData)
        : StateSerializationUtils.deserialize(storedData);

      if (!deserializationResult.success) {
        return {
          success: false,
          error: deserializationResult.error
        };
      }

      // Update metrics
      if (enableMetrics) {
        this.updateMetrics(pluginId, 'load');
      }

      console.log(`[SessionStorageManager] Loaded state for plugin ${pluginId}`);

      return {
        success: true,
        data: deserializationResult.data,
        metadata: metadata || undefined
      };

    } catch (error) {
      console.error(`[SessionStorageManager] Error loading state for plugin ${pluginId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Clear plugin state
   */
  async clearState(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const storageKey = this.getStorageKey(pluginId);
      const metadataKey = this.getMetadataKey(pluginId);

      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(metadataKey);

      // Remove from metrics
      this.metrics.delete(pluginId);

      // Update global stats
      this.updateGlobalStats();

      console.log(`[SessionStorageManager] Cleared state for plugin ${pluginId}`);

      return { success: true };

    } catch (error) {
      console.error(`[SessionStorageManager] Error clearing state for plugin ${pluginId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get storage statistics
   */
  getStorageStats(): StorageStats {
    const pluginStats = new Map<string, { size: number; lastAccessed: number; accessCount: number }>();
    let totalSize = 0;
    let oldestEntry = Date.now();
    let newestEntry = 0;
    let totalPlugins = 0;

    // Iterate through all storage items
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith(SessionStorageManager.STORAGE_PREFIX)) {
        continue;
      }

      const pluginId = key.replace(SessionStorageManager.STORAGE_PREFIX, '');
      const metadataKey = this.getMetadataKey(pluginId);
      const metadataStr = sessionStorage.getItem(metadataKey);

      if (metadataStr) {
        try {
          const metadata: StorageMetadata = JSON.parse(metadataStr);
          const metrics = this.metrics.get(pluginId) || { accessCount: 0, lastAccessed: metadata.timestamp };

          pluginStats.set(pluginId, {
            size: metadata.size,
            lastAccessed: metrics.lastAccessed,
            accessCount: metrics.accessCount
          });

          totalSize += metadata.size;
          totalPlugins++;
          
          if (metadata.timestamp < oldestEntry) {
            oldestEntry = metadata.timestamp;
          }
          if (metadata.timestamp > newestEntry) {
            newestEntry = metadata.timestamp;
          }
        } catch (error) {
          console.warn(`[SessionStorageManager] Invalid metadata for plugin ${pluginId}`);
        }
      }
    }

    return {
      totalPlugins,
      totalSize,
      availableSpace: this.getAvailableStorageSpace(),
      oldestEntry: totalPlugins > 0 ? oldestEntry : 0,
      newestEntry: totalPlugins > 0 ? newestEntry : 0,
      pluginStats
    };
  }

  /**
   * Clean up old or unused state entries
   */
  async cleanupOldEntries(maxAge: number): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith(SessionStorageManager.METADATA_PREFIX)) {
        continue;
      }

      const metadataStr = sessionStorage.getItem(key);
      if (!metadataStr) continue;

      try {
        const metadata: StorageMetadata = JSON.parse(metadataStr);
        if ((now - metadata.timestamp) > maxAge) {
          await this.clearState(metadata.pluginId);
          cleanedCount++;
        }
      } catch (error) {
        // Remove invalid metadata
        sessionStorage.removeItem(key);
        cleanedCount++;
      }
    }

    console.log(`[SessionStorageManager] Cleaned up ${cleanedCount} old entries`);
    return cleanedCount;
  }

  /**
   * Get list of all stored plugin IDs
   */
  getStoredPluginIds(): string[] {
    const pluginIds: string[] = [];

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SessionStorageManager.STORAGE_PREFIX)) {
        const pluginId = key.replace(SessionStorageManager.STORAGE_PREFIX, '');
        pluginIds.push(pluginId);
      }
    }

    return pluginIds;
  }

  /**
   * Destroy the manager and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.saveMetrics();
  }

  // Private helper methods

  private getStorageKey(pluginId: string): string {
    return `${SessionStorageManager.STORAGE_PREFIX}${pluginId}`;
  }

  private getMetadataKey(pluginId: string): string {
    return `${SessionStorageManager.METADATA_PREFIX}${pluginId}`;
  }

  private getAvailableStorageSpace(): number {
    try {
      // Estimate available space (sessionStorage typically has ~5-10MB limit)
      const testKey = 'braindrive_space_test';
      const testData = 'x'.repeat(1024); // 1KB test
      let availableSpace = 0;

      // Try to determine available space
      for (let i = 0; i < 10240; i++) { // Test up to ~10MB
        try {
          sessionStorage.setItem(`${testKey}_${i}`, testData);
          availableSpace += 1024;
        } catch (error) {
          break;
        }
      }

      // Clean up test data
      for (let i = 0; i < 10240; i++) {
        sessionStorage.removeItem(`${testKey}_${i}`);
      }

      return availableSpace;
    } catch (error) {
      return 0;
    }
  }

  private async freeUpSpace(requiredSpace: number): Promise<number> {
    const stats = this.getStorageStats();
    let freedSpace = 0;

    // Sort plugins by last accessed time (oldest first)
    const sortedPlugins = Array.from(stats.pluginStats.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    for (const [pluginId, pluginStat] of sortedPlugins) {
      if (freedSpace >= requiredSpace) {
        break;
      }

      await this.clearState(pluginId);
      freedSpace += pluginStat.size;
      console.log(`[SessionStorageManager] Freed ${pluginStat.size} bytes by removing state for plugin ${pluginId}`);
    }

    return freedSpace;
  }

  private updateMetrics(pluginId: string, operation: 'save' | 'load'): void {
    const existing = this.metrics.get(pluginId) || { accessCount: 0, lastAccessed: 0 };
    this.metrics.set(pluginId, {
      accessCount: existing.accessCount + 1,
      lastAccessed: Date.now()
    });
  }

  private updateGlobalStats(): void {
    const stats = this.getStorageStats();
    sessionStorage.setItem(SessionStorageManager.GLOBAL_STATS_KEY, JSON.stringify({
      lastUpdated: Date.now(),
      totalPlugins: stats.totalPlugins,
      totalSize: stats.totalSize
    }));
  }

  private initializeCleanup(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldEntries(24 * 60 * 60 * 1000); // Clean entries older than 24 hours
    }, 5 * 60 * 1000);
  }

  private loadMetrics(): void {
    try {
      const metricsData = sessionStorage.getItem('braindrive_storage_metrics');
      if (metricsData) {
        const parsed = JSON.parse(metricsData);
        this.metrics = new Map(Object.entries(parsed));
      }
    } catch (error) {
      console.warn('[SessionStorageManager] Failed to load metrics:', error);
    }
  }

  private saveMetrics(): void {
    try {
      const metricsObj = Object.fromEntries(this.metrics);
      sessionStorage.setItem('braindrive_storage_metrics', JSON.stringify(metricsObj));
    } catch (error) {
      console.warn('[SessionStorageManager] Failed to save metrics:', error);
    }
  }
}

// Export singleton instance
export const sessionStorageManager = SessionStorageManager.getInstance();