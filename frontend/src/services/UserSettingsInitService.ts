import { AbstractBaseService, ServiceCapability } from './base/BaseService';
import { SettingsService } from './SettingsService';
import { themeService } from './themeService';

export class UserSettingsInitService extends AbstractBaseService {
  private settingsService: SettingsService;
  
  constructor(settingsService: SettingsService) {
    const capabilities: ServiceCapability[] = [
      {
        name: 'user.settings.init',
        description: 'Initialize user settings on login',
        version: '1.0.0'
      }
    ];
    
    super('userSettingsInit', { major: 1, minor: 0, patch: 0 }, capabilities);
    this.settingsService = settingsService;
  }
  
  async initialize(): Promise<void> {
    // Register the theme setting definition
    await this.registerThemeSettingDefinition();
  }
  
  async destroy(): Promise<void> {
    // No cleanup needed
  }
  
  private async registerThemeSettingDefinition(): Promise<void> {
    // We don't need to register the theme_settings definition as it already exists in the system
    // console.log('Using existing theme_settings definition');
  }
  
  async initializeUserSettings(userId: string): Promise<void> {
    await this.initializeThemeSettings(userId);
    // Add more setting initializations here in the future
  }
  
  private async initializeThemeSettings(userId: string): Promise<void> {
    try {
      // console.log(`Initializing theme settings for user: ${userId}`);
      
      // Check if the user has theme settings
      const rawThemeSettings = await this.settingsService.getSetting<string | { theme: string; useSystemTheme: boolean }>(
        'theme_settings', 
        { userId }
      );
      
      // console.log(`Retrieved raw theme settings for user ${userId}:`, rawThemeSettings);
      
      // Parse the theme settings if it's a string
      let themeSettings: { theme: string; useSystemTheme: boolean } | null = null;
      
      if (typeof rawThemeSettings === 'string') {
        try {
          themeSettings = JSON.parse(rawThemeSettings);
          // console.log(`Parsed theme settings:`, themeSettings);
        } catch (parseError) {
          console.error('Error parsing theme settings JSON:', parseError);
        }
      } else if (rawThemeSettings && typeof rawThemeSettings === 'object') {
        themeSettings = rawThemeSettings;
      }
      
      if (themeSettings && themeSettings.theme) {
        // console.log(`Applying theme from settings: ${themeSettings.theme}`);
        
        // Apply the user's theme preference
        if (themeSettings.theme === 'light' || themeSettings.theme === 'dark') {
          // console.log(`Setting theme to: ${themeSettings.theme}`);
          themeService.setTheme(themeSettings.theme);
        }
        
        // Note: We're not handling useSystemTheme here as it would require additional changes
        // to the themeService implementation
      } else {
        // console.log('No theme settings found or invalid format, keeping default theme');
        // If no settings are found, we'll keep the default theme
        // No need to create a default setting
      }
    } catch (error) {
      console.error('Error initializing theme settings:', error);
    }
  }
}
