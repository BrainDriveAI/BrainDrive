import React, { Component } from 'react';
import { PluginStateConfig } from '../services/PageContextService';
import { PluginStateServiceInterface } from '../services/PluginStateService';
import { PluginStateFactoryInterface } from '../services/PluginStateFactory';

interface PluginStateTestProps {
  services?: {
    pluginStateFactory?: PluginStateFactoryInterface;
    pageContext?: any;
  };
}

interface PluginStateTestState {
  pluginState: any;
  isConfigured: boolean;
  testData: {
    counter: number;
    message: string;
    preferences: {
      theme: string;
      autoSave: boolean;
    };
  };
}

/**
 * Test component to demonstrate plugin state persistence functionality
 * This would typically be used within a plugin to test the state management
 */
export class PluginStateTest extends Component<PluginStateTestProps, PluginStateTestState> {
  private pluginStateService: PluginStateServiceInterface | null = null;
  private saveCallback?: () => void;
  private restoreCallback?: () => void;
  private clearCallback?: () => void;

  constructor(props: PluginStateTestProps) {
    super(props);
    
    this.state = {
      pluginState: null,
      isConfigured: false,
      testData: {
        counter: 0,
        message: 'Hello Plugin State!',
        preferences: {
          theme: 'light',
          autoSave: true
        }
      }
    };
  }

  async componentDidMount() {
    await this.initializePluginState();
    await this.restoreState();
  }

  componentWillUnmount() {
    this.cleanup();
  }

  private async initializePluginState() {
    if (!this.props.services?.pluginStateFactory) {
      console.error('[PluginStateTest] PluginStateFactory service not available');
      return;
    }

    try {
      // Create plugin-specific state service
      this.pluginStateService = this.props.services.pluginStateFactory.createPluginStateService('test-plugin');

      // Configure the plugin state
      const config: PluginStateConfig = {
        pluginId: 'test-plugin',
        stateStrategy: 'session',
        preserveKeys: ['counter', 'message', 'preferences'],
        stateSchema: {
          counter: { type: 'number', required: false, default: 0 },
          message: { type: 'string', required: false, default: 'Hello Plugin State!' },
          preferences: { type: 'object', required: false, default: { theme: 'light', autoSave: true } }
        },
        maxStateSize: 1024 // 1KB limit
      };

      this.pluginStateService.configure(config);

      // Set up lifecycle callbacks
      this.saveCallback = this.pluginStateService.onSave((state: any) => {
        console.log('[PluginStateTest] State saved:', state);
      });

      this.restoreCallback = this.pluginStateService.onRestore((state: any) => {
        console.log('[PluginStateTest] State restored:', state);
      });

      this.clearCallback = this.pluginStateService.onClear(() => {
        console.log('[PluginStateTest] State cleared');
      });

      this.setState({ isConfigured: true });
      console.log('[PluginStateTest] Plugin state service initialized');
    } catch (error) {
      console.error('[PluginStateTest] Error initializing plugin state:', error);
    }
  }

  private async restoreState() {
    if (!this.pluginStateService) return;

    try {
      const savedState = await this.pluginStateService.getState();
      if (savedState) {
        this.setState({
          testData: { ...this.state.testData, ...savedState }
        });
        console.log('[PluginStateTest] State restored from storage');
      }
    } catch (error) {
      console.error('[PluginStateTest] Error restoring state:', error);
    }
  }

  private async saveState() {
    if (!this.pluginStateService) return;

    try {
      await this.pluginStateService.saveState(this.state.testData);
      console.log('[PluginStateTest] State saved to storage');
    } catch (error) {
      console.error('[PluginStateTest] Error saving state:', error);
    }
  }

  private async clearState() {
    if (!this.pluginStateService) return;

    try {
      await this.pluginStateService.clearState();
      this.setState({
        testData: {
          counter: 0,
          message: 'Hello Plugin State!',
          preferences: {
            theme: 'light',
            autoSave: true
          }
        }
      });
      console.log('[PluginStateTest] State cleared from storage');
    } catch (error) {
      console.error('[PluginStateTest] Error clearing state:', error);
    }
  }

  private cleanup() {
    if (this.saveCallback) this.saveCallback();
    if (this.restoreCallback) this.restoreCallback();
    if (this.clearCallback) this.clearCallback();
  }

  private incrementCounter = async () => {
    const newTestData = {
      ...this.state.testData,
      counter: this.state.testData.counter + 1
    };
    
    this.setState({ testData: newTestData });
    
    // Auto-save if enabled
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
    
    // Auto-save if enabled
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
    
    // Auto-save if enabled
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
    const { isConfigured, testData } = this.state;

    if (!isConfigured) {
      return (
        <div style={{ padding: '20px', border: '1px solid #ccc', margin: '10px' }}>
          <h3>Plugin State Test</h3>
          <p>Initializing plugin state service...</p>
        </div>
      );
    }

    return (
      <div style={{ 
        padding: '20px', 
        border: '1px solid #ccc', 
        margin: '10px',
        backgroundColor: testData.preferences.theme === 'dark' ? '#333' : '#fff',
        color: testData.preferences.theme === 'dark' ? '#fff' : '#000'
      }}>
        <h3>Plugin State Test</h3>
        
        <div style={{ marginBottom: '15px' }}>
          <h4>Current State:</h4>
          <p><strong>Counter:</strong> {testData.counter}</p>
          <p><strong>Message:</strong> {testData.message}</p>
          <p><strong>Theme:</strong> {testData.preferences.theme}</p>
          <p><strong>Auto-save:</strong> {testData.preferences.autoSave ? 'Enabled' : 'Disabled'}</p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <h4>Actions:</h4>
          <button 
            onClick={this.incrementCounter}
            style={{ margin: '5px', padding: '5px 10px' }}
          >
            Increment Counter
          </button>
          
          <button 
            onClick={() => this.updateMessage(`Updated at ${new Date().toLocaleTimeString()}`)}
            style={{ margin: '5px', padding: '5px 10px' }}
          >
            Update Message
          </button>
          
          <button 
            onClick={this.toggleTheme}
            style={{ margin: '5px', padding: '5px 10px' }}
          >
            Toggle Theme
          </button>
          
          <button 
            onClick={this.toggleAutoSave}
            style={{ margin: '5px', padding: '5px 10px' }}
          >
            Toggle Auto-save
          </button>
        </div>

        <div>
          <h4>State Management:</h4>
          <button 
            onClick={() => this.saveState()}
            style={{ margin: '5px', padding: '5px 10px', backgroundColor: '#4CAF50', color: 'white' }}
          >
            Save State
          </button>
          
          <button 
            onClick={() => this.restoreState()}
            style={{ margin: '5px', padding: '5px 10px', backgroundColor: '#2196F3', color: 'white' }}
          >
            Restore State
          </button>
          
          <button 
            onClick={() => this.clearState()}
            style={{ margin: '5px', padding: '5px 10px', backgroundColor: '#f44336', color: 'white' }}
          >
            Clear State
          </button>
        </div>

        <div style={{ marginTop: '15px', fontSize: '12px', color: '#666' }}>
          <p><strong>Instructions:</strong></p>
          <ul>
            <li>Modify the state using the action buttons</li>
            <li>Navigate to another page and come back to test persistence</li>
            <li>Check browser console for detailed logs</li>
            <li>State is stored in sessionStorage with key: braindrive_plugin_state_test-plugin</li>
          </ul>
        </div>
      </div>
    );
  }
}

export default PluginStateTest;