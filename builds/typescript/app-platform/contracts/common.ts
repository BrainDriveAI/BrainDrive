import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

import { z } from "zod";

import {
  APP_CONTRACT_SCHEMA_VERSION,
  APP_BRIDGE_SCHEMA_VERSION,
  RESUME_DATA_SCHEMA_VERSION,
  RESUME_INFERENCE_SCHEMA_VERSION,
} from "./constants.js";

export const OpaqueIdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const SemverSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
export const NonEmptyStringSchema = z.string().min(1).max(512);
export const ExtensionsSchema = z.record(z.string(), z.unknown()).default({});

export const ContractVersionsSchema = z
  .object({
    app_contract: z.literal(APP_CONTRACT_SCHEMA_VERSION),
    resume_data: z.literal(RESUME_DATA_SCHEMA_VERSION),
    resume_inference: z.literal(RESUME_INFERENCE_SCHEMA_VERSION),
    app_bridge: z.literal(APP_BRIDGE_SCHEMA_VERSION),
  })
  .strict();

export const AttributionSchema = z
  .object({
    owner_id: OpaqueIdSchema,
    actor_id: OpaqueIdSchema,
    app_id: NonEmptyStringSchema,
    publisher_id: NonEmptyStringSchema,
    package_digest: Sha256DigestSchema,
    installation_id: OpaqueIdSchema,
  })
  .strict();

export const RevisionMetadataSchema = z
  .object({
    record_id: OpaqueIdSchema,
    revision_id: OpaqueIdSchema,
    revision: z.number().int().positive(),
    created_at: TimestampSchema,
    created_by: AttributionSchema,
    prior_revision_id: OpaqueIdSchema.nullable(),
    extensions: ExtensionsSchema,
  })
  .strict();

export const UnknownFieldPolicySchema = z
  .object({
    authority_envelopes: z.literal("reject"),
    durable_records: z.literal("preserve_extensions_only"),
    unrecognized_extensions_are_authoritative: z.literal(false),
  })
  .strict();

export const DowngradePolicySchema = z
  .object({
    newer_schema: z.literal("fail_closed_export_or_upgrade"),
    unknown_schema: z.literal("fail_closed"),
    destructive_downgrade: z.literal("prohibited"),
  })
  .strict();

export const CompatibilityMatrixSchema = z
  .object({
    matrix_version: z.literal(1),
    host_contract_versions: z.array(z.literal(APP_CONTRACT_SCHEMA_VERSION)).length(1),
    data_read_versions: z.tuple([z.literal(2), z.literal(RESUME_DATA_SCHEMA_VERSION)]),
    data_write_versions: z.array(z.literal(RESUME_DATA_SCHEMA_VERSION)).length(1),
    inference_versions: z.array(z.literal(RESUME_INFERENCE_SCHEMA_VERSION)).length(1),
    bridge_versions: z.array(z.literal(APP_BRIDGE_SCHEMA_VERSION)).length(1),
    dependency_evidence: z
      .object({
        typescript_mcp_sdk: z.literal("1.30.0"),
        mcp_ext_apps: z.literal("1.7.5"),
      })
      .strict(),
    desktop_release_targets: z.tuple([z.literal("windows")]),
    docker_dev_required: z.literal(true),
    unknown_fields: UnknownFieldPolicySchema,
    downgrade: DowngradePolicySchema,
  })
  .strict();

export type CompatibilityMatrix = z.infer<typeof CompatibilityMatrixSchema>;

export const COMPATIBILITY_MATRIX: CompatibilityMatrix = {
  matrix_version: 1,
  host_contract_versions: [1],
  data_read_versions: [2, 3],
  data_write_versions: [3],
  inference_versions: [1],
  bridge_versions: [1],
  dependency_evidence: {
    typescript_mcp_sdk: "1.30.0",
    mcp_ext_apps: "1.7.5",
  },
  desktop_release_targets: ["windows"],
  docker_dev_required: true,
  unknown_fields: {
    authority_envelopes: "reject",
    durable_records: "preserve_extensions_only",
    unrecognized_extensions_are_authoritative: false,
  },
  downgrade: {
    newer_schema: "fail_closed_export_or_upgrade",
    unknown_schema: "fail_closed",
    destructive_downgrade: "prohibited",
  },
};

export function encodedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    if (entries.some(([, item]) => item === undefined)) {
      throw new TypeError("Canonical JSON does not support undefined values");
    }
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON supports only JSON-compatible values");
}

export function canonicalInputDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function canonicalJsonDocumentDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(`${canonicalJson(value)}\n`, "utf8").digest("hex")}`;
}

export function canonicalSignedBytes(domainSeparator: string, payload: unknown): string {
  if (!/^[A-Za-z0-9-]+-v[1-9]\d*$/.test(domainSeparator)) {
    throw new TypeError("Signing domain separator must be a versioned ASCII identifier");
  }
  return `${domainSeparator}\n${canonicalJson(payload)}\n`;
}

export function verifyEd25519Signature(
  publicKeyBase64: string,
  signatureBase64: string,
  domainSeparator: string,
  payload: unknown,
): boolean {
  const rawPublicKey = Buffer.from(publicKeyBase64, "base64");
  const signature = Buffer.from(signatureBase64, "base64");
  if (rawPublicKey.byteLength !== 32 || signature.byteLength !== 64) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = createPublicKey({ key: Buffer.concat([spkiPrefix, rawPublicKey]), format: "der", type: "spki" });
  return verifySignature(null, Buffer.from(canonicalSignedBytes(domainSeparator, payload), "utf8"), publicKey, signature);
}
