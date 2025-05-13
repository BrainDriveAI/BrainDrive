import { z } from 'zod';

// Add type declaration for Vite's import.meta.env
declare global {
  interface ImportMeta {
    env: Record<string, string>;
  }
}


// Environment configuration schema
const envSchema = z.object({
  VITE_API_URL: z.string().optional(),
  VITE_API_TIMEOUT: z.string().transform(Number).optional(),
  MODE: z.enum(['development', 'production']).default('development'),
  VITE_DEV_AUTO_LOGIN: z.string().transform(val => val === 'true').optional(),
  VITE_DEV_EMAIL: z.string().optional(),
  VITE_DEV_PASSWORD: z.string().optional(),
});

// Parse environment variables with fallback for import.meta.env
const env = envSchema.parse(typeof import.meta !== 'undefined' ? import.meta.env : {});

// Determine API URL based on environment and protocol
const getApiBaseUrl = () => {
  // If environment variable is provided, use it (highest priority)
  if (env.VITE_API_URL) {
    return env.VITE_API_URL;
  }
  
  // In development, use the proxy
  if (env.MODE === 'development') {
    return '';  // Empty string will use the current host with proxy
  }

  
  // Default to localhost for local development/testing
  return 'http://localhost:8005';
};

// Application configuration
export const config = {
  api: {
    baseURL: getApiBaseUrl(),
    timeout: env.VITE_API_TIMEOUT || 10000,
  },
  auth: {
    tokenKey: 'accessToken',
    development: {
      autoLogin: env.VITE_DEV_AUTO_LOGIN || false,
      email: env.VITE_DEV_EMAIL,
      password: env.VITE_DEV_PASSWORD,
    }
  },
  env: {
    isDevelopment: env.MODE === 'development',
    isProduction: env.MODE === 'production',
  },
} as const;

// Type exports
export type Config = typeof config;
