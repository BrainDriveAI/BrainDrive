import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  base: './',
  build: {
    target: 'esnext' // allows top-level await
  },
  plugins: [
    react(),
    federation({
      name: 'host-app',
      remotes: {},
      shared: {
        react: { 
          singleton: true,
          requiredVersion: '18.3.1',
          eager: true
        },
        'react-dom': { 
          singleton: true,
          requiredVersion: '18.3.1',
          eager: true
        }
      }
    })
  ],


  server: {
    host: '0.0.0.0',
    port: 5173,
    force: true, // Force dependency pre-bundling
    hmr: {
      overlay: true
    },
    proxy: {
      '/api': {
        target: 'http://10.0.2.149:8005',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  optimizeDeps: {
    force: true // Force re-optimization of dependencies
  }
})
