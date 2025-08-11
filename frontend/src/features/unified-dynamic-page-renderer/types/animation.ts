/**
 * Animation System Types - Unified Dynamic Page Renderer
 * 
 * Comprehensive type definitions for the CSS-based animation system
 * with performance monitoring and reduced motion support.
 */

// Animation Configuration Types
export interface AnimationConfig {
  name: string;
  duration: number;
  easing: AnimationEasing;
  delay?: number;
  iterations?: number | 'infinite';
  direction?: AnimationDirection;
  fillMode?: AnimationFillMode;
  playState?: AnimationPlayState;
}

export interface TransitionConfig {
  property: string | string[];
  duration: number;
  easing: AnimationEasing;
  delay?: number;
}

export interface AnimationSequence {
  id: string;
  animations: AnimationConfig[];
  parallel?: boolean;
  onComplete?: () => void;
  onStart?: () => void;
}

// Animation Enums
export type AnimationEasing = 
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic-bezier(number, number, number, number)'
  | string;

export type AnimationDirection = 
  | 'normal'
  | 'reverse'
  | 'alternate'
  | 'alternate-reverse';

export type AnimationFillMode = 
  | 'none'
  | 'forwards'
  | 'backwards'
  | 'both';

export type AnimationPlayState = 
  | 'running'
  | 'paused';

// Predefined Animation Types
export interface FadeAnimation extends AnimationConfig {
  name: 'fadeIn' | 'fadeOut';
  opacity?: {
    from: number;
    to: number;
  };
}

export interface SlideAnimation extends AnimationConfig {
  name: 'slideIn' | 'slideOut' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight';
  distance?: string;
}

export interface ScaleAnimation extends AnimationConfig {
  name: 'scaleIn' | 'scaleOut' | 'pulse';
  scale?: {
    from: number;
    to: number;
  };
}

export interface RotateAnimation extends AnimationConfig {
  name: 'rotateIn' | 'rotateOut' | 'spin';
  rotation?: {
    from: number;
    to: number;
  };
}

// Animation Performance Types
export interface AnimationPerformanceMetrics {
  animationId: string;
  startTime: number;
  endTime?: number;
  duration: number;
  frameRate: number;
  droppedFrames: number;
  jankScore: number;
  memoryUsage: number;
}

export interface AnimationPerformanceConfig {
  enableMonitoring: boolean;
  targetFrameRate: number;
  jankThreshold: number;
  memoryThreshold: number;
  reportingInterval: number;
}

// Reduced Motion Types
export interface ReducedMotionConfig {
  respectUserPreference: boolean;
  fallbackDuration: number;
  disableAnimations: boolean;
  alternativeEffects: {
    fade: boolean;
    scale: boolean;
    position: boolean;
  };
}

// Animation State Types
export interface AnimationState {
  id: string;
  status: AnimationStatus;
  progress: number;
  startTime: number;
  currentTime: number;
  remainingTime: number;
  iterations: number;
  currentIteration: number;
}

export type AnimationStatus = 
  | 'idle'
  | 'running'
  | 'paused'
  | 'finished'
  | 'cancelled';

// Animation Event Types
export interface AnimationEvent {
  type: AnimationEventType;
  animationId: string;
  timestamp: number;
  data?: any;
}

export type AnimationEventType = 
  | 'start'
  | 'end'
  | 'iteration'
  | 'cancel'
  | 'pause'
  | 'resume';

// Animation Manager Types
export interface AnimationManager {
  // Animation Control
  play(config: AnimationConfig, element: HTMLElement): Promise<void>;
  pause(animationId: string): void;
  resume(animationId: string): void;
  stop(animationId: string): void;
  
  // Sequence Control
  playSequence(sequence: AnimationSequence, element: HTMLElement): Promise<void>;
  
  // State Management
  getAnimationState(animationId: string): AnimationState | null;
  getAllAnimations(): AnimationState[];
  
  // Performance Monitoring
  getPerformanceMetrics(animationId?: string): AnimationPerformanceMetrics[];
  
  // Configuration
  setReducedMotionConfig(config: ReducedMotionConfig): void;
  setPerformanceConfig(config: AnimationPerformanceConfig): void;
  
  // Events
  addEventListener(type: AnimationEventType, listener: (event: AnimationEvent) => void): void;
  removeEventListener(type: AnimationEventType, listener: (event: AnimationEvent) => void): void;
}

// Responsive Animation Types
export interface ResponsiveAnimationConfig {
  breakpoints: {
    [key: string]: AnimationConfig;
  };
  default: AnimationConfig;
}

export interface ResponsiveTransitionConfig {
  breakpoints: {
    [key: string]: TransitionConfig;
  };
  default: TransitionConfig;
}

// Animation Preset Types
export interface AnimationPreset {
  name: string;
  description: string;
  config: AnimationConfig;
  preview?: string;
  category: AnimationCategory;
}

export type AnimationCategory = 
  | 'entrance'
  | 'exit'
  | 'emphasis'
  | 'transition'
  | 'loading'
  | 'interaction';

// Animation Hook Types
export interface UseAnimationOptions {
  autoPlay?: boolean;
  respectReducedMotion?: boolean;
  enablePerformanceMonitoring?: boolean;
  onComplete?: () => void;
  onStart?: () => void;
}

export interface UseAnimationReturn {
  play: (config?: Partial<AnimationConfig>) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  state: AnimationState | null;
  isPlaying: boolean;
  isPaused: boolean;
  progress: number;
  ref: React.RefObject<HTMLElement>;
}

export interface UseTransitionOptions {
  property?: string | string[];
  duration?: number;
  easing?: AnimationEasing;
  delay?: number;
  respectReducedMotion?: boolean;
}

export interface UseTransitionReturn {
  trigger: () => void;
  isTransitioning: boolean;
  progress: number;
  ref: React.RefObject<HTMLElement>;
}

// Animation Service Types
export interface AnimationServiceConfig {
  reducedMotion: ReducedMotionConfig;
  performance: AnimationPerformanceConfig;
  presets: AnimationPreset[];
  globalEasing: AnimationEasing;
  globalDuration: number;
}

export interface AnimationServiceState {
  activeAnimations: Map<string, AnimationState>;
  performanceMetrics: AnimationPerformanceMetrics[];
  reducedMotionEnabled: boolean;
  config: AnimationServiceConfig;
}

// CSS Animation Types
export interface CSSAnimationRule {
  name: string;
  keyframes: string;
  properties: {
    duration: string;
    easing: string;
    delay?: string;
    iterations?: string;
    direction?: string;
    fillMode?: string;
  };
}

export interface CSSTransitionRule {
  property: string;
  duration: string;
  easing: string;
  delay?: string;
}

// Animation Utility Types
export interface AnimationUtils {
  // CSS Generation
  generateKeyframes(name: string, keyframes: Record<string, Record<string, string>>): string;
  generateAnimationCSS(config: AnimationConfig): string;
  generateTransitionCSS(config: TransitionConfig): string;
  
  // Performance
  measureFrameRate(callback: () => void): Promise<number>;
  detectJank(threshold: number): boolean;
  
  // Reduced Motion
  prefersReducedMotion(): boolean;
  adaptForReducedMotion(config: AnimationConfig): AnimationConfig;
  
  // Easing
  parseEasing(easing: AnimationEasing): string;
  createCustomEasing(x1: number, y1: number, x2: number, y2: number): string;
}
