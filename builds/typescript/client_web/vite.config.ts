/// <reference types="vitest/config" />

import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const gatewayProxyTarget =
  process.env.VITE_GATEWAY_PROXY_TARGET ?? "http://127.0.0.1:8787";
const allowedHostDomain = process.env.VITE_ALLOWED_HOST_DOMAIN ?? ".ijustwantthebox.com";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5073,
    strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1", allowedHostDomain],
    proxy: {
      "/api": {
        target: gatewayProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: { "X-Forwarded-For": "127.0.0.1" },
      },
      "/twilio": {
        target: gatewayProxyTarget,
        changeOrigin: true,
        headers: { "X-Forwarded-For": "127.0.0.1" },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.ts",
    include: ["src/**/*.test.{ts,tsx}"]
  }
});
