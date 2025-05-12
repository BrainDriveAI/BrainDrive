import React, { createContext, useContext, ReactNode } from 'react';
import { useAppSelector } from '../stores/hooks';

interface Theme {
  text: {
    primary: string;
    secondary: string;
  };
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: {
    primary: string;
  };
  accent: {
    primary: string;
    secondary: string;
  };
}

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useAppSelector((state) => state.userPreferences);

  const themeValue: Theme = {
    text: {
      primary: theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
      secondary: theme === 'dark' ? 'text-gray-400' : 'text-gray-600',
    },
    background: {
      primary: theme === 'dark' ? 'bg-gray-900' : 'bg-white',
      secondary: theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50',
      tertiary: theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100',
    },
    border: {
      primary: theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
    },
    accent: {
      primary: theme === 'dark' ? 'text-blue-400' : 'text-blue-600',
      secondary: theme === 'dark' ? 'text-blue-300' : 'text-blue-500',
    },
  };

  return (
    <ThemeContext.Provider value={themeValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
