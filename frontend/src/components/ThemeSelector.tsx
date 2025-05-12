import React, { useState, useEffect } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { useTheme, useSettings } from '../contexts/ServiceContext';
import { useAuth } from '../contexts/AuthContext';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';

export const ThemeSelector = () => {
  const themeService = useTheme();
  const settingsService = useSettings();
  const { user } = useAuth();
  const [currentTheme, setCurrentTheme] = useState(themeService.getCurrentTheme());

  useEffect(() => {
    const listener = (theme: 'light' | 'dark') => {
      setCurrentTheme(theme);
    };
    themeService.addThemeChangeListener(listener);
    return () => themeService.removeThemeChangeListener(listener);
  }, [themeService]);

  const toggleTheme = async () => {
    // Always get the current theme from the service instead of using local state
    const serviceTheme = themeService.getCurrentTheme();
    const newTheme = serviceTheme === 'dark' ? 'light' : 'dark';
    
    console.log(`ThemeSelector: Toggling theme from ${serviceTheme} to ${newTheme}`);
    
    // Set the theme in the theme service
    themeService.setTheme(newTheme);
    
    // If user is logged in, save their preference
    if (user) {
      console.log(`ThemeSelector: User is logged in (${user.id}), saving theme preference`);
      try {
        // First try to get existing settings to preserve useSystemTheme value
        const rawExistingSettings = await settingsService.getSetting<string | { theme: string; useSystemTheme: boolean }>(
          'theme_settings',
          { userId: user.id }
        );
        
        console.log(`ThemeSelector: Retrieved existing settings:`, rawExistingSettings);
        
        // Parse the settings if it's a string
        let existingSettings: { theme: string; useSystemTheme: boolean } | undefined;
        
        if (typeof rawExistingSettings === 'string') {
          try {
            existingSettings = JSON.parse(rawExistingSettings);
            console.log(`ThemeSelector: Parsed existing settings:`, existingSettings);
          } catch (parseError) {
            console.error('ThemeSelector: Error parsing settings JSON:', parseError);
          }
        } else if (rawExistingSettings && typeof rawExistingSettings === 'object') {
          existingSettings = rawExistingSettings;
        }
        
        // Create settings object with new theme value
        const themeSettings = {
          theme: newTheme,
          useSystemTheme: existingSettings?.useSystemTheme || false
        };
        
        console.log(`ThemeSelector: Saving theme settings:`, themeSettings);
        
        // Save the settings
        await settingsService.setSetting(
          'theme_settings',
          themeSettings,
          { userId: user.id }
        );
        console.log(`ThemeSelector: Theme settings saved successfully for user ${user.id}`);
      } catch (error) {
        console.error('ThemeSelector: Error saving theme settings:', error);
      }
    } else {
      console.log('ThemeSelector: User is not logged in, not saving theme preference');
    }
  };

  return (
    <Tooltip title={`Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`}>
      <IconButton 
        onClick={toggleTheme} 
        color="inherit" 
        size="small"
        sx={{ ml: 1 }}
      >
        {currentTheme === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
      </IconButton>
    </Tooltip>
  );
};
