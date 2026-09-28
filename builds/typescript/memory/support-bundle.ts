import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AuthMode, InstallLocation, InstallMode } from "../contracts.js";

const SUPPORT_BUNDLE_FILE_NAME_PATTERN = /^support-bundle-\d{13}\.tar\.gz$/;
const AUDIT_FILE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/;

export type CreateSupportBundleOptions = {
  windowHours: number;
  appVersion: string;
  installMode: InstallMode;
  installLocation: InstallLocation;
  authMode: AuthMode;
  actorId: string;
};

export type SupportBundleResult = {
  archive_path: string;
  file_name: string;
  included_audit_files: number;
};

export type SupportBundleEntry = {
  file_name: string;
  size_bytes: number;
  updated_at: string;
};

export async function createSupportBundle(
  memoryRoot: string,
  options: CreateSupportBundleOptions
): Promise<SupportBundleResult> {
  const supportBundleDir = supportBundleOutputDir(memoryRoot);
  await mkdir(supportBundleDir, { recursive: true });

  const timestamp = Date.now();
  const fileName = `support-bundle-${timestamp}.tar.gz`;
  const archivePath = path.join(supportBundleDir, fileName);

  const stagingParent = await mkdtemp(path.join(tmpdir(), "braindrive-support-bundle-"));
  const stagingRoot = path.join(stagingParent, "bundle");
  await mkdir(stagingRoot, { recursive: true });

  try {
    const generatedAt = new Date();
    const cutoffDateIso = new Date(generatedAt.getTime() - options.windowHours * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const copySummary = await copyAuditDiagnostics(memoryRoot, stagingRoot, cutoffDateIso);
    await writeRuntimeMetadata(stagingRoot, {
      generated_at: generatedAt.toISOString(),
      scope: "memory-only",
      app_version: options.appVersion,
      install_mode: options.installMode,
      install_location: options.installLocation,
      auth_mode: options.authMode,
      actor_id: options.actorId,
      window_hours: options.windowHours,
      cutoff_date_utc: cutoffDateIso,
      included_audit_files: copySummary.includedFiles.length,
    });
    await writeFile(
      path.join(stagingRoot, "metadata", "included-audit-files.json"),
      `${JSON.stringify({ files: copySummary.includedFiles }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(stagingRoot, "metadata", "lifecycle-diagnostics.jsonl"),
      copySummary.lifecycleDiagnostics.map((event) => JSON.stringify(event)).join("\n") + (copySummary.lifecycleDiagnostics.length ? "\n" : ""),
      "utf8"
    );

    if (copySummary.includedFiles.length === 0) {
      await writeFile(
        path.join(stagingRoot, "metadata", "notes.txt"),
        "No audit JSONL files matched the requested window.\n",
        "utf8"
      );
    }

    await createTarArchive(stagingRoot, archivePath);
    return {
      archive_path: archivePath,
      file_name: fileName,
      included_audit_files: copySummary.includedFiles.length,
    };
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
  }
}

export async function listSupportBundles(memoryRoot: string): Promise<SupportBundleEntry[]> {
  const supportBundleDir = supportBundleOutputDir(memoryRoot);
  try {
    await mkdir(supportBundleDir, { recursive: true });
  } catch {
    return [];
  }

  const entries = await readdir(supportBundleDir, { withFileTypes: true });
  const bundles: SupportBundleEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!SUPPORT_BUNDLE_FILE_NAME_PATTERN.test(entry.name)) {
      continue;
    }
    const absolutePath = path.join(supportBundleDir, entry.name);
    const fileStats = await stat(absolutePath);
    bundles.push({
      file_name: entry.name,
      size_bytes: fileStats.size,
      updated_at: fileStats.mtime.toISOString(),
    });
  }

  bundles.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return bundles;
}

export function resolveSupportBundleDownloadPath(memoryRoot: string, fileName: string): string | null {
  if (!SUPPORT_BUNDLE_FILE_NAME_PATTERN.test(fileName)) {
    return null;
  }

  const supportBundleDir = supportBundleOutputDir(memoryRoot);
  const candidate = path.resolve(supportBundleDir, fileName);
  const normalizedDir = path.resolve(supportBundleDir);
  if (candidate !== normalizedDir && !candidate.startsWith(`${normalizedDir}${path.sep}`)) {
    return null;
  }

  return candidate;
}

async function writeRuntimeMetadata(stagingRoot: string, metadata: Record<string, unknown>): Promise<void> {
  const metadataDir = path.join(stagingRoot, "metadata");
  await mkdir(metadataDir, { recursive: true });
  await writeFile(path.join(metadataDir, "runtime-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function copyAuditDiagnostics(
  memoryRoot: string,
  stagingRoot: string,
  cutoffDateIso: string
): Promise<{ includedFiles: string[]; lifecycleDiagnostics: Array<Record<string, unknown>> }> {
  const auditSourceDir = path.join(memoryRoot, "diagnostics", "audit");
  const auditTargetDir = path.join(stagingRoot, "memory", "diagnostics", "audit");
  const includedFiles: string[] = [];
  const lifecycleDiagnostics: Array<Record<string, unknown>> = [];

  try {
    const entries = await readdir(auditSourceDir, { withFileTypes: true });
    await mkdir(auditTargetDir, { recursive: true });
    for (const entry of entries) {
      if (!entry.isFile() || !AUDIT_FILE_NAME_PATTERN.test(entry.name)) {
        continue;
      }

      const dateSegment = entry.name.slice(0, 10);
      if (dateSegment < cutoffDateIso) {
        continue;
      }

      const sourceFile = path.join(auditSourceDir, entry.name);
      const targetFile = path.join(auditTargetDir, entry.name);
      const source = await readFile(sourceFile, "utf8");
      const sanitizedLines: string[] = [];
      for (const line of source.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const sanitized = sanitizeSupportAuditEvent(parsed);
          sanitizedLines.push(JSON.stringify(sanitized));
          const lifecycle = lifecycleDiagnosticProjection(sanitized);
          if (lifecycle) lifecycleDiagnostics.push(lifecycle);
        } catch {
          sanitizedLines.push(JSON.stringify({ event: "audit.invalid_line", details: { outcome: "redacted" } }));
        }
      }
      await writeFile(targetFile, `${sanitizedLines.join("\n")}\n`, "utf8");
      includedFiles.push(`memory/diagnostics/audit/${entry.name}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return { includedFiles, lifecycleDiagnostics };
}

const SUPPORT_DETAIL_ALLOWLIST = new Set([
  "action", "actor_id", "app_id", "attempt", "attempt_outcome", "byte_count", "capability_diff", "capability_version", "checked_at", "connection_id", "decision",
  "completion_mode", "deletion_class", "diagnostic_version", "duration_class", "elapsed_ms", "error_class", "error_code", "final_disposition", "finish_category", "generation", "grant_id", "installation_id",
  "idempotency_decision", "item_count", "lifecycle_action", "next_state", "operation_id", "outcome", "owner_data_preserved", "owner_id",
  "model_class", "output_schema_id", "output_schema_version", "package_digest", "package_version", "prior_state", "prompt_policy_id", "prompt_policy_version", "publisher_id", "purpose", "recovery", "recovery_class", "removed_classes",
  "removed_item_count", "repair", "request_id", "result_state", "retained_classes", "retryable", "revocation_sequence", "schema_issue_ids", "stage", "step", "structural_failure_class",
  "attempt_count", "revocation_generation", "grant_revision", "target_state", "timestamp", "transition_event", "usage_available", "validator_codes", "view_id",
  "provider_validator_codes", "provider_validator_rule_ids", "local_candidate_classes", "targeted_fact_repair_validator_codes", "targeted_fact_repair_validator_rule_ids", "targeted_fact_repair_disposition", "full_general_constructor_validator_codes", "full_general_constructor_validator_rule_ids", "full_general_constructor_disposition", "original_failure_code", "recovery_disposition", "validator_rule_ids",
  "acknowledgement_timing_class", "conflict_class", "expected_revision", "idempotency_disposition", "initial_wait_class", "reconciliation_class", "reconciliation_count", "semantic_digest",
  "retry_relation_version", "retry_reason", "retry_prior_operation_id", "retry_new_operation_id", "retry_semantic_input_digest", "retry_strategy_revision_id", "retry_provider_profile_id", "retry_model_id", "retry_equivalent",
  "app_issue_ids", "approved_record_changed", "execution_disposition", "program_id", "program_version", "provider_call_count", "repeated_issue_ids", "saved_record_written",
]);

export function sanitizeSupportAuditEvent(event: Record<string, unknown>): Record<string, unknown> {
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
  const allowedDetails: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SUPPORT_DETAIL_ALLOWLIST.has(key)) continue;
    allowedDetails[key] = sanitizeSupportValue(value);
  }
  return {
    timestamp: typeof event.timestamp === "string" ? event.timestamp : undefined,
    event: typeof event.event === "string" ? event.event : "audit.unknown",
    details: allowedDetails,
  };
}

function sanitizeSupportValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (
      value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      value.includes("-----BEGIN") ||
      /Bearer\s+/i.test(value) ||
      /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
      /https?:\/\//i.test(value)
    ) return "[REDACTED]";
    return value.length > 512 ? "[REDACTED]" : value;
  }
  if (Array.isArray(value)) return value.slice(0, 64).map(sanitizeSupportValue);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  return "[REDACTED]";
}

function lifecycleDiagnosticProjection(event: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof event.event !== "string" || !event.event.startsWith("app.lifecycle.")) return null;
  return { timestamp: event.timestamp, event: event.event, details: event.details };
}

function supportBundleOutputDir(memoryRoot: string): string {
  return path.join(memoryRoot, "exports", "support-bundles");
}

async function createTarArchive(sourceRoot: string, destinationPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-czf", destinationPath, "."], { cwd: sourceRoot });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `tar failed with ${code}`));
    });
  });
}
