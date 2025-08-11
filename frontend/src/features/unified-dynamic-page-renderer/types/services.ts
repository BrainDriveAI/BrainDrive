import React from 'react';
import { RenderMode, ModuleConfig, UserContext } from './core';
import { BreakpointInfo, ContainerDimensions } from './responsive';

// Service Bridge v2 interfaces
export interface ServiceBridgeV2 {
  // Service management
  registerService(name: string, service: any): void;
  unregisterService(name: string): void;
  getService<T = any>(name: string): T | null;
  
  // Dependency resolution
  resolveDependencies(requiredServices: string[]): ServiceResolution;
  
  // Lifecycle management
  initializeServices(context: ServiceContext): Promise<void>;
  cleanupServices(): Promise<void>;
  
  // Performance monitoring
  getServiceMetrics(): ServiceMetrics;
}

export interface ServiceResolution {
  resolved: Record<string, any>;
  missing: string[];
  errors: ServiceError[];
}

export interface ServiceContext {
  mode: RenderMode;
  pageId: string;
  moduleId: string;
  breakpoint: BreakpointInfo;
  user?: UserContext;
}

export interface ServiceMetrics {
  loadTime: number;
  memoryUsage: number;
  errorCount: number;
  lastAccessed: Date;
}

export interface ServiceError {
  service: string;
  error: Error;
  timestamp: Date;
  context: ServiceContext;
}

// Enhanced service definitions
export interface APIService {
  get<T>(url: string, options?: RequestOptions): Promise<T>;
  post<T>(url: string, data: any, options?: RequestOptions): Promise<T>;
  put<T>(url: string, data: any, options?: RequestOptions): Promise<T>;
  delete<T>(url: string, options?: RequestOptions): Promise<T>;
  
  // Batch operations
  batch(requests: BatchRequest[]): Promise<BatchResponse[]>;
  
  // Caching
  cache: CacheService;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  cache?: boolean;
}

export interface BatchRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  data?: any;
  options?: RequestOptions;
}

export interface BatchResponse<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  status: number;
}

export interface EventService {
  emit(event: string, data: any): void;
  on(event: string, handler: EventHandler): () => void;
  off(event: string, handler: EventHandler): void;
  once(event: string, handler: EventHandler): void;
  
  // Module-to-module communication
  sendToModule(moduleId: string, message: any): void;
  onModuleMessage(handler: ModuleMessageHandler): () => void;
  
  // Global events
  onPageChange(handler: PageChangeHandler): () => void;
  onBreakpointChange(handler: BreakpointChangeHandler): () => void;
}

export type EventHandler = (data: any) => void;
export type ModuleMessageHandler = (fromModuleId: string, message: any) => void;
export type PageChangeHandler = (pageId: string) => void;
export type BreakpointChangeHandler = (breakpoint: BreakpointInfo) => void;

export interface ThemeService {
  getCurrentTheme(): Theme;
  setTheme(theme: Theme): void;
  onThemeChange(handler: ThemeChangeHandler): () => void;
  
  // Responsive theming
  getResponsiveTheme(breakpoint: string): ResponsiveTheme;
  
  // CSS custom properties
  setCSSVariable(name: string, value: string): void;
  getCSSVariable(name: string): string;
}

export interface Theme {
  name: string;
  colors: Record<string, string>;
  typography: Record<string, string>;
  spacing: Record<string, string>;
  shadows: Record<string, string>;
  borders: Record<string, string>;
}

export interface ResponsiveTheme extends Theme {
  breakpoint: string;
  overrides: Partial<Theme>;
}

export type ThemeChangeHandler = (theme: Theme) => void;

export interface StateService {
  // Module state
  getModuleState<T = any>(moduleId: string): T | null;
  setModuleState<T = any>(moduleId: string, state: T): void;
  
  // Page state
  getPageState<T = any>(pageId: string): T | null;
  setPageState<T = any>(pageId: string, state: T): void;
  
  // Global state
  getGlobalState<T = any>(key: string): T | null;
  setGlobalState<T = any>(key: string, value: T): void;
  
  // State persistence
  persist(): Promise<void>;
  restore(): Promise<void>;
  
  // State subscriptions
  subscribe<T = any>(key: string, handler: StateChangeHandler<T>): () => void;
}

export type StateChangeHandler<T> = (newState: T, oldState: T) => void;

export interface CacheService {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttl?: number): void;
  delete(key: string): void;
  clear(): void;
  has(key: string): boolean;
  
  // Cache statistics
  getStats(): CacheStats;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  memoryUsage: number;
}

// New services for enhanced functionality
export interface ResponsiveService {
  observeContainer(element: HTMLElement, callback: (dimensions: ContainerDimensions) => void): () => void;
  getCurrentBreakpoint(): BreakpointInfo;
  getResponsiveValue<T>(values: ResponsiveValues<T>): T;
  generateResponsiveStyles(config: ResponsiveStyleConfig): string;
}

export interface ResponsiveValues<T> {
  mobile?: T;
  tablet?: T;
  desktop?: T;
  wide?: T;
  ultrawide?: T;
  default: T;
}

export interface ResponsiveStyleConfig {
  property: string;
  values: ResponsiveValues<string | number>;
  unit?: string;
  important?: boolean;
}

export interface PerformanceService {
  startTiming(label: string): void;
  endTiming(label: string): number;
  getMemoryUsage(): MemoryInfo;
  getRenderMetrics(): RenderMetrics;
  getNetworkMetrics(): NetworkMetrics;
  
  // Performance monitoring
  onPerformanceIssue(handler: PerformanceIssueHandler): () => void;
}

export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface RenderMetrics {
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  firstInputDelay: number;
}

export interface NetworkMetrics {
  downloadTime: number;
  uploadTime: number;
  latency: number;
  bandwidth: number;
}

export type PerformanceIssueHandler = (issue: PerformanceIssue) => void;

export interface PerformanceIssue {
  type: 'memory' | 'render' | 'network';
  severity: 'low' | 'medium' | 'high';
  message: string;
  metrics: any;
  timestamp: Date;
}

export interface AccessibilityService {
  checkAccessibility(element: HTMLElement): AccessibilityReport;
  announceToScreenReader(message: string): void;
  focusElement(element: HTMLElement): void;
  
  // Accessibility monitoring
  onAccessibilityViolation(handler: AccessibilityViolationHandler): () => void;
}

export interface AccessibilityReport {
  violations: AccessibilityViolation[];
  warnings: AccessibilityWarning[];
  score: number;
}

export interface AccessibilityViolation {
  rule: string;
  severity: 'error' | 'warning';
  element: string;
  message: string;
  suggestion: string;
}

export interface AccessibilityWarning {
  rule: string;
  element: string;
  message: string;
  suggestion: string;
}

export type AccessibilityViolationHandler = (violation: AccessibilityViolation) => void;

export interface AnimationService {
  animate(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation;
  createTransition(element: HTMLElement, properties: string[], duration: number): void;
  
  // Animation utilities
  easing: Record<string, string>;
  presets: Record<string, AnimationPreset>;
}

export interface AnimationPreset {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  description: string;
}