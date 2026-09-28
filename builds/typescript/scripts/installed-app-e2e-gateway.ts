import path from "node:path";
import { pathToFileURL } from "node:url";

import type { InstalledAppInferenceProviderResolver } from "../app-inference/installed-program.js";
import { buildServer } from "../gateway/server.js";
import { auditLog } from "../logger.js";

type FixtureModule = {
  resolveInstalledAppInferenceProvider?: InstalledAppInferenceProviderResolver;
};

async function main(): Promise<void> {
  const fixtureModule = process.env.BRAINDRIVE_E2E_INSTALLED_APP_PROVIDER_MODULE?.trim();
  if (!fixtureModule) throw new Error("Installed-app E2E provider module is required");

  const loaded = await import(pathToFileURL(path.resolve(process.cwd(), fixtureModule)).href) as FixtureModule;
  if (typeof loaded.resolveInstalledAppInferenceProvider !== "function") {
    throw new Error("Installed-app E2E provider module must export resolveInstalledAppInferenceProvider");
  }

  const { app, runtimeConfig } = await buildServer(process.cwd(), {
    installedAppInferenceProviderResolver: loaded.resolveInstalledAppInferenceProvider,
  });
  await app.listen({ host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
  auditLog("startup.listen", { host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void app.close().catch((error) => {
      auditLog("shutdown.failure", { message: error instanceof Error ? error.message : "Unknown shutdown error" });
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

main().catch((error) => {
  auditLog("startup.failure", { message: error instanceof Error ? error.message : "Unknown startup error" });
  process.exitCode = 1;
});
