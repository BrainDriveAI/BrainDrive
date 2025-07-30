import { useContext, useEffect, useState, useCallback } from 'react';
import { PublishedModeContext } from '../components/PublishedModeController';
import {
  PublishedModeConfig,
  PublishedPageData,
  PublicationStatus,
  SEOIssue,
  InteractionEvent
} from '../types/published';

/**
 * Hook for managing published mode functionality
 */
export function usePublishedMode() {
  const context = useContext(PublishedModeContext);
  
  if (!context) {
    throw new Error('usePublishedMode must be used within a PublishedModeController');
  }

  const { isPublishedMode, currentPage, config, events } = context;

  return {
    isPublishedMode,
    currentPage,
    config,
    events,
    
    // Helper methods
    isPagePublished: currentPage?.publicationStatus.isPublished || false,
    pageMetadata: currentPage?.metadata,
    publicationStatus: currentPage?.publicationStatus,
    
    // Event tracking helpers
    trackInteraction: events.onInteraction,
    trackError: events.onError,
    trackPerformance: events.onPerformanceMetric
  };
}

/**
 * Hook for SEO management in published mode
 */
export function useSEO() {
  const { currentPage, config } = usePublishedMode();
  const [seoIssues, setSeoIssues] = useState<SEOIssue[]>([]);
  const [seoScore, setSeoScore] = useState<number>(0);

  // Calculate SEO score based on metadata completeness
  const calculateSEOScore = useCallback((metadata: PublishedPageData['metadata']): number => {
    let score = 0;
    const maxScore = 100;

    // Title (20 points)
    if (metadata.title && metadata.title.length >= 30 && metadata.title.length <= 60) {
      score += 20;
    } else if (metadata.title) {
      score += 10;
    }

    // Description (20 points)
    if (metadata.description && metadata.description.length >= 120 && metadata.description.length <= 160) {
      score += 20;
    } else if (metadata.description) {
      score += 10;
    }

    // Keywords (10 points)
    if (metadata.keywords && metadata.keywords.length > 0 && metadata.keywords.length <= 10) {
      score += 10;
    }

    // Open Graph (15 points)
    if (metadata.ogTitle && metadata.ogDescription && metadata.ogImage) {
      score += 15;
    } else if (metadata.ogTitle || metadata.ogDescription) {
      score += 8;
    }

    // Twitter Card (10 points)
    if (metadata.twitterCard && metadata.twitterTitle && metadata.twitterDescription) {
      score += 10;
    }

    // Canonical URL (10 points)
    if (metadata.canonicalUrl) {
      score += 10;
    }

    // Structured Data (10 points)
    if (metadata.structuredData && metadata.structuredData.length > 0) {
      score += 10;
    }

    // Author (5 points)
    if (metadata.author) {
      score += 5;
    }

    return Math.min(score, maxScore);
  }, []);

  // Validate SEO and update issues
  const validateSEO = useCallback((metadata: PublishedPageData['metadata']): SEOIssue[] => {
    const issues: SEOIssue[] = [];

    // Title validation
    if (!metadata.title) {
      issues.push({
        type: 'missing',
        severity: 'critical',
        element: 'title',
        message: 'Page title is missing',
        recommendation: 'Add a descriptive title between 30-60 characters'
      });
    } else if (metadata.title.length < 30) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'title',
        message: 'Page title is too short',
        recommendation: 'Expand title to 30-60 characters for better SEO'
      });
    } else if (metadata.title.length > 60) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'title',
        message: 'Page title is too long',
        recommendation: 'Shorten title to under 60 characters to prevent truncation'
      });
    }

    // Description validation
    if (!metadata.description) {
      issues.push({
        type: 'missing',
        severity: 'critical',
        element: 'description',
        message: 'Meta description is missing',
        recommendation: 'Add a compelling description between 120-160 characters'
      });
    } else if (metadata.description.length < 120) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'description',
        message: 'Meta description is too short',
        recommendation: 'Expand description to 120-160 characters'
      });
    } else if (metadata.description.length > 160) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'description',
        message: 'Meta description is too long',
        recommendation: 'Shorten description to under 160 characters'
      });
    }

    // Open Graph validation
    if (!metadata.ogTitle && !metadata.title) {
      issues.push({
        type: 'missing',
        severity: 'high',
        element: 'og:title',
        message: 'Open Graph title is missing',
        recommendation: 'Add og:title for better social media sharing'
      });
    }

    if (!metadata.ogImage) {
      issues.push({
        type: 'missing',
        severity: 'medium',
        element: 'og:image',
        message: 'Open Graph image is missing',
        recommendation: 'Add an engaging image for social media sharing'
      });
    }

    return issues;
  }, []);

  // Update SEO data when page changes
  useEffect(() => {
    if (currentPage?.metadata) {
      const score = calculateSEOScore(currentPage.metadata);
      const issues = validateSEO(currentPage.metadata);
      
      setSeoScore(score);
      setSeoIssues(issues);
    }
  }, [currentPage, calculateSEOScore, validateSEO]);

  return {
    seoScore,
    seoIssues,
    metadata: currentPage?.metadata,
    
    // Helper methods
    getSEOGrade: (): 'A' | 'B' | 'C' | 'D' | 'F' => {
      if (seoScore >= 90) return 'A';
      if (seoScore >= 80) return 'B';
      if (seoScore >= 70) return 'C';
      if (seoScore >= 60) return 'D';
      return 'F';
    },
    
    getCriticalIssues: (): SEOIssue[] => seoIssues.filter(issue => issue.severity === 'critical'),
    getHighPriorityIssues: (): SEOIssue[] => seoIssues.filter(issue => issue.severity === 'high'),
    
    // Validation helpers
    validateSEO,
    calculateSEOScore
  };
}

/**
 * Hook for analytics tracking in published mode
 */
export function useAnalytics() {
  const { events, currentPage, config } = usePublishedMode();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(config.enableAnalytics);

  // Track page view
  const trackPageView = useCallback(() => {
    if (!analyticsEnabled || !currentPage) return;
    
    events.onPageView(currentPage.id, currentPage.metadata);
  }, [analyticsEnabled, currentPage, events]);

  // Track custom interaction
  const trackInteraction = useCallback((
    type: InteractionEvent['type'],
    target: string,
    moduleId?: string,
    metadata?: Record<string, any>
  ) => {
    if (!analyticsEnabled) return;

    const interactionEvent: InteractionEvent = {
      type,
      target,
      moduleId,
      timestamp: new Date(),
      metadata
    };

    events.onInteraction(interactionEvent);
  }, [analyticsEnabled, events]);

  // Track click events
  const trackClick = useCallback((target: string, moduleId?: string, metadata?: Record<string, any>) => {
    trackInteraction('click', target, moduleId, metadata);
  }, [trackInteraction]);

  // Track scroll events
  const trackScroll = useCallback((target: string, metadata?: Record<string, any>) => {
    trackInteraction('scroll', target, undefined, metadata);
  }, [trackInteraction]);

  // Track form interactions
  const trackInput = useCallback((target: string, moduleId?: string, metadata?: Record<string, any>) => {
    trackInteraction('input', target, moduleId, metadata);
  }, [trackInteraction]);

  // Auto-track page view on mount
  useEffect(() => {
    trackPageView();
  }, [trackPageView]);

  return {
    analyticsEnabled,
    setAnalyticsEnabled,
    
    // Tracking methods
    trackPageView,
    trackInteraction,
    trackClick,
    trackScroll,
    trackInput,
    
    // Current page info
    pageId: currentPage?.id,
    pageTitle: currentPage?.metadata.title,
    pageRoute: currentPage?.route
  };
}

/**
 * Hook for performance monitoring in published mode
 */
export function usePerformanceMonitoring() {
  const { events, config } = usePublishedMode();
  const [performanceData, setPerformanceData] = useState<{
    loadTime: number;
    renderTime: number;
    interactionDelay: number;
  }>({
    loadTime: 0,
    renderTime: 0,
    interactionDelay: 0
  });

  // Track performance metric
  const trackPerformance = useCallback((name: string, value: number, unit: string = 'ms') => {
    events.onPerformanceMetric({
      name,
      value,
      unit,
      timestamp: new Date(),
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent
      }
    });

    // Update local performance data
    setPerformanceData(prev => ({
      ...prev,
      [name]: value
    }));
  }, [events]);

  // Measure and track page load time
  const measureLoadTime = useCallback(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navigation) {
      const loadTime = navigation.loadEventEnd - navigation.fetchStart;
      trackPerformance('loadTime', loadTime);
    }
  }, [trackPerformance]);

  // Measure render time
  const measureRenderTime = useCallback((startTime: number) => {
    const renderTime = performance.now() - startTime;
    trackPerformance('renderTime', renderTime);
  }, [trackPerformance]);

  // Measure interaction delay
  const measureInteractionDelay = useCallback((startTime: number) => {
    const delay = performance.now() - startTime;
    trackPerformance('interactionDelay', delay);
  }, [trackPerformance]);

  // Auto-measure load time on mount
  useEffect(() => {
    // Wait for page to fully load
    if (document.readyState === 'complete') {
      measureLoadTime();
    } else {
      window.addEventListener('load', measureLoadTime);
      return () => window.removeEventListener('load', measureLoadTime);
    }
  }, [measureLoadTime]);

  return {
    performanceData,
    
    // Measurement methods
    trackPerformance,
    measureLoadTime,
    measureRenderTime,
    measureInteractionDelay,
    
    // Helper methods
    getPerformanceGrade: (): 'A' | 'B' | 'C' | 'D' | 'F' => {
      const { loadTime } = performanceData;
      if (loadTime < 1000) return 'A';
      if (loadTime < 2000) return 'B';
      if (loadTime < 3000) return 'C';
      if (loadTime < 5000) return 'D';
      return 'F';
    },
    
    isPerformanceGood: (): boolean => {
      const { loadTime, renderTime, interactionDelay } = performanceData;
      return loadTime < 2000 && renderTime < 100 && interactionDelay < 50;
    }
  };
}

export default usePublishedMode;