/**
 * Developer Tools Types - Unified Dynamic Page Renderer
 * 
 * Comprehensive type definitions for debugging utilities, performance profiling,
 * component inspection, and development mode enhancements.
 */

// Developer Tools Configuration
export interface DeveloperToolsConfig {
  enabled: boolean;
  mode: DevelopmentMode;
  debugging: DebuggingConfig;
  profiling: ProfilingConfig;
  inspection: InspectionConfig;
  logging: LoggingConfig;
  monitoring: MonitoringConfig;
}

export type DevelopmentMode = 'development' | 'staging' | 'production';

// Debugging Configuration
export interface DebuggingConfig {
  enabled: boolean;
  breakpoints: boolean;
  console: boolean;
  network: boolean;
  performance: boolean;
  accessibility: boolean;
  errors: boolean;
  warnings: boolean;
}

// Performance Profiling
export interface ProfilingConfig {
  enabled: boolean;
  renderProfiling: boolean;
  memoryProfiling: boolean;
  networkProfiling: boolean;
  bundleAnalysis: boolean;
  cacheAnalysis: boolean;
  animationProfiling: boolean;
}

export interface PerformanceProfile {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metrics: PerformanceMetrics;
  breakdown: PerformanceBreakdown;
  recommendations: PerformanceRecommendation[];
}

export interface PerformanceMetrics {
  renderTime: number;
  memoryUsage: number;
  bundleSize: number;
  cacheHitRate: number;
  networkRequests: number;
  errorCount: number;
  warningCount: number;
}

export interface PerformanceBreakdown {
  initialization: number;
  rendering: number;
  dataLoading: number;
  animations: number;
  interactions: number;
  cleanup: number;
}

export interface PerformanceRecommendation {
  id: string;
  category: PerformanceCategory;
  severity: RecommendationSeverity;
  title: string;
  description: string;
  impact: PerformanceImpact;
  solution: string;
  autoFixable: boolean;
  priority: number;
}

export type PerformanceCategory = 
  | 'rendering'
  | 'memory'
  | 'network'
  | 'bundle'
  | 'cache'
  | 'animation'
  | 'accessibility';

export type RecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type PerformanceImpact = 'minimal' | 'moderate' | 'significant' | 'severe';

// Component Inspection
export interface InspectionConfig {
  enabled: boolean;
  componentTree: boolean;
  props: boolean;
  state: boolean;
  hooks: boolean;
  context: boolean;
  performance: boolean;
  accessibility: boolean;
}

export interface ComponentInspection {
  id: string;
  name: string;
  type: ComponentType;
  props: Record<string, any>;
  state: Record<string, any>;
  hooks: HookInspection[];
  context: ContextInspection[];
  performance: ComponentPerformance;
  accessibility: ComponentAccessibility;
  children: ComponentInspection[];
  parent?: ComponentInspection;
}

export type ComponentType = 'functional' | 'class' | 'memo' | 'forwardRef' | 'lazy';

export interface HookInspection {
  name: string;
  type: HookType;
  value: any;
  dependencies?: any[];
  rerenderCount: number;
}

export type HookType = 
  | 'useState'
  | 'useEffect'
  | 'useContext'
  | 'useReducer'
  | 'useCallback'
  | 'useMemo'
  | 'useRef'
  | 'custom';

export interface ContextInspection {
  name: string;
  value: any;
  provider?: string;
  consumers: string[];
}

export interface ComponentPerformance {
  renderCount: number;
  averageRenderTime: number;
  lastRenderTime: number;
  memoryUsage: number;
  rerenderReasons: RerenderReason[];
}

export interface RerenderReason {
  type: RerenderType;
  description: string;
  timestamp: number;
  impact: PerformanceImpact;
}

export type RerenderType = 
  | 'props-change'
  | 'state-change'
  | 'context-change'
  | 'parent-rerender'
  | 'force-update';

export interface ComponentAccessibility {
  score: number;
  violations: string[];
  warnings: string[];
  suggestions: string[];
}

// Logging Configuration
export interface LoggingConfig {
  enabled: boolean;
  level: LogLevel;
  categories: LogCategory[];
  output: LogOutput[];
  formatting: LogFormatting;
  filtering: LogFiltering;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogCategory = 
  | 'rendering'
  | 'state'
  | 'props'
  | 'hooks'
  | 'context'
  | 'performance'
  | 'accessibility'
  | 'network'
  | 'errors';

export type LogOutput = 'console' | 'file' | 'remote' | 'memory';

export interface LogFormatting {
  timestamp: boolean;
  level: boolean;
  category: boolean;
  component: boolean;
  colors: boolean;
  stackTrace: boolean;
}

export interface LogFiltering {
  minLevel: LogLevel;
  categories: LogCategory[];
  components: string[];
  keywords: string[];
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  component?: string;
  message: string;
  data?: any;
  stackTrace?: string;
}

// Monitoring Configuration
export interface MonitoringConfig {
  enabled: boolean;
  realTime: boolean;
  alerts: AlertConfig;
  metrics: MetricConfig[];
  reporting: ReportingConfig;
}

export interface AlertConfig {
  enabled: boolean;
  thresholds: AlertThreshold[];
  notifications: NotificationConfig[];
}

export interface AlertThreshold {
  metric: string;
  operator: ThresholdOperator;
  value: number;
  severity: RecommendationSeverity;
  message: string;
}

export type ThresholdOperator = 'gt' | 'lt' | 'eq' | 'gte' | 'lte';

export interface NotificationConfig {
  type: NotificationType;
  enabled: boolean;
  config: Record<string, any>;
}

export type NotificationType = 'console' | 'toast' | 'email' | 'webhook';

export interface MetricConfig {
  name: string;
  enabled: boolean;
  interval: number;
  retention: number;
  aggregation: AggregationType;
}

export type AggregationType = 'sum' | 'avg' | 'min' | 'max' | 'count';

export interface ReportingConfig {
  enabled: boolean;
  interval: number;
  format: ReportFormat;
  destination: ReportDestination[];
}

export type ReportFormat = 'json' | 'csv' | 'html' | 'pdf';

export type ReportDestination = 'file' | 'email' | 'api' | 'storage';

// Developer Tools Service Types
export interface DeveloperToolsServiceState {
  enabled: boolean;
  config: DeveloperToolsConfig;
  profiles: PerformanceProfile[];
  inspections: ComponentInspection[];
  logs: LogEntry[];
  alerts: Alert[];
  metrics: Metric[];
}

export interface Alert {
  id: string;
  timestamp: number;
  severity: RecommendationSeverity;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  acknowledged: boolean;
}

export interface Metric {
  name: string;
  timestamp: number;
  value: number;
  unit: string;
  tags: Record<string, string>;
}

// Hook Types
export interface UseDeveloperToolsOptions {
  enabled?: boolean;
  profiling?: boolean;
  inspection?: boolean;
  logging?: boolean;
  monitoring?: boolean;
}

export interface UseDeveloperToolsReturn {
  isEnabled: boolean;
  startProfiling: (name: string) => string;
  stopProfiling: (id: string) => PerformanceProfile | null;
  inspectComponent: (element: HTMLElement) => ComponentInspection | null;
  log: (level: LogLevel, category: LogCategory, message: string, data?: any) => void;
  getMetrics: () => Metric[];
  getAlerts: () => Alert[];
  acknowledgeAlert: (id: string) => void;
}

export interface UseComponentInspectorOptions {
  enabled?: boolean;
  trackPerformance?: boolean;
  trackAccessibility?: boolean;
  onInspection?: (inspection: ComponentInspection) => void;
}

export interface UseComponentInspectorReturn {
  inspection: ComponentInspection | null;
  isInspecting: boolean;
  startInspection: () => void;
  stopInspection: () => void;
  refreshInspection: () => void;
}

export interface UsePerformanceProfilerOptions {
  enabled?: boolean;
  autoStart?: boolean;
  interval?: number;
  onProfile?: (profile: PerformanceProfile) => void;
}

export interface UsePerformanceProfilerReturn {
  currentProfile: PerformanceProfile | null;
  profiles: PerformanceProfile[];
  isProfilering: boolean;
  startProfiling: (name: string) => string;
  stopProfiling: (id: string) => PerformanceProfile | null;
  clearProfiles: () => void;
}

// Debug Console Types
export interface DebugConsole {
  log: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
  table: (data: any) => void;
  time: (label: string) => void;
  timeEnd: (label: string) => void;
  clear: () => void;
  count: (label?: string) => void;
  trace: () => void;
}

// Network Monitor Types
export interface NetworkMonitor {
  requests: NetworkRequest[];
  startMonitoring: () => void;
  stopMonitoring: () => void;
  clearRequests: () => void;
  getRequestById: (id: string) => NetworkRequest | null;
}

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: any;
  responseBody?: any;
  size: number;
  cached: boolean;
  error?: string;
}

// Error Tracking Types
export interface ErrorTracker {
  errors: TrackedError[];
  warnings: TrackedWarning[];
  startTracking: () => void;
  stopTracking: () => void;
  clearErrors: () => void;
  reportError: (error: Error, context?: ErrorContext) => void;
  reportWarning: (message: string, context?: ErrorContext) => void;
}

export interface TrackedError {
  id: string;
  timestamp: number;
  message: string;
  stack?: string;
  component?: string;
  props?: Record<string, any>;
  state?: Record<string, any>;
  context?: ErrorContext;
  count: number;
}

export interface TrackedWarning {
  id: string;
  timestamp: number;
  message: string;
  component?: string;
  context?: ErrorContext;
  count: number;
}

export interface ErrorContext {
  component?: string;
  props?: Record<string, any>;
  state?: Record<string, any>;
  userAgent?: string;
  url?: string;
  userId?: string;
  sessionId?: string;
  buildVersion?: string;
}

// Bundle Analyzer Types
export interface BundleAnalyzer {
  analyze: () => BundleAnalysis;
  getChunkInfo: (chunkId: string) => ChunkInfo | null;
  getDependencyTree: () => DependencyTree;
  getUnusedCode: () => UnusedCode[];
}

export interface BundleAnalysis {
  totalSize: number;
  gzippedSize: number;
  chunks: ChunkInfo[];
  dependencies: DependencyInfo[];
  duplicates: DuplicateModule[];
  recommendations: BundleRecommendation[];
}

export interface ChunkInfo {
  id: string;
  name: string;
  size: number;
  gzippedSize: number;
  modules: ModuleInfo[];
  loadTime: number;
  cached: boolean;
}

export interface ModuleInfo {
  id: string;
  name: string;
  size: number;
  dependencies: string[];
  used: boolean;
}

export interface DependencyInfo {
  name: string;
  version: string;
  size: number;
  used: boolean;
  treeshakeable: boolean;
}

export interface DuplicateModule {
  name: string;
  instances: string[];
  totalSize: number;
  wastedSize: number;
}

export interface BundleRecommendation {
  type: BundleRecommendationType;
  severity: RecommendationSeverity;
  description: string;
  impact: number;
  solution: string;
}

export type BundleRecommendationType = 
  | 'code-splitting'
  | 'tree-shaking'
  | 'duplicate-removal'
  | 'lazy-loading'
  | 'compression'
  | 'minification';

export interface DependencyTree {
  root: DependencyNode;
  totalNodes: number;
  maxDepth: number;
  circularDependencies: CircularDependency[];
}

export interface DependencyNode {
  id: string;
  name: string;
  size: number;
  children: DependencyNode[];
  parent?: DependencyNode;
  depth: number;
}

export interface CircularDependency {
  path: string[];
  severity: RecommendationSeverity;
}

export interface UnusedCode {
  file: string;
  functions: string[];
  variables: string[];
  imports: string[];
  size: number;
  percentage: number;
}