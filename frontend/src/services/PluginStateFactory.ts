import { AbstractBaseService } from './base/BaseService';
import { createPluginStateService, PluginStateServiceImpl } from './PluginStateService';

export interface PluginStateFactoryInterface {
  createPluginStateService(pluginId: string): PluginStateServiceImpl;
  getPluginStateService(pluginId: string): PluginStateServiceImpl | null;
  destroyPluginStateService(pluginId: string): Promise<void>;
  listActivePlugins(): string[];
}

class PluginStateFactoryImpl extends AbstractBaseService implements PluginStateFactoryInterface {
  private activeServices: Map<string, PluginStateServiceImpl> = new Map();
  private static instance: PluginStateFactoryImpl;

  private constructor() {
    super(
      'pluginStateFactory',
      { major: 1, minor: 0, patch: 0 },
      [
        {
          name: 'plugin-state-factory',
          description: 'Factory for creating plugin-specific state services',
          version: '1.0.0'
        },
        {
          name: 'plugin-state-lifecycle',
          description: 'Lifecycle management for plugin state services',
          version: '1.0.0'
        }
      ]
    );
  }

  public static getInstance(): PluginStateFactoryImpl {
    if (!PluginStateFactoryImpl.instance) {
      PluginStateFactoryImpl.instance = new PluginStateFactoryImpl();
    }
    return PluginStateFactoryImpl.instance;
  }

  async initialize(): Promise<void> {
    console.log('[PluginStateFactory] Initialized');
  }

  async destroy(): Promise<void> {
    // Destroy all active plugin state services
    const destroyPromises = Array.from(this.activeServices.values()).map(service => service.destroy());
    await Promise.all(destroyPromises);
    this.activeServices.clear();
    console.log('[PluginStateFactory] Destroyed');
  }

  createPluginStateService(pluginId: string): PluginStateServiceImpl {
    if (this.activeServices.has(pluginId)) {
      console.warn(`[PluginStateFactory] Plugin state service for ${pluginId} already exists, returning existing instance`);
      return this.activeServices.get(pluginId)!;
    }

    const service = createPluginStateService(pluginId);
    this.activeServices.set(pluginId, service);
    
    // Initialize the service
    service.initialize().catch(error => {
      console.error(`[PluginStateFactory] Error initializing plugin state service for ${pluginId}:`, error);
    });

    console.log(`[PluginStateFactory] Created plugin state service for ${pluginId}`);
    return service;
  }

  getPluginStateService(pluginId: string): PluginStateServiceImpl | null {
    return this.activeServices.get(pluginId) || null;
  }

  async destroyPluginStateService(pluginId: string): Promise<void> {
    const service = this.activeServices.get(pluginId);
    if (service) {
      await service.destroy();
      this.activeServices.delete(pluginId);
      console.log(`[PluginStateFactory] Destroyed plugin state service for ${pluginId}`);
    }
  }

  listActivePlugins(): string[] {
    return Array.from(this.activeServices.keys());
  }
}

export const pluginStateFactory = PluginStateFactoryImpl.getInstance();