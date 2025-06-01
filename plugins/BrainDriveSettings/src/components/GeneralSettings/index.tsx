import React from 'react';
import '../../ComponentTheme.css';
import './GeneralSettings.css';
import { GENERAL_SETTINGS } from '../../settings-constants';
import { GearIcon } from '../../icons';

interface ApiService {
  get: (url: string, options?: any) => Promise<any>;
  post: (url: string, data: any) => Promise<any>;
}

interface ThemeService {
  getCurrentTheme: () => string;
  addThemeChangeListener: (callback: (theme: string) => void) => void;
  removeThemeChangeListener: (callback: (theme: string) => void) => void;
}

interface PageInfo {
  id: string;
  name: string;
}

interface GeneralSettingsProps {
  services?: {
    api?: ApiService;
    theme?: ThemeService;
  };
}

interface GeneralSettingsState {
  pages: PageInfo[];
  selectedPage: string;
  isLoading: boolean;
  error: string | null;
  settingId: string | null;
  currentTheme: string;
}

/**
 * ComponentGeneralSettings - A component that allows users to configure general application settings
 * such as the default landing page after login.
 */
class ComponentGeneralSettings extends React.Component<GeneralSettingsProps, GeneralSettingsState> {
  private themeChangeListener: ((theme: string) => void) | null = null;

  constructor(props: GeneralSettingsProps) {
    super(props);
    
    // Debug the props received
    console.log('ComponentGeneralSettings constructor - props received:', {
      hasServices: !!props.services,
      hasApiService: props.services?.api ? 'YES' : 'NO',
      hasThemeService: props.services?.theme ? 'YES' : 'NO'
    });
    
    this.state = {
      pages: [],
      selectedPage: 'Dashboard',
      isLoading: true,
      error: null,
      settingId: null,
      currentTheme: 'light'
    };
  }

  componentDidMount() {
    console.log('ComponentGeneralSettings componentDidMount - initializing...');
    this.initializeThemeService();
    this.loadSettings();
    this.loadPages();
  }

  componentWillUnmount() {
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
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
    }
  }

  /**
   * Load available pages from the API
   */
  async loadPages() {
    if (!this.props.services?.api) {
      this.setState({ error: 'API service not available', isLoading: false });
      return;
    }
    
    try {
      console.log('Loading available pages...');
      const response = await this.props.services.api.get('/api/v1/pages', {
        params: { published_only: true }
      });
      
      const pages = Array.isArray(response?.pages) ? response.pages : response?.data?.pages;
      
      if (Array.isArray(pages)) {
        const formatted = pages.map((p: any) => ({ id: p.id, name: p.name }));
        console.log('Pages loaded successfully:', formatted);
        this.setState({ pages: formatted });
      } else {
        console.warn('No pages found or invalid response format');
      }
    } catch (error: any) {
      console.error('Error loading pages:', error);
      this.setState({ error: error.message || 'Error loading pages' });
    } finally {
      this.setState({ isLoading: false });
    }
  }

  /**
   * Load general settings from the API
   */
  async loadSettings() {
    if (!this.props.services?.api) {
      console.warn('API service not available for loading settings');
      return;
    }
    
    try {
      console.log('Loading general settings...');
      const response = await this.props.services.api.get('/api/v1/settings/instances', {
        params: {
          definition_id: GENERAL_SETTINGS.DEFINITION_ID,
          scope: 'user',
          user_id: 'current'
        }
      });
      
      let instance = null;
      
      if (Array.isArray(response) && response.length > 0) {
        instance = response[0];
      } else if (response?.data) {
        const data = Array.isArray(response.data) ? response.data[0] : response.data;
        instance = data;
      } else if (response) {
        instance = response;
      }
      
      if (instance) {
        console.log('General settings found:', instance);
        
        // Parse the value if it's a string
        const value = typeof instance.value === 'string' ? JSON.parse(instance.value) : instance.value;
        
        // Find the default page setting
        const defaultPageSetting = value?.settings?.find((s: any) => s.Setting_Name === 'default_page');
        
        if (defaultPageSetting && defaultPageSetting.Setting_Data) {
          console.log('Default page setting found:', defaultPageSetting.Setting_Data);
          this.setState({ selectedPage: defaultPageSetting.Setting_Data });
        } else {
          console.log('No default page setting found, using Dashboard');
        }
        
        // Store the setting ID for updates
        this.setState({ settingId: instance.id });
      } else {
        console.log('No general settings found, will create new on save');
      }
    } catch (error) {
      console.error('Error loading general settings:', error);
      this.setState({ error: this.getErrorMessage(error) });
    }
  }

  /**
   * Save general settings to the API
   */
  async saveSettings(newPage: string) {
    if (!this.props.services?.api) {
      console.warn('API service not available for saving settings');
      return;
    }
    
    try {
      console.log('Saving general settings, new default page:', newPage);
      
      const value = {
        settings: [
          {
            Setting_Name: 'default_page',
            Setting_Data: newPage,
            Setting_Help: 'This is the first page to be displayed after logging in to BrainDrive'
          }
        ]
      };
      
      const payload: any = {
        definition_id: GENERAL_SETTINGS.DEFINITION_ID,
        name: GENERAL_SETTINGS.NAME,
        value,
        scope: 'user',
        user_id: 'current'
      };
      
      // If we have an existing setting ID, include it to update instead of create
      if (this.state.settingId) {
        payload.id = this.state.settingId;
      }
      
      const resp = await this.props.services.api.post('/api/v1/settings/instances', payload);
      
      if (resp?.id) {
        console.log('Settings saved successfully, ID:', resp.id);
        this.setState({ settingId: resp.id, error: null });
      } else {
        console.log('Settings saved, but no ID returned');
        this.setState({ error: null });
      }
    } catch (error) {
      console.error('Error saving general settings:', error);
      this.setState({ error: this.getErrorMessage(error) });
    }
  }

  /**
   * Handle page selection change
   */
  handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    console.log('Default page changed to:', val);
    this.setState({ selectedPage: val });
    this.saveSettings(val);
  };

  /**
   * Get user-friendly error message
   */
  getErrorMessage(error: any): string {
    if (error.message && error.message.includes('network')) {
      return 'Network error: Could not connect to settings service';
    } else if (error.message && error.message.includes('permission')) {
      return 'Permission denied: You do not have access to these settings';
    } else {
      return `Error: ${error.message || 'Unknown error'}`;
    }
  }

  render() {
    const { pages, selectedPage, isLoading, error, currentTheme } = this.state;
    const themeClass = currentTheme === 'dark' ? 'dark-theme' : '';

    // Show loading state
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
        {/* Error message if any */}
        {error && (
          <div className="error-message">
            <strong>Error: </strong>{error}
          </div>
        )}
        
        {/* Main content area */}
        <div>
          {/* Default page setting */}
          <div className="theme-option-row">
            <div className="theme-option-icon">
              <GearIcon />
            </div>
            <div className="theme-option-content">
              <div className="theme-option-title">Default Page</div>
              <div className="theme-option-description">Choose which page to display after login</div>
            </div>
            <div className="theme-option-control">
              <select
                id="defaultPageSelect"
                className="settings-select"
                value={selectedPage}
                onChange={this.handleChange}
              >
                <option value="Dashboard">Dashboard</option>
                {pages.map(page => (
                  <option key={page.id} value={page.id}>{page.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ComponentGeneralSettings;
export { ComponentGeneralSettings };
