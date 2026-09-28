import { DEFAULT_APP_RETENTION_POLICY, GenericPackageManifestSchema } from "../contracts/app-registry.js";
import { canonicalJsonDocumentDigest } from "../contracts/common.js";
import { PackageManifestSchema } from "../contracts/package.js";
import type { RuntimePackageManifest } from "./package-verifier.js";

const TRANSITIONAL_RETAIN_OWNER_DATA_POLICY = "retain_owner_data_remove_runtime_authority";

export type ParsedStoredRuntimePackageManifest = {
  manifest: RuntimePackageManifest;
  manifestDigest: `sha256:${string}`;
};

export function parseStoredRuntimePackageManifest(value: unknown): RuntimePackageManifest {
  return parseStoredRuntimePackageManifestWithDigest(value).manifest;
}

export function parseStoredRuntimePackageManifestWithDigest(value: unknown): ParsedStoredRuntimePackageManifest {
  const candidate = value as { manifest_version?: unknown; retention_policy?: unknown };
  if (candidate?.manifest_version !== 2) {
    const manifest = PackageManifestSchema.parse(value);
    return { manifest, manifestDigest: canonicalJsonDocumentDigest(manifest) };
  }

  const strict = GenericPackageManifestSchema.safeParse(value);
  if (strict.success) {
    return { manifest: strict.data, manifestDigest: canonicalJsonDocumentDigest(strict.data) };
  }

  if (candidate.retention_policy === TRANSITIONAL_RETAIN_OWNER_DATA_POLICY) {
    const normalized = GenericPackageManifestSchema.parse({
      ...(value as Record<string, unknown>),
      retention_policy: DEFAULT_APP_RETENTION_POLICY,
    });
    return { manifest: normalized, manifestDigest: canonicalJsonDocumentDigest(value) };
  }

  return { manifest: GenericPackageManifestSchema.parse(value), manifestDigest: canonicalJsonDocumentDigest(value) };
}
