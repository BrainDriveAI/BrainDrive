/**
 * Constants for theme settings
 * This file defines constants for theme settings to ensure consistency and prevent typos
 */

export const THEME_SETTINGS = {
  DEFINITION_ID: 'theme_settings',
  NAME: 'Theme Settings',
  CATEGORY: 'appearance',
  TAGS: ['theme', 'appearance', 'display'],
  DEFAULT_VALUE: {
    theme: 'light',
    useSystemTheme: false,
    autoSwitchTime: null
  }
};

/**
 * Local storage keys for fallback storage
 */
export const LOCAL_STORAGE_KEYS = {
  THEME_PREFERENCE: 'theme_preference_local'
};

export const GENERAL_SETTINGS = {
  DEFINITION_ID: 'general_settings',
  NAME: 'General Settings',
  DEFAULT_VALUE: {
    settings: [
      {
        Setting_Name: 'default_page',
        Setting_Data: 'Dashboard',
        Setting_Help: 'This is the first page to be displayed after logging in to BrainDrive'
      }
    ]
  }
};
