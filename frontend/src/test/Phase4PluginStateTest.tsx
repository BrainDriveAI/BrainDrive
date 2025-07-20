import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Grid,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Switch,
  FormControlLabel,
  Divider,
  Paper
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { databasePersistenceManager } from '../services/DatabasePersistenceManager';
import { stateRestorationManager } from '../services/StateRestorationManager';
import { pluginStateLifecycleManager } from '../services/PluginStateLifecycleManager';
import { EnhancedPluginStateConfig } from '../services/StateConfigurationManager';

interface TestResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

interface LifecycleEvent {
  timestamp: number;
  pluginId: string;
  eventType: string;
  data?: any;
}

const Phase4PluginStateTest: React.FC = () => {
  const [testPluginId, setTestPluginId] = useState('test-plugin-phase4');
  const [testState, setTestState] = useState({ counter: 0, message: 'Hello Phase 4!' });
  const [results, setResults] = useState<TestResult[]>([]);
  const [lifecycleEvents, setLifecycleEvents] = useState<LifecycleEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [enableLifecycleHooks, setEnableLifecycleHooks] = useState(true);
  const [databaseStats, setDatabaseStats] = useState<any>(null);

  // Test configuration
  const testConfig: EnhancedPluginStateConfig = {
    pluginId: testPluginId,
    stateStrategy: 'persistent',
    preserveKeys: ['counter', 'message'],
    stateSchema: {
      counter: { type: 'number', required: true, default: 0 },
      message: { type: 'string', required: false, default: 'Default message' }
    },
    validation: {
      strict: true,
      allowUnknownKeys: false,
      customValidators: new Map([
        ['counter', (value) => typeof value === 'number' && value >= 0]
      ])
    },
    compression: {
      enabled: true,
      threshold: 100
    },
    performance: {
      debounceMs: 300,
      maxRetries: 3,
      timeout: 5000
    },
    hooks: {
      beforeSave: async (state) => {
        addLifecycleEvent('beforeSave', state);
        return state;
      },
      afterSave: async (state) => {
        addLifecycleEvent('afterSave', state);
      },
      beforeLoad: async () => {
        addLifecycleEvent('beforeLoad', null);
      },
      afterLoad: async (state) => {
        addLifecycleEvent('afterLoad', state);
        return state;
      },
      onError: (error, operation) => {
        addLifecycleEvent('onError', { error: error.message, operation });
      }
    }
  };

  const addResult = (result: TestResult) => {
    setResults(prev => [...prev, { ...result, timestamp: Date.now() }]);
  };

  const addLifecycleEvent = (eventType: string, data: any) => {
    if (enableLifecycleHooks) {
      setLifecycleEvents(prev => [...prev, {
        timestamp: Date.now(),
        pluginId: testPluginId,
        eventType,
        data
      }]);
    }
  };

  const clearResults = () => {
    setResults([]);
    setLifecycleEvents([]);
  };

  // Database Persistence Tests
  const testDatabaseSave = async () => {
    setIsLoading(true);
    try {
      const result = await databasePersistenceManager.saveState(testPluginId, testState, {
        strategy: 'persistent',
        pageId: 'test-page',
        ttlHours: 24
      });

      addResult({
        success: result.success,
        message: result.success ? 'Database save successful' : 'Database save failed',
        data: result.record,
        error: result.error
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Database save error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testDatabaseLoad = async () => {
    setIsLoading(true);
    try {
      const result = await databasePersistenceManager.loadState(testPluginId, {
        pageId: 'test-page'
      });

      addResult({
        success: result.success,
        message: result.success ? 'Database load successful' : 'Database load failed',
        data: result.data,
        error: result.error
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Database load error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testDatabaseQuery = async () => {
    setIsLoading(true);
    try {
      const states = await databasePersistenceManager.queryStates({
        plugin_id: testPluginId,
        limit: 10
      });

      addResult({
        success: true,
        message: `Found ${states.length} database states`,
        data: states
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Database query error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testDatabaseStats = async () => {
    setIsLoading(true);
    try {
      const stats = await databasePersistenceManager.getStateStats();
      setDatabaseStats(stats);

      addResult({
        success: true,
        message: 'Database stats retrieved',
        data: stats
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Database stats error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  // State Restoration Tests
  const testStateRestoration = async () => {
    setIsLoading(true);
    try {
      const result = await stateRestorationManager.restorePluginState(testPluginId, testConfig, {
        preferDatabase: true,
        fallbackToSession: true
      });

      addResult({
        success: result.success,
        message: `State restoration ${result.success ? 'successful' : 'failed'} (source: ${result.source})`,
        data: result.data,
        error: result.errors?.join(', ')
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'State restoration error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testPartialRestoration = async () => {
    setIsLoading(true);
    try {
      const result = await stateRestorationManager.restorePartialState(
        testPluginId, 
        ['counter'], 
        testConfig
      );

      addResult({
        success: result.success,
        message: `Partial restoration ${result.success ? 'successful' : 'failed'}`,
        data: result.data,
        error: result.errors?.join(', ')
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Partial restoration error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testFallbackRestoration = async () => {
    setIsLoading(true);
    try {
      const fallbackData = { counter: 999, message: 'Fallback data' };
      const result = await stateRestorationManager.restoreWithFallback(
        testPluginId, 
        testConfig, 
        fallbackData
      );

      addResult({
        success: result.success,
        message: `Fallback restoration ${result.success ? 'successful' : 'failed'}`,
        data: result.data,
        error: result.errors?.join(', ')
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Fallback restoration error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testMigration = async () => {
    setIsLoading(true);
    try {
      // First save to session storage (simulate existing session data)
      sessionStorage.setItem(`braindrive_plugin_state_${testPluginId}`, JSON.stringify(testState));
      
      const success = await stateRestorationManager.migrateSessionToDatabase(testPluginId, testConfig);

      addResult({
        success,
        message: `Migration ${success ? 'successful' : 'failed'}`,
        data: { migrated: success }
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Migration error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  // Lifecycle Hook Tests
  const testLifecycleHooks = async () => {
    setIsLoading(true);
    try {
      // Register lifecycle hooks
      const hookIds: string[] = [];

      hookIds.push(pluginStateLifecycleManager.registerHook(
        testPluginId,
        'onStateChange',
        (data) => {
          addLifecycleEvent('onStateChange', data);
        }
      ));

      hookIds.push(pluginStateLifecycleManager.registerHook(
        testPluginId,
        'beforeSave',
        (data) => {
          addLifecycleEvent('hookBeforeSave', data);
          return { ...data.state, hookModified: true };
        },
        { priority: 10 }
      ));

      // Simulate state change
      await pluginStateLifecycleManager.notifyStateChange({
        pluginId: testPluginId,
        oldState: { counter: 0 },
        newState: testState,
        changeType: 'update',
        source: 'session',
        timestamp: Date.now()
      });

      addResult({
        success: true,
        message: `Registered ${hookIds.length} lifecycle hooks`,
        data: { hookIds }
      });

      // Clean up hooks after test
      setTimeout(() => {
        hookIds.forEach(id => pluginStateLifecycleManager.unregisterHook(id));
      }, 1000);

    } catch (error) {
      addResult({
        success: false,
        message: 'Lifecycle hooks error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testValidationCallbacks = async () => {
    setIsLoading(true);
    try {
      // Register validation callback
      const callbackId = pluginStateLifecycleManager.registerValidationCallback(
        testPluginId,
        (state, config) => {
          // Custom validation: counter must be positive
          return state.counter >= 0;
        }
      );

      // Test validation with valid state
      const validResult = await pluginStateLifecycleManager.executeValidation(
        testPluginId,
        { counter: 5, message: 'Valid' },
        testConfig
      );

      // Test validation with invalid state
      const invalidResult = await pluginStateLifecycleManager.executeValidation(
        testPluginId,
        { counter: -1, message: 'Invalid' },
        testConfig
      );

      addResult({
        success: true,
        message: `Validation tests completed`,
        data: { 
          callbackId,
          validResult,
          invalidResult
        }
      });

      // Clean up
      pluginStateLifecycleManager.unregisterValidationCallback(callbackId);

    } catch (error) {
      addResult({
        success: false,
        message: 'Validation callbacks error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  // Sync and Cross-Device Tests
  const testCrossDeviceSync = async () => {
    setIsLoading(true);
    try {
      const result = await stateRestorationManager.syncStateAcrossDevices(testPluginId, testConfig);

      addResult({
        success: result.success,
        message: `Cross-device sync ${result.success ? 'successful' : 'failed'}`,
        data: result.data,
        error: result.errors?.join(', ')
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Cross-device sync error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const testBulkOperations = async () => {
    setIsLoading(true);
    try {
      const states = [
        { pluginId: `${testPluginId}-1`, data: { counter: 1 } },
        { pluginId: `${testPluginId}-2`, data: { counter: 2 } },
        { pluginId: `${testPluginId}-3`, data: { counter: 3 } }
      ];

      const result = await databasePersistenceManager.syncStates(states);

      addResult({
        success: result.success,
        message: `Bulk operations ${result.success ? 'successful' : 'failed'}`,
        data: {
          synced: result.synced.length,
          conflicts: result.conflicts.length,
          errors: result.errors.length
        }
      });
    } catch (error) {
      addResult({
        success: false,
        message: 'Bulk operations error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    setIsLoading(false);
  };

  const runAllTests = async () => {
    clearResults();
    setIsLoading(true);

    const tests = [
      testDatabaseSave,
      testDatabaseLoad,
      testDatabaseQuery,
      testDatabaseStats,
      testStateRestoration,
      testPartialRestoration,
      testFallbackRestoration,
      testMigration,
      testLifecycleHooks,
      testValidationCallbacks,
      testCrossDeviceSync,
      testBulkOperations
    ];

    for (const test of tests) {
      await test();
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
    }

    setIsLoading(false);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Phase 4: Advanced Plugin State Management Test Suite
      </Typography>

      <Grid container spacing={3}>
        {/* Configuration Panel */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Test Configuration</Typography>
              
              <TextField
                fullWidth
                label="Plugin ID"
                value={testPluginId}
                onChange={(e) => setTestPluginId(e.target.value)}
                margin="normal"
              />

              <TextField
                fullWidth
                label="Counter Value"
                type="number"
                value={testState.counter}
                onChange={(e) => setTestState(prev => ({ ...prev, counter: parseInt(e.target.value) || 0 }))}
                margin="normal"
              />

              <TextField
                fullWidth
                label="Message"
                value={testState.message}
                onChange={(e) => setTestState(prev => ({ ...prev, message: e.target.value }))}
                margin="normal"
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={enableLifecycleHooks}
                    onChange={(e) => setEnableLifecycleHooks(e.target.checked)}
                  />
                }
                label="Enable Lifecycle Hooks"
              />

              <Box sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  onClick={runAllTests}
                  disabled={isLoading}
                  fullWidth
                  sx={{ mb: 1 }}
                >
                  Run All Tests
                </Button>
                <Button
                  variant="outlined"
                  onClick={clearResults}
                  fullWidth
                >
                  Clear Results
                </Button>
              </Box>
            </CardContent>
          </Card>

          {/* Database Stats */}
          {databaseStats && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>Database Statistics</Typography>
                <List dense>
                  <ListItem>
                    <ListItemText primary={`Total States: ${databaseStats.total_states}`} />
                  </ListItem>
                  <ListItem>
                    <ListItemText primary={`Active States: ${databaseStats.active_states}`} />
                  </ListItem>
                  <ListItem>
                    <ListItemText primary={`Total Size: ${databaseStats.total_size} bytes`} />
                  </ListItem>
                  <ListItem>
                    <ListItemText primary={`Plugins with State: ${databaseStats.plugins_with_state}`} />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Test Controls */}
        <Grid item xs={12} md={8}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">Database Persistence Tests</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testDatabaseSave} disabled={isLoading} fullWidth>
                    Save to DB
                  </Button>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testDatabaseLoad} disabled={isLoading} fullWidth>
                    Load from DB
                  </Button>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testDatabaseQuery} disabled={isLoading} fullWidth>
                    Query States
                  </Button>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testDatabaseStats} disabled={isLoading} fullWidth>
                    Get Stats
                  </Button>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">State Restoration Tests</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testStateRestoration} disabled={isLoading} fullWidth>
                    Full Restore
                  </Button>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testPartialRestoration} disabled={isLoading} fullWidth>
                    Partial Restore
                  </Button>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testFallbackRestoration} disabled={isLoading} fullWidth>
                    Fallback Restore
                  </Button>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Button variant="outlined" onClick={testMigration} disabled={isLoading} fullWidth>
                    Migration
                  </Button>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">Lifecycle & Validation Tests</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={4}>
                  <Button variant="outlined" onClick={testLifecycleHooks} disabled={isLoading} fullWidth>
                    Lifecycle Hooks
                  </Button>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Button variant="outlined" onClick={testValidationCallbacks} disabled={isLoading} fullWidth>
                    Validation
                  </Button>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Button variant="outlined" onClick={testCrossDeviceSync} disabled={isLoading} fullWidth>
                    Cross-Device Sync
                  </Button>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">Advanced Tests</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Button variant="outlined" onClick={testBulkOperations} disabled={isLoading} fullWidth>
                    Bulk Operations
                  </Button>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* Results Panel */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Test Results</Typography>
              {results.length === 0 ? (
                <Typography color="textSecondary">No test results yet. Run some tests to see results here.</Typography>
              ) : (
                <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                  {results.map((result, index) => (
                    <Alert 
                      key={index} 
                      severity={result.success ? 'success' : 'error'} 
                      sx={{ mb: 1 }}
                    >
                      <Typography variant="body2">
                        <strong>{result.message}</strong>
                        {result.data && (
                          <Box component="pre" sx={{ mt: 1, fontSize: '0.75rem', overflow: 'auto' }}>
                            {JSON.stringify(result.data, null, 2)}
                          </Box>
                        )}
                        {result.error && (
                          <Typography color="error" variant="caption" display="block">
                            Error: {result.error}
                          </Typography>
                        )}
                      </Typography>
                    </Alert>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Lifecycle Events Panel */}
        {enableLifecycleHooks && lifecycleEvents.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Lifecycle Events</Typography>
                <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                  {lifecycleEvents.map((event, index) => (
                    <Paper key={index} sx={{ p: 1, mb: 1, bgcolor: 'grey.50' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip 
                          label={event.eventType} 
                          size="small" 
                          color={event.eventType.includes('Error') ? 'error' : 'primary'}
                        />
                        <Typography variant="caption">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </Typography>
                      </Box>
                      {event.data && (
                        <Box component="pre" sx={{ fontSize: '0.7rem', mt: 0.5, overflow: 'auto' }}>
                          {JSON.stringify(event.data, null, 2)}
                        </Box>
                      )}
                    </Paper>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default Phase4PluginStateTest;