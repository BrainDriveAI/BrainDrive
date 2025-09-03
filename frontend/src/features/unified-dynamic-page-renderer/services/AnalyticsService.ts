import {
  AnalyticsService as IAnalyticsService,
  PublishedPageMetadata,
  InteractionEvent,
  PagePerformanceMetrics,
  PublishedModeError,
  AnalyticsData
} from '../types/published';

interface AnalyticsConfig {
  enabled: boolean;
  trackingId?: string;
  apiEndpoint?: string;
  batchSize: number;
  flushInterval: number;
  enableDebug: boolean;
}

interface AnalyticsEvent {
  type: 'pageview' | 'interaction' | 'performance' | 'error';
  timestamp: Date;
  sessionId: string;
  userId?: string;
  data: any;
}

/**
 * AnalyticsService - Handles page view tracking, user interactions, and performance monitoring
 */
export class AnalyticsService implements IAnalyticsService {
  private config: AnalyticsConfig;
  private eventQueue: AnalyticsEvent[] = [];
  private sessionId: string;
  private userId?: string;
  private flushTimer?: NodeJS.Timeout;
  private pageViewCount = 0;
  private uniqueVisitors = new Set<string>();
  private interactions: InteractionEvent[] = [];
  private performanceMetrics: PagePerformanceMetrics[] = [];
  private errors: PublishedModeError[] = [];

  constructor(config: Partial<AnalyticsConfig> = {}) {
    this.config = {
      enabled: true,
      batchSize: 10,
      flushInterval: 30000, // 30 seconds
      enableDebug: false,
      ...config
    };

    this.sessionId = this.generateSessionId();
    this.userId = this.getUserId();

    if (this.config.enabled) {
      this.startFlushTimer();
      this.setupBeforeUnloadHandler();
    }
  }

  /**
   * Track page view
   */
  trackPageView(pageId: string, metadata: PublishedPageMetadata): void {
    if (!this.config.enabled) return;

    this.pageViewCount++;
    if (this.userId) {
      this.uniqueVisitors.add(this.userId);
    }

    const event: AnalyticsEvent = {
      type: 'pageview',
      timestamp: new Date(),
      sessionId: this.sessionId,
      userId: this.userId,
      data: {
        pageId,
        title: metadata.title,
        description: metadata.description,
        author: metadata.author,
        publishedAt: metadata.publishedAt,
        url: window.location.href,
        referrer: document.referrer,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        screen: {
          width: screen.width,
          height: screen.height,
          colorDepth: screen.colorDepth
        },
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    };

    this.queueEvent(event);

    if (this.config.enableDebug) {
      console.log('[Analytics] Page view tracked:', event);
    }
  }

  /**
   * Track user interaction
   */
  trackInteraction(event: InteractionEvent): void {
    if (!this.config.enabled) return;

    this.interactions.push(event);

    const analyticsEvent: AnalyticsEvent = {
      type: 'interaction',
      timestamp: new Date(),
      sessionId: this.sessionId,
      userId: this.userId,
      data: {
        interactionType: event.type,
        target: event.target,
        moduleId: event.moduleId,
        metadata: event.metadata,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }
    };

    this.queueEvent(analyticsEvent);

    if (this.config.enableDebug) {
      console.log('[Analytics] Interaction tracked:', analyticsEvent);
    }
  }

  /**
   * Track performance metrics
   */
  trackPerformance(metrics: PagePerformanceMetrics): void {
    if (!this.config.enabled) return;

    this.performanceMetrics.push(metrics);

    const event: AnalyticsEvent = {
      type: 'performance',
      timestamp: new Date(),
      sessionId: this.sessionId,
      userId: this.userId,
      data: {
        ...metrics,
        url: window.location.href,
        connection: this.getConnectionInfo(),
        deviceInfo: this.getDeviceInfo()
      }
    };

    this.queueEvent(event);

    if (this.config.enableDebug) {
      console.log('[Analytics] Performance tracked:', event);
    }
  }

  /**
   * Track error
   */
  trackError(error: PublishedModeError): void {
    if (!this.config.enabled) return;

    this.errors.push(error);

    const event: AnalyticsEvent = {
      type: 'error',
      timestamp: new Date(),
      sessionId: this.sessionId,
      userId: this.userId,
      data: {
        ...error,
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }
    };

    this.queueEvent(event);

    // Flush errors immediately for critical issues
    if (error.type === 'security' || error.type === 'validation') {
      this.flush();
    }

    if (this.config.enableDebug) {
      console.log('[Analytics] Error tracked:', event);
    }
  }

  /**
   * Get analytics data
   */
  getAnalytics(pageId?: string): AnalyticsData {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let filteredInteractions = this.interactions;
    let filteredMetrics = this.performanceMetrics;
    let filteredErrors = this.errors;

    if (pageId) {
      // Filter by page ID if provided
      filteredInteractions = this.interactions.filter(
        interaction => interaction.metadata?.pageId === pageId
      );
      // Note: Performance metrics and errors don't have direct pageId reference
      // In a real implementation, you'd need to track this relationship
    }

    return {
      pageViews: this.pageViewCount,
      uniqueVisitors: this.uniqueVisitors.size,
      interactions: filteredInteractions,
      performanceMetrics: filteredMetrics.length > 0 ? filteredMetrics[filteredMetrics.length - 1] : {
        loadTime: 0,
        firstContentfulPaint: 0,
        largestContentfulPaint: 0,
        firstInputDelay: 0,
        cumulativeLayoutShift: 0,
        timeToInteractive: 0,
        bundleSize: 0,
        imageSize: 0,
        requestCount: 0,
        cacheHitRate: 0,
        cachedResources: 0,
        mobileScore: 0,
        mobileFriendly: false
      },
      errors: filteredErrors,
      timeRange: {
        start: startOfDay,
        end: now
      }
    };
  }

  /**
   * Set user ID for tracking
   */
  setUserId(userId: string): void {
    this.userId = userId;
    this.uniqueVisitors.add(userId);
    
    // Store in localStorage for persistence
    try {
      localStorage.setItem('analytics_user_id', userId);
    } catch (error) {
      console.warn('[Analytics] Failed to store user ID:', error);
    }
  }

  /**
   * Clear user ID
   */
  clearUserId(): void {
    this.userId = undefined;
    
    try {
      localStorage.removeItem('analytics_user_id');
    } catch (error) {
      console.warn('[Analytics] Failed to clear user ID:', error);
    }
  }

  /**
   * Flush events to server
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      if (this.config.apiEndpoint) {
        await this.sendToServer(events);
      } else {
        // Fallback to console logging if no endpoint configured
        if (this.config.enableDebug) {
          console.log('[Analytics] Events to flush:', events);
        }
      }
    } catch (error) {
      console.error('[Analytics] Failed to flush events:', error);
      // Re-queue events on failure
      this.eventQueue.unshift(...events);
    }
  }

  /**
   * Destroy analytics service
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Flush remaining events
    this.flush();
  }

  // Private methods

  private queueEvent(event: AnalyticsEvent): void {
    this.eventQueue.push(event);

    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getUserId(): string | undefined {
    try {
      return localStorage.getItem('analytics_user_id') || undefined;
    } catch (error) {
      return undefined;
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  private setupBeforeUnloadHandler(): void {
    window.addEventListener('beforeunload', () => {
      // Use sendBeacon for reliable event sending on page unload
      if (this.eventQueue.length > 0 && navigator.sendBeacon && this.config.apiEndpoint) {
        const data = JSON.stringify(this.eventQueue);
        navigator.sendBeacon(this.config.apiEndpoint, data);
      }
    });
  }

  private async sendToServer(events: AnalyticsEvent[]): Promise<void> {
    if (!this.config.apiEndpoint) return;

    const response = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        events,
        trackingId: this.config.trackingId,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Analytics API error: ${response.status} ${response.statusText}`);
    }
  }

  private getConnectionInfo(): any {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    if (!connection) return null;

    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData
    };
  }

  private getDeviceInfo(): any {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency,
      maxTouchPoints: navigator.maxTouchPoints,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      }
    };
  }
}

// Singleton instance for global use
let analyticsInstance: AnalyticsService | null = null;

export const getAnalyticsInstance = (config?: Partial<AnalyticsConfig>): AnalyticsService => {
  if (!analyticsInstance) {
    analyticsInstance = new AnalyticsService(config);
  }
  return analyticsInstance;
};

export const destroyAnalyticsInstance = (): void => {
  if (analyticsInstance) {
    analyticsInstance.destroy();
    analyticsInstance = null;
  }
};

export default AnalyticsService;