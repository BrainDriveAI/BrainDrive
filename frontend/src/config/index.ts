import { z } from 'zod';


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
  // In development, use the proxy
  if (env.MODE === 'development') {
    return '';  // Empty string will use the current host with proxy
  }
  
  // If environment variable is provided, use it
  if (env.VITE_API_URL) {
    return env.VITE_API_URL;
  }
  
  // If we're in the browser
  if (typeof window !== 'undefined') {
    // If frontend is served over HTTPS, use HTTPS for API
    if (window.location.protocol === 'https:') {
      return 'https://braindriveapi.ijustwantthebox.com';
    }
  }
  
  // Default to HTTP for local development
  return 'http://10.0.2.149:8005';
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
