import React from 'react';
import './ComponentOllamaServer.css';
import { GearIcon, TagIcon, LinkIcon, KeyIcon, LightningIcon, UpdateIcon, TrashIcon, CloseIcon, PlusIcon, SearchIcon, SortIcon, FilterIcon } from './icons';
import CustomDropdown from './CustomDropdown';

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

// New interfaces for model management
interface ModelInfo {
  name: string;
  tag: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: ModelDetails;
}

interface ModelDetails {
  format: string;
  family: string;
  families?: string[];
  parameter_size: string;
  quantization_level: string;
  template?: string;
  system?: string;
  license?: string;
  modelfile?: string;
  parameters?: string;
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
  existingSettingId: string | null; // ID of the existing settings instance
  
  // New state for tabbed interface and model management
  activeTab: 'servers' | 'models';
  models: ModelInfo[];
  modelsLoading: boolean;
  modelsError: string;
  sortBy: 'name' | 'size' | 'modified' | 'family' | 'parameters' | 'quantization';
  sortOrder: 'asc' | 'desc';
  selectedModelId: string | null;
  selectedModel: ModelInfo | null;
  expandedModelId: string | null;
}

class ComponentOllamaServer extends React.Component<OllamaServerComponentProps, OllamaServerComponentState> {
  private themeChangeListener: ((theme: string) => void) | null = null;

  constructor(props: OllamaServerComponentProps) {
    super(props);
    this.state = {
      servers: [],
      isLoading: true,
      isSaving: false,
      errorMessage: '',
      currentTheme: 'light', // Default theme
      activeServerId: null,
      isAddingNew: false,
      existingSettingId: null,
      
      // New state initialization
      activeTab: 'servers',
      models: [],
      modelsLoading: false,
      modelsError: '',
      sortBy: 'name',
      sortOrder: 'asc',
      selectedModelId: null,
      selectedModel: null,
      expandedModelId: null
    };
  }

  componentDidMount() {
    this.loadSettings();
    this.initializeThemeService();
  }

  componentWillUnmount() {
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
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
    this.setState({ isLoading: true, errorMessage: '' });
    
    if (!this.props.services?.api) {
      this.setState({ 
        isLoading: false, 
        errorMessage: 'API service not available' 
      });
      return;
    }

    try {
      const response = await this.props.services.api.get('/api/v1/settings/instances', {
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
        
        // Ensure servers is an array and each server has a connectionStatus
        const servers: ServerConfig[] = [];
        
        if (Array.isArray(parsedValue.servers)) {
          for (const server of parsedValue.servers) {
            // Ensure connectionStatus is one of the allowed values
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
          errorMessage: '',
          existingSettingId: settingsData.id
        });
      } else {
        // No existing settings, initialize with empty array
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
    if (!this.props.services?.api) {
      this.setState({ errorMessage: 'API service not available' });
      return;
    }

    this.setState({ isSaving: true, errorMessage: '' });

    // Create a properly typed array of server configs
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

    // Include the existing setting ID if it exists
    if (this.state.existingSettingId) {
      (settingsData as any).id = this.state.existingSettingId;
    }

    try {
      const response = await this.props.services.api.post('/api/v1/settings/instances', settingsData);
      
      this.setState({ 
        isSaving: false,
        errorMessage: '',
        isAddingNew: false,
        activeServerId: null,
        existingSettingId: response?.id || this.state.existingSettingId
      });
      
      alert(this.state.existingSettingId ? 'Settings updated successfully!' : 'Settings saved successfully!');
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

  // Model Management Methods
  setActiveTab = (tab: 'servers' | 'models') => {
    this.setState({ activeTab: tab }, () => {
      // Auto-refresh models when switching to models tab
      if (tab === 'models' && this.state.activeServerId) {
        this.loadModels(this.state.activeServerId);
      }
    });
  };

  loadModels = async (serverId: string) => {
    const server = this.state.servers.find(s => s.id === serverId);
    if (!server) {
      this.setState({ modelsError: 'Server not found' });
      return;
    }

    this.setState({ modelsLoading: true, modelsError: '' });

    if (!this.props.services?.api) {
      this.setState({ 
        modelsLoading: false, 
        modelsError: 'API service not available' 
      });
      return;
    }

    try {
      const encodedUrl = encodeURIComponent(server.serverAddress);
      const params: Record<string, string> = { server_url: encodedUrl };
      
      if (server.apiKey) {
        params.api_key = server.apiKey;
      }
      
      const response = await this.props.services.api.get('/api/v1/ollama/models', { params });
      
      if (response && Array.isArray(response)) {
        this.setState({
          models: response,
          modelsLoading: false,
          modelsError: ''
        });
      } else {
        this.setState({
          models: [],
          modelsLoading: false,
          modelsError: 'Invalid response format from server'
        });
      }
    } catch (error: any) {
      this.setState({
        models: [],
        modelsLoading: false,
        modelsError: `Error loading models: ${error.message || 'Unknown error'}`
      });
    }
  };

  handleSortChange = (sortBy: 'name' | 'size' | 'modified' | 'family' | 'parameters' | 'quantization') => {
    this.setState(prevState => ({
      sortBy,
      sortOrder: prevState.sortBy === sortBy && prevState.sortOrder === 'asc' ? 'desc' : 'asc'
    }));
  };

  getSortedModels = () => {
    const { models, sortBy, sortOrder } = this.state;
    
    // Sort models
    const sortedModels = [...models].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;
      
      switch (sortBy) {
        case 'name':
          aValue = (a.name || '').toLowerCase();
          bValue = (b.name || '').toLowerCase();
          break;
        case 'size':
          aValue = a.size || 0;
          bValue = b.size || 0;
          break;
        case 'modified':
          aValue = new Date(a.modified_at || 0).getTime();
          bValue = new Date(b.modified_at || 0).getTime();
          break;
        case 'family':
          aValue = (a.details?.family || '').toLowerCase();
          bValue = (b.details?.family || '').toLowerCase();
          break;
        case 'parameters':
          aValue = (a.details?.parameter_size || '').toLowerCase();
          bValue = (b.details?.parameter_size || '').toLowerCase();
          break;
        case 'quantization':
          aValue = (a.details?.quantization_level || '').toLowerCase();
          bValue = (b.details?.quantization_level || '').toLowerCase();
          break;
        default:
          aValue = (a.name || '').toLowerCase();
          bValue = (b.name || '').toLowerCase();
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
    
    return sortedModels;
  };

  formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  handleModelSelection = (modelId: string) => {
    const selectedModel = this.state.models.find(model => 
      `${model.name}-${model.tag}` === modelId
    );
    
    this.setState({
      selectedModelId: modelId,
      selectedModel: selectedModel || null,
      expandedModelId: null // Clear expansion when selecting from dropdown
    });
  };

  handleModelRowClick = (modelId: string) => {
    this.setState(prevState => ({
      expandedModelId: prevState.expandedModelId === modelId ? null : modelId
    }));
  };

  handleModelAction = (action: 'copy' | 'delete', modelId: string) => {
    const model = this.state.models.find(m => `${m.name}-${m.tag}` === modelId);
    if (!model) return;

    switch (action) {
      case 'copy':
        // TODO: Implement model copying
        console.log('Copy model:', model.name);
        break;
      case 'delete':
        if (window.confirm(`Are you sure you want to delete "${model.name}"?`)) {
          // TODO: Implement model deletion
          console.log('Delete model:', model.name);
        }
        break;
    }
  };

  getDropdownOptions = () => {
    const sortedModels = this.getSortedModels();
    
    // Convert to dropdown options with size and parameters as secondary text
    return sortedModels.map(model => ({
      id: `${model.name}-${model.tag}`,
      primaryText: model.name,
      secondaryText: `${this.formatFileSize(model.size)}${model.details?.parameter_size ? ` • ${model.details.parameter_size}` : ''}`
    }));
  };

  renderModelsTable = () => {
    const { selectedModelId, expandedModelId } = this.state;
    const sortedModels = this.getSortedModels();
    
    // Filter to selected model if one is selected
    const displayModels = selectedModelId 
      ? sortedModels.filter(model => `${model.name}-${model.tag}` === selectedModelId)
      : sortedModels;

    if (displayModels.length === 0) {
      return (
        <div className="models-table-empty">
          <p>No models found on this server</p>
        </div>
      );
    }

    return (
      <div className="models-table-container">
        <table className="models-table">
          <thead>
            <tr>
              <th 
                className={`sortable-header ${this.state.sortBy === 'name' ? 'active' : ''}`}
                onClick={() => this.handleSortChange('name')}
              >
                Name
                {this.state.sortBy === 'name' && (
                  <span className="sort-indicator">
                    {this.state.sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
              <th 
                className={`sortable-header ${this.state.sortBy === 'size' ? 'active' : ''}`}
                onClick={() => this.handleSortChange('size')}
              >
                Size
                {this.state.sortBy === 'size' && (
                  <span className="sort-indicator">
                    {this.state.sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
              <th 
                className={`sortable-header ${this.state.sortBy === 'modified' ? 'active' : ''}`}
                onClick={() => this.handleSortChange('modified')}
              >
                Modified
                {this.state.sortBy === 'modified' && (
                  <span className="sort-indicator">
                    {this.state.sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
              <th 
                className={`sortable-header ${this.state.sortBy === 'family' ? 'active' : ''}`}
                onClick={() => this.handleSortChange('family')}
              >
                Family
                {this.state.sortBy === 'family' && (
                  <span className="sort-indicator">
                    {this.state.sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
              <th 
                className={`sortable-header ${this.state.sortBy === 'parameters' ? 'active' : ''}`}
                onClick={() => this.handleSortChange('parameters')}
              >
                Parameters
                {this.state.sortBy === 'parameters' && (
                  <span className="sort-indicator">
                    {this.state.sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
              <th 
                className={`sortable-header ${this.state.sortBy === 'quantization' ? 'active' : ''}`}
                onClick={() => this.handleSortChange('quantization')}
              >
                Quantization
                {this.state.sortBy === 'quantization' && (
                  <span className="sort-indicator">
                    {this.state.sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayModels.map((model) => {
              const modelId = `${model.name}-${model.tag}`;
              const isExpanded = expandedModelId === modelId;
              
              return (
                <React.Fragment key={modelId}>
                  <tr 
                    className={`model-row ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => this.handleModelRowClick(modelId)}
                  >
                    <td className="model-name-cell">
                      <div className="model-name-content">
                        <span className="model-name">{model.name}</span>
                        <span className="model-tag">{model.tag}</span>
                      </div>
                    </td>
                    <td>{this.formatFileSize(model.size)}</td>
                    <td>{this.formatDate(model.modified_at)}</td>
                    <td>{model.details?.family || '-'}</td>
                    <td>{model.details?.parameter_size || '-'}</td>
                    <td>{model.details?.quantization_level || '-'}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="model-actions-row">
                      <td colSpan={6}>
                        <div className="model-actions">
                          <div className="model-actions-info">
                            <div className="action-info-item">
                              <span className="label">License:</span>
                              <span className="value">{model.details?.license || 'Not specified'}</span>
                            </div>
                            {model.details?.template && (
                              <div className="action-info-item">
                                <span className="label">Template:</span>
                                <span className="value template-preview">{model.details.template.substring(0, 100)}...</span>
                              </div>
                            )}
                          </div>
                          <div className="model-actions-buttons">
                            <button
                              className="button button-secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                this.handleModelAction('copy', modelId);
                              }}
                            >
                              <TagIcon />
                              <span>Copy Model</span>
                            </button>
                            <button
                              className="button button-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                this.handleModelAction('delete', modelId);
                              }}
                            >
                              <TrashIcon />
                              <span>Delete Model</span>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
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

  renderModelManagement() {
    const { servers, activeServerId, models, modelsLoading, modelsError, selectedModelId } = this.state;
    
    if (!activeServerId) {
      return (
        <div className="model-management">
          <div className="model-management-placeholder">
            <div className="placeholder-content">
              <div style={{ marginBottom: '16px' }}>
                <TagIcon />
              </div>
              <p>Select a server to view and manage its models</p>
            </div>
          </div>
        </div>
      );
    }

    const server = servers.find(s => s.id === activeServerId);
    if (!server) return null;

    const dropdownOptions = this.getDropdownOptions();

    return (
      <div className="model-management">
        <div className="model-management-header">
          <h3>{server.serverName}</h3>
        </div>

        {modelsError && (
          <div className="form-section">
            <div className="status-indicator status-error">
              {modelsError}
            </div>
          </div>
        )}

        <div className="model-selection-section">
          <div className="model-controls">
            <div className="model-dropdown-container">
              <label className="input-label">
                {selectedModelId ? 'Selected Model' : 'Filter Models'}
              </label>
              <CustomDropdown
                options={dropdownOptions}
                selectedId={selectedModelId || ''}
                onChange={this.handleModelSelection}
                placeholder="Select a model"
                disabled={modelsLoading || models.length === 0}
                ariaLabel="Select Ollama model"
              />
            </div>
            <div className="model-controls-buttons">
              {selectedModelId && (
                <button
                  className="button button-secondary"
                  onClick={() => this.setState({ selectedModelId: null, expandedModelId: null })}
                >
                  <CloseIcon />
                  <span>Clear Filter</span>
                </button>
              )}
              <button
                className="button button-secondary"
                onClick={() => this.loadModels(server.id)}
                disabled={modelsLoading}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ marginRight: '8px' }}>
                    <UpdateIcon />
                  </div>
                  <span>{modelsLoading ? 'Loading...' : 'Refresh Models'}</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="models-table-section">
          {modelsLoading ? (
            <div className="loading-spinner">
              <div className="spinner" />
              <span>Loading models...</span>
            </div>
          ) : (
            this.renderModelsTable()
          )}
        </div>
      </div>
    );
  }

  renderTabs() {
    const { activeTab } = this.state;
    
    return (
      <div className="tabs-container">
        <div className="tabs-header">
          <button
            className={`tab-button ${activeTab === 'servers' ? 'active' : ''}`}
            onClick={() => this.setActiveTab('servers')}
          >
            <GearIcon />
            <span>Server Settings</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => this.setActiveTab('models')}
          >
            <TagIcon />
            <span>Model Management</span>
          </button>
        </div>
        
        <div className="tab-content">
          {activeTab === 'servers' && (
            <div className="server-management">
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
          )}
          
          {activeTab === 'models' && this.renderModelManagement()}
        </div>
      </div>
    );
  }

  render() {
    const { isLoading } = this.state;
    const themeClass = this.state.currentTheme === 'dark' ? 'dark-theme' : '';

    if (isLoading) {
      return (
        <div className={`ollama-container ${themeClass}`}>
          <div className="ollama-paper">
            <div className="loading-spinner">
              <div className="spinner" />
              <span>Loading settings...</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`ollama-container ${themeClass}`}>
        <div className="ollama-paper">
          <div className="ollama-server-layout">
            {this.renderTabs()}
          </div>
        </div>
      </div>
    );
  }
}

export default ComponentOllamaServer;
