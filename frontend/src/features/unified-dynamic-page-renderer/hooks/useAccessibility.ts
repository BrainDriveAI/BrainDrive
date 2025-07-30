/**
 * useAccessibility Hook - Unified Dynamic Page Renderer
 * 
 * React hook for managing WCAG 2.1 AA compliance, accessibility testing,
 * and violation reporting.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AccessibilityScore,
  AccessibilityViolation,
  AccessibilityWarning,
  AccessibilityTestResult,
  UseAccessibilityOptions,
  UseAccessibilityReturn,
  AnnouncementPriority,
  AccessibilityEvent,
  AccessibilityEventType
} from '../types/accessibility';
import { accessibilityService } from '../services/AccessibilityService';

export function useAccessibility(
  options: UseAccessibilityOptions = {}
): UseAccessibilityReturn {
  const [score, setScore] = useState<AccessibilityScore | null>(null);
  const [violations, setViolations] = useState<AccessibilityViolation[]>([]);
  const [warnings, setWarnings] = useState<AccessibilityWarning[]>([]);
  const [isCompliant, setIsCompliant] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  const {
    enabled = true,
    autoFix = false,
    continuous = false,
    reportViolations = true,
    onViolation,
    onScore
  } = options;

  // Event handlers
  const handleViolationDetected = useCallback((event: AccessibilityEvent) => {
    if (event.data.violation) {
      const violation = event.data.violation as AccessibilityViolation;
      setViolations(prev => [...prev, violation]);
      
      if (onViolation) {
        onViolation(violation);
      }
    }
  }, [onViolation]);

  const handleScoreUpdated = useCallback((event: AccessibilityEvent) => {
    if (event.data.score) {
      const newScore = event.data.score as AccessibilityScore;
      setScore(newScore);
      setIsCompliant(newScore.overall >= 80);
      
      if (onScore) {
        onScore(newScore);
      }
    }
  }, [onScore]);

  // Setup event listeners
  useEffect(() => {
    if (!enabled) return;

    const eventTypes: AccessibilityEventType[] = ['violation-detected', 'score-updated'];
    const handlers = [handleViolationDetected, handleScoreUpdated];

    eventTypes.forEach((type, index) => {
      accessibilityService.addEventListener(type, handlers[index]);
    });

    return () => {
      eventTypes.forEach((type, index) => {
        accessibilityService.removeEventListener(type, handlers[index]);
      });
    };
  }, [enabled, handleViolationDetected, handleScoreUpdated]);

  // Run accessibility test
  const runTest = useCallback(async (): Promise<AccessibilityTestResult[]> => {
    if (!containerRef.current) {
      console.warn('Container ref not set. Testing document body instead.');
      containerRef.current = document.body;
    }

    try {
      // Run WCAG compliance test
      const wcagResult = accessibilityService.testWCAGCompliance(containerRef.current, 'AA');
      
      // Convert to AccessibilityTestResult format
      const testResult: AccessibilityTestResult = {
        ruleId: 'wcag-compliance',
        passed: wcagResult.passed,
        score: wcagResult.score,
        violations: wcagResult.issues.map(issue => ({
          id: issue.id,
          severity: issue.severity,
          element: issue.element,
          description: issue.description,
          impact: issue.severity === 'error' ? 'serious' : 'moderate',
          fix: {
            description: issue.suggestion,
            autoFixable: issue.autoFixable,
            apply: autoFix ? () => {
              // Auto-fix logic would go here
              console.log(`Auto-fixing: ${issue.suggestion}`);
            } : undefined
          }
        })),
        warnings: [],
        suggestions: wcagResult.suggestions
      };

      const results = [testResult];
      
      // Update state
      setViolations(testResult.violations);
      const newScore = accessibilityService.calculateAccessibilityScore(results);
      setScore(newScore);
      setIsCompliant(newScore.overall >= 80);

      return results;
    } catch (error) {
      console.error('Accessibility test failed:', error);
      return [];
    }
  }, [autoFix]);

  // Fix violations
  const fixViolations = useCallback(async (): Promise<void> => {
    if (!autoFix) {
      console.warn('Auto-fix is disabled. Enable autoFix option to use this feature.');
      return;
    }

    try {
      for (const violation of violations) {
        if (violation.fix.autoFixable && violation.fix.apply) {
          violation.fix.apply(violation.element);
        }
      }

      // Re-run test after fixes
      await runTest();
    } catch (error) {
      console.error('Failed to fix violations:', error);
    }
  }, [violations, autoFix, runTest]);

  // Announce to screen reader
  const announceToScreenReader = useCallback((
    message: string, 
    priority: AnnouncementPriority = 'polite'
  ): void => {
    accessibilityService.announceToScreenReader(message, priority);
  }, []);

  // Continuous testing
  useEffect(() => {
    if (!enabled || !continuous) return;

    const interval = setInterval(() => {
      runTest();
    }, 5000); // Test every 5 seconds

    return () => clearInterval(interval);
  }, [enabled, continuous, runTest]);

  // Initial test
  useEffect(() => {
    if (enabled) {
      // Run initial test after a short delay to allow DOM to settle
      const timeout = setTimeout(() => {
        runTest();
      }, 100);

      return () => clearTimeout(timeout);
    }
  }, [enabled, runTest]);

  return {
    score,
    violations,
    warnings,
    isCompliant,
    runTest,
    fixViolations,
    announceToScreenReader,
    ref: containerRef
  };
}

export default useAccessibility;