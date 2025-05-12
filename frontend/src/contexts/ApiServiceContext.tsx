import React, { createContext, useContext, ReactNode } from 'react';
import ApiService, { ApiServiceConfig } from '../services/ApiService';

interface ApiServiceContextValue {
  apiService: ApiService;
}

const ApiServiceContext = createContext<ApiServiceContextValue | undefined>(undefined);

interface ApiServiceProviderProps {
  children: ReactNode;
  config: ApiServiceConfig;
}

export const ApiServiceProvider: React.FC<ApiServiceProviderProps> = ({ children, config }) => {
  const apiService = ApiService.getInstance(config);

  return (
    <ApiServiceContext.Provider value={{ apiService }}>
      {children}
    </ApiServiceContext.Provider>
  );
};

export const useApiService = () => {
  const context = useContext(ApiServiceContext);
  if (!context) {
    throw new Error('useApiService must be used within an ApiServiceProvider');
  }
  return { apiService: context.apiService };
};

export default ApiServiceContext;
