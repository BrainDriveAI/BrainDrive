import { useState, useEffect } from 'react';
import { createTheme } from '@mui/material';
import { useTheme } from '../contexts/ServiceContext';

export const useAppTheme = () => {
  const themeService = useTheme();
  const [currentTheme, setCurrentTheme] = useState(themeService.getCurrentTheme());

  useEffect(() => {
    const listener = (newTheme: 'light' | 'dark') => {
      setCurrentTheme(newTheme);
    };
    themeService.addThemeChangeListener(listener);
    return () => themeService.removeThemeChangeListener(listener);
  }, [themeService]);

  const theme = createTheme({
    palette: {
      mode: currentTheme,
      primary: {
        main: '#1976d2',
      },
      background: {
        default: currentTheme === 'dark' ? '#1e293b' : '#f5f5f5',
        paper: currentTheme === 'dark' ? '#0f172a' : '#ffffff',
      },
      text: {
        primary: currentTheme === 'dark' ? '#f1f5f9' : '#000000',
        secondary: currentTheme === 'dark' ? '#94a3b8' : '#4b5563',
      },
    },
    components: {
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: currentTheme === 'dark' ? '#0f172a' : '#ffffff',
            color: currentTheme === 'dark' ? '#f1f5f9' : '#000000',
          },
        },
      },
    },
  });

  return theme;
};
