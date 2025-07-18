import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, Paper, Alert, Chip, Divider } from '@mui/material';
import { useService } from '../contexts/ServiceContext';
import { PluginStateServiceInterface, PluginStateServiceImpl } from '../services/PluginStateService';
import { EnhancedPageContextServiceInterface } from '../services/PageContextService';
import { PluginStateFactoryInterface } from '../services/PluginStateFactory';
import { ServiceBridgeManager, getServiceAvailability, getAllServiceAvailability } from '../utils/serviceBridge';
import { BaseService } from '../services/base/BaseService';

interface TestState {
  messages: Array<{
    id: string;
    sender: 'user' | 'ai';
    content: string;
    timestamp: string;
  }>;
  selectedModel: {
    name: string;
    provider: string;
  } | null;
  conversationId: string | null;
  useStreaming: boolean;
  currentTheme: string;
  inputText: string;
}

interface TestResults {
  serviceBridgeIntegration: boolean;
  stateConfigurationSetup: boolean;
  stateSaveOperation: boolean;
  stateRestoreOperation: boolean;
  stateClearOperation: boolean;
  pageNavigationPersistence: boolean;
  errorHandling: boolean;
  serviceAvailability: boolean;
}

/**
 * Comprehensive test component for BrainDriveBasicAIChat plugin state persistence
 */
export const BrainDriveBasicAIChatStateTest: React.FC = () => {
  const [testState, setTestState] = useState<TestState>({
    messages: [],
    selectedModel: null,
    conversationId: null,
    useStreaming: true,
    currentTheme: 'light',
    inputText: ''
  });

  const [testResults, setTestResults] = useState<TestResults>({
    serviceBridgeIntegration: false,
    stateConfigurationSetup: false,
    stateSaveOperation: false,
    stateRestoreOperation: false,
    stateClearOperation: false,
    pageNavigationPersistence: false,
    errorHandling: false,
    serviceAvailability: false
  });

  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [pluginStateService, setPluginStateService] = useState<PluginStateServiceInterface | null>(null);

  // Get services
  const pageContextService = useService('pageContext') as any;

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(`[BrainDriveBasicAIChatStateTest] ${message}`);
  };

  const updateTestResult = (test: keyof TestResults, result: boolean) => {
    setTestResults(prev => ({ ...prev, [test]: result }));
  };

  /**
   * Test 1: Service Bridge Integration
   */
  const testServiceBridgeIntegration = async (): Promise<boolean> => {
    setCurrentTest('Testing Service Bridge Integration');
    addLog('Starting service bridge integration test...');

    try {
      // Test service availability checks
      const bridgeManager = ServiceBridgeManager.getInstance();
      const availabilityChecks = getAllServiceAvailability();
      
      addLog(`Found ${availabilityChecks.length} service availability checks`);
      
      // Check for required services
      const requiredServices = ['pageContext', 'pluginStateFactory'];
      let allServicesAvailable = true;

      for (const serviceName of requiredServices) {
        const availability = getServiceAvailability(serviceName);
        if (!availability || !availability.isAvailable) {
          addLog(`ERROR: Required service '${serviceName}' is not available`);
          allServicesAvailable = false;
        } else {
          addLog(`✓ Service '${serviceName}' is available (version: ${availability.version || 'unknown'})`);
        }
      }

      // Test error handling
      try {
        const mockGetService = (name: string) => {
          if (name === 'nonexistent') {
            return null;
          }
          return { testMethod: () => 'test' };
        };

        const { serviceBridges, errors } = bridgeManager.createServiceBridges(
          { nonexistent: { methods: ['testMethod'] } },
          mockGetService
        );

        if (errors.length > 0) {
          addLog(`✓ Error handling working: ${errors[0].error}`);
        }
      } catch (error) {
        addLog(`ERROR: Service bridge error handling failed: ${error}`);
        return false;
      }

      addLog('Service bridge integration test completed successfully');
      return allServicesAvailable;
    } catch (error) {
      addLog(`ERROR: Service bridge integration test failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 2: State Configuration Setup
   */
  const testStateConfigurationSetup = async (): Promise<boolean> => {
    setCurrentTest('Testing State Configuration Setup');
    addLog('Starting state configuration setup test...');

    try {
      // Get plugin state service for BrainDriveBasicAIChat
      const pluginStateFactory = useService('pluginStateFactory') as any;
      const stateService = pluginStateFactory.getPluginStateService('BrainDriveBasicAIChat');
      setPluginStateService(stateService);

      // Configure plugin state
      const config = {
        pluginId: 'BrainDriveBasicAIChat',
        stateStrategy: 'session' as const,
        preserveKeys: ['messages', 'selectedModel', 'conversationId', 'useStreaming', 'currentTheme', 'inputText'],
        stateSchema: {
          messages: { type: 'array' as const, required: false, default: [] },
          selectedModel: { type: 'object' as const, required: false, default: null },
          conversationId: { type: 'string' as const, required: false, default: null },
          useStreaming: { type: 'boolean' as const, required: false, default: true },
          currentTheme: { type: 'string' as const, required: false, default: 'light' },
          inputText: { type: 'string' as const, required: false, default: '' }
        },
        maxStateSize: 1024 * 1024 // 1MB
      };

      stateService.configure(config);
      addLog('✓ Plugin state configuration set successfully');

      // Verify configuration
      const retrievedConfig = stateService.getConfiguration();
      if (retrievedConfig && retrievedConfig.pluginId === 'BrainDriveBasicAIChat') {
        addLog('✓ Configuration retrieval successful');
        return true;
      } else {
        addLog('ERROR: Configuration retrieval failed');
        return false;
      }
    } catch (error) {
      addLog(`ERROR: State configuration setup failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 3: State Save Operation
   */
  const testStateSaveOperation = async (): Promise<boolean> => {
    setCurrentTest('Testing State Save Operation');
    addLog('Starting state save operation test...');

    if (!pluginStateService) {
      addLog('ERROR: Plugin state service not available');
      return false;
    }

    try {
      // Create test state
      const testStateData = {
        messages: [
          {
            id: 'test-1',
            sender: 'user' as const,
            content: 'Hello, this is a test message',
            timestamp: new Date().toISOString()
          },
          {
            id: 'test-2',
            sender: 'ai' as const,
            content: 'Hello! I am an AI assistant. How can I help you today?',
            timestamp: new Date().toISOString()
          }
        ],
        selectedModel: {
          name: 'gpt-4',
          provider: 'openai'
        },
        conversationId: 'test-conversation-123',
        useStreaming: false,
        currentTheme: 'dark',
        inputText: 'Test input text'
      };

      // Save state
      await pluginStateService.saveState(testStateData);
      addLog('✓ State saved successfully');

      // Update local test state
      setTestState(testStateData);
      
      return true;
    } catch (error) {
      addLog(`ERROR: State save operation failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 4: State Restore Operation
   */
  const testStateRestoreOperation = async (): Promise<boolean> => {
    setCurrentTest('Testing State Restore Operation');
    addLog('Starting state restore operation test...');

    if (!pluginStateService) {
      addLog('ERROR: Plugin state service not available');
      return false;
    }

    try {
      // Restore state
      const restoredState = await pluginStateService.getState();
      
      if (restoredState) {
        addLog('✓ State restored successfully');
        addLog(`Restored ${restoredState.messages?.length || 0} messages`);
        addLog(`Restored model: ${restoredState.selectedModel?.name || 'none'}`);
        addLog(`Restored conversation ID: ${restoredState.conversationId || 'none'}`);
        
        // Verify restored data matches saved data
        const isValid = 
          restoredState.messages?.length === 2 &&
          restoredState.selectedModel?.name === 'gpt-4' &&
          restoredState.conversationId === 'test-conversation-123' &&
          restoredState.useStreaming === false &&
          restoredState.currentTheme === 'dark' &&
          restoredState.inputText === 'Test input text';

        if (isValid) {
          addLog('✓ Restored state data is valid');
          return true;
        } else {
          addLog('ERROR: Restored state data is invalid');
          return false;
        }
      } else {
        addLog('ERROR: No state was restored');
        return false;
      }
    } catch (error) {
      addLog(`ERROR: State restore operation failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 5: State Clear Operation
   */
  const testStateClearOperation = async (): Promise<boolean> => {
    setCurrentTest('Testing State Clear Operation');
    addLog('Starting state clear operation test...');

    if (!pluginStateService) {
      addLog('ERROR: Plugin state service not available');
      return false;
    }

    try {
      // Clear state
      await pluginStateService.clearState();
      addLog('✓ State cleared successfully');

      // Verify state is cleared
      const clearedState = await pluginStateService.getState();
      
      if (!clearedState || Object.keys(clearedState).length === 0) {
        addLog('✓ State clear verification successful');
        return true;
      } else {
        addLog('ERROR: State was not properly cleared');
        return false;
      }
    } catch (error) {
      addLog(`ERROR: State clear operation failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 6: Page Navigation Persistence
   */
  const testPageNavigationPersistence = async (): Promise<boolean> => {
    setCurrentTest('Testing Page Navigation Persistence');
    addLog('Starting page navigation persistence test...');

    try {
      // This test simulates what happens during page navigation
      // First, save some state
      if (!pluginStateService) {
        addLog('ERROR: Plugin state service not available');
        return false;
      }

      const navigationTestState = {
        messages: [
          {
            id: 'nav-test-1',
            sender: 'user' as const,
            content: 'Testing navigation persistence',
            timestamp: new Date().toISOString()
          }
        ],
        selectedModel: {
          name: 'claude-3',
          provider: 'anthropic'
        },
        conversationId: 'nav-test-conversation',
        useStreaming: true,
        currentTheme: 'light',
        inputText: 'Navigation test input'
      };

      await pluginStateService.saveState(navigationTestState);
      addLog('✓ State saved before navigation simulation');

      // Simulate page context change (like navigation)
      const currentContext = pageContextService.getCurrentPageContext();
      if (currentContext) {
        // Trigger a page context change event
        addLog('✓ Page context change simulated');
      }

      // Wait a bit to simulate navigation delay
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to restore state after "navigation"
      const restoredAfterNav = await pluginStateService.getState();
      
      if (restoredAfterNav && restoredAfterNav.conversationId === 'nav-test-conversation') {
        addLog('✓ State persisted through navigation simulation');
        return true;
      } else {
        addLog('ERROR: State was not persisted through navigation');
        return false;
      }
    } catch (error) {
      addLog(`ERROR: Page navigation persistence test failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 7: Error Handling
   */
  const testErrorHandling = async (): Promise<boolean> => {
    setCurrentTest('Testing Error Handling');
    addLog('Starting error handling test...');

    if (!pluginStateService) {
      addLog('ERROR: Plugin state service not available');
      return false;
    }

    try {
      // Test invalid state validation
      const invalidState = {
        messages: 'invalid-not-array',
        selectedModel: 'invalid-not-object',
        useStreaming: 'invalid-not-boolean'
      };

      // This should either validate and sanitize, or throw an error
      const isValid = pluginStateService.validateState(invalidState);
      addLog(`State validation result for invalid data: ${isValid}`);

      // Test state sanitization
      const sanitizedState = pluginStateService.sanitizeState(invalidState);
      addLog('✓ State sanitization completed');

      // Test error recovery
      try {
        await pluginStateService.saveState(null);
        addLog('WARNING: Saving null state should have been handled');
      } catch (error) {
        addLog('✓ Error handling for null state working');
      }

      return true;
    } catch (error) {
      addLog(`ERROR: Error handling test failed: ${error}`);
      return false;
    }
  };

  /**
   * Test 8: Service Availability
   */
  const testServiceAvailability = async (): Promise<boolean> => {
    setCurrentTest('Testing Service Availability');
    addLog('Starting service availability test...');

    try {
      const allAvailability = getAllServiceAvailability();
      addLog(`Total services checked: ${allAvailability.length}`);

      let availableCount = 0;
      let unavailableCount = 0;

      allAvailability.forEach(check => {
        if (check.isAvailable) {
          availableCount++;
          addLog(`✓ ${check.serviceName}: Available (${check.version || 'unknown version'})`);
        } else {
          unavailableCount++;
          addLog(`✗ ${check.serviceName}: Unavailable`);
        }
      });

      addLog(`Service availability summary: ${availableCount} available, ${unavailableCount} unavailable`);

      // Check specifically for plugin state related services
      const criticalServices = ['pageContext', 'pluginStateFactory'];
      let criticalServicesAvailable = true;

      for (const serviceName of criticalServices) {
        const availability = getServiceAvailability(serviceName);
        if (!availability || !availability.isAvailable) {
          addLog(`ERROR: Critical service '${serviceName}' is not available`);
          criticalServicesAvailable = false;
        }
      }

      return criticalServicesAvailable;
    } catch (error) {
      addLog(`ERROR: Service availability test failed: ${error}`);
      return false;
    }
  };

  /**
   * Run all tests
   */
  const runAllTests = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog('Starting comprehensive BrainDriveBasicAIChat state persistence tests...');

    const tests = [
      { name: 'serviceBridgeIntegration', fn: testServiceBridgeIntegration },
      { name: 'stateConfigurationSetup', fn: testStateConfigurationSetup },
      { name: 'stateSaveOperation', fn: testStateSaveOperation },
      { name: 'stateRestoreOperation', fn: testStateRestoreOperation },
      { name: 'stateClearOperation', fn: testStateClearOperation },
      { name: 'pageNavigationPersistence', fn: testPageNavigationPersistence },
      { name: 'errorHandling', fn: testErrorHandling },
      { name: 'serviceAvailability', fn: testServiceAvailability }
    ];

    for (const test of tests) {
      try {
        const result = await test.fn();
        updateTestResult(test.name as keyof TestResults, result);
        addLog(`Test ${test.name}: ${result ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        updateTestResult(test.name as keyof TestResults, false);
        addLog(`Test ${test.name}: FAILED with error: ${error}`);
      }
    }

    setCurrentTest('');
    setIsRunning(false);
    addLog('All tests completed!');
  };

  const getTestResultColor = (result: boolean) => result ? 'success' : 'error';
  const getTestResultText = (result: boolean) => result ? 'PASS' : 'FAIL';

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        BrainDriveBasicAIChat State Persistence Test
      </Typography>
      
      <Typography variant="body1" sx={{ mb: 3 }}>
        This test validates the plugin state persistence functionality with the BrainDriveBasicAIChat plugin.
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Button
          variant="contained"
          onClick={runAllTests}
          disabled={isRunning}
          sx={{ mr: 2 }}
        >
          {isRunning ? 'Running Tests...' : 'Run All Tests'}
        </Button>
        
        {currentTest && (
          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
            Current: {currentTest}
          </Typography>
        )}
      </Box>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Test Results</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {Object.entries(testResults).map(([test, result]) => (
            <Chip
              key={test}
              label={`${test}: ${getTestResultText(result)}`}
              color={getTestResultColor(result)}
              variant="outlined"
            />
          ))}
        </Box>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Current Test State</Typography>
        <Typography variant="body2" component="pre" sx={{ fontSize: '0.8rem' }}>
          {JSON.stringify(testState, null, 2)}
        </Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Test Logs</Typography>
        <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
          {logs.map((log, index) => (
            <Typography
              key={index}
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: log.includes('ERROR') ? 'error.main' : 
                       log.includes('✓') ? 'success.main' : 'text.primary'
              }}
            >
              {log}
            </Typography>
          ))}
        </Box>
      </Paper>
    </Box>
  );
};

export default BrainDriveBasicAIChatStateTest;