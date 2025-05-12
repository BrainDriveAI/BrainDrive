import React from 'react';
import './ComponentModelSelection.css';
import CustomDropdown from './CustomDropdown';

// Define model interfaces
interface ModelInfo {
  name: string;
  provider: string;
  providerId: string;
  serverName: string;
  serverId: string;
}

interface ServerInfo {
  id: string;
  serverName: string;
  serverAddress: string;
  apiKey?: string;
}

interface ProviderSettings {
  id: string;
  name: string;
  servers: ServerInfo[];
}

// Define the component props
interface ComponentModelSelectionProps {
  moduleId?: string;
  label?: string;
  labelPosition?: 'top' | 'left' | 'right' | 'bottom';
  providerSettings?: string[];
  targetComponent?: string;
  services?: {
    api?: {
      get: (url: string, options?: any) => Promise<any>;
      post: (url: string, data: any) => Promise<any>;
    };
    settings?: {
      getSetting: (id: string) => Promise<any>;
      setSetting: (id: string, value: any) => Promise<any>;
      getSettingDefinitions: () => Promise<any>;
    };
    event?: {
      sendMessage: (target: string, message: any, options?: any) => void;
      subscribeToMessages: (target: string, callback: (message: any) => void) => void;
      unsubscribeFromMessages: (target: string, callback: (message: any) => void) => void;
    };
    theme?: {
      getCurrentTheme: () => string;
      addThemeChangeListener: (callback: (theme: string) => void) => void;
      removeThemeChangeListener: (callback: (theme: string) => void) => void;
    };
  };
}

// Define the component state
interface ComponentModelSelectionState {
  models: ModelInfo[];
  selectedModel: ModelInfo | null;
  isLoading: boolean;
  error: string | null;
  currentTheme: 'light' | 'dark';
  providerSettingsData: ProviderSettings[];
  pendingModelSelection: {
    name: string;
    provider: string;
    serverId: string;
  } | null;
}

class ComponentModelSelection extends React.Component<ComponentModelSelectionProps, ComponentModelSelectionState> {
  private eventService: any;
  private themeChangeListener: ((theme: string) => void) | null = null;
  private conversationModelListener: ((content: any) => void) | null = null;
  
  constructor(props: ComponentModelSelectionProps) {
    super(props);
    
    this.state = {
      models: [],
      selectedModel: null,
      isLoading: true,
      error: null,
      currentTheme: 'light',
      providerSettingsData: [],
      pendingModelSelection: null
    };
    
    // Initialize event service
    if (props.services?.event) {
      const { createEventService } = require('./services/eventService');
      this.eventService = createEventService('pluginA', props.moduleId || 'model-selection-v2');
      this.eventService.setServiceBridge(props.services.event);
    }
  }
  
  componentDidMount() {
    this.initializeThemeService();
    this.loadProviderSettings();
    this.initializeEventListeners();
  }
  
  componentWillUnmount() {
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
    
    if (this.conversationModelListener && this.props.services?.event) {
      this.props.services.event.unsubscribeFromMessages(
        'model-selection-v2',
        this.conversationModelListener
      );
    }
  }
  
  /**
   * Initialize event listeners for conversation model selection
   */
  initializeEventListeners() {
    if (this.props.services?.event) {
      try {
        // Set up conversation model selection listener
        this.conversationModelListener = (message: any) => {
          console.log('Received model selection from conversation:', message);
          
          // Extract model from the message content
          const modelInfo = message.content?.model;
          
          if (modelInfo) {
            // First try to find the exact model by ID
            const modelId = `${modelInfo.provider}_${modelInfo.serverId}_${modelInfo.name}`;
            let matchingModel = this.state.models.find(model =>
              `${model.provider}_${model.serverId}_${model.name}` === modelId
            );
            
            // If exact match not found, try to find by name only
            if (!matchingModel) {
              console.log('Exact model match not found, trying to find by name:', modelInfo.name);
              matchingModel = this.state.models.find(model => model.name === modelInfo.name);
            }
            
            // If model is found and different from current selection, update it
            if (matchingModel &&
                (!this.state.selectedModel ||
                 this.state.selectedModel.name !== matchingModel.name)) {
              this.setState({
                selectedModel: matchingModel,
                pendingModelSelection: null // Clear any pending selection
              });
              console.log('Updated model selection from conversation event:', matchingModel.name);
            } else if (!matchingModel) {
              console.log('Model from conversation not found in available models:', modelId);
              console.log('Available models:', this.state.models.map(m => `${m.provider}_${m.serverId}_${m.name}`));
              
              // Store the model info for later selection when models are loaded
              this.setState({
                pendingModelSelection: {
                  name: modelInfo.name,
                  provider: modelInfo.provider,
                  serverId: modelInfo.serverId
                }
              });
              console.log('Saved pending model selection for later:', modelInfo.name);
            }
          }
        };
        
        // Subscribe to model selection events from conversation history
        this.props.services.event.subscribeToMessages(
          'model-selection-v2',
          this.conversationModelListener
        );
        
        console.log('Subscribed to model selection events from conversation history');
      } catch (error) {
        console.error('Error initializing event listeners:', error);
      }
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
        this.setState({ currentTheme: currentTheme as 'light' | 'dark' });
        
        // Set up theme change listener
        this.themeChangeListener = (newTheme: string) => {
          this.setState({ currentTheme: newTheme as 'light' | 'dark' });
        };
        
        // Add the listener to the theme service
        this.props.services.theme.addThemeChangeListener(this.themeChangeListener);
      } catch (error) {
        console.error('Error initializing theme service:', error);
      }
    }
  }
  
  /**
   * Load provider settings based on configuration
   */
  loadProviderSettings = async () => {
    this.setState({ isLoading: true, error: null });
    
    if (!this.props.services?.api) {
      this.setState({ 
        isLoading: false, 
        error: 'API service not available' 
      });
      return;
    }
    
    try {
      // Get provider settings from configuration or use default
      const providerSettingIds = this.props.providerSettings || ['ollama_servers_settings'];
      const providerSettingsData: ProviderSettings[] = [];
      
      // Load each provider setting
      for (const settingId of providerSettingIds) {
        try {
          const response = await this.props.services.api.get('/api/v1/settings/instances', {
            params: {
              definition_id: settingId,
              scope: 'user',
              user_id: 'current'
            }
          });
          
          // Process response to extract settings data
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
            // Parse the value field
            let parsedValue = typeof settingsData.value === 'string' 
              ? JSON.parse(settingsData.value) 
              : settingsData.value;
            
            // Add to provider settings data
            providerSettingsData.push({
              id: settingId,
              name: settingsData.name || settingId,
              servers: Array.isArray(parsedValue.servers) ? parsedValue.servers : []
            });
          }
        } catch (error) {
          console.error(`Error loading provider setting ${settingId}:`, error);
        }
      }
      
      this.setState({ 
        providerSettingsData,
        isLoading: false
      }, () => {
        // Load models after settings are loaded
        this.loadModels();
      });
    } catch (error: any) {
      console.error("Error loading provider settings:", error);
      
      this.setState({
        isLoading: false,
        error: `Error loading provider settings: ${error.message || 'Unknown error'}`
      });
    }
  };
  
  /**
   * Load models from all configured providers
   */
  loadModels = async () => {
    this.setState({ isLoading: true, error: null });
    
    if (!this.props.services?.api) {
      this.setState({ 
        isLoading: false, 
        error: 'API service not available' 
      });
      return;
    }
    
    try {
      const models: ModelInfo[] = [];
      const { providerSettingsData } = this.state;
      
      // Process each provider setting
      for (const providerSetting of providerSettingsData) {
        // Determine provider type from setting ID
        const providerType = providerSetting.id.includes('ollama') ? 'ollama' : 
                            providerSetting.id.includes('openai') ? 'openai' : 
                            'unknown';
        
        // Process each server in the provider setting
        for (const server of providerSetting.servers) {
          try {
            let serverModels: any[] = [];
            
            // Fetch models based on provider type
            if (providerType === 'ollama') {
              // Encode the server URL
              const encodedUrl = encodeURIComponent(server.serverAddress);
              
              // Build query parameters
              const params: Record<string, string> = { 
                server_url: encodedUrl,
                settings_id: providerSetting.id,
                server_id: server.id
              };
              
              // Add API key if provided
              if (server.apiKey) {
                params.api_key = server.apiKey;
              }
              
              // Fetch models from the backend
              const response = await this.props.services.api.get('/api/v1/ollama/models', { params });
              serverModels = Array.isArray(response) ? response : [];
            } else if (providerType === 'openai') {
              // Fetch OpenAI models
              const response = await this.props.services.api.get('/api/v1/ai/models', { 
                params: {
                  provider: 'openai',
                  settings_id: providerSetting.id,
                  server_id: server.id
                }
              });
              
              serverModels = response?.models || [];
            }
            
            // Map server models to ModelInfo format
            for (const model of serverModels) {
              models.push({
                name: model.name,
                provider: providerType,
                providerId: providerSetting.id,
                serverName: server.serverName,
                serverId: server.id
              });
            }
          } catch (error) {
            console.error(`Error loading models for server ${server.serverName}:`, error);
          }
        }
      }
      
      // Check if we have a pending model selection
      const { pendingModelSelection } = this.state;
      let modelToSelect = models.length > 0 ? models[0] : null;
      
      if (pendingModelSelection && models.length > 0) {
        console.log('Checking for pending model selection:', pendingModelSelection.name);
        
        // First try to find an exact match
        let matchingModel = models.find(model =>
          model.name === pendingModelSelection.name &&
          model.provider === pendingModelSelection.provider &&
          model.serverId === pendingModelSelection.serverId
        );
        
        // If not found, try to match by name only
        if (!matchingModel) {
          matchingModel = models.find(model => model.name === pendingModelSelection.name);
        }
        
        if (matchingModel) {
          console.log('Found pending model in available models:', matchingModel.name);
          modelToSelect = matchingModel;
        } else {
          console.log('Pending model still not found in available models:', pendingModelSelection.name);
        }
      }
      
      // Update state with models
      this.setState({
        models,
        isLoading: false,
        selectedModel: modelToSelect,
        pendingModelSelection: modelToSelect ? null : pendingModelSelection // Clear pending selection if found
      });
      
      // Broadcast initial model selection if available
      if (modelToSelect) {
        this.broadcastModelSelection(modelToSelect);
      }
    } catch (error) {
      console.error('Error loading models:', error);
      this.setState({ 
        isLoading: false, 
        error: 'Error loading models' 
      });
    }
  };
  
  /**
   * Handle model selection change
   */
  handleModelChange = (modelId: string) => {
    const selectedModel = this.state.models.find(model => 
      `${model.provider}_${model.serverId}_${model.name}` === modelId
    );
    
    if (selectedModel) {
      this.setState({ selectedModel }, () => {
        this.broadcastModelSelection(selectedModel);
      });
    }
  };
  
  /**
   * Broadcast model selection event
   */
  broadcastModelSelection = (model: ModelInfo) => {
    if (!this.eventService && !this.props.services?.event) {
      console.error('Event service not available');
      return;
    }
    
    // Create model selection message
    const modelInfo = {
      type: 'model.selection',
      content: {
        model: {
          name: model.name,
          provider: model.provider,
          providerId: model.providerId,
          serverName: model.serverName,
          serverId: model.serverId
        },
        timestamp: new Date().toISOString()
      }
    };
    
    // Send to target component or broadcast to all
    const target = this.props.targetComponent || 'ai-prompt-chat';
    
    // Log the target and message for debugging
    console.log(`Sending model selection to target: ${target}`, modelInfo);
    
    // Send via both methods to ensure delivery
    // The receiving component will handle deduplication
    if (this.props.services?.event) {
      this.props.services.event.sendMessage(target, modelInfo.content);
      console.log('Model selection sent via services.event');
    }
    
    if (this.eventService) {
      this.eventService.sendMessage(target, modelInfo, { remote: true });
      console.log('Model selection sent via eventService');
    }
  };
  
  /**
   * Render the component
   */
  render() {
    const { models, selectedModel, isLoading, error, currentTheme } = this.state;
    const { label = 'Select Model', labelPosition = 'top' } = this.props;
    
    // Determine layout based on position
    const isHorizontal = labelPosition === 'top' || labelPosition === 'bottom';
    const layoutClass = isHorizontal ? 'horizontal' : 'vertical';
    
    // Adjust order based on position
    const labelOrder = labelPosition === 'bottom' || labelPosition === 'right' ? 2 : 1;
    const dropdownOrder = labelPosition === 'bottom' || labelPosition === 'right' ? 1 : 2;
    
    // Create a unique ID for each model
    const getModelId = (model: ModelInfo) => `${model.provider}_${model.serverId}_${model.name}`;
    
    // Convert models to dropdown options
    const dropdownOptions = models.map(model => ({
      id: getModelId(model),
      primaryText: model.name,
      secondaryText: model.serverName
    }));
    
    return (
      <div className={`model-selection-container ${currentTheme === 'dark' ? 'dark-theme' : ''}`}>
        <div className={`model-selection-layout ${layoutClass}`}>
          <label 
            htmlFor="model-select" 
            className="model-selection-label"
            style={{ order: labelOrder }}
          >
            {label}
          </label>
          
          <div className="model-selection-dropdown" style={{ order: dropdownOrder }}>
            {isLoading ? (
              <div className="model-selection-loading"></div>
            ) : error ? (
              <div className="model-selection-error">{error}</div>
            ) : (
              <CustomDropdown
                options={dropdownOptions}
                selectedId={selectedModel ? getModelId(selectedModel) : ''}
                onChange={this.handleModelChange}
                placeholder="Select a model"
                disabled={models.length === 0}
                ariaLabel="Select AI model"
              />
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ComponentModelSelection;
