/**
 * Accessibility Service - Unified Dynamic Page Renderer
 * 
 * WCAG 2.1 AA compliance service with keyboard navigation,
 * screen reader optimization, and accessibility testing.
 */

import {
  WCAGComplianceConfig,
  WCAGLevel,
  WCAGTestResult,
  WCAGIssue,
  KeyboardNavigationConfig,
  ScreenReaderConfig,
  ScreenReaderAnnouncement,
  AnnouncementPriority,
  LiveRegionConfig,
  ARIAConfig,
  ColorContrastConfig,
  ColorContrastResult,
  AccessibilityTestConfig,
  AccessibilityTestResult,
  AccessibilityViolation,
  AccessibilityWarning,
  AccessibilityServiceConfig,
  AccessibilityServiceState,
  AccessibilityScore,
  AccessibilityEvent,
  AccessibilityEventType,
  AccessibilityUtils,
  ARIAValidationResult,
  ARIAIssue,
  ARIAIssueType
} from '../types/accessibility';

export class AccessibilityService implements AccessibilityUtils {
  private state: AccessibilityServiceState;
  private eventListeners: Map<AccessibilityEventType, Set<(event: AccessibilityEvent) => void>>;
  private liveRegions: Map<string, HTMLElement>;
  private focusableElements: HTMLElement[] = [];
  private currentFocusIndex: number = -1;
  private skipLinks: HTMLElement[] = [];

  constructor(config?: Partial<AccessibilityServiceConfig>) {
    this.state = {
      enabled: true,
      config: this.createDefaultConfig(config),
      testResults: [],
      violations: [],
      warnings: [],
      score: this.createInitialScore()
    };

    this.eventListeners = new Map();
    this.liveRegions = new Map();
    
    this.initializeAccessibility();
  }

  // WCAG Compliance Methods
  testWCAGCompliance(element: HTMLElement, level: WCAGLevel = 'AA'): WCAGTestResult {
    const issues: WCAGIssue[] = [];
    let score = 100;

    // Test color contrast
    const contrastIssues = this.testColorContrast(element, level);
    issues.push(...contrastIssues);

    // Test ARIA labels
    const ariaIssues = this.testARIALabels(element);
    issues.push(...ariaIssues);

    // Test keyboard accessibility
    const keyboardIssues = this.testKeyboardAccessibility(element);
    issues.push(...keyboardIssues);

    // Test semantic structure
    const semanticIssues = this.testSemanticStructure(element);
    issues.push(...semanticIssues);

    // Calculate score based on issues
    const errorCount = issues.filter(issue => issue.severity === 'error').length;
    const warningCount = issues.filter(issue => issue.severity === 'warning').length;
    
    score -= (errorCount * 20) + (warningCount * 5);
    score = Math.max(0, score);

    const result: WCAGTestResult = {
      passed: score >= 80 && errorCount === 0,
      score,
      issues,
      suggestions: this.generateSuggestions(issues)
    };

    this.emitEvent('test-completed', { result });
    return result;
  }

  calculateAccessibilityScore(results: AccessibilityTestResult[]): AccessibilityScore {
    if (results.length === 0) {
      return this.createInitialScore();
    }

    const totalScore = results.reduce((sum, result) => sum + result.score, 0);
    const overall = totalScore / results.length;

    // Calculate category scores
    const perceivable = this.calculateCategoryScore(results, 'perceivable');
    const operable = this.calculateCategoryScore(results, 'operable');
    const understandable = this.calculateCategoryScore(results, 'understandable');
    const robust = this.calculateCategoryScore(results, 'robust');

    return {
      overall,
      wcag: overall,
      keyboard: operable,
      screenReader: perceivable,
      colorContrast: perceivable,
      breakdown: {
        perceivable,
        operable,
        understandable,
        robust
      }
    };
  }

  // Color Contrast Methods
  calculateColorContrast(foreground: string, background: string): number {
    const frgb = this.hexToRgb(foreground);
    const brgb = this.hexToRgb(background);

    if (!frgb || !brgb) return 0;

    const fLuminance = this.getLuminance(frgb);
    const bLuminance = this.getLuminance(brgb);

    const lighter = Math.max(fLuminance, bLuminance);
    const darker = Math.min(fLuminance, bLuminance);

    return (lighter + 0.05) / (darker + 0.05);
  }

  suggestColorImprovements(foreground: string, background: string, level: WCAGLevel) {
    const currentRatio = this.calculateColorContrast(foreground, background);
    const requiredRatio = level === 'AAA' ? 7 : 4.5;
    
    const suggestions: Array<{color: string; ratio: number; type: 'foreground' | 'background'}> = [];

    if (currentRatio < requiredRatio) {
      // Suggest darker foreground
      const darkerForeground = this.adjustColorBrightness(foreground, -20);
      suggestions.push({
        color: darkerForeground,
        ratio: this.calculateColorContrast(darkerForeground, background),
        type: 'foreground' as const
      });

      // Suggest lighter background
      const lighterBackground = this.adjustColorBrightness(background, 20);
      suggestions.push({
        color: lighterBackground,
        ratio: this.calculateColorContrast(foreground, lighterBackground),
        type: 'background' as const
      });
    }

    return suggestions;
  }

  // ARIA Methods
  validateARIA(element: HTMLElement): ARIAValidationResult {
    const issues: ARIAIssue[] = [];
    const suggestions: string[] = [];

    // Check for missing labels
    if (this.isInteractiveElement(element) && !this.hasAccessibleName(element)) {
      issues.push({
        type: 'missing-label' as ARIAIssueType,
        element,
        description: 'Interactive element missing accessible name',
        fix: 'Add aria-label or aria-labelledby attribute'
      });
    }

    // Check for invalid roles
    const role = element.getAttribute('role');
    if (role && !this.isValidRole(role)) {
      issues.push({
        type: 'invalid-role' as ARIAIssueType,
        element,
        description: `Invalid ARIA role: ${role}`,
        fix: 'Use a valid ARIA role or remove the role attribute'
      });
    }

    // Check for invalid states
    const ariaStates = this.getARIAStates(element);
    ariaStates.forEach(state => {
      if (!this.isValidARIAState(state.name, state.value)) {
        issues.push({
          type: 'invalid-state' as ARIAIssueType,
          element,
          description: `Invalid ARIA state: ${state.name}="${state.value}"`,
          fix: `Use a valid value for ${state.name}`
        });
      }
    });

    return {
      valid: issues.length === 0,
      issues,
      suggestions
    };
  }

  generateARIALabel(element: HTMLElement): string {
    // Try to get existing label
    const existingLabel = this.getAccessibleName(element);
    if (existingLabel) return existingLabel;

    // Generate label based on element type and content
    const tagName = element.tagName.toLowerCase();
    const textContent = element.textContent?.trim() || '';
    
    switch (tagName) {
      case 'button':
        return textContent || 'Button';
      case 'input':
        const type = element.getAttribute('type') || 'text';
        const placeholder = element.getAttribute('placeholder') || '';
        return placeholder || `${type} input`;
      case 'img':
        const alt = element.getAttribute('alt');
        return alt || 'Image';
      case 'a':
        return textContent || 'Link';
      default:
        return textContent || `${tagName} element`;
    }
  }

  // Keyboard Navigation Methods
  getFocusableElements(container: HTMLElement = document.body): HTMLElement[] {
    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]'
    ].join(', ');

    const elements = Array.from(container.querySelectorAll(focusableSelectors)) as HTMLElement[];
    return elements.filter(el => this.isElementFocusable(el));
  }

  isElementFocusable(element: HTMLElement): boolean {
    // Check if element is visible
    if (element.offsetParent === null) return false;
    
    // Check if element is disabled
    if (element.hasAttribute('disabled')) return false;
    
    // Check tabindex
    const tabindex = element.getAttribute('tabindex');
    if (tabindex === '-1') return false;
    
    return true;
  }

  // Screen Reader Methods
  detectScreenReader(): boolean {
    // Check for common screen reader indicators
    if (typeof window === 'undefined') return false;
    
    // Check for NVDA
    if ((window as any).nvda) return true;
    
    // Check for JAWS
    if ((window as any).jaws) return true;
    
    // Check for VoiceOver (simplified detection)
    if (navigator.userAgent.includes('Mac') && 'speechSynthesis' in window) {
      return true;
    }
    
    return false;
  }

  formatForScreenReader(text: string): string {
    return text
      .replace(/([A-Z])/g, ' $1') // Add spaces before capital letters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // Screen Reader Announcements
  announceToScreenReader(message: string, priority: AnnouncementPriority = 'polite'): void {
    const announcement: ScreenReaderAnnouncement = {
      id: `announcement-${Date.now()}`,
      message,
      priority
    };

    // Create or update live region
    let liveRegion = this.liveRegions.get(priority);
    if (!liveRegion) {
      liveRegion = this.createLiveRegion({ politeness: priority });
      this.liveRegions.set(priority, liveRegion);
    }

    // Announce message
    liveRegion.textContent = message;

    // Clear after announcement
    setTimeout(() => {
      if (liveRegion) {
        liveRegion.textContent = '';
      }
    }, 1000);

    this.emitEvent('announcement-made', { announcement });
  }

  createLiveRegion(config: Partial<LiveRegionConfig>): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('aria-live', config.politeness || 'polite');
    element.setAttribute('aria-atomic', config.atomic ? 'true' : 'false');
    element.setAttribute('aria-relevant', config.relevant?.join(' ') || 'additions text');
    element.style.position = 'absolute';
    element.style.left = '-10000px';
    element.style.width = '1px';
    element.style.height = '1px';
    element.style.overflow = 'hidden';
    
    document.body.appendChild(element);
    return element;
  }

  // Focus Management
  trapFocus(container: HTMLElement): () => void {
    const focusableElements = this.getFocusableElements(container);
    if (focusableElements.length === 0) return () => {};

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstElement.focus();

    // Return cleanup function
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }

  addSkipLink(target: string, label: string): void {
    const skipLink = document.createElement('a');
    skipLink.href = `#${target}`;
    skipLink.textContent = label;
    skipLink.className = 'skip-link';
    skipLink.style.position = 'absolute';
    skipLink.style.left = '-10000px';
    skipLink.style.top = 'auto';
    skipLink.style.width = '1px';
    skipLink.style.height = '1px';
    skipLink.style.overflow = 'hidden';

    skipLink.addEventListener('focus', () => {
      skipLink.style.left = '6px';
      skipLink.style.top = '7px';
      skipLink.style.width = 'auto';
      skipLink.style.height = 'auto';
      skipLink.style.padding = '8px';
      skipLink.style.background = '#000';
      skipLink.style.color = '#fff';
      skipLink.style.textDecoration = 'none';
      skipLink.style.zIndex = '100000';
    });

    skipLink.addEventListener('blur', () => {
      skipLink.style.left = '-10000px';
      skipLink.style.top = 'auto';
      skipLink.style.width = '1px';
      skipLink.style.height = '1px';
      skipLink.style.padding = '0';
    });

    document.body.insertBefore(skipLink, document.body.firstChild);
    this.skipLinks.push(skipLink);
  }

  // Event Management
  addEventListener(type: AccessibilityEventType, listener: (event: AccessibilityEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: AccessibilityEventType, listener: (event: AccessibilityEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  // Configuration
  updateConfig(config: Partial<AccessibilityServiceConfig>): void {
    this.state.config = { ...this.state.config, ...config };
    this.emitEvent('score-updated', { score: this.state.score });
  }

  // Private Methods
  private createDefaultConfig(config?: Partial<AccessibilityServiceConfig>): AccessibilityServiceConfig {
    return {
      wcag: {
        level: 'AA',
        guidelines: [],
        autoFix: false,
        reportingEnabled: true,
        testingEnabled: true
      },
      keyboard: {
        enabled: true,
        trapFocus: true,
        skipLinks: true,
        customKeyBindings: [],
        focusManagement: {
          autoFocus: false,
          focusVisible: true,
          focusWithin: true,
          restoreFocus: true,
          focusOrder: {
            strategy: 'dom',
            skipHidden: true,
            skipDisabled: true
          }
        }
      },
      screenReader: {
        enabled: true,
        announcements: true,
        liveRegions: true,
        landmarks: true,
        headings: true,
        descriptions: true,
        labels: true
      },
      aria: {
        labels: true,
        descriptions: true,
        roles: true,
        states: true,
        properties: true,
        landmarks: true
      },
      colorContrast: {
        enabled: true,
        level: 'AA',
        autoFix: false,
        threshold: {
          normal: 4.5,
          large: 3,
          nonText: 3
        }
      },
      testing: {
        enabled: true,
        automated: true,
        manual: false,
        continuous: false,
        reportingEnabled: true,
        rules: []
      },
      ...config
    };
  }

  private createInitialScore(): AccessibilityScore {
    return {
      overall: 0,
      wcag: 0,
      keyboard: 0,
      screenReader: 0,
      colorContrast: 0,
      breakdown: {
        perceivable: 0,
        operable: 0,
        understandable: 0,
        robust: 0
      }
    };
  }

  private initializeAccessibility(): void {
    if (typeof document === 'undefined') return;

    // Add skip links for main content areas
    this.addSkipLink('main', 'Skip to main content');
    this.addSkipLink('navigation', 'Skip to navigation');

    // Set up keyboard event listeners
    document.addEventListener('keydown', this.handleGlobalKeyDown.bind(this));

    // Set up focus management
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    document.addEventListener('focusout', this.handleFocusOut.bind(this));
  }

  private handleGlobalKeyDown(event: KeyboardEvent): void {
    // Handle custom key bindings
    const bindings = this.state.config.keyboard.customKeyBindings;
    for (const binding of bindings) {
      if (this.matchesKeyBinding(event, binding)) {
        event.preventDefault();
        binding.action.handler(event);
        break;
      }
    }
  }

  private handleFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (target) {
      this.emitEvent('focus-changed', { element: target, type: 'focusin' });
    }
  }

  private handleFocusOut(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (target) {
      this.emitEvent('focus-changed', { element: target, type: 'focusout' });
    }
  }

  private matchesKeyBinding(event: KeyboardEvent, binding: any): boolean {
    if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
    
    const modifiers = binding.modifiers || [];
    return (
      event.ctrlKey === modifiers.includes('ctrl') &&
      event.altKey === modifiers.includes('alt') &&
      event.shiftKey === modifiers.includes('shift') &&
      event.metaKey === modifiers.includes('meta')
    );
  }

  private testColorContrast(element: HTMLElement, level: WCAGLevel): WCAGIssue[] {
    const issues: WCAGIssue[] = [];
    const computedStyle = window.getComputedStyle(element);
    const foreground = computedStyle.color;
    const background = computedStyle.backgroundColor;

    if (foreground && background && background !== 'rgba(0, 0, 0, 0)') {
      const ratio = this.calculateColorContrast(foreground, background);
      const requiredRatio = level === 'AAA' ? 7 : 4.5;

      if (ratio < requiredRatio) {
        issues.push({
          id: `contrast-${Date.now()}`,
          severity: 'error',
          element,
          description: `Color contrast ratio ${ratio.toFixed(2)} is below required ${requiredRatio}`,
          guideline: 'WCAG 1.4.3',
          suggestion: 'Increase color contrast between text and background',
          autoFixable: true
        });
      }
    }

    return issues;
  }

  private testARIALabels(element: HTMLElement): WCAGIssue[] {
    const issues: WCAGIssue[] = [];

    if (this.isInteractiveElement(element) && !this.hasAccessibleName(element)) {
      issues.push({
        id: `aria-label-${Date.now()}`,
        severity: 'error',
        element,
        description: 'Interactive element missing accessible name',
        guideline: 'WCAG 4.1.2',
        suggestion: 'Add aria-label, aria-labelledby, or visible text',
        autoFixable: true
      });
    }

    return issues;
  }

  private testKeyboardAccessibility(element: HTMLElement): WCAGIssue[] {
    const issues: WCAGIssue[] = [];

    if (this.isInteractiveElement(element) && !this.isKeyboardAccessible(element)) {
      issues.push({
        id: `keyboard-${Date.now()}`,
        severity: 'error',
        element,
        description: 'Interactive element not keyboard accessible',
        guideline: 'WCAG 2.1.1',
        suggestion: 'Ensure element is focusable and has keyboard event handlers',
        autoFixable: false
      });
    }

    return issues;
  }

  private testSemanticStructure(element: HTMLElement): WCAGIssue[] {
    const issues: WCAGIssue[] = [];

    // Test for proper heading hierarchy
    if (element.tagName.match(/^H[1-6]$/)) {
      const level = parseInt(element.tagName.charAt(1));
      const previousHeading = this.findPreviousHeading(element);
      
      if (previousHeading) {
        const previousLevel = parseInt(previousHeading.tagName.charAt(1));
        if (level > previousLevel + 1) {
          issues.push({
            id: `heading-${Date.now()}`,
            severity: 'warning',
            element,
            description: `Heading level ${level} follows heading level ${previousLevel}`,
            guideline: 'WCAG 1.3.1',
            suggestion: 'Use proper heading hierarchy without skipping levels',
            autoFixable: false
          });
        }
      }
    }

    return issues;
  }

  private generateSuggestions(issues: WCAGIssue[]): string[] {
    return issues.map(issue => issue.suggestion);
  }

  private calculateCategoryScore(results: AccessibilityTestResult[], category: string): number {
    const categoryResults = results.filter(result => 
      result.violations.some(v => v.description.toLowerCase().includes(category))
    );
    
    if (categoryResults.length === 0) return 100;
    
    const totalScore = categoryResults.reduce((sum, result) => sum + result.score, 0);
    return totalScore / categoryResults.length;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  private getLuminance(rgb: { r: number; g: number; b: number }): number {
    const { r, g, b } = rgb;
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  private adjustColorBrightness(hex: string, percent: number): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;

    const adjust = (value: number) => {
      const adjusted = value + (value * percent / 100);
      return Math.max(0, Math.min(255, Math.round(adjusted)));
    };

    const newRgb = {
      r: adjust(rgb.r),
      g: adjust(rgb.g),
      b: adjust(rgb.b)
    };

    return `#${newRgb.r.toString(16).padStart(2, '0')}${newRgb.g.toString(16).padStart(2, '0')}${newRgb.b.toString(16).padStart(2, '0')}`;
  }

  private isInteractiveElement(element: HTMLElement): boolean {
    const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
    const role = element.getAttribute('role');
    const interactiveRoles = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'];
    
    return interactiveTags.includes(element.tagName.toLowerCase()) ||
           (role && interactiveRoles.includes(role)) ||
           element.hasAttribute('onclick') ||
           element.hasAttribute('tabindex');
  }

  private hasAccessibleName(element: HTMLElement): boolean {
    return !!(
      element.getAttribute('aria-label') ||
      element.getAttribute('aria-labelledby') ||
      element.getAttribute('title') ||
      element.textContent?.trim()
    );
  }

  private getAccessibleName(element: HTMLElement): string {
    return element.getAttribute('aria-label') ||
           element.getAttribute('title') ||
           element.textContent?.trim() ||
           '';
  }

  private isValidRole(role: string): boolean {
    const validRoles = [
      'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
      'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
      'contentinfo', 'definition', 'dialog', 'directory', 'document',
      'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
      'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
      'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation',
      'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
      'rowheader', 'scrollbar', 'search', 'searchbox', 'separator',
      'slider', 'spinbutton', 'status', 'switch', 'tab', 'table',
      'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar',
      'tooltip', 'tree', 'treegrid', 'treeitem'
    ];
    return validRoles.includes(role);
  }

  private getARIAStates(element: HTMLElement): Array<{ name: string; value: string }> {
    const states = [];
    for (const attr of element.attributes) {
      if (attr.name.startsWith('aria-')) {
        states.push({ name: attr.name, value: attr.value });
      }
    }
    return states;
  }

  private isValidARIAState(name: string, value: string): boolean {
    // Simplified validation - in a real implementation, this would be more comprehensive
    const booleanStates = ['aria-checked', 'aria-disabled', 'aria-expanded', 'aria-hidden'];
    if (booleanStates.includes(name)) {
      return ['true', 'false'].includes(value);
    }
    return true; // For other states, assume valid for now
  }

  private isKeyboardAccessible(element: HTMLElement): boolean {
    return element.tabIndex >= 0 || this.isNativelyFocusable(element);
  }

  private isNativelyFocusable(element: HTMLElement): boolean {
    const focusableTags = ['a', 'button', 'input', 'select', 'textarea'];
    return focusableTags.includes(element.tagName.toLowerCase()) &&
           !element.hasAttribute('disabled');
  }

  private findPreviousHeading(element: HTMLElement): HTMLElement | null {
    let current = element.previousElementSibling;
    while (current) {
      if (current.tagName.match(/^H[1-6]$/)) {
        return current as HTMLElement;
      }
      current = current.previousElementSibling;
    }
    return null;
  }

  private emitEvent(type: AccessibilityEventType, data: any): void {
    const event: AccessibilityEvent = {
      type,
      timestamp: Date.now(),
      data
    };

    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('Error in accessibility event listener:', error);
        }
      });
    }
  }

  // Cleanup
  destroy(): void {
    // Remove skip links
    this.skipLinks.forEach(link => {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    });

    // Remove live regions
    this.liveRegions.forEach(region => {
      if (region.parentNode) {
        region.parentNode.removeChild(region);
      }
    });

    // Remove event listeners
    document.removeEventListener('keydown', this.handleGlobalKeyDown);
    document.removeEventListener('focusin', this.handleFocusIn);
    document.removeEventListener('focusout', this.handleFocusOut);

    // Clear state
    this.eventListeners.clear();
    this.liveRegions.clear();
    this.skipLinks = [];
    this.focusableElements = [];
  }
}

// Export singleton instance
export const accessibilityService = new AccessibilityService();
export default accessibilityService;