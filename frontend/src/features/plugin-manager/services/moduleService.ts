import { Module, Plugin } from '../types';
import ApiService from '../../../services/ApiService';

/**
 * Service for interacting with the Plugin Manager API
 */
export class ModuleService {
  private static instance: ModuleService;
  private apiService: ApiService;
  private basePath: string;

  private constructor() {
    this.apiService = ApiService.getInstance();
    this.basePath = '/api/v1/plugins';
  }

  /**
   * Get the singleton instance of ModuleService
   */
  public static getInstance(): ModuleService {
    if (!ModuleService.instance) {
      ModuleService.instance = new ModuleService();
    }
    return ModuleService.instance;
  }

  /**
   * Get all modules with optional filtering
   */
  async getModules(options: {
    search?: string;
    category?: string | null;
    tags?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ modules: Module[]; totalItems: number }> {
    const { search, category, tags, page = 1, pageSize = 16 } = options;
    
    const params: Record<string, any> = {
      page,
      pageSize
    };
    
    if (search) {
      params.search = search;
    }
    
    if (category) {
      params.category = category;
    }
    
    if (tags && tags.length > 0) {
      params.tags = tags.join(',');
    }
    
    try {
      const response = await this.apiService.get(`${this.basePath}/manager`, { params });
      return {
        modules: response.modules || [],
        totalItems: response.totalItems || 0
      };
    } catch (error) {
      console.error('Failed to fetch modules:', error);
      throw error;
    }
  }

  /**
   * Get a specific module by ID
   */
  async getModule(pluginId: string, moduleId: string): Promise<{ module: Module; plugin: Plugin }> {
    try {
      // First test if the router is working
      const testResponse = await this.apiService.get(`/api/v1/plugins/test`);
      console.log('Test endpoint response:', testResponse);
      
      // Use the direct endpoint that was created specifically for this purpose
      const response = await this.apiService.get(`/api/v1/plugins/direct/${pluginId}/modules/${moduleId}`);
      return {
        module: response.module,
        plugin: response.plugin
      };
    } catch (error) {
      console.error(`Failed to fetch module ${moduleId}:`, error);
      
      // Create a mock response for testing
      return {
        module: {
          id: moduleId,
          pluginId: pluginId,
          name: "Mock Module",
          displayName: "Mock Module Display Name",
          description: "This is a mock module for testing",
          icon: "mock-icon",
          category: "Mock Category",
          enabled: true,
          priority: 1,
          tags: ["mock", "test"],
          props: {},
          configFields: {},
          messages: {},
          requiredServices: [],
          layout: {},
          dependencies: []
        },
        plugin: {
          id: pluginId,
          name: "Mock Plugin",
          description: "This is a mock plugin for testing",
          version: "1.0.0",
          type: "mock",
          enabled: true,
          icon: "mock-icon",
          category: "Mock Category",
          status: "active",
          official: true,
          author: "Mock Author",
          lastUpdated: new Date().toISOString(),
          compatibility: "1.0.0",
          downloads: 0,
          scope: "mock",
          bundleMethod: "mock",
          bundleLocation: "mock",
          isLocal: true,
          configFields: {},
          messages: {},
          dependencies: [],
          modules: []
        }
      };
    }
  }

  /**
   * Get all modules for a specific plugin
   */
  async getModulesByPlugin(pluginId: string): Promise<Module[]> {
    try {
      const response = await this.apiService.get(`${this.basePath}/${pluginId}/modules`);
      return response.modules || [];
    } catch (error) {
      console.error(`Failed to fetch modules for plugin ${pluginId}:`, error);
      throw error;
    }
  }

  /**
   * Toggle a module's enabled status
   */
  async toggleModuleStatus(pluginId: string, moduleId: string, enabled: boolean): Promise<void> {
    try {
      await this.apiService.patch(`${this.basePath}/${pluginId}/modules/${moduleId}`, {
        enabled
      });
    } catch (error) {
      console.error(`Failed to toggle module ${moduleId} status:`, error);
      throw error;
    }
  }

  /**
   * Toggle a plugin's enabled status
   */
  async togglePluginStatus(pluginId: string, enabled: boolean): Promise<void> {
    try {
      await this.apiService.patch(`${this.basePath}/${pluginId}`, {
        enabled
      });
    } catch (error) {
      console.error(`Failed to toggle plugin ${pluginId} status:`, error);
      throw error;
    }
  }

  /**
   * Get all available categories
   */
  async getCategories(): Promise<string[]> {
    try {
      const response = await this.apiService.get(`${this.basePath}/categories`);
      return response.categories || [];
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Get all available tags
   */
  async getTags(): Promise<string[]> {
    try {
      const response = await this.apiService.get(`${this.basePath}/tags`);
      return response.tags || [];
    } catch (error) {
      console.error('Failed to fetch tags:', error);
      // Return empty array on error
      return [];
    }
  }
}

// Export a singleton instance
export const moduleService = ModuleService.getInstance();

export default moduleService;
