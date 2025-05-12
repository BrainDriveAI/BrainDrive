export interface ResourceLimits {
  maxConcurrentOperations?: number;
  maxQueueSize?: number;
  timeoutMs?: number;
  maxMemoryMB?: number;
  maxCpuPercent?: number;
  maxNetworkMBps?: number;
  maxDiskMB?: number;
}

export interface ResourceUsage {
  type: 'memory' | 'cpu' | 'network' | 'disk' | 'operations';
  value: number;
  timestamp: number;
}

interface PluginResources {
  limits: ResourceLimits;
  usage: {
    memory: number;
    cpu: number;
    network: number;
    disk: number;
    operations: number;
  };
  history: ResourceUsage[];
}

/**
 * Monitors and limits resource usage by plugins
 */
export class ResourceMonitor {
  private resources: Map<string, PluginResources>;
  private readonly historyLimit = 1000; // Keep last 1000 measurements

  constructor() {
    this.resources = new Map();
  }

  /**
   * Set resource limits for a plugin
   */
  setLimits(pluginId: string, limits: ResourceLimits): void {
    if (!this.resources.has(pluginId)) {
      this.resources.set(pluginId, {
        limits,
        usage: {
          memory: 0,
          cpu: 0,
          network: 0,
          disk: 0,
          operations: 0,
        },
        history: [],
      });
    } else {
      this.resources.get(pluginId)!.limits = limits;
    }
  }

  /**
   * Track resource usage for a plugin
   */
  trackUsage(pluginId: string, usage: ResourceUsage): void {
    const resources = this.resources.get(pluginId);
    if (!resources) {
      throw new Error(`No resource limits defined for plugin ${pluginId}`);
    }

    // Update current usage
    resources.usage[usage.type] = usage.value;

    // Add to history
    resources.history.push(usage);
    if (resources.history.length > this.historyLimit) {
      resources.history.shift();
    }

    // Check limits
    this.checkLimits(pluginId, usage);
  }

  /**
   * Get resource usage history for a plugin
   */
  getUsage(pluginId: string): ResourceUsage[] {
    return this.resources.get(pluginId)?.history || [];
  }

  /**
   * Get current resource usage for a plugin
   */
  getCurrentUsage(pluginId: string): Record<string, number> | undefined {
    return this.resources.get(pluginId)?.usage;
  }

  /**
   * Clean up resources for a plugin
   */
  cleanup(pluginId: string): void {
    this.resources.delete(pluginId);
  }

  private checkLimits(pluginId: string, usage: ResourceUsage): void {
    const resources = this.resources.get(pluginId)!;
    const { limits } = resources;

    switch (usage.type) {
      case 'memory':
        if (limits.maxMemoryMB && usage.value > limits.maxMemoryMB) {
          throw new Error(`Memory limit exceeded: ${usage.value}MB > ${limits.maxMemoryMB}MB`);
        }
        break;

      case 'cpu':
        if (limits.maxCpuPercent && usage.value > limits.maxCpuPercent) {
          throw new Error(`CPU limit exceeded: ${usage.value}% > ${limits.maxCpuPercent}%`);
        }
        break;

      case 'network':
        if (limits.maxNetworkMBps && usage.value > limits.maxNetworkMBps) {
          throw new Error(
            `Network limit exceeded: ${usage.value}MBps > ${limits.maxNetworkMBps}MBps`
          );
        }
        break;

      case 'disk':
        if (limits.maxDiskMB && usage.value > limits.maxDiskMB) {
          throw new Error(`Disk limit exceeded: ${usage.value}MB > ${limits.maxDiskMB}MB`);
        }
        break;

      case 'operations':
        if (
          limits.maxConcurrentOperations &&
          usage.value > limits.maxConcurrentOperations
        ) {
          throw new Error(
            `Operation limit exceeded: ${usage.value} > ${limits.maxConcurrentOperations}`
          );
        }
        break;
    }
  }
}
