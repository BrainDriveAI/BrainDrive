import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "client_web/**",
      "src-tauri/desktop-runtime/**",
      "src-tauri/target/**",
    ],
    ...(process.platform === "win32" ? { fileParallelism: false, maxWorkers: 1 } : {}),
  },
});
