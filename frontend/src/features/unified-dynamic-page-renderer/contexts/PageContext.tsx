import React, { createContext, useContext } from 'react';
import { PageData, RenderMode, BreakpointConfig } from '../types';

export interface PageContextValue {
  pageData: PageData | null;
  mode: RenderMode;
  responsive: boolean;
  breakpoints: BreakpointConfig;
  containerQueries: boolean;
  lazyLoading: boolean;
  preloadPlugins: string[];
}

const PageContext = createContext<PageContextValue | undefined>(undefined);

export interface PageProviderProps {
  children: React.ReactNode;
  value: PageContextValue;
}

export const PageProvider: React.FC<PageProviderProps> = ({ children, value }) => {
  return (
    <PageContext.Provider value={value}>
      {children}
    </PageContext.Provider>
  );
};

export const usePageContext = (): PageContextValue => {
  const context = useContext(PageContext);
  if (!context) {
    throw new Error('usePageContext must be used within a PageProvider');
  }
  return context;
};

export default PageContext;