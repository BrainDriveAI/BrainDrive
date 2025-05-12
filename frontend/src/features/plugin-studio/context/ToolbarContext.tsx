import React, { createContext, useState, useContext, useEffect } from 'react';

interface ToolbarContextType {
  expandedCategories: string[];
  toggleCategory: (category: string) => void;
  isExpanded: (category: string) => boolean;
}

const ToolbarContext = createContext<ToolbarContextType | null>(null);

export const ToolbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize from localStorage if available
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pluginStudio.expandedCategories');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Error loading expanded categories from localStorage:', error);
      return [];
    }
  });

  // Save to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('pluginStudio.expandedCategories', JSON.stringify(expandedCategories));
    } catch (error) {
      console.error('Error saving expanded categories to localStorage:', error);
    }
  }, [expandedCategories]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      if (prev.includes(category)) {
        return prev.filter(c => c !== category);
      } else {
        return [...prev, category];
      }
    });
  };

  const isExpanded = (category: string) => {
    return expandedCategories.includes(category);
  };

  return (
    <ToolbarContext.Provider value={{ expandedCategories, toggleCategory, isExpanded }}>
      {children}
    </ToolbarContext.Provider>
  );
};

export const useToolbar = () => {
  const context = useContext(ToolbarContext);
  if (!context) {
    throw new Error('useToolbar must be used within a ToolbarProvider');
  }
  return context;
};