import { buildServer } from "./gateway/server.js";
import { startRepl } from "./client/repl.js";
import { auditLog } from "./logger.js";

async function main(): Promise<void> {
  const { app, runtimeConfig } = await buildServer(process.cwd());
  await app.listen({ host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
  auditLog("startup.listen", { host: runtimeConfig.bind_address, port: runtimeConfig.port ?? 8787 });
  await startRepl(`http://${runtimeConfig.bind_address}:${runtimeConfig.port ?? 8787}`);
  await app.close();
}

main().catch((error) => {
  auditLog("startup.failure", {
    message: error instanceof Error ? error.message : "Unknown startup error",
  });
  process.exitCode = 1;
});
