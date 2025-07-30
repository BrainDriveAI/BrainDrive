/**
 * Animation Service - Unified Dynamic Page Renderer
 * 
 * CSS-based animation management service with performance monitoring,
 * reduced motion support, and comprehensive animation control.
 */

import {
  AnimationConfig,
  TransitionConfig,
  AnimationSequence,
  AnimationState,
  AnimationEvent,
  AnimationEventType,
  AnimationStatus,
  AnimationPerformanceMetrics,
  AnimationPerformanceConfig,
  ReducedMotionConfig,
  AnimationServiceConfig,
  AnimationServiceState,
  AnimationPreset,
  AnimationCategory,
  CSSAnimationRule,
  CSSTransitionRule
} from '../types/animation';

export class AnimationService {
  private state: AnimationServiceState;
  private eventListeners: Map<AnimationEventType, Set<(event: AnimationEvent) => void>>;
  private animationCounter: number = 0;
  private performanceObserver: PerformanceObserver | null = null;
  private styleSheet: CSSStyleSheet | null = null;

  constructor(config?: Partial<AnimationServiceConfig>) {
    this.state = {
      activeAnimations: new Map(),
      performanceMetrics: [],
      reducedMotionEnabled: this.detectReducedMotion(),
      config: this.createDefaultConfig(config)
    };

    this.eventListeners = new Map();
    this.initializeStyleSheet();
    this.initializePerformanceMonitoring();
    this.setupReducedMotionListener();
  }

  // Animation Control Methods
  async play(config: AnimationConfig, element: HTMLElement): Promise<void> {
    const animationId = this.generateAnimationId();
    
    // Adapt for reduced motion if needed
    const adaptedConfig = this.state.reducedMotionEnabled 
      ? this.adaptForReducedMotion(config)
      : config;

    // Create animation state
    const animationState: AnimationState = {
      id: animationId,
      status: 'running',
      progress: 0,
      startTime: performance.now(),
      currentTime: performance.now(),
      remainingTime: adaptedConfig.duration,
      iterations: typeof adaptedConfig.iterations === 'number' ? adaptedConfig.iterations : 1,
      currentIteration: 1
    };

    this.state.activeAnimations.set(animationId, animationState);

    // Generate and apply CSS animation
    const cssRule = this.generateAnimationCSS(adaptedConfig);
    this.addCSSRule(cssRule);
    
    // Apply animation to element
    element.style.animationName = adaptedConfig.name;
    element.style.animationDuration = `${adaptedConfig.duration}ms`;
    element.style.animationTimingFunction = adaptedConfig.easing;
    element.style.animationDelay = `${adaptedConfig.delay || 0}ms`;
    element.style.animationIterationCount = adaptedConfig.iterations?.toString() || '1';
    element.style.animationDirection = adaptedConfig.direction || 'normal';
    element.style.animationFillMode = adaptedConfig.fillMode || 'both';

    // Emit start event
    this.emitEvent('start', animationId);

    // Start performance monitoring
    if (this.state.config.performance.enableMonitoring) {
      this.startPerformanceMonitoring(animationId);
    }

    // Return promise that resolves when animation completes
    return new Promise((resolve, reject) => {
      const handleAnimationEnd = (event: AnimationEvent) => {
        if (event.animationId === animationId && event.type === 'end') {
          this.removeEventListener('end', handleAnimationEnd);
          resolve();
        }
      };

      const handleAnimationCancel = (event: AnimationEvent) => {
        if (event.animationId === animationId && event.type === 'cancel') {
          this.removeEventListener('cancel', handleAnimationCancel);
          reject(new Error('Animation was cancelled'));
        }
      };

      this.addEventListener('end', handleAnimationEnd);
      this.addEventListener('cancel', handleAnimationCancel);

      // Set up native animation event listeners
      const onAnimationEnd = () => {
        animationState.status = 'finished';
        animationState.progress = 1;
        this.emitEvent('end', animationId);
        this.cleanupAnimation(animationId, element);
      };

      const onAnimationIteration = () => {
        animationState.currentIteration++;
        this.emitEvent('iteration', animationId);
      };

      element.addEventListener('animationend', onAnimationEnd, { once: true });
      element.addEventListener('animationiteration', onAnimationIteration);

      // Cleanup listeners when animation ends
      setTimeout(() => {
        element.removeEventListener('animationiteration', onAnimationIteration);
      }, adaptedConfig.duration + (adaptedConfig.delay || 0));
    });
  }

  pause(animationId: string): void {
    const animation = this.state.activeAnimations.get(animationId);
    if (!animation || animation.status !== 'running') return;

    animation.status = 'paused';
    this.emitEvent('pause', animationId);

    // Find and pause the CSS animation
    const element = this.findElementByAnimationId(animationId);
    if (element) {
      element.style.animationPlayState = 'paused';
    }
  }

  resume(animationId: string): void {
    const animation = this.state.activeAnimations.get(animationId);
    if (!animation || animation.status !== 'paused') return;

    animation.status = 'running';
    this.emitEvent('resume', animationId);

    // Find and resume the CSS animation
    const element = this.findElementByAnimationId(animationId);
    if (element) {
      element.style.animationPlayState = 'running';
    }
  }

  stop(animationId: string): void {
    const animation = this.state.activeAnimations.get(animationId);
    if (!animation) return;

    animation.status = 'cancelled';
    this.emitEvent('cancel', animationId);

    // Find and stop the CSS animation
    const element = this.findElementByAnimationId(animationId);
    if (element) {
      this.cleanupAnimation(animationId, element);
    }
  }

  // Sequence Control
  async playSequence(sequence: AnimationSequence, element: HTMLElement): Promise<void> {
    if (sequence.parallel) {
      // Play all animations in parallel
      const promises = sequence.animations.map(config => this.play(config, element));
      await Promise.all(promises);
    } else {
      // Play animations sequentially
      for (const config of sequence.animations) {
        await this.play(config, element);
      }
    }

    if (sequence.onComplete) {
      sequence.onComplete();
    }
  }

  // Transition Control
  applyTransition(config: TransitionConfig, element: HTMLElement): void {
    const adaptedConfig = this.state.reducedMotionEnabled 
      ? this.adaptTransitionForReducedMotion(config)
      : config;

    const properties = Array.isArray(adaptedConfig.property) 
      ? adaptedConfig.property.join(', ')
      : adaptedConfig.property;

    element.style.transition = `${properties} ${adaptedConfig.duration}ms ${adaptedConfig.easing} ${adaptedConfig.delay || 0}ms`;
  }

  // State Management
  getAnimationState(animationId: string): AnimationState | null {
    return this.state.activeAnimations.get(animationId) || null;
  }

  getAllAnimations(): AnimationState[] {
    return Array.from(this.state.activeAnimations.values());
  }

  // Performance Monitoring
  getPerformanceMetrics(animationId?: string): AnimationPerformanceMetrics[] {
    if (animationId) {
      return this.state.performanceMetrics.filter(metric => metric.animationId === animationId);
    }
    return [...this.state.performanceMetrics];
  }

  // Configuration
  setReducedMotionConfig(config: ReducedMotionConfig): void {
    this.state.config.reducedMotion = { ...this.state.config.reducedMotion, ...config };
  }

  setPerformanceConfig(config: AnimationPerformanceConfig): void {
    this.state.config.performance = { ...this.state.config.performance, ...config };
    
    if (config.enableMonitoring && !this.performanceObserver) {
      this.initializePerformanceMonitoring();
    } else if (!config.enableMonitoring && this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }
  }

  // Event Management
  addEventListener(type: AnimationEventType, listener: (event: AnimationEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: AnimationEventType, listener: (event: AnimationEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  // Preset Management
  getPresets(category?: AnimationCategory): AnimationPreset[] {
    const presets = this.state.config.presets;
    return category ? presets.filter(preset => preset.category === category) : presets;
  }

  addPreset(preset: AnimationPreset): void {
    this.state.config.presets.push(preset);
  }

  // Utility Methods
  prefersReducedMotion(): boolean {
    return this.state.reducedMotionEnabled;
  }

  // Private Methods
  private createDefaultConfig(config?: Partial<AnimationServiceConfig>): AnimationServiceConfig {
    return {
      reducedMotion: {
        respectUserPreference: true,
        fallbackDuration: 200,
        disableAnimations: false,
        alternativeEffects: {
          fade: true,
          scale: false,
          position: false
        }
      },
      performance: {
        enableMonitoring: true,
        targetFrameRate: 60,
        jankThreshold: 16.67,
        memoryThreshold: 50 * 1024 * 1024, // 50MB
        reportingInterval: 1000
      },
      presets: this.createDefaultPresets(),
      globalEasing: 'ease-out',
      globalDuration: 300,
      ...config
    };
  }

  private createDefaultPresets(): AnimationPreset[] {
    return [
      {
        name: 'fadeIn',
        description: 'Fade in animation',
        config: {
          name: 'fadeIn',
          duration: 300,
          easing: 'ease-out'
        },
        category: 'entrance'
      },
      {
        name: 'slideInUp',
        description: 'Slide in from bottom',
        config: {
          name: 'slideInUp',
          duration: 400,
          easing: 'ease-out'
        },
        category: 'entrance'
      },
      {
        name: 'scaleIn',
        description: 'Scale in animation',
        config: {
          name: 'scaleIn',
          duration: 250,
          easing: 'ease-out'
        },
        category: 'entrance'
      }
    ];
  }

  private generateAnimationId(): string {
    return `animation-${++this.animationCounter}-${Date.now()}`;
  }

  private detectReducedMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private setupReducedMotionListener(): void {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (e: MediaQueryListEvent) => {
      this.state.reducedMotionEnabled = e.matches;
    };

    mediaQuery.addEventListener('change', handleChange);
  }

  private adaptForReducedMotion(config: AnimationConfig): AnimationConfig {
    if (!this.state.config.reducedMotion.respectUserPreference) {
      return config;
    }

    if (this.state.config.reducedMotion.disableAnimations) {
      return {
        ...config,
        duration: 0,
        delay: 0
      };
    }

    return {
      ...config,
      duration: Math.min(config.duration, this.state.config.reducedMotion.fallbackDuration),
      easing: 'ease-out'
    };
  }

  private adaptTransitionForReducedMotion(config: TransitionConfig): TransitionConfig {
    if (!this.state.config.reducedMotion.respectUserPreference) {
      return config;
    }

    return {
      ...config,
      duration: Math.min(config.duration, this.state.config.reducedMotion.fallbackDuration)
    };
  }

  private generateAnimationCSS(config: AnimationConfig): CSSAnimationRule {
    // Generate keyframes based on animation name
    const keyframes = this.generateKeyframes(config.name);
    
    return {
      name: config.name,
      keyframes,
      properties: {
        duration: `${config.duration}ms`,
        easing: config.easing,
        delay: config.delay ? `${config.delay}ms` : undefined,
        iterations: config.iterations?.toString(),
        direction: config.direction,
        fillMode: config.fillMode
      }
    };
  }

  private generateKeyframes(animationName: string): string {
    const keyframeMap: Record<string, string> = {
      fadeIn: `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `,
      fadeOut: `
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `,
      slideInUp: `
        @keyframes slideInUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `,
      slideInDown: `
        @keyframes slideInDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `,
      slideInLeft: `
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `,
      slideInRight: `
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `,
      scaleIn: `
        @keyframes scaleIn {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `,
      scaleOut: `
        @keyframes scaleOut {
          from { transform: scale(1); opacity: 1; }
          to { transform: scale(0); opacity: 0; }
        }
      `,
      pulse: `
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `,
      spin: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `
    };

    return keyframeMap[animationName] || keyframeMap.fadeIn;
  }

  private initializeStyleSheet(): void {
    if (typeof document === 'undefined') return;

    const style = document.createElement('style');
    style.id = 'unified-page-renderer-animations';
    document.head.appendChild(style);
    this.styleSheet = style.sheet;
  }

  private addCSSRule(rule: CSSAnimationRule): void {
    if (!this.styleSheet) return;

    try {
      // Add keyframes
      this.styleSheet.insertRule(rule.keyframes, this.styleSheet.cssRules.length);
    } catch (error) {
      console.warn('Failed to add CSS animation rule:', error);
    }
  }

  private initializePerformanceMonitoring(): void {
    if (!this.state.config.performance.enableMonitoring || typeof window === 'undefined') return;

    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'measure' && entry.name.startsWith('animation-')) {
            const animationId = entry.name.replace('animation-', '');
            const metric: AnimationPerformanceMetrics = {
              animationId,
              startTime: entry.startTime,
              endTime: entry.startTime + entry.duration,
              duration: entry.duration,
              frameRate: this.calculateFrameRate(entry.duration),
              droppedFrames: 0, // Would need more sophisticated tracking
              jankScore: entry.duration > this.state.config.performance.jankThreshold ? 1 : 0,
              memoryUsage: (performance as any).memory?.usedJSHeapSize || 0
            };
            this.state.performanceMetrics.push(metric);
          }
        });
      });

      this.performanceObserver.observe({ entryTypes: ['measure'] });
    } catch (error) {
      console.warn('Performance monitoring not available:', error);
    }
  }

  private startPerformanceMonitoring(animationId: string): void {
    if (typeof performance === 'undefined') return;
    performance.mark(`animation-${animationId}-start`);
  }

  private calculateFrameRate(duration: number): number {
    // Simplified frame rate calculation
    const expectedFrames = (duration / 1000) * this.state.config.performance.targetFrameRate;
    return Math.min(expectedFrames, this.state.config.performance.targetFrameRate);
  }

  private findElementByAnimationId(animationId: string): HTMLElement | null {
    // This would need to be implemented based on how we track elements
    // For now, return null as we'd need a more sophisticated tracking system
    return null;
  }

  private cleanupAnimation(animationId: string, element: HTMLElement): void {
    // Remove animation styles
    element.style.animationName = '';
    element.style.animationDuration = '';
    element.style.animationTimingFunction = '';
    element.style.animationDelay = '';
    element.style.animationIterationCount = '';
    element.style.animationDirection = '';
    element.style.animationFillMode = '';
    element.style.animationPlayState = '';

    // Remove from active animations
    this.state.activeAnimations.delete(animationId);

    // Mark performance measurement end
    if (typeof performance !== 'undefined') {
      try {
        performance.mark(`animation-${animationId}-end`);
        performance.measure(`animation-${animationId}`, `animation-${animationId}-start`, `animation-${animationId}-end`);
      } catch (error) {
        // Ignore performance measurement errors
      }
    }
  }

  private emitEvent(type: AnimationEventType, animationId: string, data?: any): void {
    const event: AnimationEvent = {
      type,
      animationId,
      timestamp: performance.now(),
      data
    };

    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('Error in animation event listener:', error);
        }
      });
    }
  }

  // Cleanup
  destroy(): void {
    // Stop all active animations
    this.state.activeAnimations.forEach((_, animationId) => {
      this.stop(animationId);
    });

    // Disconnect performance observer
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }

    // Remove style sheet
    if (this.styleSheet && this.styleSheet.ownerNode) {
      this.styleSheet.ownerNode.remove();
    }

    // Clear event listeners
    this.eventListeners.clear();

    // Clear state
    this.state.activeAnimations.clear();
    this.state.performanceMetrics = [];
  }
}

// Export singleton instance
export const animationService = new AnimationService();
export default animationService;