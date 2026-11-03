import { createHash } from "node:crypto";

export const STATUS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  BLOCKED: "blocked",
  NOT_RUN: "not_run",
});

const ALLOWED = new Set(Object.values(STATUS));

export function normalizeRow(row = {}) {
  const basis = row.basis ?? "No evidence basis was supplied.";
  if (row.status === STATUS.PASS) return { status: STATUS.PASS, basis };
  if (row.status === STATUS.FAIL || row.status === "failed") return { status: STATUS.FAIL, basis };
  if (row.status === STATUS.BLOCKED || row.status === "blocked") return { status: STATUS.BLOCKED, basis };
  if (row.status === STATUS.NOT_RUN || row.status === "not_implemented") return { status: STATUS.NOT_RUN, basis };

  // Legacy `implemented` rows were routinely paired with `qualification: pending`.
  // They are intentionally never upgraded here: incomplete evidence is not Pass.
  return {
    status: STATUS.NOT_RUN,
    basis: `${basis} Legacy or incomplete verifier state was rejected; this row is not run until its evidence contract is complete.`,
  };
}

export function normalizeRows(rows = {}) {
  return Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, normalizeRow(row)]));
}

export function reviewStatus(rows = {}) {
  const normalized = Object.values(normalizeRows(rows));
  if (normalized.some((row) => row.status === STATUS.FAIL)) return STATUS.FAIL;
  if (normalized.some((row) => row.status === STATUS.BLOCKED)) return STATUS.BLOCKED;
  if (normalized.some((row) => row.status === STATUS.NOT_RUN)) return STATUS.NOT_RUN;
  return STATUS.PASS;
}

export function assertStatus(status) {
  if (!ALLOWED.has(status)) throw new Error(`Invalid verifier status: ${status}`);
  return status;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function candidateDigest(candidate = {}) {
  return sha256(canonical({
    head: candidate.head ?? null,
    branch: candidate.branch ?? null,
    platform: candidate.platform ?? null,
    architecture: candidate.architecture ?? null,
  }));
}

export function digestRawValue(value) {
  return sha256(canonical(value));
}
