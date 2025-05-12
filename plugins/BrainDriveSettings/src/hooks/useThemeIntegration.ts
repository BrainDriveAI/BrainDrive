import { useState, useEffect } from 'react';
import { Services } from '../types/chat';

/**
 * Hook to integrate with the theme service
 * @param themeService The theme service from props
 * @returns The current theme
 */
export const useThemeIntegration = (themeService?: Services['theme']) => {
  const [currentTheme, setCurrentTheme] = useState<string>('light');

  useEffect(() => {
    if (!themeService) return;

    try {
      // Get initial theme
      const initialTheme = themeService.getCurrentTheme();
      setCurrentTheme(initialTheme);

      // Set up theme change listener
      const handleThemeChange = (newTheme: string) => {
        setCurrentTheme(newTheme);
      };

      // Add the listener
      themeService.addThemeChangeListener(handleThemeChange);

      // Clean up on unmount
      return () => {
        themeService.removeThemeChangeListener(handleThemeChange);
      };
    } catch (error) {
      console.error('Error initializing theme service:', error);
    }
  }, [themeService]);

  return { currentTheme };
};
