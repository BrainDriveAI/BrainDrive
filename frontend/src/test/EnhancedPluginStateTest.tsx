import React, { Component } from 'react';
import { EnhancedPluginStateConfig } from '../services/StateConfigurationManager';
import { PluginStateServiceInterface } from '../services/PluginStateService';
import { PluginStateFactoryInterface } from '../services/PluginStateFactory';

interface EnhancedPluginStateTestProps {
  services?: {
    pluginStateFactory?: PluginStateFactoryInterface;
    pageContext?: any;
  };
}

interface EnhancedPluginStateTestState {
  pluginState: any;
  isConfigured: boolean;
  testData: {
    counter: number;
    message: string;
    email: string;
    age: number;
    preferences: {
      theme: string;
      autoSave: boolean;
      notifications: boolean;
    };
    sensitiveData: string;
    tempData: string;
  };
  configType: 'basic' | 'enhanced';
  compressionEnabled: boolean;
  debounceMs: number;
  storageStats: any;
  logs: string[];
}

/**
 * Enhanced test component to demonstrate Phase 3 plugin state persistence features
 * Shows advanced configuration, lifecycle hooks, transformations, and optimization
 */
export class EnhancedPluginStateTest extends Component<EnhancedPluginStateTestProps, EnhancedPluginStateTestState> {
  private pluginStateService: PluginStateServiceInterface | null = null;
  private saveCallback?: () => void;
  private restoreCallback?: () => void;
  private clearCallback?: () => void;

  constructor(props: EnhancedPluginStateTestProps) {
    super(props);
    
    this.state = {
      pluginState: null,
      isConfigured: false,
      testData: {
        counter: 0,
        message: 'Hello Enhanced Plugin State!',
        email: 'user@example.com',
        age: 25,
        preferences: {
          theme: 'light',
          autoSave: true,
          notifications: true
        },
        sensitiveData: 'secret-token-123',
        tempData: 'temporary-cache-data'
      },
      configType: 'basic',
      compressionEnabled: false,
      debounceMs: 0,
      storageStats: null,
      logs: []
    };
  }

  async componentDidMount() {
    await this.initializePluginState();
    await this.restoreState();
    this.updateStorageStats();
  }

  componentWillUnmount() {
    this.cleanup();
  }

  private addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    this.setState(prevState => ({
      logs: [`[${timestamp}] ${message}`, ...prevState.logs.slice(0, 19)] // Keep last 20 logs
    }));
  };

  private async initializePluginState() {
    if (!this.props.services?.pluginStateFactory) {
      this.addLog('ERROR: PluginStateFactory service not available');
      return;
    }

    try {
      // Create plugin-specific state service
      this.pluginStateService = this.props.services.pluginStateFactory.createPluginStateService('enhanced-test-plugin');

      // Configure with basic settings initially
      await this.configurePlugin();

      this.setState({ isConfigured: true });
      this.addLog('Plugin state service initialized successfully');
    } catch (error) {
      this.addLog(`ERROR: Failed to initialize plugin state: ${error}`);
    }
  }

  private async configurePlugin() {
    if (!this.pluginStateService) return;

    const { configType, compressionEnabled, debounceMs } = this.state;

    if (configType === 'basic') {
      // Basic configuration (backward compatible)
      const basicConfig = {
        pluginId: 'enhanced-test-plugin',
        stateStrategy: 'session' as const,
        preserveKeys: ['counter', 'message', 'email', 'age', 'preferences'],
        stateSchema: {
          counter: { type: 'number' as const, required: false, default: 0 },
          message: { type: 'string' as const, required: false, default: 'Hello Enhanced Plugin State!' },
          email: { type: 'string' as const, required: false, default: 'user@example.com' },
          age: { type: 'number' as const, required: false, default: 0 },
          preferences: { type: 'object' as const, required: false, default: { theme: 'light', autoSave: true, notifications: true } }
        },
        maxStateSize: 2048
      };

      this.pluginStateService.configure(basicConfig);
      this.addLog('Configured with basic settings');
    } else {
      // Enhanced configuration with Phase 3 features
      const enhancedConfig: EnhancedPluginStateConfig = {
        pluginId: 'enhanced-test-plugin',
        stateStrategy: 'session',
        
        // Advanced filtering
        preserveKeys: ['counter', 'message', 'email', 'age', 'preferences'],
        excludeKeys: ['tempData'], // Exclude temporary data
        excludePatterns: [/^temp_/, /_cache$/], // Exclude temp and cache keys
        
        // State schema with validation
        stateSchema: {
          counter: { type: 'number', required: false, default: 0 },
          message: { type: 'string', required: false, default: 'Hello Enhanced Plugin State!' },
          email: { type: 'string', required: true, default: 'user@example.com' },
          age: { type: 'number', required: false, default: 0 },
          preferences: { type: 'object', required: false, default: { theme: 'light', autoSave: true, notifications: true } }
        },
        
        // Enhanced validation
        validation: {
          strict: true,
          allowUnknownKeys: false,
          customValidators: new Map([
            ['email', (value: any) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)],
            ['age', (value: any) => typeof value === 'number' && value >= 0 && value <= 150]
          ])
        },
        
        // State transformations
        transformers: {
          beforeSave: (state: any) => {
            // Simulate encryption of sensitive data
            return {
              ...state,
              sensitiveData: state.sensitiveData ? `encrypted:${btoa(state.sensitiveData)}` : undefined
            };
          },
          afterLoad: (state: any) => {
            // Simulate decryption of sensitive data
            if (state.sensitiveData && state.sensitiveData.startsWith('encrypted:')) {
              return {
                ...state,
                sensitiveData: atob(state.sensitiveData.replace('encrypted:', ''))
              };
            }
            return state;
          }
        },
        
        // Lifecycle hooks
        hooks: {
          beforeSave: async (state: any) => {
            this.addLog(`HOOK: Before save - State size: ${JSON.stringify(state).length} bytes`);
            return state;
          },
          afterSave: async (state: any) => {
            this.addLog('HOOK: After save - State saved successfully');
            this.updateStorageStats();
          },
          beforeLoad: async () => {
            this.addLog('HOOK: Before load - Preparing to load state');
          },
          afterLoad: async (state: any) => {
            this.addLog(`HOOK: After load - State loaded: ${state ? 'success' : 'no data'}`);
            return state;
          },
          onError: (error: Error, operation: string) => {
            this.addLog(`HOOK: Error during ${operation}: ${error.message}`);
          }
        },
        
        // Performance optimization
        performance: {
          debounceMs: debounceMs,
          maxRetries: 3,
          timeout: 5000
        },
        
        // Compression settings
        compression: {
          enabled: compressionEnabled,
          threshold: 512 // Compress if state > 512 bytes
        },
        
        maxStateSize: 4096 // 4KB limit
      };

      this.pluginStateService.configure(enhancedConfig);
      this.addLog(`Configured with enhanced settings (compression: ${compressionEnabled}, debounce: ${debounceMs}ms)`);
    }

    // Set up lifecycle callbacks
    this.saveCallback = this.pluginStateService.onSave((state: any) => {
      this.addLog('CALLBACK: State save callback triggered');
    });

    this.restoreCallback = this.pluginStateService.onRestore((state: any) => {
      this.addLog('CALLBACK: State restore callback triggered');
    });

    this.clearCallback = this.pluginStateService.onClear(() => {
      this.addLog('CALLBACK: State clear callback triggered');
    });
  }

  private async restoreState() {
    if (!this.pluginStateService) return;

    try {
      const savedState = await this.pluginStateService.getState();
      if (savedState) {
        this.setState({
          testData: { ...this.state.testData, ...savedState }
        });
        this.addLog('State restored from storage');
      } else {
        this.addLog('No saved state found');
      }
    } catch (error) {
      this.addLog(`ERROR: Failed to restore state: ${error}`);
    }
  }

  private async saveState() {
    if (!this.pluginStateService) return;

    try {
      await this.pluginStateService.saveState(this.state.testData);
      this.addLog('State saved to storage');
    } catch (error) {
      this.addLog(`ERROR: Failed to save state: ${error}`);
    }
  }

  private async clearState() {
    if (!this.pluginStateService) return;

    try {
      await this.pluginStateService.clearState();
      this.setState({
        testData: {
          counter: 0,
          message: 'Hello Enhanced Plugin State!',
          email: 'user@example.com',
          age: 25,
          preferences: {
            theme: 'light',
            autoSave: true,
            notifications: true
          },
          sensitiveData: 'secret-token-123',
          tempData: 'temporary-cache-data'
        }
      });
      this.addLog('State cleared from storage');
      this.updateStorageStats();
    } catch (error) {
      this.addLog(`ERROR: Failed to clear state: ${error}`);
    }
  }

  private updateStorageStats = () => {
    if (this.props.services?.pageContext?.getStorageStats) {
      try {
        const stats = this.props.services.pageContext.getStorageStats();
        this.setState({ storageStats: stats });
      } catch (error) {
        this.addLog(`ERROR: Failed to get storage stats: ${error}`);
      }
    }
  };

  private async cleanupOldStates() {
    if (this.props.services?.pageContext?.cleanupOldStates) {
      try {
        const maxAge = 60 * 60 * 1000; // 1 hour
        const cleanedCount = await this.props.services.pageContext.cleanupOldStates(maxAge);
        this.addLog(`Cleaned up ${cleanedCount} old state entries`);
        this.updateStorageStats();
      } catch (error) {
        this.addLog(`ERROR: Failed to cleanup old states: ${error}`);
      }
    }
  }

  private cleanup() {
    if (this.saveCallback) this.saveCallback();
    if (this.restoreCallback) this.restoreCallback();
    if (this.clearCallback) this.clearCallback();
  }

  private async switchConfigType(newType: 'basic' | 'enhanced') {
    this.setState({ configType: newType });
    await this.configurePlugin();
    this.addLog(`Switched to ${newType} configuration`);
  }

  private async updateCompressionSetting(enabled: boolean) {
    this.setState({ compressionEnabled: enabled });
    await this.configurePlugin();
    this.addLog(`Compression ${enabled ? 'enabled' : 'disabled'}`);
  }

  private async updateDebounceSetting(ms: number) {
    this.setState({ debounceMs: ms });
    await this.configurePlugin();
    this.addLog(`Debounce set to ${ms}ms`);
  }

  // Test data modification methods
  private incrementCounter = async () => {
    const newTestData = {
      ...this.state.testData,
      counter: this.state.testData.counter + 1
    };
    
    this.setState({ testData: newTestData });
    
    if (newTestData.preferences.autoSave) {
      await this.saveState();
    }
  };

  private updateMessage = async (message: string) => {
    const newTestData = {
      ...this.state.testData,
      message
    };
    
    this.setState({ testData: newTestData });
    
    if (newTestData.preferences.autoSave) {
      await this.saveState();
    }
  };

  private updateEmail = async (email: string) => {
    const newTestData = {
      ...this.state.testData,
      email
    };
    
    this.setState({ testData: newTestData });
    
    if (newTestData.preferences.autoSave) {
      await this.saveState();
    }
  };

  private updateAge = async (age: number) => {
    const newTestData = {
      ...this.state.testData,
      age
    };
    
    this.setState({ testData: newTestData });
    
    if (newTestData.preferences.autoSave) {
      await this.saveState();
    }
  };

  private toggleTheme = async () => {
    const newTestData = {
      ...this.state.testData,
      preferences: {
        ...this.state.testData.preferences,
        theme: this.state.testData.preferences.theme === 'light' ? 'dark' : 'light'
      }
    };
    
    this.setState({ testData: newTestData });
    
    if (newTestData.preferences.autoSave) {
      await this.saveState();
    }
  };

  private toggleAutoSave = async () => {
    const newTestData = {
      ...this.state.testData,
      preferences: {
        ...this.state.testData.preferences,
        autoSave: !this.state.testData.preferences.autoSave
      }
    };
    
    this.setState({ testData: newTestData });
    await this.saveState(); // Always save this preference change
  };

  render() {
    const { isConfigured, testData, configType, compressionEnabled, debounceMs, storageStats, logs } = this.state;

    if (!isConfigured) {
      return (
        <div style={{ padding: '20px', border: '1px solid #ccc', margin: '10px' }}>
          <h3>Enhanced Plugin State Test</h3>
          <p>Initializing enhanced plugin state service...</p>
        </div>
      );
    }

    const isDarkTheme = testData.preferences.theme === 'dark';
    const containerStyle = {
      padding: '20px',
      border: '1px solid #ccc',
      margin: '10px',
      backgroundColor: isDarkTheme ? '#333' : '#fff',
      color: isDarkTheme ? '#fff' : '#000',
      fontFamily: 'Arial, sans-serif'
    };

    return (
      <div style={containerStyle}>
        <h3>Enhanced Plugin State Test (Phase 3)</h3>
        
        {/* Configuration Controls */}
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #666', borderRadius: '5px' }}>
          <h4>Configuration Settings</h4>
          
          <div style={{ marginBottom: '10px' }}>
            <label>
              <strong>Config Type: </strong>
              <select 
                value={configType} 
                onChange={(e) => this.switchConfigType(e.target.value as 'basic' | 'enhanced')}
                style={{ marginLeft: '10px', padding: '5px' }}
              >
                <option value="basic">Basic (Backward Compatible)</option>
                <option value="enhanced">Enhanced (Phase 3 Features)</option>
              </select>
            </label>
          </div>
          
          {configType === 'enhanced' && (
            <>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={compressionEnabled}
                    onChange={(e) => this.updateCompressionSetting(e.target.checked)}
                  />
                  <strong> Enable Compression</strong>
                </label>
              </div>
              
              <div style={{ marginBottom: '10px' }}>
                <label>
                  <strong>Debounce (ms): </strong>
                  <input
                    type="number"
                    value={debounceMs}
                    onChange={(e) => this.updateDebounceSetting(parseInt(e.target.value) || 0)}
                    style={{ marginLeft: '10px', padding: '5px', width: '80px' }}
                    min="0"
                    max="2000"
                    step="100"
                  />
                </label>
              </div>
            </>
          )}
        </div>

        {/* Current State Display */}
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #666', borderRadius: '5px' }}>
          <h4>Current State</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <p><strong>Counter:</strong> {testData.counter}</p>
              <p><strong>Message:</strong> {testData.message}</p>
              <p><strong>Email:</strong> {testData.email}</p>
              <p><strong>Age:</strong> {testData.age}</p>
            </div>
            <div>
              <p><strong>Theme:</strong> {testData.preferences.theme}</p>
              <p><strong>Auto-save:</strong> {testData.preferences.autoSave ? 'Enabled' : 'Disabled'}</p>
              <p><strong>Notifications:</strong> {testData.preferences.notifications ? 'Enabled' : 'Disabled'}</p>
              <p><strong>Sensitive Data:</strong> {testData.sensitiveData}</p>
            </div>
          </div>
        </div>

        {/* Data Modification Controls */}
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #666', borderRadius: '5px' }}>
          <h4>Data Modification</h4>
          
          <div style={{ marginBottom: '15px' }}>
            <button 
              onClick={this.incrementCounter}
              style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '3px' }}
            >
              Increment Counter
            </button>
            
            <button 
              onClick={() => this.updateMessage(`Updated at ${new Date().toLocaleTimeString()}`)}
              style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '3px' }}
            >
              Update Message
            </button>
            
            <button 
              onClick={this.toggleTheme}
              style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: '3px' }}
            >
              Toggle Theme
            </button>
            
            <button 
              onClick={this.toggleAutoSave}
              style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#9C27B0', color: 'white', border: 'none', borderRadius: '3px' }}
            >
              Toggle Auto-save
            </button>
          </div>
          
          <div style={{ marginBottom: '15px' }}>
            <input
              type="email"
              value={testData.email}
              onChange={(e) => this.updateEmail(e.target.value)}
              placeholder="Email address"
              style={{ margin: '5px', padding: '8px', width: '200px' }}
            />
            
            <input
              type="number"
              value={testData.age}
              onChange={(e) => this.updateAge(parseInt(e.target.value) || 0)}
              placeholder="Age"
              style={{ margin: '5px', padding: '8px', width: '80px' }}
              min="0"
              max="150"
            />
          </div>
        </div>

        {/* State Management Controls */}
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #666', borderRadius: '5px' }}>
          <h4>State Management</h4>
          
          <button 
            onClick={() => this.saveState()}
            style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '3px' }}
          >
            Save State
          </button>
          
          <button 
            onClick={() => this.restoreState()}
            style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '3px' }}
          >
            Restore State
          </button>
          
          <button 
            onClick={() => this.clearState()}
            style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '3px' }}
          >
            Clear State
          </button>
          
          <button 
            onClick={() => this.cleanupOldStates()}
            style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#607D8B', color: 'white', border: 'none', borderRadius: '3px' }}
          >
            Cleanup Old States
          </button>
          
          <button 
            onClick={this.updateStorageStats}
            style={{ margin: '5px', padding: '8px 12px', backgroundColor: '#795548', color: 'white', border: 'none', borderRadius: '3px' }}
          >
            Refresh Stats
          </button>
        </div>

        {/* Storage Statistics */}
        {storageStats && (
          <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #666', borderRadius: '5px' }}>
            <h4>Storage Statistics</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
              <div>
                <p><strong>Total Plugins:</strong> {storageStats.totalPlugins}</p>
                <p><strong>Total Size:</strong> {storageStats.totalSize} bytes</p>
                <p><strong>Available Space:</strong> {storageStats.availableSpace} bytes</p>
              </div>
              <div>
                <p><strong>Oldest Entry:</strong> {storageStats.oldestEntry ? new Date(storageStats.oldestEntry).toLocaleString() : 'N/A'}</p>
                <p><strong>Newest Entry:</strong> {storageStats.newestEntry ? new Date(storageStats.newestEntry).toLocaleString() : 'N/A'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Activity Logs */}
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #666', borderRadius: '5px' }}>
          <h4>Activity Logs</h4>
          <div style={{ 
            height: '200px', 
            overflowY: 'auto', 
            backgroundColor: isDarkTheme ? '#222' : '#f5f5f5', 
            padding: '10px', 
            borderRadius: '3px',
            fontFamily: 'monospace',
            fontSize: '12px'
          }}>
            {logs.map((log, index) => (
              <div key={index} style={{ marginBottom: '2px' }}>
                {log}
              </div>
            ))}
            {logs.length === 0 && (
              <div style={{ color: '#666', fontStyle: 'italic' }}>
                No logs yet. Perform some actions to see activity.
              </div>
            )}
          </div>
          <button 
            onClick={() => this.setState({ logs: [] })}
            style={{ marginTop: '10px', padding: '5px 10px', backgroundColor: '#666', color: 'white', border: 'none', borderRadius: '3px' }}
          >
            Clear Logs
          </button>
        </div>

        {/* Instructions */}
        <div style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
          <p><strong>Phase 3 Features Demonstrated:</strong></p>
          <ul>
            <li><strong>Enhanced Configuration:</strong> Switch between basic and enhanced config modes</li>
            <li><strong>State Filtering:</strong> Sensitive and temporary data handling with exclude patterns</li>
            <li><strong>Lifecycle Hooks:</strong> Before/after save/load hooks with logging</li>
            <li><strong>State Transformations:</strong> Automatic encryption/decryption of sensitive data</li>
            <li><strong>Compression:</strong> Optional compression for large states</li>
            <li><strong>Debounced Saves:</strong> Configurable debouncing to prevent excessive writes</li>
            <li><strong>Enhanced Validation:</strong> Email and age validation with custom validators</li>
            <li><strong>Storage Monitoring:</strong> Real-time storage statistics and cleanup</li>
            <li><strong>Error Handling:</strong> Comprehensive error handling with recovery</li>
          </ul>
          <p><strong>Instructions:</strong></p>
          <ul>
            <li>Try switching between basic and enhanced configuration modes</li>
            <li>Enable compression and observe the behavior with large states</li>
            <li>Set debounce delay and rapidly modify data to see debouncing in action</li>
            <li>Enter invalid email addresses to test validation</li>
            <li>Navigate to another page and return to test persistence</li>
            <li>Check the activity logs to see lifecycle hooks and callbacks</li>
            <li>Monitor storage statistics to see space usage</li>
          </ul>
        </div>
      </div>
    );
  }
}

export default EnhancedPluginStateTest;