import React from 'react';
import './OllamaServer.css';
import { GearIcon, TagIcon, LinkIcon, KeyIcon, LightningIcon, UpdateIcon, TrashIcon, CloseIcon, PlusIcon } from '../icons';

interface ApiResponse {
  data?: any;
  status?: number;
  id?: string;
  [key: string]: any;
}

interface OllamaApiResponse {
  status: string;
  version?: string;
}

interface ServerConfig {
  id: string;          // Unique identifier for the server
  serverName: string;  // Display name
  serverAddress: string; // URL
  apiKey: string;      // Optional authentication
  connectionStatus: 'idle' | 'checking' | 'success' | 'error';
}

/**
 * Settings Service Bridge Interface
 * This interface defines the contract for the settings service bridge.
 * This keeps the plugin decoupled from the actual service implementation.
 */
interface SettingsServiceBridge {
  // Basic operations
  getSetting: (name: string, context?: { userId?: string; pageId?: string }) => any;
  setSetting: (name: string, value: any, context?: { userId?: string; pageId?: string }) => void;
  
  // Definition management
  registerSettingDefinition?: (definition: any) => Promise<void>;
  getSettingDefinitions?: (filter?: { category?: string; tags?: string[] }) => Promise<any[]>;
  
  // Subscription methods
  subscribe?: (key: string, callback: (value: any) => void) => () => void;
  subscribeToCategory?: (category: string, callback: (value: any) => void) => () => void;
}

interface OllamaServerComponentProps {
  services: {
    api?: {
      get: (url: string, options?: any) => Promise<ApiResponse>;
      post: (url: string, data: any) => Promise<ApiResponse>;
      delete: (url: string, options?: any) => Promise<ApiResponse>;
    };
    theme?: {
      getCurrentTheme: () => string;
      addThemeChangeListener: (callback: (theme: string) => void) => void;
      removeThemeChangeListener: (callback: (theme: string) => void) => void;
    };
    settings?: SettingsServiceBridge;
  };
}

interface OllamaServerComponentState {
  servers: ServerConfig[];
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string;
  currentTheme: string;
  activeServerId: string | null; // Currently selected server for editing
  isAddingNew: boolean;          // Flag to indicate adding a new server
}

// Ollama Settings Configuration
const OLLAMA_SETTINGS = {
  DEFINITION_ID: 'ollama_servers_settings',
  CATEGORY: 'llm_servers',
  SCHEMA: {
    type: 'object',
    properties: {
      servers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            serverName: { type: 'string' },
            serverAddress: { type: 'string' },
            apiKey: { type: 'string' },
            connectionStatus: {
              type: 'string',
              enum: ['idle', 'checking', 'success', 'error']
            }
          },
          required: ['id', 'serverName', 'serverAddress']
        }
      }
    }
  },
  DEFAULT_VALUE: {
    servers: []
  }
};

class ComponentOllamaServer extends React.Component<OllamaServerComponentProps, OllamaServerComponentState> {
  private themeChangeListener: ((theme: string) => void) | null = null;
  private settingsUnsubscribe?: () => void;

  constructor(props: OllamaServerComponentProps) {
    super(props);
    console.log('ComponentOllamaServer - Constructor called');
    this.state = {
      servers: [],
      isLoading: true,
      isSaving: false,
      errorMessage: '',
      currentTheme: 'light', // Default theme
      activeServerId: null,
      isAddingNew: false
    };
  }

  async componentDidMount() {
    console.log('ComponentOllamaServer - componentDidMount called');
    console.log('ComponentOllamaServer - Props:', this.props);
    console.log('ComponentOllamaServer - Services available:', !!this.props.services);
    console.log('ComponentOllamaServer - Settings service available:', !!this.props.services?.settings);
    
    await this.initializeSettingsDefinition();
    this.initializeSettingsSubscription();
    this.initializeThemeService();
    // Don't call loadSettings immediately - let the subscription handle it
    // Give a moment for the subscription to be established
    setTimeout(() => {
      this.loadSettings();
    }, 50);
  }

  componentWillUnmount() {
    console.log('ComponentOllamaServer - componentWillUnmount called');
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
    }
  }

  /**
   * Initialize the Ollama settings definition
   */
  async initializeSettingsDefinition() {
    if (!this.props.services?.settings?.registerSettingDefinition) {
      console.warn('registerSettingDefinition method not available, assuming definition exists');
      return;
    }

    try {
      // Check if definition already exists
      if (this.props.services.settings.getSettingDefinitions) {
        const definitions = await this.props.services.settings.getSettingDefinitions({
          category: OLLAMA_SETTINGS.CATEGORY
        });
        
        const existingDefinition = definitions.find(def => def.id === OLLAMA_SETTINGS.DEFINITION_ID);
        if (existingDefinition) {
          console.log('Ollama settings definition already exists');
          return;
        }
      }

      // Register the definition
      await this.props.services.settings.registerSettingDefinition({
        id: OLLAMA_SETTINGS.DEFINITION_ID,
        name: 'Ollama Servers Settings',
        description: 'Configuration for multiple Ollama server connections',
        category: OLLAMA_SETTINGS.CATEGORY,
        scope: 'user',
        schema: OLLAMA_SETTINGS.SCHEMA,
        defaultValue: OLLAMA_SETTINGS.DEFAULT_VALUE,
        tags: ['ollama', 'llm', 'servers', 'ai']
      });

      console.log('Ollama settings definition registered successfully');
    } catch (error) {
      console.error('Failed to register Ollama settings definition:', error);
    }
  }

  /**
   * Initialize settings subscription for real-time updates
   */
  initializeSettingsSubscription() {
    if (!this.props.services?.settings?.subscribe) {
      console.warn('Settings service subscription not available');
      return;
    }

    console.log('ComponentOllamaServer - Setting up subscription for:', OLLAMA_SETTINGS.DEFINITION_ID);
    console.log('ComponentOllamaServer - Subscribe method available:', typeof this.props.services.settings.subscribe);

    // Subscribe to Ollama settings changes
    // The ServiceBridge passes the entire settings object, not just the specific setting
    const callback = (allSettings: Record<string, any>) => {
      console.log('ComponentOllamaServer - Subscription callback fired!', allSettings);
      console.log('ComponentOllamaServer - Settings keys:', allSettings ? Object.keys(allSettings) : 'none');
      
      // Extract our specific setting from the entire settings object
      const ourSetting = allSettings[OLLAMA_SETTINGS.DEFINITION_ID];
      console.log('ComponentOllamaServer - Our setting:', ourSetting);
      
      if (ourSetting && ourSetting.servers && Array.isArray(ourSetting.servers)) {
        const servers: ServerConfig[] = ourSetting.servers.map((server: any) => ({
          id: server.id,
          serverName: server.serverName,
          serverAddress: server.serverAddress,
          apiKey: server.apiKey || '',
          connectionStatus: server.connectionStatus || 'idle'
        }));
        
        console.log('ComponentOllamaServer - Updating state with servers:', servers);
        this.setState({
          servers,
          errorMessage: '',
          isLoading: false
        });
      } else {
        console.log('ComponentOllamaServer - No servers found, setting empty array');
        this.setState({
          servers: [],
          errorMessage: '',
          isLoading: false
        });
      }
    };

    console.log('ComponentOllamaServer - Callback function created:', typeof callback);
    
    this.settingsUnsubscribe = this.props.services.settings.subscribe(
      OLLAMA_SETTINGS.DEFINITION_ID,
      callback
    );
    
    console.log('ComponentOllamaServer - Subscription set up, unsubscribe function:', typeof this.settingsUnsubscribe);
  }

  /**
   * Initialize the theme service to listen for theme changes
   */
  initializeThemeService() {
    if (this.props.services?.theme) {
      try {
        // Get the current theme
        const currentTheme = this.props.services.theme.getCurrentTheme();
        this.setState({ currentTheme });
        
        // Set up theme change listener
        this.themeChangeListener = (newTheme: string) => {
          this.setState({ currentTheme: newTheme });
        };
        
        // Add the listener to the theme service
        this.props.services.theme.addThemeChangeListener(this.themeChangeListener);
      } catch (error) {
        console.error('Error initializing theme service:', error);
      }
    }
  }

  /**
   * Generate a unique ID for a new server
   */
  generateUniqueId = () => {
    return 'server_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  };

  loadSettings = async () => {
    if (!this.props.services?.settings) {
      // Fallback to API service if Settings service not available
      if (!this.props.services?.api) {
        this.setState({
          isLoading: false,
          errorMessage: 'Neither Settings nor API service available'
        });
        return;
      }
      return this.loadSettingsFromAPI();
    }

    try {
      // Try to get current settings value
      const settingsValue = this.props.services.settings.getSetting(OLLAMA_SETTINGS.DEFINITION_ID);
      
      if (settingsValue && settingsValue.servers && Array.isArray(settingsValue.servers)) {
        // Ensure each server has a connection status
        const servers: ServerConfig[] = settingsValue.servers.map((server: any) => ({
          id: server.id,
          serverName: server.serverName,
          serverAddress: server.serverAddress,
          apiKey: server.apiKey || '',
          connectionStatus: server.connectionStatus || 'idle'
        }));
        
        this.setState({
          servers,
          isLoading: false,
          errorMessage: ''
        });
      } else {
        // No settings found yet, subscription will update when available
        // Don't set isLoading to false yet - let subscription handle it
      }
    } catch (error: any) {
      console.error('Error loading Ollama settings:', error);
      this.setState({
        isLoading: false,
        errorMessage: `Error loading settings: ${error.message || 'Unknown error'}`
      });
    }
  };

  /**
   * Fallback method to load settings from API when Settings service is not available
   */
  loadSettingsFromAPI = async () => {
    try {
      const response = await this.props.services!.api!.get('/api/v1/settings/instances', {
        params: {
          definition_id: 'ollama_servers_settings',
          scope: 'user',
          user_id: 'current'
        }
      });
      
      let settingsData = null;
      
      if (Array.isArray(response) && response.length > 0) {
        settingsData = response[0];
      } else if (response && typeof response === 'object') {
        const responseObj = response as Record<string, any>;
        
        if (responseObj.data) {
          if (Array.isArray(responseObj.data) && responseObj.data.length > 0) {
            settingsData = responseObj.data[0];
          } else if (typeof responseObj.data === 'object') {
            settingsData = responseObj.data;
          }
        } else {
          settingsData = response;
        }
      }
      
      if (settingsData && settingsData.value) {
        let parsedValue = typeof settingsData.value === 'string'
          ? JSON.parse(settingsData.value)
          : settingsData.value;
        
        const servers: ServerConfig[] = [];
        
        if (Array.isArray(parsedValue.servers)) {
          for (const server of parsedValue.servers) {
            let status: 'idle' | 'checking' | 'success' | 'error' = 'idle';
            if (server.connectionStatus === 'checking' ||
                server.connectionStatus === 'success' ||
                server.connectionStatus === 'error') {
              status = server.connectionStatus;
            }
            
            servers.push({
              id: server.id,
              serverName: server.serverName,
              serverAddress: server.serverAddress,
              apiKey: server.apiKey || '',
              connectionStatus: status
            });
          }
        }
        
        this.setState({
          servers,
          isLoading: false,
          errorMessage: ''
        });
      } else {
        this.setState({
          servers: [],
          isLoading: false,
          errorMessage: ''
        });
      }
    } catch (error: any) {
      this.setState({
        isLoading: false,
        errorMessage: `Error loading settings: ${error.message || 'Unknown error'}`
      });
    }
  };

  saveSettings = async () => {
    if (!this.props.services?.settings) {
      // Fallback to API service if Settings service not available
      if (!this.props.services?.api) {
        this.setState({ errorMessage: 'Neither Settings nor API service available' });
        return;
      }
      return this.saveSettingsToAPI();
    }

    this.setState({ isSaving: true, errorMessage: '' });

    try {
      // Prepare server configurations for saving
      const serverConfigs = this.state.servers.map(server => ({
        id: server.id,
        serverName: server.serverName,
        serverAddress: server.serverAddress,
        apiKey: server.apiKey,
        connectionStatus: server.connectionStatus
      }));

      const settingsValue = {
        servers: serverConfigs
      };

      // Use Settings service to save Ollama servers configuration
      this.props.services.settings.setSetting(
        OLLAMA_SETTINGS.DEFINITION_ID,
        settingsValue
      );
      
      this.setState({
        isSaving: false,
        errorMessage: '',
        isAddingNew: false,
        activeServerId: null
      });
      
      alert('Settings saved successfully!');
    } catch (error: any) {
      console.error('Error saving Ollama settings:', error);
      this.setState({
        isSaving: false,
        errorMessage: `Error saving settings: ${error.message || 'Unknown error'}`
      });
    }
  };

  /**
   * Fallback method to save settings to API when Settings service is not available
   */
  saveSettingsToAPI = async () => {
    this.setState({ isSaving: true, errorMessage: '' });

    try {
      const serverConfigs: ServerConfig[] = [];
      
      for (const server of this.state.servers) {
        serverConfigs.push({
          id: server.id,
          serverName: server.serverName,
          serverAddress: server.serverAddress,
          apiKey: server.apiKey,
          connectionStatus: 'idle'
        });
      }

      const settingsData = {
        definition_id: 'ollama_servers_settings',
        name: 'Ollama Servers Settings',
        value: {
          servers: serverConfigs
        },
        scope: "user",
        user_id: "current"
      };

      const response = await this.props.services!.api!.post('/api/v1/settings/instances', settingsData);
      
      this.setState({
        isSaving: false,
        errorMessage: '',
        isAddingNew: false,
        activeServerId: null
      });
      
      alert('Settings saved successfully!');
    } catch (error: any) {
      this.setState({
        isSaving: false,
        errorMessage: `Error saving settings: ${error.message || 'Unknown error'}`
      });
    }
  };

  addNewServer = () => {
    const newServer: ServerConfig = {
      id: this.generateUniqueId(),
      serverName: 'New Server',
      serverAddress: 'http://localhost:11434',
      apiKey: '',
      connectionStatus: 'idle'
    };

    this.setState({
      isAddingNew: true,
      activeServerId: newServer.id,
      servers: [...this.state.servers, newServer]
    });
  };

  selectServer = (serverId: string) => {
    this.setState({
      activeServerId: serverId,
      isAddingNew: false
    });
  };

  deleteServer = (serverId: string) => {
    if (!window.confirm('Are you sure you want to delete this server?')) {
      return;
    }

    const updatedServers = this.state.servers.filter(server => server.id !== serverId);
    
    this.setState({
      servers: updatedServers,
      activeServerId: null,
      isAddingNew: false
    }, () => {
      this.saveSettings();
    });
  };

  cancelEdit = () => {
    if (this.state.isAddingNew) {
      // Remove the new server that was being added
      const updatedServers = this.state.servers.filter(server => server.id !== this.state.activeServerId);
      this.setState({
        servers: updatedServers,
        activeServerId: null,
        isAddingNew: false
      });
    } else {
      // Just cancel editing
      this.setState({
        activeServerId: null,
        isAddingNew: false
      });
    }
  };

  handleInputChange = (serverId: string, field: 'serverName' | 'serverAddress' | 'apiKey', value: string) => {
    const updatedServers = this.state.servers.map(server => {
      if (server.id === serverId) {
        if (field === 'serverName') {
          return { ...server, serverName: value };
        } else if (field === 'serverAddress') {
          return { ...server, serverAddress: value };
        } else if (field === 'apiKey') {
          return { ...server, apiKey: value };
        }
      }
      return server;
    });

    this.setState({ servers: updatedServers });
  };

  testConnection = async (serverId: string) => {
    const server = this.state.servers.find(s => s.id === serverId);
    if (!server) return;

    const updatedServers = this.state.servers.map(s => {
      if (s.id === serverId) {
        return { ...s, connectionStatus: 'checking' as const };
      }
      return s;
    });

    this.setState({ 
      servers: updatedServers,
      errorMessage: '' 
    });
    
    if (!this.props.services?.api) {
      this.updateServerStatus(serverId, 'error');
      this.setState({ errorMessage: 'API service not available' });
      return;
    }
    
    try {
      const encodedUrl = encodeURIComponent(server.serverAddress);
      const params: Record<string, string> = { server_url: encodedUrl };
      
      if (server.apiKey) {
        params.api_key = server.apiKey;
      }
      
      const response = await this.props.services.api.get('/api/v1/ollama/test', { params });
      const responseData = response as unknown as OllamaApiResponse;
      
      if (responseData && responseData.status === 'success') {
        this.updateServerStatus(serverId, 'success');
      } else {
        this.updateServerStatus(serverId, 'error');
        this.setState({ 
          errorMessage: 'Connection failed. Please check your server address and API key.'
        });
      }
    } catch (error: any) {
      this.updateServerStatus(serverId, 'error');
      this.setState({ 
        errorMessage: 'Connection failed. Please check your server address and API key.'
      });
    }
  };

  updateServerStatus = (serverId: string, status: 'idle' | 'checking' | 'success' | 'error') => {
    const updatedServers = this.state.servers.map(server => {
      if (server.id === serverId) {
        return { ...server, connectionStatus: status };
      }
      return server;
    });

    this.setState({ servers: updatedServers });
  };

  updateServer = (serverId: string) => {
    const server = this.state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.serverName.trim() || !server.serverAddress.trim()) {
      this.setState({ errorMessage: 'Server name and address are required' });
      return;
    }

    // Update the server in state
    const updatedServers = this.state.servers.map(s => {
      if (s.id === serverId) {
        return {
          ...s,
          serverName: s.serverName.trim(),
          serverAddress: s.serverAddress.trim()
        };
      }
      return s;
    });

    this.setState({
      servers: updatedServers,
      activeServerId: null,
      isAddingNew: false
    }, () => {
      this.saveSettings();
    });
  };

  renderServerList() {
    const { servers, activeServerId } = this.state;
    
    return (
      <div className="server-list">
        <h3 className="server-list-title">Ollama Servers</h3>
        
        {servers.length === 0 ? (
          <div className="no-servers">No servers configured</div>
        ) : (
          <ul className="server-items">
            {servers.map(server => (
              <li 
                key={server.id} 
                className={`server-item ${activeServerId === server.id ? 'active' : ''}`}
                onClick={() => this.selectServer(server.id)}
              >
                <div className="server-item-content">
                  <div className="server-name">{server.serverName}</div>
                  <div className="server-address">{server.serverAddress}</div>
                </div>
                <div className={`server-status status-${server.connectionStatus}`}>
                  {server.connectionStatus === 'success' && <LightningIcon />}
                  {server.connectionStatus === 'error' && <CloseIcon />}
                  {server.connectionStatus === 'checking' && <div className="spinner-small" />}
                </div>
              </li>
            ))}
          </ul>
        )}
        
        <button 
          className="button button-primary add-server-button"
          onClick={this.addNewServer}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ marginRight: '8px' }}>
              <PlusIcon />
            </div>
            <span>Add New Server</span>
          </div>
        </button>
      </div>
    );
  }

  renderServerDetail() {
    const { servers, activeServerId, errorMessage } = this.state;
    
    if (!activeServerId) return null;
    
    const server = servers.find(s => s.id === activeServerId);
    if (!server) return null;

    return (
      <div className="server-detail">
        <div className="server-detail-header">
          <h3>{this.state.isAddingNew ? 'Add New Server' : 'Edit Server'}</h3>
          <button 
            className="button-icon" 
            onClick={this.cancelEdit}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {errorMessage && (
          <div className="form-section">
            <div className="status-indicator status-error">
              {errorMessage}
            </div>
          </div>
        )}

        <div className="form-section">
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">
                <div className="label-container">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ marginRight: '8px' }}>
                      <GearIcon />
                    </div>
                    <span>Server Name</span>
                  </div>
                  <span className="label-description">Name for this Ollama server</span>
                </div>
              </label>
              <input
                type="text"
                className="input-field"
                value={server.serverName}
                onChange={(e) => this.handleInputChange(server.id, 'serverName', e.target.value)}
                placeholder="Enter server name"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="input-group">
              <label className="input-label">
                <div className="label-container">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ marginRight: '8px' }}>
                      <LinkIcon />
                    </div>
                    <span>Server Address</span>
                  </div>
                  <span className="label-description">URL of the Ollama server</span>
                </div>
              </label>
              <input
                type="text"
                className="input-field"
                value={server.serverAddress}
                onChange={(e) => this.handleInputChange(server.id, 'serverAddress', e.target.value)}
                placeholder="Enter server address"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="input-group">
              <label className="input-label">
                <div className="label-container">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ marginRight: '8px' }}>
                      <KeyIcon />
                    </div>
                    <span>API Key (Optional)</span>
                  </div>
                  <span className="label-description">Authentication key (if required)</span>
                </div>
              </label>
              <input
                type="password"
                className="input-field"
                value={server.apiKey}
                onChange={(e) => this.handleInputChange(server.id, 'apiKey', e.target.value)}
                placeholder="Enter API key (optional)"
              />
            </div>
          </div>

          {server.connectionStatus !== 'idle' && (
            <div className={`status-indicator status-${server.connectionStatus}`}>
              {server.connectionStatus === 'checking' && (
                <>
                  <div className="spinner" />
                  Testing connection...
                </>
              )}
              {server.connectionStatus === 'success' && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ marginRight: '8px' }}>
                    <LightningIcon />
                  </div>
                  <span>Connection successful!</span>
                </div>
              )}
              {server.connectionStatus === 'error' && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ marginRight: '8px' }}>
                    <CloseIcon />
                  </div>
                  <span>Connection failed</span>
                </div>
              )}
            </div>
          )}

          <div className="button-group">
            <button
              className="button button-secondary"
              onClick={() => this.testConnection(server.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ marginRight: '8px' }}>
                  <UpdateIcon />
                </div>
                <span>Test Connection</span>
              </div>
            </button>

            <button
              className="button button-primary"
              onClick={() => this.updateServer(server.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ marginRight: '8px' }}>
                  <LightningIcon />
                </div>
                <span>{this.state.isAddingNew ? 'Add Server' : 'Update Server'}</span>
              </div>
            </button>

            {!this.state.isAddingNew && (
              <button
                className="button button-danger"
                onClick={() => this.deleteServer(server.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ marginRight: '8px' }}>
                    <TrashIcon />
                  </div>
                  <span>Delete Server</span>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  render() {
    const { isLoading } = this.state;
    const themeClass = this.state.currentTheme === 'dark' ? 'dark-theme' : '';

    if (isLoading) {
      return (
        <div className={`theme-paper ${themeClass}`}>
          <div className="loading-spinner">
            <div className="spinner"></div>
            <span>Loading settings...</span>
          </div>
        </div>
      );
    }

    return (
      <div className={`theme-paper ${themeClass}`}>
        <div className="ollama-server-layout">
          {this.renderServerList()}
          {this.state.activeServerId && this.renderServerDetail()}
          {!this.state.activeServerId && (
            <div className="server-detail-placeholder">
              <div className="placeholder-content">
                <div style={{ marginBottom: '16px' }}>
                  <GearIcon />
                </div>
                <p>Select a server to edit or add a new server</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default ComponentOllamaServer;
export { ComponentOllamaServer };