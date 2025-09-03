// Performance optimization types
export interface PerformanceConfig {
  // Lazy loading
  lazyLoading: {
    enabled: boolean;
    threshold: number; // Intersection observer threshold
    rootMargin: string;
  };
  
  // Code splitting
  codeSplitting: {
    enabled: boolean;
    chunkSize: number;
    preloadChunks: string[];
  };
  
  // Caching
  caching: {
    enabled: boolean;
    strategy: 'memory' | 'localStorage' | 'indexedDB';
    ttl: number; // Time to live in milliseconds
  };
  
  // Bundle optimization
  bundleOptimization: {
    treeshaking: boolean;
    minification: boolean;
    compression: boolean;
  };
}

export interface PerformanceMonitor {
  // Metrics collection
  startTiming(label: string): void;
  endTiming(label: string): number;
  
  // Memory monitoring
  getMemoryUsage(): MemoryInfo;
  
  // Render performance
  getRenderMetrics(): RenderMetrics;
  
  // Network performance
  getNetworkMetrics(): NetworkMetrics;
}

export interface RenderMetrics {
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  firstInputDelay: number;
  timeToInteractive: number;
  totalBlockingTime: number;
}

export interface NetworkMetrics {
  downloadTime: number;
  uploadTime: number;
  latency: number;
  bandwidth: number;
  requestCount: number;
  cacheHitRate: number;
}

export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  domNodes: number;
  eventListeners: number;
}

// Performance budgets
export interface PerformanceBudget {
  // Time budgets (milliseconds)
  maxLoadTime: number;
  maxRenderTime: number;
  maxInteractionDelay: number;
  
  // Size budgets (bytes)
  maxBundleSize: number;
  maxImageSize: number;
  maxFontSize: number;
  
  // Resource budgets
  maxRequests: number;
  maxDomNodes: number;
  maxMemoryUsage: number;
}

// Performance optimization strategies
export interface OptimizationStrategy {
  name: string;
  enabled: boolean;
  priority: number;
  conditions: OptimizationCondition[];
  actions: OptimizationAction[];
}

export interface OptimizationCondition {
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
}

export interface OptimizationAction {
  type: 'lazy-load' | 'preload' | 'cache' | 'compress' | 'defer';
  target: string;
  parameters: Record<string, any>;
}

// Performance alerts
export interface PerformanceAlert {
  id: string;
  type: 'warning' | 'error' | 'critical';
  metric: string;
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: Date;
  suggestions: string[];
}

// Resource loading
export interface ResourceLoadingConfig {
  // Image optimization
  images: {
    lazy: boolean;
    webp: boolean;
    avif: boolean;
    responsive: boolean;
    placeholder: 'blur' | 'empty' | 'skeleton';
  };
  
  // Font optimization
  fonts: {
    preload: string[];
    display: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
    subset: boolean;
  };
  
  // Script optimization
  scripts: {
    defer: boolean;
    async: boolean;
    preload: string[];
    modulePreload: string[];
  };
  
  // CSS optimization
  styles: {
    critical: boolean;
    inline: boolean;
    preload: string[];
  };
}

// Performance profiling
export interface PerformanceProfile {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  
  // Detailed metrics
  phases: ProfilePhase[];
  resources: ResourceTiming[];
  interactions: InteractionTiming[];
  
  // Analysis
  bottlenecks: PerformanceBottleneck[];
  recommendations: PerformanceRecommendation[];
}

export interface ProfilePhase {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  description: string;
}

export interface ResourceTiming {
  name: string;
  type: 'script' | 'stylesheet' | 'image' | 'font' | 'fetch' | 'xhr';
  startTime: number;
  endTime: number;
  duration: number;
  size: number;
  cached: boolean;
}

export interface InteractionTiming {
  type: 'click' | 'scroll' | 'input' | 'navigation';
  startTime: number;
  endTime: number;
  duration: number;
  target: string;
}

export interface PerformanceBottleneck {
  type: 'render' | 'network' | 'script' | 'layout' | 'paint';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: number; // milliseconds
  location: string;
}

export interface PerformanceRecommendation {
  priority: 'low' | 'medium' | 'high';
  category: 'loading' | 'rendering' | 'interactivity' | 'accessibility';
  title: string;
  description: string;
  implementation: string;
  expectedImprovement: number; // milliseconds
}

// Web Vitals tracking
export interface WebVitals {
  // Core Web Vitals
  lcp: number; // Largest Contentful Paint
  fid: number; // First Input Delay
  cls: number; // Cumulative Layout Shift
  
  // Additional metrics
  fcp: number; // First Contentful Paint
  ttfb: number; // Time to First Byte
  tti: number; // Time to Interactive
  tbt: number; // Total Blocking Time
  
  // Custom metrics
  custom: Record<string, number>;
}

export interface WebVitalsThresholds {
  lcp: { good: number; needsImprovement: number };
  fid: { good: number; needsImprovement: number };
  cls: { good: number; needsImprovement: number };
  fcp: { good: number; needsImprovement: number };
  ttfb: { good: number; needsImprovement: number };
  tti: { good: number; needsImprovement: number };
  tbt: { good: number; needsImprovement: number };
}