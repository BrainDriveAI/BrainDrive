import { access, constants, readFile } from "node:fs/promises";
import { normalizeRows, reviewStatus, STATUS } from "./verification-contract.mjs";

const ALLOWED_TRIGGERS = new Set(["refresh", "install", "update", "automatic"]);
const OWNER_FIELD_PATTERN = /owner[_ -]?(?:id|identity|email|name)|installed[_ -]?apps?|usage|telemetry|credential|token|password|api[_ -]?key/i;

async function fixtureState() {
  const path = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CE_CATALOG_PATH?.trim() ?? null;
  if (!path) return { status: "blocked", path: null, basis: "The C-E catalog fixture for a post-refresh new-app entry was not supplied." };
  try {
    await access(path, constants.R_OK);
    return { status: "ready", path, basis: "The C-E catalog fixture is available to the native verifier." };
  } catch {
    return { status: "blocked", path, basis: "The configured C-E catalog fixture is not readable." };
  }
}

async function readTrace(tracePath) {
  if (!tracePath) return { status: "blocked", path: null, records: [], basis: "No catalog network trace was configured." };
  const lines = (await readFile(tracePath, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean);
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { /* malformed trace is reported below */ }
  }
  if (records.length === 0) return { status: "blocked", path: tracePath, records, basis: "The catalog network trace contains no records." };
  const malformed = records.length !== lines.length;
  const networkRecords = records.filter((record) => record.network !== false);
  const unexpected = networkRecords.filter((record) => !ALLOWED_TRIGGERS.has(record.trigger));
  const privacyViolations = networkRecords.filter((record) => OWNER_FIELD_PATTERN.test(JSON.stringify({ target: record.target, error: record.error, request_body_fields: record.request_body_fields })) ||
    (record.request_body_fields ?? []).length > 0 || (record.owner_data_fields ?? []).length > 0 ||
    (record.installed_app_fields ?? []).length > 0 || (record.usage_fields ?? []).length > 0);
  return {
    status: malformed || unexpected.length > 0 || privacyViolations.length > 0 ? "failed" : "ready",
    path: tracePath,
    records,
    networkRecords,
    malformed,
    unexpectedTriggers: unexpected.map((record) => record.trigger),
    privacyViolations,
    triggers: [...new Set(records.map((record) => record.trigger))],
    basis: malformed
      ? "The catalog network trace contains malformed records."
      : unexpected.length > 0
        ? `The catalog trace contains unattributed triggers: ${[...new Set(unexpected.map((record) => record.trigger))].join(", ")}.`
        : privacyViolations.length > 0
          ? "The catalog trace contains owner, installed-app, usage, or credential-like request fields."
          : "Catalog request records are trigger-attributed and contain no owner, installed-app, usage, or credential fields.",
  };
}

/** Review US-6 and its by-reference catalog/network rows. */
export async function reviewCatalogRefresh({
  catalogMetadata,
  tracePath,
  refreshObserved = false,
  metadataVisible: metadataVisibleOverride = null,
  asOfValid: asOfValidOverride = null,
  offlineObservation = null,
  newEntryObservation = null,
  installedAppOpened = false,
}) {
  const fixture = await fixtureState();
  const trace = await readTrace(tracePath);
  const metadataVisible = metadataVisibleOverride ?? Boolean(catalogMetadata?.source_label && catalogMetadata?.as_of);
  const asOfValid = asOfValidOverride ?? (metadataVisible && Boolean(catalogMetadata?.as_of) && !Number.isNaN(Date.parse(catalogMetadata.as_of)));
  const triggerAttribution = trace.status === "ready" && trace.networkRecords.every((record) => ALLOWED_TRIGGERS.has(record.trigger));
  const privacyClean = trace.status === "ready" && trace.privacyViolations.length === 0;
  const offlinePass = offlineObservation?.status === STATUS.PASS && offlineObservation.catalogPreserved && offlineObservation.installedAppUnaffected;
  const newEntryPass = newEntryObservation?.status === STATUS.PASS && newEntryObservation.newEntryVisible;
  const ac61Pass = metadataVisible && asOfValid && installedAppOpened;
  const ac62Pass = metadataVisible && refreshObserved && triggerAttribution && privacyClean;
  const ac63Pass = offlinePass;
  const ac64Pass = newEntryPass;
  const tb1Pass = triggerAttribution && privacyClean && trace.networkRecords.every((record) => record.trigger !== "page_load" && record.trigger !== "startup");

  const rows = {
    "AC-6.1": { status: ac61Pass ? STATUS.PASS : STATUS.FAIL, basis: ac61Pass ? "The catalog source/as-of metadata was visible and a non-revoked installed app opened normally." : "Catalog metadata or the installed-app open leg is incomplete." },
    "AC-6.2": { status: ac62Pass ? STATUS.PASS : STATUS.FAIL, basis: ac62Pass ? "The explicit refresh was observed and catalog requests were trigger-attributed with privacy-clean request records." : `The refresh/source/privacy evidence is incomplete. ${trace.basis}` },
    "AC-6.3": { status: ac63Pass ? STATUS.PASS : STATUS.BLOCKED, basis: ac63Pass ? "Repository failure preserved the last-known catalog and left the installed app unaffected." : "The native run has no controlled repository-unreachable observation yet." },
    "AC-6.4": { status: ac64Pass ? STATUS.PASS : STATUS.BLOCKED, basis: ac64Pass ? "The C-E refresh exposed the new catalog entry without a freshness promise." : `The C-E new-entry leg is not executed. ${fixture.basis}` },
    "CF-1": { status: ac63Pass ? STATUS.PASS : STATUS.BLOCKED, basis: "Repository-unreachable behavior closes by reference to AC-6.1/AC-6.3." },
    "TB-1": { status: tb1Pass ? STATUS.PASS : trace.status === "failed" ? STATUS.FAIL : STATUS.BLOCKED, basis: tb1Pass ? "Every observed repository request had an allowed explicit-owner trigger and carried no owner data." : `The full lifecycle request capture is incomplete. ${trace.basis}` },
    "FR-4": { status: tb1Pass ? STATUS.PASS : trace.status === "failed" ? STATUS.FAIL : STATUS.BLOCKED, basis: "FR-4 closes by reference to TB-1 and AC-6.2." },
    "DC-1": { status: ac61Pass ? STATUS.PASS : STATUS.FAIL, basis: "Bundled catalog/as-of and refresh-only replacement evidence is required." },
    "DC-3": { status: ac63Pass && tb1Pass ? STATUS.PASS : STATUS.BLOCKED, basis: "The last successful anonymous inventory must persist locally after a controlled repository failure." },
  };
  const normalizedRows = normalizeRows(rows);
  return { review: "US-6 catalog and refresh", catalogMetadata, trace, fixture, refreshObserved, offlineObservation, newEntryObservation, installedAppOpened, rows: normalizedRows, status: reviewStatus(normalizedRows) };
}
