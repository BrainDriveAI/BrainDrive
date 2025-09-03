/**
 * Accessibility Types - Unified Dynamic Page Renderer
 * 
 * Comprehensive type definitions for WCAG 2.1 AA compliance,
 * keyboard navigation, screen reader optimization, and accessibility testing.
 */

// WCAG Compliance Types
export interface WCAGComplianceConfig {
  level: WCAGLevel;
  guidelines: WCAGGuideline[];
  autoFix: boolean;
  reportingEnabled: boolean;
  testingEnabled: boolean;
}

export type WCAGLevel = 'A' | 'AA' | 'AAA';

export interface WCAGGuideline {
  id: string;
  name: string;
  level: WCAGLevel;
  category: WCAGCategory;
  description: string;
  testFunction: (element: HTMLElement) => WCAGTestResult;
  autoFixFunction?: (element: HTMLElement) => void;
}

export type WCAGCategory = 
  | 'perceivable'
  | 'operable'
  | 'understandable'
  | 'robust';

export interface WCAGTestResult {
  passed: boolean;
  score: number;
  issues: WCAGIssue[];
  suggestions: string[];
}

export interface WCAGIssue {
  id: string;
  severity: WCAGSeverity;
  element: HTMLElement;
  description: string;
  guideline: string;
  suggestion: string;
  autoFixable: boolean;
}

export type WCAGSeverity = 'error' | 'warning' | 'info';

// Keyboard Navigation Types
export interface KeyboardNavigationConfig {
  enabled: boolean;
  trapFocus: boolean;
  skipLinks: boolean;
  customKeyBindings: KeyBinding[];
  focusManagement: FocusManagementConfig;
}

export interface KeyBinding {
  key: string;
  modifiers: KeyModifier[];
  action: KeyboardAction;
  description: string;
  context?: string;
}

export type KeyModifier = 'ctrl' | 'alt' | 'shift' | 'meta';

export interface KeyboardAction {
  type: KeyboardActionType;
  target?: string;
  handler: (event: KeyboardEvent) => void;
}

export type KeyboardActionType = 
  | 'navigate'
  | 'activate'
  | 'toggle'
  | 'focus'
  | 'custom';

export interface FocusManagementConfig {
  autoFocus: boolean;
  focusVisible: boolean;
  focusWithin: boolean;
  restoreFocus: boolean;
  focusOrder: FocusOrderConfig;
}

export interface FocusOrderConfig {
  strategy: FocusOrderStrategy;
  customOrder?: string[];
  skipHidden: boolean;
  skipDisabled: boolean;
}

export type FocusOrderStrategy = 'dom' | 'visual' | 'custom';

// Screen Reader Types
export interface ScreenReaderConfig {
  enabled: boolean;
  announcements: boolean;
  liveRegions: boolean;
  landmarks: boolean;
  headings: boolean;
  descriptions: boolean;
  labels: boolean;
}

export interface ScreenReaderAnnouncement {
  id: string;
  message: string;
  priority: AnnouncementPriority;
  delay?: number;
  interrupt?: boolean;
}

export type AnnouncementPriority = 'polite' | 'assertive' | 'off';

export interface LiveRegionConfig {
  element: HTMLElement;
  politeness: AnnouncementPriority;
  atomic: boolean;
  relevant: LiveRegionRelevant[];
}

export type LiveRegionRelevant = 'additions' | 'removals' | 'text' | 'all';

// ARIA Types
export interface ARIAConfig {
  labels: boolean;
  descriptions: boolean;
  roles: boolean;
  states: boolean;
  properties: boolean;
  landmarks: boolean;
}

export interface ARIALabel {
  element: HTMLElement;
  label: string;
  labelledBy?: string;
  describedBy?: string;
}

export interface ARIARole {
  element: HTMLElement;
  role: string;
  implicit: boolean;
  valid: boolean;
}

export interface ARIAState {
  element: HTMLElement;
  state: string;
  value: string | boolean | number;
  valid: boolean;
}

// Color Contrast Types
export interface ColorContrastConfig {
  enabled: boolean;
  level: WCAGLevel;
  autoFix: boolean;
  threshold: ColorContrastThreshold;
}

export interface ColorContrastThreshold {
  normal: number;
  large: number;
  nonText: number;
}

export interface ColorContrastResult {
  ratio: number;
  passed: boolean;
  level: WCAGLevel;
  foreground: string;
  background: string;
  suggestions: ColorSuggestion[];
}

export interface ColorSuggestion {
  color: string;
  ratio: number;
  type: 'foreground' | 'background';
}

// Accessibility Testing Types
export interface AccessibilityTestConfig {
  enabled: boolean;
  automated: boolean;
  manual: boolean;
  continuous: boolean;
  reportingEnabled: boolean;
  rules: AccessibilityRule[];
}

export interface AccessibilityRule {
  id: string;
  name: string;
  description: string;
  category: WCAGCategory;
  level: WCAGLevel;
  enabled: boolean;
  testFunction: (context: AccessibilityTestContext) => AccessibilityTestResult;
}

export interface AccessibilityTestContext {
  element: HTMLElement;
  document: Document;
  window: Window;
  config: AccessibilityTestConfig;
}

export interface AccessibilityTestResult {
  ruleId: string;
  passed: boolean;
  score: number;
  violations: AccessibilityViolation[];
  warnings: AccessibilityWarning[];
  suggestions: string[];
}

export interface AccessibilityViolation {
  id: string;
  severity: WCAGSeverity;
  element: HTMLElement;
  description: string;
  impact: AccessibilityImpact;
  fix: AccessibilityFix;
}

export interface AccessibilityWarning {
  id: string;
  element: HTMLElement;
  description: string;
  suggestion: string;
}

export type AccessibilityImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AccessibilityFix {
  description: string;
  autoFixable: boolean;
  code?: string;
  apply?: (element: HTMLElement) => void;
}

// Accessibility Service Types
export interface AccessibilityServiceConfig {
  wcag: WCAGComplianceConfig;
  keyboard: KeyboardNavigationConfig;
  screenReader: ScreenReaderConfig;
  aria: ARIAConfig;
  colorContrast: ColorContrastConfig;
  testing: AccessibilityTestConfig;
}

export interface AccessibilityServiceState {
  enabled: boolean;
  config: AccessibilityServiceConfig;
  testResults: AccessibilityTestResult[];
  violations: AccessibilityViolation[];
  warnings: AccessibilityWarning[];
  score: AccessibilityScore;
}

export interface AccessibilityScore {
  overall: number;
  wcag: number;
  keyboard: number;
  screenReader: number;
  colorContrast: number;
  breakdown: AccessibilityScoreBreakdown;
}

export interface AccessibilityScoreBreakdown {
  perceivable: number;
  operable: number;
  understandable: number;
  robust: number;
}

// Hook Types
export interface UseAccessibilityOptions {
  enabled?: boolean;
  autoFix?: boolean;
  continuous?: boolean;
  reportViolations?: boolean;
  onViolation?: (violation: AccessibilityViolation) => void;
  onScore?: (score: AccessibilityScore) => void;
}

export interface UseAccessibilityReturn {
  score: AccessibilityScore | null;
  violations: AccessibilityViolation[];
  warnings: AccessibilityWarning[];
  isCompliant: boolean;
  runTest: () => Promise<AccessibilityTestResult[]>;
  fixViolations: () => Promise<void>;
  announceToScreenReader: (message: string, priority?: AnnouncementPriority) => void;
  ref: React.RefObject<HTMLElement>;
}

export interface UseKeyboardNavigationOptions {
  enabled?: boolean;
  trapFocus?: boolean;
  skipLinks?: boolean;
  customBindings?: KeyBinding[];
  onNavigate?: (target: HTMLElement) => void;
}

export interface UseKeyboardNavigationReturn {
  focusedElement: HTMLElement | null;
  focusNext: () => void;
  focusPrevious: () => void;
  focusFirst: () => void;
  focusLast: () => void;
  trapFocus: (container: HTMLElement) => () => void;
  addSkipLink: (target: string, label: string) => void;
}

export interface UseScreenReaderOptions {
  enabled?: boolean;
  announcements?: boolean;
  liveRegions?: boolean;
  onAnnouncement?: (announcement: ScreenReaderAnnouncement) => void;
}

export interface UseScreenReaderReturn {
  announce: (message: string, priority?: AnnouncementPriority) => void;
  createLiveRegion: (config: Partial<LiveRegionConfig>) => HTMLElement;
  updateLiveRegion: (element: HTMLElement, content: string) => void;
  isScreenReaderActive: boolean;
}

// Utility Types
export interface AccessibilityUtils {
  // WCAG Testing
  testWCAGCompliance: (element: HTMLElement, level: WCAGLevel) => WCAGTestResult;
  calculateAccessibilityScore: (results: AccessibilityTestResult[]) => AccessibilityScore;
  
  // Color Contrast
  calculateColorContrast: (foreground: string, background: string) => number;
  suggestColorImprovements: (foreground: string, background: string, level: WCAGLevel) => ColorSuggestion[];
  
  // ARIA
  validateARIA: (element: HTMLElement) => ARIAValidationResult;
  generateARIALabel: (element: HTMLElement) => string;
  
  // Keyboard Navigation
  getFocusableElements: (container: HTMLElement) => HTMLElement[];
  isElementFocusable: (element: HTMLElement) => boolean;
  
  // Screen Reader
  detectScreenReader: () => boolean;
  formatForScreenReader: (text: string) => string;
}

export interface ARIAValidationResult {
  valid: boolean;
  issues: ARIAIssue[];
  suggestions: string[];
}

export interface ARIAIssue {
  type: ARIAIssueType;
  element: HTMLElement;
  description: string;
  fix: string;
}

export type ARIAIssueType = 
  | 'missing-label'
  | 'invalid-role'
  | 'invalid-state'
  | 'invalid-property'
  | 'redundant-label'
  | 'missing-description';

// Event Types
export interface AccessibilityEvent {
  type: AccessibilityEventType;
  timestamp: number;
  data: any;
}

export type AccessibilityEventType = 
  | 'violation-detected'
  | 'score-updated'
  | 'test-completed'
  | 'focus-changed'
  | 'announcement-made'
  | 'fix-applied';
