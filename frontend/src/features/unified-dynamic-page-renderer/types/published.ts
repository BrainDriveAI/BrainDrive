// Published mode specific types
export interface PublishedModeConfig {
  // Security settings
  readOnly: boolean;
  hideUnpublished: boolean;
  validatePublication: boolean;
  
  // Performance optimizations
  enableCaching: boolean;
  cacheStrategy: 'aggressive' | 'moderate' | 'minimal';
  preloadCritical: boolean;
  
  // SEO settings
  enableSEO: boolean;
  generateSitemap: boolean;
  structuredData: boolean;
  
  // Analytics
  enableAnalytics: boolean;
  trackPageViews: boolean;
  trackInteractions: boolean;
}

export interface PublicationStatus {
  isPublished: boolean;
  publishedAt?: Date;
  publishedBy?: string;
  version: string;
  status: 'draft' | 'review' | 'published' | 'archived';
  
  // Publication validation
  validationErrors: ValidationError[];
  lastValidated?: Date;
  
  // SEO readiness
  seoScore: number;
  seoIssues: SEOIssue[];
}

export interface ValidationError {
  type: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface SEOIssue {
  type: 'missing' | 'invalid' | 'duplicate' | 'optimization';
  severity: 'critical' | 'high' | 'medium' | 'low';
  element: string;
  message: string;
  recommendation: string;
}

export interface PublishedPageData {
  // Core page data
  id: string;
  name: string;
  route: string;
  
  // Published content
  publishedLayouts: ResponsiveLayouts;
  publishedModules: PublishedModuleConfig[];
  
  // Metadata
  metadata: PublishedPageMetadata;
  publicationStatus: PublicationStatus;
  
  // Performance data
  performanceMetrics?: PagePerformanceMetrics;
  cacheInfo?: CacheInfo;
}

export interface PublishedModuleConfig {
  // Basic module info
  moduleId: string;
  pluginId: string;
  
  // Published configuration (sanitized)
  config: Record<string, any>;
  
  // Performance hints
  lazy: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  preload: boolean;
  
  // Cache settings
  cacheable: boolean;
  cacheKey?: string;
  cacheTTL?: number;
}

export interface PublishedPageMetadata {
  // SEO metadata
  title: string;
  description: string;
  keywords: string[];
  
  // Open Graph
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
  
  // Twitter Card
  twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player';
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  
  // Technical metadata
  canonicalUrl?: string;
  robots?: string;
  viewport?: string;
  charset?: string;
  
  // Structured data
  structuredData?: StructuredData[];
  
  // Publication info
  author?: string;
  publishedAt: Date;
  lastModified: Date;
  version: string;
}

export interface StructuredData {
  type: string;
  data: Record<string, any>;
  context?: string;
}

export interface PagePerformanceMetrics {
  // Load metrics
  loadTime: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  
  // Interaction metrics
  firstInputDelay: number;
  cumulativeLayoutShift: number;
  timeToInteractive: number;
  
  // Resource metrics
  bundleSize: number;
  imageSize: number;
  requestCount: number;
  
  // Cache metrics
  cacheHitRate: number;
  cachedResources: number;
  
  // Mobile metrics
  mobileScore: number;
  mobileFriendly: boolean;
}

export interface CacheInfo {
  // Cache status
  cached: boolean;
  cacheKey: string;
  cacheLevel: 'memory' | 'localStorage' | 'indexedDB' | 'http';
  
  // Cache timing
  cachedAt: Date;
  expiresAt: Date;
  ttl: number;
  
  // Cache performance
  hitCount: number;
  missCount: number;
  hitRate: number;
  
  // Cache size
  size: number;
  compressed: boolean;
}

// Published mode events
export interface PublishedModeEvents {
  onPageLoad: (page: PublishedPageData) => void;
  onPageView: (pageId: string, metadata: PublishedPageMetadata) => void;
  onInteraction: (event: InteractionEvent) => void;
  onError: (error: PublishedModeError) => void;
  onPerformanceMetric: (metric: PerformanceMetric) => void;
}

export interface InteractionEvent {
  type: 'click' | 'scroll' | 'hover' | 'focus' | 'input';
  target: string;
  moduleId?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface PublishedModeError {
  type: 'load' | 'render' | 'validation' | 'security' | 'performance';
  code: string;
  message: string;
  pageId?: string;
  moduleId?: string;
  timestamp: Date;
  stack?: string;
  userAgent?: string;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: Date;
  context?: Record<string, any>;
}

// Published mode context
export interface PublishedModeContext {
  // Current state
  isPublishedMode: boolean;
  currentPage?: PublishedPageData;
  
  // Configuration
  config: PublishedModeConfig;
  
  // Services
  seoService?: SEOService;
  analyticsService?: AnalyticsService;
  cacheService?: CacheService;
  
  // Event handlers
  events: PublishedModeEvents;
}

// Service interfaces for published mode
export interface SEOService {
  generateMetaTags(metadata: PublishedPageMetadata): string;
  generateStructuredData(data: StructuredData[]): string;
  validateSEO(page: PublishedPageData): SEOIssue[];
  generateSitemap(pages: PublishedPageData[]): string;
  updateMetaTags(metadata: PublishedPageMetadata): void;
}

export interface AnalyticsService {
  trackPageView(pageId: string, metadata: PublishedPageMetadata): void;
  trackInteraction(event: InteractionEvent): void;
  trackPerformance(metrics: PagePerformanceMetrics): void;
  trackError(error: PublishedModeError): void;
  getAnalytics(pageId?: string): AnalyticsData;
}

export interface AnalyticsData {
  pageViews: number;
  uniqueVisitors: number;
  interactions: InteractionEvent[];
  performanceMetrics: PagePerformanceMetrics;
  errors: PublishedModeError[];
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getInfo(key: string): Promise<CacheInfo | null>;
  invalidate(pattern: string): Promise<void>;
}

// Import types from other modules
import { ResponsiveLayouts } from './core';