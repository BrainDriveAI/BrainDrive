import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { InstalledAppInferenceExecutor } from "../app-inference/installed-program.js";
import { createDockerAppLifecycle } from "../app-platform/lifecycle/bootstrap.js";
import { MODERN_FIXTURE_VERSION } from "../app-platform/lifecycle/fixture-repository.js";
import { AppMcpHost } from "../app-platform/mcp-host/app-host.js";
import { ResumeAppHostAdapter } from "../app-platform/mcp-host/resume-host-adapter.js";
import { loadAdapterConfig, loadPreferences } from "../config.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import {
  SPEC_10_INSTALLED_LIVE_MAX_CALLS,
  SPEC_10_INSTALLED_LIVE_MAX_USD,
  SPEC_10_INSTALLED_LIVE_MODEL,
  SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE,
  buildSpec10InstalledLiveInvocation,
  runSpec10InstalledLiveValidation,
} from "../resume-inference/spec-10-installed-live-validation.js";

async function main(): Promise<void> {
  if (process.env.BRAINDRIVE_SPEC10_LIVE !== "1") throw new Error("authorization_missing");
  if (process.env.BRAINDRIVE_SPEC10_LIVE_MAX_CALLS !== String(SPEC_10_INSTALLED_LIVE_MAX_CALLS)) throw new Error("call_ceiling_mismatch");
  if (process.env.BRAINDRIVE_SPEC10_LIVE_MAX_USD !== String(SPEC_10_INSTALLED_LIVE_MAX_USD)) throw new Error("spend_ceiling_mismatch");
  const memoryRoot = process.env.PAA_MEMORY_ROOT?.trim();
  if (!memoryRoot) throw new Error("memory_root_missing");

  const rootDir = process.cwd();
  const preferences = await loadPreferences(memoryRoot);
  const adapterConfig = await loadAdapterConfig(rootDir, "openai-compatible");
  const effective = resolveEffectiveAdapterConfig(adapterConfig, preferences);
  const profileId = preferences.active_provider_profile?.trim() || adapterConfig.default_provider_profile?.trim();
  if (profileId !== SPEC_10_INSTALLED_LIVE_PROVIDER_PROFILE || effective.model !== SPEC_10_INSTALLED_LIVE_MODEL) throw new Error("provider_authority_mismatch");

  const dense = buildSpec10InstalledLiveInvocation("dense");
  const holdout = buildSpec10InstalledLiveInvocation("holdout");
  if (process.env.BRAINDRIVE_SPEC10_LIVE_PREFLIGHT_ONLY === "1") {
    process.stdout.write(`${JSON.stringify({
      status: "preflight_passed",
      execution_boundary: "installed_app_contract_v2",
      provider_profile_id: profileId,
      model_id: effective.model,
      authorized_call_ceiling: SPEC_10_INSTALLED_LIVE_MAX_CALLS,
      authorized_spend_ceiling_usd: SPEC_10_INSTALLED_LIVE_MAX_USD,
      fixture_count: 2,
      fixture_input_digests: [dense.input.persistence_input_digest, holdout.input.persistence_input_digest],
      provider_calls_made: 0,
      credential_accessed: false,
    })}\n`);
    return;
  }

  const credential = await resolveProviderCredentialForStartup("openai-compatible", effective, preferences);
  if (!credential?.apiKey) throw new Error("credential_unavailable");
  const adapter = createModelAdapter("openai-compatible", adapterConfig, preferences, { apiKey: credential.apiKey });
  const balanceUrl = new URL(effective.base_url);
  balanceUrl.pathname = balanceUrl.pathname.replace(/\/v1\/?$/, "/status");
  balanceUrl.search = "";
  balanceUrl.hash = "";

  const readBalance = async () => {
    const response = await fetch(balanceUrl, { headers: { Authorization: `Bearer ${credential.apiKey}` } });
    if (response.status === 401) throw new Error("provider_authentication_failed");
    if (response.status === 403) throw new Error("provider_authorization_failed");
    if (response.status === 429) throw new Error("rate_limited");
    if (!response.ok) throw new Error("balance_unavailable");
    const body = await response.json() as Record<string, unknown>;
    return {
      remainingUsd: numberFromUnknown(body.remaining_usd),
      totalSpentUsd: numberFromUnknown(body.total_spent_usd),
    };
  };

  const report = await runSpec10InstalledLiveValidation({
    adapter,
    providerProfileId: profileId,
    modelId: effective.model,
    readBalance,
    createExecution: async (provider) => {
      const taskRoot = await mkdtemp(path.join(os.tmpdir(), "bd-spec10-installed-live-"));
      const lifecycle = await createDockerAppLifecycle({
        memoryRoot: path.join(taskRoot, "memory"),
        stateRoot: path.join(taskRoot, "host"),
        hostVersion: "26.7.23",
      });
      const executor = new InstalledAppInferenceExecutor({ resolveProvider: async () => provider });
      const host = new AppMcpHost(new ResumeAppHostAdapter(lifecycle, { installedAppInference: executor }));
      try {
        const installed = await lifecycle.install({ version: MODERN_FIXTURE_VERSION, idempotencyKey: `spec10-installed-live-${crypto.randomUUID()}`, approveCapabilities: true });
        const launch = await host.launch();
        return {
          async execute(invocation) {
            const response = await host.handleBridge(launch.session_id, {
              bridge_version: 1,
              message_id: crypto.randomUUID(),
              app_id: "ai.braindrive.resume-builder",
              installation_id: installed.record.installation_id,
              view_id: launch.view_id,
              operation_id: launch.operation_id,
              sent_at: new Date().toISOString(),
              type: "capability.call",
              payload: {
                capability: "app.inference.request",
                request_operation_id: invocation.operation_id,
                token_id: launch.bridge_token_id,
                input: invocation,
              },
            }, { origin: "null", sourceMatches: true });
            if (response.status !== "capability_completed") throw new Error("installed_app_execution_failed");
            return response.result;
          },
          async close() {
            await host.closeAll();
            await lifecycle.dependencies.supervisor.close();
            await makeWritable(taskRoot);
            await rm(taskRoot, { recursive: true, force: true });
          },
        };
      } catch (error) {
        await host.closeAll();
        await lifecycle.dependencies.supervisor.close();
        await makeWritable(taskRoot);
        await rm(taskRoot, { recursive: true, force: true });
        throw error;
      }
    },
  });
  const reportPath = process.env.BRAINDRIVE_SPEC10_LIVE_REPORT_PATH?.trim();
  if (reportPath) {
    if (!path.isAbsolute(reportPath)) throw new Error("report_path_must_be_absolute");
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 2;
}

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }));
}

function numberFromUnknown(value: unknown): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(result) || result < 0) throw new Error("balance_unavailable");
  return result;
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "live_validation_failed";
  process.stderr.write(`${JSON.stringify({ status: "failed", safe_code: code })}\n`);
  process.exitCode = 2;
});
