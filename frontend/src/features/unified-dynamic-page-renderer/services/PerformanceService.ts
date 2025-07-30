import { PerformanceService, MemoryInfo, RenderMetrics, NetworkMetrics, PerformanceIssue } from '../types/services';

/**
 * Enhanced Performance Service Implementation
 * Provides comprehensive performance monitoring and optimization
 */
export class PerformanceServiceImpl implements PerformanceService {
  private timings = new Map<string, number>();
  private performanceObserver?: PerformanceObserver;
  private issueHandlers: ((issue: PerformanceIssue) => void)[] = [];
  private isMonitoring = false;
  private thresholds = {
    slowRender: 16, // 60fps = 16.67ms per frame
    slowLoad: 1000, // 1 second
    highMemory: 50 * 1024 * 1024, // 50MB
    layoutShift: 0.1 // CLS threshold
  };

  constructor() {
    this.setupPerformanceObserver();
    this.startMonitoring();
  }

  /**
   * Start timing a performance measurement
   */
  startTiming(label: string): void {
    this.timings.set(label, performance.now());
    
    // Also use Performance API mark if available
    if (performance.mark) {
      performance.mark(`${label}-start`);
    }
  }

  /**
   * End timing and return duration
   */
  endTiming(label: string): number {
    const startTime = this.timings.get(label);
    if (!startTime) {
      console.warn(`[PerformanceService] No start time found for label: ${label}`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.timings.delete(label);

    // Use Performance API measure if available
    if (performance.mark && performance.measure) {
      try {
        performance.mark(`${label}-end`);
        performance.measure(label, `${label}-start`, `${label}-end`);
      } catch (error) {
        // Ignore errors from performance API
      }
    }

    // Check for performance issues
    this.checkPerformanceThresholds(label, duration);

    return duration;
  }

  /**
   * Get current memory usage information
   */
  getMemoryUsage(): MemoryInfo {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const memoryInfo = {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit
      };

      // Check for high memory usage
      if (memoryInfo.usedJSHeapSize > this.thresholds.highMemory) {
        this.reportIssue({
          type: 'memory',
          severity: 'medium',
          message: `High memory usage detected: ${(memoryInfo.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
          metrics: memoryInfo,
          timestamp: new Date()
        });
      }

      return memoryInfo;
    }

    return {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0
    };
  }

  /**
   * Get render performance metrics
   */
  getRenderMetrics(): RenderMetrics {
    const metrics: RenderMetrics = {
      firstContentfulPaint: 0,
      largestContentfulPaint: 0,
      cumulativeLayoutShift: 0,
      firstInputDelay: 0
    };

    try {
      // Get paint metrics
      const paintEntries = performance.getEntriesByType('paint');
      for (const entry of paintEntries) {
        if (entry.name === 'first-contentful-paint') {
          metrics.firstContentfulPaint = entry.startTime;
        }
      }

      // Get LCP metric
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) {
        const lastEntry = lcpEntries[lcpEntries.length - 1] as any;
        metrics.largestContentfulPaint = lastEntry.startTime;
      }

      // Get CLS metric
      const clsEntries = performance.getEntriesByType('layout-shift');
      let clsValue = 0;
      for (const entry of clsEntries) {
        const layoutShift = entry as any;
        if (!layoutShift.hadRecentInput) {
          clsValue += layoutShift.value;
        }
      }
      metrics.cumulativeLayoutShift = clsValue;

      // Check CLS threshold
      if (clsValue > this.thresholds.layoutShift) {
        this.reportIssue({
          type: 'render',
          severity: 'medium',
          message: `High Cumulative Layout Shift detected: ${clsValue.toFixed(3)}`,
          metrics: { cls: clsValue },
          timestamp: new Date()
        });
      }

      // Get FID metric
      const fidEntries = performance.getEntriesByType('first-input');
      if (fidEntries.length > 0) {
        const firstInput = fidEntries[0] as any;
        metrics.firstInputDelay = firstInput.processingStart - firstInput.startTime;
      }

    } catch (error) {
      console.warn('[PerformanceService] Error getting render metrics:', error);
    }

    return metrics;
  }

  /**
   * Get network performance metrics
   */
  getNetworkMetrics(): NetworkMetrics {
    const metrics: NetworkMetrics = {
      downloadTime: 0,
      uploadTime: 0,
      latency: 0,
      bandwidth: 0
    };

    try {
      // Get navigation timing
      const navigation = performance.getEntriesByType('navigation')[0] as any;
      if (navigation) {
        metrics.downloadTime = navigation.responseEnd - navigation.responseStart;
        metrics.latency = navigation.responseStart - navigation.requestStart;
      }

      // Estimate bandwidth from resource timings
      const resources = performance.getEntriesByType('resource');
      let totalBytes = 0;
      let totalTime = 0;

      for (const resource of resources) {
        const resourceEntry = resource as any;
        if (resourceEntry.transferSize && resourceEntry.duration) {
          totalBytes += resourceEntry.transferSize;
          totalTime += resourceEntry.duration;
        }
      }

      if (totalTime > 0) {
        metrics.bandwidth = (totalBytes * 8) / (totalTime / 1000); // bits per second
      }

    } catch (error) {
      console.warn('[PerformanceService] Error getting network metrics:', error);
    }

    return metrics;
  }

  /**
   * Register a performance issue handler
   */
  onPerformanceIssue(handler: (issue: PerformanceIssue) => void): () => void {
    this.issueHandlers.push(handler);
    
    return () => {
      const index = this.issueHandlers.indexOf(handler);
      if (index > -1) {
        this.issueHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    return {
      memory: this.getMemoryUsage(),
      render: this.getRenderMetrics(),
      network: this.getNetworkMetrics(),
      activeTimings: this.timings.size,
      isMonitoring: this.isMonitoring
    };
  }

  /**
   * Set performance thresholds
   */
  setThresholds(newThresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }

  /**
   * Start performance monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Monitor long tasks
    if ('PerformanceObserver' in window) {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) { // Long task threshold
              this.reportIssue({
                type: 'render',
                severity: 'high',
                message: `Long task detected: ${entry.duration.toFixed(2)}ms`,
                metrics: { duration: entry.duration, name: entry.name },
                timestamp: new Date()
              });
            }
          }
        });
        
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch (error) {
        console.warn('[PerformanceService] Long task observer not supported');
      }
    }

    console.log('[PerformanceService] Performance monitoring started');
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }
    
    console.log('[PerformanceService] Performance monitoring stopped');
  }

  /**
   * Clear all performance data
   */
  clearData(): void {
    this.timings.clear();
    
    if (performance.clearMarks) {
      performance.clearMarks();
    }
    
    if (performance.clearMeasures) {
      performance.clearMeasures();
    }
  }

  /**
   * Setup performance observer for automatic monitoring
   */
  private setupPerformanceObserver(): void {
    if (!('PerformanceObserver' in window)) {
      console.warn('[PerformanceService] PerformanceObserver not supported');
      return;
    }

    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.processPerformanceEntry(entry);
        }
      });

      // Observe multiple entry types
      const entryTypes = ['measure', 'navigation', 'resource', 'paint'];
      for (const type of entryTypes) {
        try {
          this.performanceObserver.observe({ entryTypes: [type] });
        } catch (error) {
          // Some entry types might not be supported
        }
      }
    } catch (error) {
      console.warn('[PerformanceService] Failed to setup PerformanceObserver:', error);
    }
  }

  /**
   * Process individual performance entries
   */
  private processPerformanceEntry(entry: PerformanceEntry): void {
    // Process different types of performance entries
    switch (entry.entryType) {
      case 'measure':
        if (entry.duration > this.thresholds.slowRender) {
          this.reportIssue({
            type: 'render',
            severity: 'medium',
            message: `Slow measurement: ${entry.name} took ${entry.duration.toFixed(2)}ms`,
            metrics: { duration: entry.duration, name: entry.name },
            timestamp: new Date()
          });
        }
        break;
        
      case 'resource':
        const resource = entry as any;
        if (resource.duration > this.thresholds.slowLoad) {
          this.reportIssue({
            type: 'network',
            severity: 'medium',
            message: `Slow resource load: ${resource.name} took ${resource.duration.toFixed(2)}ms`,
            metrics: { duration: resource.duration, name: resource.name },
            timestamp: new Date()
          });
        }
        break;
    }
  }

  /**
   * Check performance against thresholds
   */
  private checkPerformanceThresholds(label: string, duration: number): void {
    if (duration > this.thresholds.slowRender) {
      this.reportIssue({
        type: 'render',
        severity: duration > this.thresholds.slowLoad ? 'high' : 'medium',
        message: `Slow operation: ${label} took ${duration.toFixed(2)}ms`,
        metrics: { duration, label },
        timestamp: new Date()
      });
    }
  }

  /**
   * Report a performance issue
   */
  private reportIssue(issue: PerformanceIssue): void {
    console.warn(`[PerformanceService] ${issue.severity.toUpperCase()}: ${issue.message}`);
    
    // Notify all registered handlers
    for (const handler of this.issueHandlers) {
      try {
        handler(issue);
      } catch (error) {
        console.error('[PerformanceService] Error in issue handler:', error);
      }
    }
  }
}

// Export singleton instance
export const performanceService = new PerformanceServiceImpl();