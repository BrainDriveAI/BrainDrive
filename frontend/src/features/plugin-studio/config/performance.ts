// Performance optimization configuration for Enhanced Plugin Studio
export interface PerformanceConfig {
  // Rendering optimizations
  lazyLoading: boolean;
  virtualScrolling: boolean;
  debounceDelay: number;
  
  // Memory management
  maxUndoSteps: number;
  autoCleanupInterval: number;
  
  // Network optimizations
  batchUpdates: boolean;
  compressionEnabled: boolean;
  
  // Monitoring
  enableMetrics: boolean;
  metricsInterval: number;
}

export const defaultPerformanceConfig: PerformanceConfig = {
  // Rendering optimizations
  lazyLoading: true,
  virtualScrolling: true,
  debounceDelay: 300,
  
  // Memory management
  maxUndoSteps: 50,
  autoCleanupInterval: 300000, // 5 minutes
  
  // Network optimizations
  batchUpdates: true,
  compressionEnabled: true,
  
  // Monitoring
  enableMetrics: true,
  metricsInterval: 10000, // 10 seconds
};

export const productionPerformanceConfig: PerformanceConfig = {
  ...defaultPerformanceConfig,
  // Production-specific optimizations
  debounceDelay: 500,
  maxUndoSteps: 30,
  metricsInterval: 30000, // 30 seconds
};

export const developmentPerformanceConfig: PerformanceConfig = {
  ...defaultPerformanceConfig,
  // Development-specific settings
  debounceDelay: 100,
  maxUndoSteps: 100,
  metricsInterval: 5000, // 5 seconds
};

// Performance monitoring utilities
export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private config: PerformanceConfig;

  constructor(config: PerformanceConfig = defaultPerformanceConfig) {
    this.config = config;
    
    if (config.enableMetrics) {
      this.startMonitoring();
    }
  }

  // Record performance metric
  recordMetric(name: string, value: number): void {
    if (!this.config.enableMetrics) return;
    
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const values = this.metrics.get(name)!;
    values.push(value);
    
    // Keep only recent values to prevent memory leaks
    if (values.length > 100) {
      values.shift();
    }
  }

  // Get average metric value
  getAverageMetric(name: string): number {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) return 0;
    
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  // Get all metrics summary
  getMetricsSummary(): Record<string, { average: number; count: number; latest: number }> {
    const summary: Record<string, { average: number; count: number; latest: number }> = {};
    
    for (const [name, values] of this.metrics.entries()) {
      if (values.length > 0) {
        summary[name] = {
          average: values.reduce((sum, value) => sum + value, 0) / values.length,
          count: values.length,
          latest: values[values.length - 1],
        };
      }
    }
    
    return summary;
  }

  // Start performance monitoring
  private startMonitoring(): void {
    setInterval(() => {
      // Record memory usage
      if (typeof window !== 'undefined' && 'performance' in window && 'memory' in (window.performance as any)) {
        const memory = (window.performance as any).memory;
        this.recordMetric('memory.used', memory.usedJSHeapSize);
        this.recordMetric('memory.total', memory.totalJSHeapSize);
        this.recordMetric('memory.limit', memory.jsHeapSizeLimit);
      }
      
      // Record timing metrics
      if (typeof window !== 'undefined' && 'performance' in window) {
        const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (navigation) {
          this.recordMetric('timing.domContentLoaded', navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart);
          this.recordMetric('timing.loadComplete', navigation.loadEventEnd - navigation.loadEventStart);
        }
      }
    }, this.config.metricsInterval);
  }

  // Clean up resources
  cleanup(): void {
    this.metrics.clear();
  }
}

// Performance optimization hooks
export function usePerformanceOptimization(config?: Partial<PerformanceConfig>) {
  const finalConfig = { ...defaultPerformanceConfig, ...config };
  
  return {
    config: finalConfig,
    monitor: new PerformanceMonitor(finalConfig),
  };
}

// Debounce utility for performance optimization
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

// Throttle utility for performance optimization
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
}

export default {
  defaultPerformanceConfig,
  productionPerformanceConfig,
  developmentPerformanceConfig,
  PerformanceMonitor,
  usePerformanceOptimization,
  debounce,
  throttle,
};