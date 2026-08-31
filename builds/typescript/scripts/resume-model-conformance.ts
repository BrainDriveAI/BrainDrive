import { loadAdapterConfig, loadPreferences } from "../config.js";
import { createModelAdapter, resolveEffectiveAdapterConfig } from "../adapters/index.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { RESUME_CONFORMANCE_PURPOSES, runResumeModelConformance, serializeConformanceReport } from "../resume-inference/conformance.js";
import { effectiveInferenceConfigFingerprint } from "../resume-inference/compatibility.js";

if (process.env.BRAINDRIVE_RESUME_CONFORMANCE !== "1") throw new Error("Set BRAINDRIVE_RESUME_CONFORMANCE=1 to authorize live model conformance calls");
const memoryRoot = process.env.PAA_MEMORY_ROOT?.trim();
if (!memoryRoot) throw new Error("PAA_MEMORY_ROOT is required");
const rootDir = process.cwd();
const preferences = await loadPreferences(memoryRoot);
const adapterConfig = await loadAdapterConfig(rootDir, "openai-compatible");
const effective = resolveEffectiveAdapterConfig(adapterConfig, preferences);
const profileId = preferences.active_provider_profile?.trim() || adapterConfig.default_provider_profile?.trim();
if (!profileId) throw new Error("No active provider profile");
const credential = await resolveProviderCredentialForStartup("openai-compatible", effective, preferences);
const adapter = createModelAdapter("openai-compatible", adapterConfig, preferences, { apiKey: credential?.apiKey });
const requestedPurposes = process.env.BRAINDRIVE_RESUME_CONFORMANCE_PURPOSES?.split(",").map((value) => value.trim()).filter(Boolean);
if (requestedPurposes?.some((purpose) => !RESUME_CONFORMANCE_PURPOSES.includes(purpose as typeof RESUME_CONFORMANCE_PURPOSES[number]))) throw new Error("Unknown Resume Builder conformance purpose");
const diagnostics: unknown[] = [];
const result = await runResumeModelConformance({
  adapter,
  providerProfileId: profileId,
  modelId: effective.model,
  effectiveConfigFingerprint: effectiveInferenceConfigFingerprint({
    adapterName: "openai-compatible",
    providerProfileId: profileId,
    providerId: effective.provider_id ?? profileId,
    modelId: effective.model,
    baseUrl: effective.base_url,
  }),
  evidenceClass: "authorized_live_provider",
  ...(requestedPurposes ? { purposes: requestedPurposes as typeof RESUME_CONFORMANCE_PURPOSES[number][] } : {}),
  ...(process.env.BRAINDRIVE_RESUME_CONFORMANCE_DIAGNOSTICS === "1" ? { onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic) } : {}),
});
if (diagnostics.length > 0) process.stderr.write(`${JSON.stringify({ diagnostics }, null, 2)}\n`);
process.stdout.write(`${serializeConformanceReport(result)}\n`);
if (result.entries.some((entry) => !entry.compatible)) process.exitCode = 2;
