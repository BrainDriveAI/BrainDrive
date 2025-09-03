import {
  PerformanceConfig,
  PerformanceMonitor,
  RenderMetrics,
  NetworkMetrics,
  MemoryInfo,
  PerformanceBudget,
  OptimizationStrategy,
  PerformanceAlert,
  ResourceLoadingConfig,
  WebVitals,
  WebVitalsThresholds
} from '../types/performance';

interface OptimizationConfig {
  enabled: boolean;
  lazyLoadingThreshold: number;
  intersectionRootMargin: string;
  preloadCriticalResources: boolean;
  enableCodeSplitting: boolean;
  enableBundleOptimization: boolean;
  memoryManagementEnabled: boolean;
  performanceMonitoringEnabled: boolean;
  webVitalsEnabled: boolean;
}

/**
 * PerformanceOptimizer - Handles lazy loading, code splitting, and performance optimization
 */
export class PerformanceOptimizer implements PerformanceMonitor {
  private config: OptimizationConfig;
  private intersectionObserver?: IntersectionObserver;
  private performanceObserver?: PerformanceObserver;
  private timingMap = new Map<string, number>();
  private webVitals: Partial<WebVitals> = {};
  private alerts: PerformanceAlert[] = [];
  private loadedChunks = new Set<string>();
  private preloadedResources = new Set<string>();

  private webVitalsThresholds: WebVitalsThresholds = {
    lcp: { good: 2500, needsImprovement: 4000 },
    fid: { good: 100, needsImprovement: 300 },
    cls: { good: 0.1, needsImprovement: 0.25 },
    fcp: { good: 1800, needsImprovement: 3000 },
    ttfb: { good: 800, needsImprovement: 1800 },
    tti: { good: 3800, needsImprovement: 7300 },
    tbt: { good: 200, needsImprovement: 600 }
  };

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = {
      enabled: true,
      lazyLoadingThreshold: 0.1,
      intersectionRootMargin: '50px',
      preloadCriticalResources: true,
      enableCodeSplitting: true,
      enableBundleOptimization: true,
      memoryManagementEnabled: true,
      performanceMonitoringEnabled: true,
      webVitalsEnabled: true,
      ...config
    };

    if (this.config.enabled) {
      this.initializeOptimizations();
    }
  }

  /**
   * Initialize lazy loading with Intersection Observer
   */
  initializeLazyLoading(): void {
    if (!this.config.enabled || typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.loadLazyElement(entry.target as HTMLElement);
            this.intersectionObserver?.unobserve(entry.target);
          }
        });
      },
      {
        threshold: this.config.lazyLoadingThreshold,
        rootMargin: this.config.intersectionRootMargin
      }
    );
  }

  /**
   * Register element for lazy loading
   */
  observeLazyElement(element: HTMLElement): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.observe(element);
    }
  }

  /**
   * Load lazy element
   */
  private loadLazyElement(element: HTMLElement): void {
    const moduleId = element.dataset.moduleId;
    const pluginId = element.dataset.pluginId;

    if (moduleId && pluginId) {
      this.loadModuleChunk(pluginId, moduleId);
    }

    // Handle lazy images
    const lazyImages = element.querySelectorAll('img[data-src]');
    lazyImages.forEach((img) => {
      const imageElement = img as HTMLImageElement;
      if (imageElement.dataset.src) {
        imageElement.src = imageElement.dataset.src;
        imageElement.removeAttribute('data-src');
      }
    });

    // Trigger custom lazy load event
    element.dispatchEvent(new CustomEvent('lazyloaded', {
      detail: { moduleId, pluginId }
    }));
  }

  /**
   * Dynamically load module chunk
   */
  async loadModuleChunk(pluginId: string, moduleId: string): Promise<any> {
    const chunkKey = `${pluginId}/${moduleId}`;
    
    if (this.loadedChunks.has(chunkKey)) {
      return Promise.resolve();
    }

    this.startTiming(`chunk_load_${chunkKey}`);

    try {
      // Dynamic import for code splitting
      const module = await import(
        /* webpackChunkName: "[request]" */
        `../../../plugins/${pluginId}/src/components/${moduleId}`
      );

      this.loadedChunks.add(chunkKey);
      const loadTime = this.endTiming(`chunk_load_${chunkKey}`);

      // Track performance
      this.trackMetric('chunk_load_time', loadTime, 'ms', {
        pluginId,
        moduleId,
        chunkKey
      });

      return module;

    } catch (error) {
      const loadTime = this.endTiming(`chunk_load_${chunkKey}`);
      
      this.createAlert({
        type: 'error',
        metric: 'chunk_load_error',
        threshold: 0,
        currentValue: loadTime,
        message: `Failed to load chunk: ${chunkKey}`,
        suggestions: [
          'Check if the module exists',
          'Verify network connectivity',
          'Consider preloading critical modules'
        ]
      });

      throw error;
    }
  }

  /**
   * Preload critical resources
   */
  preloadCriticalResources(resources: string[]): void {
    if (!this.config.preloadCriticalResources) return;

    resources.forEach((resource) => {
      if (this.preloadedResources.has(resource)) return;

      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = resource;

      // Determine resource type
      if (resource.endsWith('.js')) {
        link.as = 'script';
      } else if (resource.endsWith('.css')) {
        link.as = 'style';
      } else if (resource.match(/\.(jpg|jpeg|png|webp|avif)$/)) {
        link.as = 'image';
      } else if (resource.match(/\.(woff|woff2|ttf|otf)$/)) {
        link.as = 'font';
        link.crossOrigin = 'anonymous';
      }

      document.head.appendChild(link);
      this.preloadedResources.add(resource);
    });
  }

  /**
   * Optimize images with lazy loading and format selection
   */
  optimizeImages(container: HTMLElement): void {
    const images = container.querySelectorAll('img');
    
    images.forEach((img) => {
      // Add lazy loading
      if (!img.loading) {
        img.loading = 'lazy';
      }

      // Add intersection observer for more control
      this.observeLazyElement(img);

      // Optimize image format
      this.optimizeImageFormat(img);
    });
  }

  /**
   * Optimize image format based on browser support
   */
  private optimizeImageFormat(img: HTMLImageElement): void {
    const src = img.src || img.dataset.src;
    if (!src) return;

    // Check for WebP support
    if (this.supportsWebP() && !src.includes('.webp')) {
      const webpSrc = src.replace(/\.(jpg|jpeg|png)$/, '.webp');
      
      // Create a picture element for fallback
      if (!img.parentElement?.tagName.toLowerCase().includes('picture')) {
        const picture = document.createElement('picture');
        const source = document.createElement('source');
        
        source.srcset = webpSrc;
        source.type = 'image/webp';
        
        img.parentNode?.insertBefore(picture, img);
        picture.appendChild(source);
        picture.appendChild(img);
      }
    }

    // Check for AVIF support
    if (this.supportsAVIF() && !src.includes('.avif')) {
      const avifSrc = src.replace(/\.(jpg|jpeg|png|webp)$/, '.avif');
      
      const picture = img.parentElement?.tagName.toLowerCase() === 'picture' 
        ? img.parentElement 
        : null;
        
      if (picture) {
        const source = document.createElement('source');
        source.srcset = avifSrc;
        source.type = 'image/avif';
        picture.insertBefore(source, picture.firstChild);
      }
    }
  }

  /**
   * Start timing measurement
   */
  startTiming(label: string): void {
    this.timingMap.set(label, performance.now());
  }

  /**
   * End timing measurement
   */
  endTiming(label: string): number {
    const startTime = this.timingMap.get(label);
    if (!startTime) return 0;

    const duration = performance.now() - startTime;
    this.timingMap.delete(label);
    return duration;
  }

  /**
   * Get memory usage information
   */
  getMemoryUsage(): MemoryInfo {
    const memory = (performance as any).memory;
    
    return {
      usedJSHeapSize: memory?.usedJSHeapSize || 0,
      totalJSHeapSize: memory?.totalJSHeapSize || 0,
      jsHeapSizeLimit: memory?.jsHeapSizeLimit || 0,
      domNodes: document.querySelectorAll('*').length,
      eventListeners: this.countEventListeners()
    };
  }

  /**
   * Get render performance metrics
   */
  getRenderMetrics(): RenderMetrics {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType('paint');
    
    const fcp = paint.find(entry => entry.name === 'first-contentful-paint')?.startTime || 0;
    const lcp = this.webVitals.lcp || 0;
    const fid = this.webVitals.fid || 0;
    const cls = this.webVitals.cls || 0;
    const tti = this.webVitals.tti || 0;
    const tbt = this.webVitals.tbt || 0;

    return {
      firstContentfulPaint: fcp,
      largestContentfulPaint: lcp,
      cumulativeLayoutShift: cls,
      firstInputDelay: fid,
      timeToInteractive: tti,
      totalBlockingTime: tbt
    };
  }

  /**
   * Get network performance metrics
   */
  getNetworkMetrics(): NetworkMetrics {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource');
    
    const downloadTime = navigation.responseEnd - navigation.responseStart;
    const latency = navigation.responseStart - navigation.requestStart;
    const requestCount = resources.length;
    
    // Calculate cache hit rate
    const cachedResources = resources.filter(resource => {
      const resourceTiming = resource as PerformanceResourceTiming;
      return resourceTiming.transferSize === 0 && resourceTiming.decodedBodySize > 0;
    }).length;
    const cacheHitRate = requestCount > 0 ? cachedResources / requestCount : 0;

    return {
      downloadTime,
      uploadTime: 0, // Not easily measurable
      latency,
      bandwidth: this.estimateBandwidth(),
      requestCount,
      cacheHitRate
    };
  }

  /**
   * Track custom performance metric
   */
  trackMetric(name: string, value: number, unit: string, context?: Record<string, any>): void {
    // Store in custom metrics
    this.webVitals.custom = this.webVitals.custom || {};
    this.webVitals.custom[name] = value;

    // Check against performance budgets
    this.checkPerformanceBudget(name, value);

    // Log for debugging
    if (this.config.performanceMonitoringEnabled) {
      console.log(`[Performance] ${name}: ${value}${unit}`, context);
    }
  }

  /**
   * Create performance alert
   */
  private createAlert(alert: Omit<PerformanceAlert, 'id' | 'timestamp'>): void {
    const fullAlert: PerformanceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...alert
    };

    this.alerts.push(fullAlert);

    // Limit alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-50);
    }

    console.warn('[Performance Alert]', fullAlert);
  }

  /**
   * Get performance alerts
   */
  getAlerts(): PerformanceAlert[] {
    return [...this.alerts];
  }

  /**
   * Clear performance alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Initialize all optimizations
   */
  private initializeOptimizations(): void {
    this.initializeLazyLoading();
    this.initializePerformanceObserver();
    this.initializeWebVitalsTracking();
    this.initializeMemoryManagement();
  }

  /**
   * Initialize performance observer
   */
  private initializePerformanceObserver(): void {
    if (!this.config.performanceMonitoringEnabled || typeof PerformanceObserver === 'undefined') {
      return;
    }

    this.performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.processPerformanceEntry(entry);
      }
    });

    // Observe different types of performance entries
    try {
      this.performanceObserver.observe({ entryTypes: ['navigation', 'paint', 'largest-contentful-paint', 'first-input', 'layout-shift'] });
    } catch (error) {
      console.warn('[Performance] Some performance entry types not supported:', error);
    }
  }

  /**
   * Process performance entry
   */
  private processPerformanceEntry(entry: PerformanceEntry): void {
    switch (entry.entryType) {
      case 'paint':
        if (entry.name === 'first-contentful-paint') {
          this.webVitals.fcp = entry.startTime;
        }
        break;
      
      case 'largest-contentful-paint':
        this.webVitals.lcp = entry.startTime;
        break;
      
      case 'first-input':
        this.webVitals.fid = (entry as any).processingStart - entry.startTime;
        break;
      
      case 'layout-shift':
        if (!(entry as any).hadRecentInput) {
          this.webVitals.cls = (this.webVitals.cls || 0) + (entry as any).value;
        }
        break;
    }
  }

  /**
   * Initialize Web Vitals tracking
   */
  private initializeWebVitalsTracking(): void {
    if (!this.config.webVitalsEnabled) return;

    // Track Time to Interactive (TTI)
    this.trackTTI();
    
    // Track Total Blocking Time (TBT)
    this.trackTBT();
    
    // Track Time to First Byte (TTFB)
    this.trackTTFB();
  }

  /**
   * Track Time to Interactive
   */
  private trackTTI(): void {
    // Simplified TTI calculation
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      
      if (lastEntry && lastEntry.startTime > 0) {
        this.webVitals.tti = lastEntry.startTime;
      }
    });

    try {
      observer.observe({ entryTypes: ['measure'] });
    } catch (error) {
      console.warn('[Performance] TTI tracking not supported:', error);
    }
  }

  /**
   * Track Total Blocking Time
   */
  private trackTBT(): void {
    let totalBlockingTime = 0;
    
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          totalBlockingTime += entry.duration - 50;
        }
      }
      this.webVitals.tbt = totalBlockingTime;
    });

    try {
      observer.observe({ entryTypes: ['longtask'] });
    } catch (error) {
      console.warn('[Performance] TBT tracking not supported:', error);
    }
  }

  /**
   * Track Time to First Byte
   */
  private trackTTFB(): void {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navigation) {
      this.webVitals.ttfb = navigation.responseStart - navigation.requestStart;
    }
  }

  /**
   * Initialize memory management
   */
  private initializeMemoryManagement(): void {
    if (!this.config.memoryManagementEnabled) return;

    // Monitor memory usage periodically
    setInterval(() => {
      const memoryInfo = this.getMemoryUsage();
      
      // Alert if memory usage is high
      if (memoryInfo.usedJSHeapSize > 50 * 1024 * 1024) { // 50MB
        this.createAlert({
          type: 'warning',
          metric: 'memory_usage',
          threshold: 50 * 1024 * 1024,
          currentValue: memoryInfo.usedJSHeapSize,
          message: 'High memory usage detected',
          suggestions: [
            'Consider lazy loading more content',
            'Check for memory leaks',
            'Optimize large objects'
          ]
        });
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Check performance against budget
   */
  private checkPerformanceBudget(metric: string, value: number): void {
    const budgets: Record<string, number> = {
      'load_time': 3000,
      'bundle_size': 1024 * 1024, // 1MB
      'memory_usage': 50 * 1024 * 1024, // 50MB
      'request_count': 50
    };

    const budget = budgets[metric];
    if (budget && value > budget) {
      this.createAlert({
        type: 'warning',
        metric,
        threshold: budget,
        currentValue: value,
        message: `Performance budget exceeded for ${metric}`,
        suggestions: [
          'Optimize resource loading',
          'Consider code splitting',
          'Implement caching strategies'
        ]
      });
    }
  }

  /**
   * Estimate bandwidth
   */
  private estimateBandwidth(): number {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    return connection?.downlink || 0;
  }

  /**
   * Count event listeners (approximation)
   */
  private countEventListeners(): number {
    // This is an approximation - actual count is not easily accessible
    return document.querySelectorAll('[onclick], [onload], [onerror]').length;
  }

  /**
   * Check WebP support
   */
  private supportsWebP(): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  }

  /**
   * Check AVIF support
   */
  private supportsAVIF(): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/avif').indexOf('data:image/avif') === 0;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }
    
    this.timingMap.clear();
    this.alerts = [];
    this.loadedChunks.clear();
    this.preloadedResources.clear();
  }
}

export default PerformanceOptimizer;