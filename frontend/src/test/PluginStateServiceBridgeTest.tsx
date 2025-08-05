/**
 * PluginState Service Bridge Test
 * 
 * This test verifies that the enhanced service bridge correctly handles
 * factory-based services like pluginState for the ServiceExample_PluginState plugin.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createServiceBridges } from '../utils/serviceBridge';
import { factoryServiceUtils } from '../utils/factoryServiceHandler';
import { PluginContext, ServiceBridgeOptions } from '../types/serviceFactory';
import { useService } from '../contexts/ServiceContext';

interface TestResult {
  testName: string;
  passed: boolean;
  message: string;
  details?: any;
  timestamp: string;
}

interface TestState {
  isRunning: boolean;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

const PluginStateServiceBridgeTest: React.FC = () => {
  const [testState, setTestState] = useState<TestState>({
    isRunning: false,
    results: [],
    summary: { total: 0, passed: 0, failed: 0 }
  });

  // Get services from context
  const getService = useCallback((name: string) => {
    try {
      return useService(name);
    } catch (error) {
      console.warn(`Service ${name} not available:`, error);
      return null;
    }
  }, []);

  const addTestResult = useCallback((result: TestResult) => {
    setTestState(prev => {
      const newResults = [...prev.results, result];
      const passed = newResults.filter(r => r.passed).length;
      const failed = newResults.filter(r => !r.passed).length;
      
      return {
        ...prev,
        results: newResults,
        summary: {
          total: newResults.length,
          passed,
          failed
        }
      };
    });
  }, []);

  const runTest = useCallback(async (testName: string, testFn: () => Promise<any>) => {
    try {
      const result = await testFn();
      addTestResult({
        testName,
        passed: true,
        message: 'Test passed',
        details: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      addTestResult({
        testName,
        passed: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        details: error,
        timestamp: new Date().toISOString()
      });
    }
  }, [addTestResult]);

  const runAllTests = useCallback(async () => {
    setTestState(prev => ({ ...prev, isRunning: true, results: [] }));

    // Test 1: Factory Service Utils
    await runTest('Factory Service Utils - isFactoryService', async () => {
      const isFactory = factoryServiceUtils.isFactoryService('pluginState');
      if (!isFactory) {
        throw new Error('pluginState should be recognized as a factory service');
      }
      return { isFactoryService: isFactory };
    });

    // Test 2: Factory Service Configuration
    await runTest('Factory Service Configuration', async () => {
      const config = factoryServiceUtils.getFactoryConfig('pluginState');
      if (!config) {
        throw new Error('pluginState factory configuration not found');
      }
      if (config.factoryServiceName !== 'pluginStateFactory') {
        throw new Error(`Expected factoryServiceName to be 'pluginStateFactory', got '${config.factoryServiceName}'`);
      }
      return config;
    });

    // Test 3: Plugin Context Validation
    await runTest('Plugin Context Validation', async () => {
      const validContext: PluginContext = {
        pluginId: 'ServiceExample_PluginState',
        moduleId: 'PluginStateDemo',
        instanceId: 'test-instance'
      };

      const validation = factoryServiceUtils.validatePluginContext(validContext, 'pluginState');
      if (!validation.isValid) {
        throw new Error(`Context validation failed: ${validation.errors.join(', ')}`);
      }

      // Test invalid context
      const invalidContext: PluginContext = { pluginId: '' };
      const invalidValidation = factoryServiceUtils.validatePluginContext(invalidContext, 'pluginState');
      if (invalidValidation.isValid) {
        throw new Error('Invalid context should not pass validation');
      }

      return { valid: validation, invalid: invalidValidation };
    });

    // Test 4: Service Bridge Creation with Plugin Context
    await runTest('Service Bridge Creation with Plugin Context', async () => {
      const pluginContext: PluginContext = {
        pluginId: 'ServiceExample_PluginState',
        moduleId: 'PluginStateDemo',
        instanceId: 'test-instance'
      };

      const requiredServices = {
        pluginState: {
          methods: ['configure', 'saveState', 'getState', 'clearState', 'onSave', 'onRestore', 'onClear']
        }
      };

      const options: ServiceBridgeOptions = {
        enableFactoryServices: true,
        enableMonitoring: true,
        enableDetailedLogging: true
      };

      const { serviceBridges, errors, metrics } = createServiceBridges(
        requiredServices,
        getService,
        pluginContext,
        options
      );

      if (errors.length > 0) {
        throw new Error(`Service bridge creation failed: ${errors.map(e => e.error).join(', ')}`);
      }

      if (!serviceBridges.pluginState) {
        throw new Error('pluginState service not created in service bridge');
      }

      // Verify the service has the required methods
      const requiredMethods = requiredServices.pluginState.methods;
      const missingMethods = requiredMethods.filter(method => 
        typeof serviceBridges.pluginState[method] !== 'function'
      );

      if (missingMethods.length > 0) {
        throw new Error(`Missing methods in pluginState service: ${missingMethods.join(', ')}`);
      }

      return { serviceBridges, metrics, methodCount: requiredMethods.length };
    });

    // Test 5: PluginState Service Functionality
    await runTest('PluginState Service Functionality', async () => {
      const pluginContext: PluginContext = {
        pluginId: 'ServiceExample_PluginState',
        moduleId: 'PluginStateDemo',
        instanceId: 'test-instance'
      };

      const requiredServices = {
        pluginState: {}
      };

      const { serviceBridges, errors } = createServiceBridges(
        requiredServices,
        getService,
        pluginContext
      );

      if (errors.length > 0) {
        throw new Error(`Service creation failed: ${errors.map(e => e.error).join(', ')}`);
      }

      const pluginStateService = serviceBridges.pluginState;
      if (!pluginStateService) {
        throw new Error('PluginState service not available');
      }

      // Test configuration
      try {
        pluginStateService.configure({
          pluginId: 'ServiceExample_PluginState',
          stateStrategy: 'session',
          preserveKeys: ['testData'],
          stateSchema: {
            testData: { type: 'object', required: false, default: {} }
          }
        });
      } catch (error) {
        throw new Error(`Configuration failed: ${error}`);
      }

      // Test state operations
      const testData = { message: 'Hello from test', timestamp: Date.now() };
      
      try {
        await pluginStateService.saveState({ testData });
      } catch (error) {
        throw new Error(`Save state failed: ${error}`);
      }

      try {
        const retrievedState = await pluginStateService.getState();
        if (!retrievedState || !retrievedState.testData) {
          throw new Error('Retrieved state does not contain test data');
        }
      } catch (error) {
        throw new Error(`Get state failed: ${error}`);
      }

      return { configured: true, stateTested: true };
    });

    setTestState(prev => ({ ...prev, isRunning: false }));
  }, [runTest, getService]);

  const clearResults = useCallback(() => {
    setTestState({
      isRunning: false,
      results: [],
      summary: { total: 0, passed: 0, failed: 0 }
    });
  }, []);

  return (
    <div className="plugin-state-service-bridge-test">
      <div className="test-header">
        <h2>PluginState Service Bridge Test</h2>
        <p>Tests the enhanced service bridge functionality for factory-based services</p>
      </div>

      <div className="test-controls">
        <button 
          onClick={runAllTests} 
          disabled={testState.isRunning}
          className="run-tests-btn"
        >
          {testState.isRunning ? 'Running Tests...' : 'Run All Tests'}
        </button>
        <button 
          onClick={clearResults} 
          disabled={testState.isRunning}
          className="clear-results-btn"
        >
          Clear Results
        </button>
      </div>

      {testState.results.length > 0 && (
        <div className="test-summary">
          <h3>Test Summary</h3>
          <div className="summary-stats">
            <span className="total">Total: {testState.summary.total}</span>
            <span className="passed">Passed: {testState.summary.passed}</span>
            <span className="failed">Failed: {testState.summary.failed}</span>
            <span className="success-rate">
              Success Rate: {testState.summary.total > 0 ? 
                Math.round((testState.summary.passed / testState.summary.total) * 100) : 0}%
            </span>
          </div>
        </div>
      )}

      <div className="test-results">
        {testState.results.map((result, index) => (
          <div 
            key={index} 
            className={`test-result ${result.passed ? 'passed' : 'failed'}`}
          >
            <div className="result-header">
              <span className="test-name">{result.testName}</span>
              <span className="test-status">{result.passed ? '✅ PASSED' : '❌ FAILED'}</span>
              <span className="test-time">{new Date(result.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="result-message">{result.message}</div>
            {result.details && (
              <details className="result-details">
                <summary>Details</summary>
                <pre>{JSON.stringify(result.details, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .plugin-state-service-bridge-test {
          padding: 20px;
          max-width: 1000px;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .test-header {
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e0e0e0;
        }

        .test-header h2 {
          margin: 0 0 10px 0;
          color: #333;
        }

        .test-header p {
          margin: 0;
          color: #666;
        }

        .test-controls {
          margin-bottom: 20px;
          display: flex;
          gap: 10px;
        }

        .run-tests-btn, .clear-results-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-weight: 500;
        }

        .run-tests-btn {
          background-color: #007bff;
          color: white;
        }

        .run-tests-btn:hover:not(:disabled) {
          background-color: #0056b3;
        }

        .run-tests-btn:disabled {
          background-color: #6c757d;
          cursor: not-allowed;
        }

        .clear-results-btn {
          background-color: #6c757d;
          color: white;
        }

        .clear-results-btn:hover:not(:disabled) {
          background-color: #545b62;
        }

        .test-summary {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 5px;
        }

        .test-summary h3 {
          margin: 0 0 10px 0;
        }

        .summary-stats {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
        }

        .summary-stats span {
          font-weight: 500;
        }

        .passed {
          color: #28a745;
        }

        .failed {
          color: #dc3545;
        }

        .test-results {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .test-result {
          border: 1px solid #e0e0e0;
          border-radius: 5px;
          padding: 15px;
        }

        .test-result.passed {
          border-left: 4px solid #28a745;
          background-color: #f8fff9;
        }

        .test-result.failed {
          border-left: 4px solid #dc3545;
          background-color: #fff8f8;
        }

        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          flex-wrap: wrap;
          gap: 10px;
        }

        .test-name {
          font-weight: 600;
          flex: 1;
        }

        .test-status {
          font-weight: 500;
        }

        .test-time {
          font-size: 0.9em;
          color: #666;
        }

        .result-message {
          margin-bottom: 10px;
        }

        .result-details {
          margin-top: 10px;
        }

        .result-details pre {
          background-color: #f8f9fa;
          padding: 10px;
          border-radius: 3px;
          overflow-x: auto;
          font-size: 0.9em;
        }
      `}</style>
    </div>
  );
};

export default PluginStateServiceBridgeTest;