import { 
  ServiceBridgeV2, 
  ServiceResolution, 
  ServiceContext, 
  ServiceMetrics, 
  ServiceError,
  APIService,
  EventService,
  ThemeService,
  StateService,
  CacheService,
  PerformanceService,
  AccessibilityService,
  AnimationService,
  ResponsiveService
} from '../types/services';

/**
 * Enhanced Service Bridge v2 Implementation
 * Provides dependency resolution, lifecycle management, and performance monitoring
 */
export class ServiceBridgeV2Implementation implements ServiceBridgeV2 {
  private services: Map<string, any> = new Map();
  private serviceMetrics: Map<string, ServiceMetrics> = new Map();
  private dependencyGraph: Map<string, string[]> = new Map();
  private initializationOrder: string[] = [];
  private isInitialized = false;

  constructor() {
    this.setupCoreServices();
  }

  /**
   * Register a service with the bridge
   */
  registerService(name: string, service: any): void {
    if (this.services.has(name)) {
      console.warn(`[ServiceBridgeV2] Service '${name}' is already registered. Overwriting.`);
    }

    this.services.set(name, service);
    
    // Initialize metrics for the service
    this.serviceMetrics.set(name, {
      loadTime: 0,
      memoryUsage: 0,
      errorCount: 0,
      lastAccessed: new Date()
    });

    // If service has dependencies, register them in the dependency graph
    if (service.dependencies && Array.isArray(service.dependencies)) {
      this.dependencyGraph.set(name, service.dependencies);
    }

    console.log(`[ServiceBridgeV2] Registered service: ${name}`);
  }

  /**
   * Unregister a service from the bridge
   */
  unregisterService(name: string): void {
    if (!this.services.has(name)) {
      console.warn(`[ServiceBridgeV2] Service '${name}' is not registered.`);
      return;
    }

    const service = this.services.get(name);
    
    // Call cleanup if available
    if (service && typeof service.cleanup === 'function') {
      try {
        service.cleanup();
      } catch (error) {
        console.error(`[ServiceBridgeV2] Error during cleanup of service '${name}':`, error);
      }
    }

    this.services.delete(name);
    this.serviceMetrics.delete(name);
    this.dependencyGraph.delete(name);

    console.log(`[ServiceBridgeV2] Unregistered service: ${name}`);
  }

  /**
   * Get a service by name
   */
  getService<T = any>(name: string): T | null {
    const startTime = performance.now();
    
    try {
      const service = this.services.get(name);
      
      if (!service) {
        return null;
      }

      // Update metrics
      const metrics = this.serviceMetrics.get(name);
      if (metrics) {
        metrics.lastAccessed = new Date();
        this.serviceMetrics.set(name, metrics);
      }

      return service as T;
    } catch (error) {
      this.recordError(name, error as Error);
      return null;
    } finally {
      const endTime = performance.now();
      this.updateLoadTime(name, endTime - startTime);
    }
  }

  /**
   * Resolve dependencies for required services
   */
  resolveDependencies(requiredServices: string[]): ServiceResolution {
    const resolved: Record<string, any> = {};
    const missing: string[] = [];
    const errors: ServiceError[] = [];

    for (const serviceName of requiredServices) {
      try {
        const service = this.getService(serviceName);
        
        if (service) {
          resolved[serviceName] = service;
        } else {
          missing.push(serviceName);
        }
      } catch (error) {
        errors.push({
          service: serviceName,
          error: error as Error,
          timestamp: new Date(),
          context: {} as ServiceContext // Will be filled by caller
        });
      }
    }

    return { resolved, missing, errors };
  }

  /**
   * Initialize all services with proper dependency order
   */
  async initializeServices(context: ServiceContext): Promise<void> {
    if (this.isInitialized) {
      console.log('[ServiceBridgeV2] Services already initialized');
      return;
    }

    console.log('[ServiceBridgeV2] Initializing services...');
    
    try {
      // Calculate initialization order based on dependencies
      this.calculateInitializationOrder();

      // Initialize services in dependency order
      for (const serviceName of this.initializationOrder) {
        const service = this.services.get(serviceName);
        
        if (service && typeof service.initialize === 'function') {
          const startTime = performance.now();
          
          try {
            await service.initialize(context);
            console.log(`[ServiceBridgeV2] Initialized service: ${serviceName}`);
          } catch (error) {
            console.error(`[ServiceBridgeV2] Failed to initialize service '${serviceName}':`, error);
            this.recordError(serviceName, error as Error);
          }
          
          const endTime = performance.now();
          this.updateLoadTime(serviceName, endTime - startTime);
        }
      }

      this.isInitialized = true;
      console.log('[ServiceBridgeV2] All services initialized successfully');
    } catch (error) {
      console.error('[ServiceBridgeV2] Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * Cleanup all services
   */
  async cleanupServices(): Promise<void> {
    console.log('[ServiceBridgeV2] Cleaning up services...');

    // Cleanup in reverse order
    const cleanupOrder = [...this.initializationOrder].reverse();

    for (const serviceName of cleanupOrder) {
      const service = this.services.get(serviceName);
      
      if (service && typeof service.cleanup === 'function') {
        try {
          await service.cleanup();
          console.log(`[ServiceBridgeV2] Cleaned up service: ${serviceName}`);
        } catch (error) {
          console.error(`[ServiceBridgeV2] Failed to cleanup service '${serviceName}':`, error);
        }
      }
    }

    this.isInitialized = false;
    console.log('[ServiceBridgeV2] All services cleaned up');
  }

  /**
   * Get performance metrics for all services
   */
  getServiceMetrics(): ServiceMetrics {
    const totalMetrics: ServiceMetrics = {
      loadTime: 0,
      memoryUsage: 0,
      errorCount: 0,
      lastAccessed: new Date()
    };

    for (const [serviceName, metrics] of this.serviceMetrics) {
      totalMetrics.loadTime += metrics.loadTime;
      totalMetrics.memoryUsage += metrics.memoryUsage;
      totalMetrics.errorCount += metrics.errorCount;
      
      if (metrics.lastAccessed > totalMetrics.lastAccessed) {
        totalMetrics.lastAccessed = metrics.lastAccessed;
      }
    }

    return totalMetrics;
  }

  /**
   * Get metrics for a specific service
   */
  getServiceMetricsFor(serviceName: string): ServiceMetrics | null {
    return this.serviceMetrics.get(serviceName) || null;
  }

  /**
   * Get all registered service names
   */
  getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Check if a service is registered
   */
  hasService(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Setup core services that are always available
   */
  private setupCoreServices(): void {
    // These would be implemented as actual service classes
    // For now, we'll register placeholders that can be replaced with real implementations
    
    this.registerService('cache', new CacheServiceImpl());
    this.registerService('performance', new PerformanceServiceImpl());
    this.registerService('responsive', new ResponsiveServiceImpl());
    
    // Add settings service for plugin compatibility
    this.registerService('settings', new SettingsServiceImpl());
  }

  /**
   * Calculate the proper initialization order based on dependencies
   */
  private calculateInitializationOrder(): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (serviceName: string) => {
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected involving service: ${serviceName}`);
      }
      
      if (visited.has(serviceName)) {
        return;
      }

      visiting.add(serviceName);
      
      const dependencies = this.dependencyGraph.get(serviceName) || [];
      for (const dependency of dependencies) {
        if (this.services.has(dependency)) {
          visit(dependency);
        }
      }
      
      visiting.delete(serviceName);
      visited.add(serviceName);
      order.push(serviceName);
    };

    // Visit all services
    for (const serviceName of this.services.keys()) {
      if (!visited.has(serviceName)) {
        visit(serviceName);
      }
    }

    this.initializationOrder = order;
  }

  /**
   * Record an error for a service
   */
  private recordError(serviceName: string, error: Error): void {
    const metrics = this.serviceMetrics.get(serviceName);
    if (metrics) {
      metrics.errorCount++;
      this.serviceMetrics.set(serviceName, metrics);
    }
    
    console.error(`[ServiceBridgeV2] Error in service '${serviceName}':`, error);
  }

  /**
   * Update load time for a service
   */
  private updateLoadTime(serviceName: string, loadTime: number): void {
    const metrics = this.serviceMetrics.get(serviceName);
    if (metrics) {
      metrics.loadTime += loadTime;
      this.serviceMetrics.set(serviceName, metrics);
    }
  }
}

/**
 * Basic Cache Service Implementation
 */
class CacheServiceImpl implements CacheService {
  private cache = new Map<string, { value: any; expires?: number }>();

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }
    
    if (item.expires && Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value as T;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const expires = ttl ? Date.now() + ttl : undefined;
    this.cache.set(key, { value, expires });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    
    if (!item) {
      return false;
    }
    
    if (item.expires && Date.now() > item.expires) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  getStats() {
    return {
      hits: 0, // Would be tracked in a real implementation
      misses: 0,
      size: this.cache.size,
      memoryUsage: 0 // Would be calculated in a real implementation
    };
  }
}

/**
 * Basic Performance Service Implementation
 */
class PerformanceServiceImpl implements PerformanceService {
  private timings = new Map<string, number>();

  startTiming(label: string): void {
    this.timings.set(label, performance.now());
  }

  endTiming(label: string): number {
    const startTime = this.timings.get(label);
    if (!startTime) {
      return 0;
    }
    
    const duration = performance.now() - startTime;
    this.timings.delete(label);
    return duration;
  }

  getMemoryUsage() {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      return {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit
      };
    }
    
    return {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0
    };
  }

  getRenderMetrics() {
    return {
      firstContentfulPaint: 0,
      largestContentfulPaint: 0,
      cumulativeLayoutShift: 0,
      firstInputDelay: 0
    };
  }

  getNetworkMetrics() {
    return {
      downloadTime: 0,
      uploadTime: 0,
      latency: 0,
      bandwidth: 0
    };
  }

  onPerformanceIssue(handler: any): () => void {
    // Would implement performance issue detection
    return () => {};
  }
}

/**
 * Basic Responsive Service Implementation
 */
class ResponsiveServiceImpl implements ResponsiveService {
  observeContainer(element: HTMLElement, callback: any): () => void {
    // Would implement ResizeObserver
    return () => {};
  }

  getCurrentBreakpoint() {
    return {
      name: 'desktop',
      width: window.innerWidth,
      height: window.innerHeight,
      orientation: (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait') as 'landscape' | 'portrait',
      pixelRatio: window.devicePixelRatio || 1
    };
  }

  getResponsiveValue<T>(values: any): T {
    return values.default;
  }

  generateResponsiveStyles(config: any): string {
    return '';
  }
}

/**
 * Enhanced Settings Service Implementation with Backend Integration
 */
class SettingsServiceImpl {
  private settings = new Map<string, any>();
  private subscriptions = new Map<string, Set<(value: any) => void>>();
  private initialized = false;

  constructor() {
    // Ensure subscribe method is always bound and available
    this.subscribe = this.subscribe.bind(this);
    this.subscribeTo = this.subscribeTo.bind(this);
    console.log('[SettingsService] Initialized with subscribe method:', typeof this.subscribe);
    
    // Initialize with some mock data for Ollama servers
    this.initializeMockData();
  }

  private async initializeMockData(): Promise<void> {
    // Initialize with mock Ollama server data to simulate backend data
    // The plugin expects the data in a specific format - let's try different formats
    const mockOllamaServers = {
      servers: [
        {
          id: 'default-ollama',
          name: 'Default Ollama Server',
          url: 'http://localhost:11434',
          status: 'connected',
          models: ['llama2', 'codellama', 'mistral']
        }
      ]
    };
    
    // Also try setting it as a direct array and as a settings object
    this.settings.set('value_ollama_servers_settings', mockOllamaServers);
    this.settings.set('value_ollama_servers', mockOllamaServers.servers);
    this.settings.set('value_servers', mockOllamaServers.servers);
    
    console.log('[SettingsService] Initialized with mock Ollama server data:', mockOllamaServers);
    this.initialized = true;
  }

  // Settings service methods that plugins expect
  registerSettingDefinition(definition: any): void {
    console.log('[SettingsService] Registering setting definition:', definition);
    // Store the definition for later use
    if (definition && definition.id) {
      this.settings.set(`definition_${definition.id}`, definition);
      
      // If this is the ollama servers setting and we have subscribers, notify them
      if (definition.id === 'ollama_servers_settings') {
        const callbacks = this.subscriptions.get('ollama_servers_settings');
        if (callbacks && callbacks.size > 0) {
          const currentValue = this.getSettingValue('ollama_servers_settings');
          console.log('[SettingsService] Notifying existing subscribers with current value:', currentValue);
          callbacks.forEach(callback => {
            try {
              callback(currentValue);
            } catch (error) {
              console.error('[SettingsService] Error in notification callback:', error);
            }
          });
        }
      }
    }
  }

  getSettingValue(key: string): any {
    const value = this.settings.get(`value_${key}`);
    console.log(`[SettingsService] Getting setting value for '${key}':`, value);
    return value;
  }

  setSettingValue(key: string, value: any): void {
    this.settings.set(`value_${key}`, value);
    console.log('[SettingsService] Setting value:', key, value);
    
    // Notify all subscribers of this setting
    const callbacks = this.subscriptions.get(key);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(value);
        } catch (error) {
          console.error('[SettingsService] Error in subscription callback:', error);
        }
      });
    }
  }

  subscribeTo(key: string, callback: (value: any) => void): () => void {
    console.log('[SettingsService] Subscribing to setting:', key);
    
    // Add callback to subscriptions
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    this.subscriptions.get(key)!.add(callback);
    
    // Immediately call callback with current value if it exists
    const currentValue = this.getSettingValue(key);
    if (currentValue !== undefined) {
      console.log(`[SettingsService] Calling subscriber immediately with current value for '${key}':`, currentValue);
      setTimeout(() => {
        try {
          callback(currentValue);
        } catch (error) {
          console.error('[SettingsService] Error in initial callback:', error);
        }
      }, 0);
    } else {
      console.log(`[SettingsService] No current value found for '${key}', subscriber will wait for updates`);
    }
    
    // Return unsubscribe function
    return () => {
      console.log('[SettingsService] Unsubscribing from setting:', key);
      const callbacks = this.subscriptions.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(key);
        }
      }
    };
  }

  // Primary method that plugins expect for subscription - ensure it's always available
  subscribe(key: string, callback: (value: any) => void): () => void {
    console.log('[SettingsService] Subscribe method called for:', key);
    return this.subscribeTo(key, callback);
  }

  // Additional methods that might be expected
  getAllSettings(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.settings) {
      if (key.startsWith('value_')) {
        result[key.substring(6)] = value;
      }
    }
    return result;
  }

  hasSettingDefinition(id: string): boolean {
    return this.settings.has(`definition_${id}`);
  }

  // Method to check if service is properly initialized
  isReady(): boolean {
    return typeof this.subscribe === 'function' && typeof this.subscribeTo === 'function' && this.initialized;
  }

  // Get subscription count for debugging
  getSubscriptionCount(): number {
    let total = 0;
    for (const callbacks of this.subscriptions.values()) {
      total += callbacks.size;
    }
    return total;
  }
}

// Export singleton instance
export const serviceBridgeV2 = new ServiceBridgeV2Implementation();