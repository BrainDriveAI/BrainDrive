import React from 'react';
import './ComponentTheme.css';
import { THEME_SETTINGS, LOCAL_STORAGE_KEYS } from './settings-constants';
import { GearIcon, MoonIcon, SunIcon, ComputerIcon } from './icons';

/**
 * Interface for the Theme service functionality required by this plugin.
 * This keeps the plugin decoupled from the actual service implementation.
 */
interface ThemeServiceBridge {
  getCurrentTheme: () => string;
  setTheme: (theme: string) => void;
  toggleTheme: () => void;
  addThemeChangeListener: (callback: (theme: string) => void) => void;
  removeThemeChangeListener: (callback: (theme: string) => void) => void;
}

/**
 * Enhanced interface for the Settings service functionality required by this plugin.
 * This keeps the plugin decoupled from the actual service implementation.
 */
interface SettingsServiceBridge {
  // Basic operations
  getSetting: (name: string, context?: { userId?: string; pageId?: string }) => Promise<any>;
  setSetting: (name: string, value: any, context?: { userId?: string; pageId?: string }) => Promise<void>;
  
  // Definition management
  registerSettingDefinition?: (definition: any) => Promise<void>;
  getSettingDefinitions?: (filter?: { category?: string; tags?: string[] }) => Promise<any[]>;
  
  // Subscription methods
  subscribe?: (key: string, callback: (value: any) => void) => () => void;
  subscribeToCategory?: (category: string, callback: (value: any) => void) => () => void;
}

interface ComponentThemeProps {
  pluginId?: string;
  moduleId?: string;
  instanceId?: string;
  services?: {
    theme?: ThemeServiceBridge;
    settings?: SettingsServiceBridge;
    api?: any;
  };
}

interface ComponentThemeState {
  currentTheme: string;
  useSystemTheme: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * ComponentTheme - A component that allows users to toggle between light and dark themes
 * and saves their preferences using the settings service.
 */
class ComponentTheme extends React.Component<ComponentThemeProps, ComponentThemeState> {
  private themeChangeListener: ((theme: string) => void) | null = null;
  private settingUnsubscribe: (() => void) | null = null;
  private categoryUnsubscribe: (() => void) | null = null;
  
  constructor(props: ComponentThemeProps) {
    super(props);
    
    // Debug the props received
    console.log('ComponentTheme constructor - props received:', {
      pluginId: props.pluginId,
      moduleId: props.moduleId,
      instanceId: props.instanceId,
      hasServices: !!props.services,
      hasThemeService: props.services?.theme ? 'YES' : 'NO',
      hasSettingsService: props.services?.settings ? 'YES' : 'NO'
    });
    
    this.state = {
      currentTheme: 'light', // Default theme
      useSystemTheme: false,
      isLoading: true,
      error: null
    };
    
    // Bind methods
    this.handleToggleTheme = this.handleToggleTheme.bind(this);
    this.saveThemePreference = this.saveThemePreference.bind(this);
    this.loadThemePreference = this.loadThemePreference.bind(this);
  }
  
  async componentDidMount() {
    console.log('ComponentTheme componentDidMount - initializing...');
    
    // Stage 1: Register setting definition
    const definitionRegistered = await this.registerThemeSettingDefinition();
    
    // Stage 2: Initialize theme service
    this.initializeThemeService();
    
    // Stage 3: Load settings (with fallbacks)
    await this.loadThemePreference();
    
    // Stage 4: Set up subscriptions
    if (definitionRegistered) {
      this.subscribeToThemeSettings();
    }
  }
  
  /**
   * Register the theme setting definition
   */
  async registerThemeSettingDefinition() {
    // If settings service is not available, return false but don't block the component
    if (!this.props.services?.settings) {
      console.warn('Settings service not available');
      return false;
    }
    
    try {
      // If registerSettingDefinition is not available, we can still proceed
      // The backend may already have the definition registered
      if (!this.props.services.settings.registerSettingDefinition) {
        console.warn('registerSettingDefinition method not available, assuming definition exists');
        return true;
      }
      
      // Check if definition already exists
      if (this.props.services.settings.getSettingDefinitions) {
        try {
          const definitions = await this.props.services.settings.getSettingDefinitions({
            category: THEME_SETTINGS.CATEGORY
          });
          
          if (definitions && Array.isArray(definitions)) {
            const exists = definitions.some(def => def.id === THEME_SETTINGS.DEFINITION_ID);
            
            if (exists) {
              console.log('Theme setting definition already exists');
              return true;
            }
          }
        } catch (error) {
          console.warn('Error checking existing definitions, will attempt to register anyway:', error);
        }
      }
      
      // Register the definition
      await this.props.services.settings.registerSettingDefinition({
        id: THEME_SETTINGS.DEFINITION_ID,
        name: THEME_SETTINGS.NAME,
        description: 'Settings for theme appearance and behavior',
        category: THEME_SETTINGS.CATEGORY,
        type: 'object',
        default: THEME_SETTINGS.DEFAULT_VALUE,
        allowedScopes: ['user', 'system'],
        validation: {
          required: true
        },
        isMultiple: false,
        tags: THEME_SETTINGS.TAGS
      });
      
      console.log('Theme setting definition registered successfully');
      return true;
    } catch (error) {
      console.error('Error registering theme setting definition:', error);
      // Don't block the component if registration fails
      return true;
    }
  }
  
  /**
   * Initialize the theme service
   */
  initializeThemeService() {
    if (this.props.services?.theme) {
      try {
        console.log('Initializing theme service...');
        const theme = this.props.services.theme.getCurrentTheme();
        console.log('Current theme retrieved:', theme);
        this.setState({ currentTheme: theme });
        
        // Subscribe to theme changes
        this.themeChangeListener = (newTheme: string) => {
          console.log('Theme changed to:', newTheme);
          this.setState({ currentTheme: newTheme });
        };
        
        console.log('Adding theme change listener...');
        this.props.services.theme.addThemeChangeListener(this.themeChangeListener);
        console.log('Theme service initialized successfully');
      } catch (error) {
        console.error('Error initializing theme service:', error);
        this.setState({ error: 'Failed to initialize theme service' });
      }
    } else {
      console.warn('Theme service not available');
      this.setState({ error: 'Theme service not available' });
    }
  }
  
  /**
   * Subscribe to theme setting changes
   */
  subscribeToThemeSettings() {
    if (!this.props.services?.settings || 
        !this.props.services.settings.subscribe || 
        !this.props.services.settings.subscribeToCategory) {
      console.warn('Settings service not available for subscription or missing subscription methods');
      return;
    }
    
    // Subscribe to the specific setting
    const settingUnsubscribe = this.props.services.settings.subscribe(
      THEME_SETTINGS.DEFINITION_ID,
      this.handleThemeSettingChange
    );
    
    // Also subscribe to the category for broader changes
    const categoryUnsubscribe = this.props.services.settings.subscribeToCategory(
      THEME_SETTINGS.CATEGORY,
      this.handleCategoryChange
    );
    
    // Store unsubscribe functions for cleanup
    this.settingUnsubscribe = settingUnsubscribe;
    this.categoryUnsubscribe = categoryUnsubscribe;
    
    console.log('Subscribed to theme settings changes');
  }
  
  /**
   * Handle theme setting change from subscription
   */
  handleThemeSettingChange = (value: any) => {
    console.log('Theme setting changed:', value);
    if (value && value.theme && this.props.services?.theme) {
      // Apply the new theme
      this.props.services.theme.setTheme(value.theme);
      this.setState({ 
        currentTheme: value.theme,
        useSystemTheme: value.useSystemTheme || false
      });
    }
  }
  
  /**
   * Handle category change from subscription
   */
  handleCategoryChange = (categorySettings: any) => {
    console.log('Appearance category settings changed:', categorySettings);
    // Handle broader category changes if needed
  }
  
  componentWillUnmount() {
    // Clean up theme listener
    if (this.props.services?.theme && this.themeChangeListener) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
    
    // Clean up settings subscriptions
    if (this.settingUnsubscribe) {
      this.settingUnsubscribe();
    }
    
    if (this.categoryUnsubscribe) {
      this.categoryUnsubscribe();
    }
  }
  
  /**
   * Handle theme toggle
   */
  handleToggleTheme() {
    if (!this.props.services?.theme) {
      console.error('Theme service not available');
      this.setState({ error: 'Theme service not available' });
      return;
    }
    
    try {
      // Toggle the theme
      this.props.services.theme.toggleTheme();
      
      // Save the new theme preference
      const newTheme = this.props.services.theme.getCurrentTheme();
      this.saveThemePreference(newTheme);
    } catch (error) {
      console.error('Error toggling theme:', error);
      this.setState({ error: 'Failed to toggle theme' });
    }
  }
  
  /**
   * Handle system theme toggle
   */
  handleToggleSystemTheme = () => {
    if (!this.props.services?.settings) {
      console.warn('Settings service not available');
      this.setState({ error: 'Settings service not available' });
      return;
    }
    
    const newUseSystemTheme = !this.state.useSystemTheme;
    
    try {
      // Update state
      this.setState({ useSystemTheme: newUseSystemTheme });
      
      // Save the updated preference
      const settings = {
        theme: this.state.currentTheme,
        useSystemTheme: newUseSystemTheme
      };
      
      // Use the enhanced SettingsService with context
      this.props.services.settings.setSetting(
        THEME_SETTINGS.DEFINITION_ID,
        settings,
        { userId: 'current' } // Save to user scope
      );
      
      // If enabling system theme, apply it immediately
      if (newUseSystemTheme && this.props.services?.theme) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const systemTheme = prefersDark ? 'dark' : 'light';
        this.props.services.theme.setTheme(systemTheme);
      }
    } catch (error) {
      console.error('Error toggling system theme:', error);
      this.setState({ error: 'Failed to toggle system theme' });
    }
  }
  
  /**
   * Get theme settings from the settings service
   */
  async getThemeSettings() {
    if (!this.props.services?.settings) {
      console.warn('Settings service not available');
      return this.getLocalThemePreference();
    }
    
    try {
      // Check if we can use the API service directly (preferred)
      if (this.props.services.api) {
        try {
          const response = await this.props.services.api.get('/api/v1/settings/instances', {
            params: {
              definition_id: THEME_SETTINGS.DEFINITION_ID,
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
          
          if (settingsData) {
            console.log('Theme settings found via API:', settingsData);
            
            // Parse the value if it's a string
            if (settingsData.value && typeof settingsData.value === 'string') {
              try {
                settingsData.value = JSON.parse(settingsData.value);
              } catch (parseError) {
                console.error('Error parsing settings value JSON:', parseError);
              }
            }
            
            // Add the parsed value to the result and include the ID
            return {
              ...settingsData.value,
              _id: settingsData.id
            };
          }
        } catch (apiError) {
          console.error('Error getting theme settings via API:', apiError);
          // Fall through to try the settings service
        }
      }
      
      // Try to get user-scoped setting using the settings service
      const userSettings = await this.props.services.settings.getSetting(
        THEME_SETTINGS.DEFINITION_ID,
        { userId: 'current' }
      );
      
      if (userSettings) {
        console.log('User theme settings found via settings service:', userSettings);
        
        // Parse the settings if it's a string (sometimes happens with backend responses)
        if (typeof userSettings === 'string') {
          try {
            return JSON.parse(userSettings);
          } catch (parseError) {
            console.error('Error parsing user settings JSON:', parseError);
            // Continue with the original value if parsing fails
            return userSettings;
          }
        }
        
        return userSettings;
      }
      
      // Fall back to system setting if no user setting exists
      const systemSettings = await this.props.services.settings.getSetting(
        THEME_SETTINGS.DEFINITION_ID,
        {}
      );
      
      if (systemSettings) {
        console.log('System theme settings found:', systemSettings);
        
        // Parse the settings if it's a string
        if (typeof systemSettings === 'string') {
          try {
            return JSON.parse(systemSettings);
          } catch (parseError) {
            console.error('Error parsing system settings JSON:', parseError);
            // Continue with the original value if parsing fails
            return systemSettings;
          }
        }
        
        return systemSettings;
      }
      
      // If no settings found, return default
      console.log('No theme settings found, using default');
      return THEME_SETTINGS.DEFAULT_VALUE;
    } catch (error) {
      console.error('Error getting theme settings:', error);
      return this.getLocalThemePreference();
    }
  }
  
  /**
   * Save theme settings to the settings service
   */
  async saveThemeSettings(settings: any) {
    if (!this.props.services?.settings) {
      console.warn('Settings service not available');
      return this.saveLocalThemePreference(settings);
    }
    
    try {
      // Save to user scope
      console.log('Saving theme settings:', settings);
      await this.props.services.settings.setSetting(
        THEME_SETTINGS.DEFINITION_ID,
        settings,
        { userId: 'current' }
      );
      
      console.log('Theme settings saved successfully');
      return true;
    } catch (error) {
      console.error('Error saving theme settings:', error);
      // Fall back to local storage
      return this.saveLocalThemePreference(settings);
    }
  }
  
  /**
   * Get theme preference from local storage (fallback)
   */
  getLocalThemePreference() {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEYS.THEME_PREFERENCE);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('Theme preference loaded from local storage:', parsed);
        return parsed;
      }
    } catch (error) {
      console.error('Error reading from local storage:', error);
    }
    return THEME_SETTINGS.DEFAULT_VALUE;
  }
  
  /**
   * Save theme preference to local storage (fallback)
   */
  saveLocalThemePreference(settings: any) {
    try {
      console.log('Saving theme preference to local storage:', settings);
      localStorage.setItem(
        LOCAL_STORAGE_KEYS.THEME_PREFERENCE,
        JSON.stringify(settings)
      );
      return true;
    } catch (error) {
      console.error('Error saving to local storage:', error);
      return false;
    }
  }
  
  /**
   * Save theme preference to settings service
   */
  async saveThemePreference(theme: string) {
    if (!this.props.services?.settings) {
      console.warn('Settings service not available');
      return;
    }
    
    try {
      const settings = {
        theme: theme,
        useSystemTheme: this.state.useSystemTheme
      };
      
      console.log('Saving theme preference:', settings);
      
      // Use the direct API approach similar to ComponentOllama
      if (this.props.services.api) {
        const settingsData = {
          definition_id: THEME_SETTINGS.DEFINITION_ID,
          name: THEME_SETTINGS.NAME,
          value: settings,
          scope: "user",
          user_id: "current"
        };
        
        // If we have an existing setting ID, include it to update instead of create
        const existingSettings = await this.getThemeSettings();
        if (existingSettings && existingSettings._id) {
          (settingsData as any).id = existingSettings._id;
        }
        
        await this.props.services.api.post('/api/v1/settings/instances', settingsData);
        console.log('Theme preference saved successfully');
        this.setState({ error: null });
      } else {
        // Fallback to using the settings service if API service is not available
        console.log('API service not available, using settings service');
        await this.props.services.settings.setSetting(
          THEME_SETTINGS.DEFINITION_ID, 
          settings,
          { userId: 'current' }
        );
        console.log('Theme preference saved successfully');
        this.setState({ error: null });
      }
    } catch (error) {
      console.error('Error saving theme preference:', error);
      this.setState({ error: 'Failed to save theme preference' });
    }
  }
  
  /**
   * Load theme preference from settings service
   */
  async loadThemePreference() {
    this.setState({ isLoading: true, error: null });
    
    try {
      // Get settings (with fallbacks)
      const settings = await this.getThemeSettings();
      
      if (settings && this.props.services?.theme) {
        console.log('User theme settings found:', JSON.stringify(settings));
        
        // Update state with loaded settings
        this.setState({ 
          currentTheme: settings.theme || 'light',
          useSystemTheme: settings.useSystemTheme || false,
          isLoading: false
        });
        
        // Apply the saved theme - make sure this happens after state update
        if (settings.theme) {
          console.log('Applying saved theme:', settings.theme);
          this.props.services.theme.setTheme(settings.theme);
        }
        
        // If system theme is enabled, apply it
        if (settings.useSystemTheme && this.props.services.theme) {
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          const systemTheme = prefersDark ? 'dark' : 'light';
          console.log('Applying system theme:', systemTheme);
          this.props.services.theme.setTheme(systemTheme);
        }
      } else {
        // No settings found or theme service not available
        console.log('No theme settings found or theme service not available, using defaults');
        this.setState({ isLoading: false });
        
        // Apply default theme if theme service is available
        if (this.props.services?.theme) {
          this.props.services.theme.setTheme('light');
        }
      }
    } catch (error) {
      console.error('Error loading theme preference:', error);
      this.setState({ 
        error: this.getErrorMessage(error),
        isLoading: false
      });
      
      // Apply default theme if theme service is available
      if (this.props.services?.theme) {
        this.props.services.theme.setTheme('light');
      }
    }
  }
  
  /**
   * Get user-friendly error message
   */
  getErrorMessage(error: any) {
    if (error.message && error.message.includes('network')) {
      return 'Network error: Could not connect to settings service';
    } else if (error.message && error.message.includes('permission')) {
      return 'Permission denied: You do not have access to these settings';
    } else {
      return `Error loading settings: ${error.message || 'Unknown error'}`;
    }
  }
  
  render() {
    const { currentTheme, useSystemTheme, isLoading, error } = this.state;
    
    // Show loading state
    if (isLoading) {
      return (
        <div className={`theme-paper ${currentTheme === 'dark' ? 'dark-theme' : ''}`}>
          <div className="loading-spinner">
            <div className="spinner"></div>
            <span>Loading theme settings...</span>
          </div>
        </div>
      );
    }
    
    return (
      <div className={`theme-paper ${currentTheme === 'dark' ? 'dark-theme' : ''}`}>
      
        {/* Error message if any */}
        {error && (
          <div className="error-message">
            <strong>Error: </strong>{error}
          </div>
        )}
        
        {/* Main content area */}
        <div>
          {/* Theme toggle */}
          <div className="theme-option-row">
            <div className="theme-option-icon">
              {currentTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
            </div>
            <div className="theme-option-content">
              <div className="theme-option-title">Theme</div>
              <div className="theme-option-description">Choose between light and dark mode</div>
            </div>
            <div className="theme-option-control">
              <span>{currentTheme === 'light' ? 'Light' : 'Dark'}</span>
              <label className="switch">
                <input type="checkbox" checked={currentTheme === 'dark'} onChange={this.handleToggleTheme} />
                <span className="slider round"></span>
              </label>
            </div>
          </div>
          

        </div>
      </div>
    );
  }
}

// Export both as default and named export
export { ComponentTheme };
export default ComponentTheme;
