import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { loadAdapterConfig, loadPreferences } from "../config.js";
import { runBriefModelConformance } from "../brief-inference/conformance.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";

if (process.env.BRAINDRIVE_BRIEF_CONFORMANCE !== "1") throw new Error("Set BRAINDRIVE_BRIEF_CONFORMANCE=1 to authorize live model conformance calls");
const memoryRoot = process.env.PAA_MEMORY_ROOT?.trim();
if (!memoryRoot) throw new Error("PAA_MEMORY_ROOT is required");
const preferences = await loadPreferences(memoryRoot);
const adapterConfig = await loadAdapterConfig(process.cwd(), "openai-compatible");
const effective = resolveEffectiveAdapterConfig(adapterConfig, preferences);
const profileId = preferences.active_provider_profile?.trim() || adapterConfig.default_provider_profile?.trim();
if (!profileId) throw new Error("No active provider profile");
const credential = await resolveProviderCredentialForStartup("openai-compatible", effective, preferences);
const adapter = createModelAdapter("openai-compatible", adapterConfig, preferences, { apiKey: credential?.apiKey });
const diagnostics: unknown[] = [];
const result = await runBriefModelConformance({
  adapter,
  providerProfileId: profileId,
  modelId: effective.model,
  ...(process.env.BRAINDRIVE_BRIEF_CONFORMANCE_DIAGNOSTICS === "1" ? { onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic) } : {}),
});
if (diagnostics.length > 0) process.stderr.write(`${JSON.stringify({ diagnostics }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.entries.some((entry) => !entry.compatible)) process.exitCode = 2;
