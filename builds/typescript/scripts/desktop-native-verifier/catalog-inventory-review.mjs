import { access, constants, readFile } from "node:fs/promises";
import { verifyExternalPacket } from "./packet-tools.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

function row(status, basis) {
  return { status, basis };
}

function first(...values) { return values.find((value) => typeof value === "string" && value.trim()) ?? null; }

function entryFields(entry = {}) {
  const identity = entry.package_identity ?? entry.identity ?? {};
  const presentation = entry.safe_presentation ?? entry.presentation ?? entry.catalog ?? {};
  return {
    appId: first(identity.app_id, identity.package_id, entry.app_id, entry.route_key),
    name: first(presentation.display_name, identity.display_name, entry.display_name),
    purpose: first(presentation.summary, presentation.purpose, entry.summary, entry.purpose),
    publisher: first(presentation.publisher_name, identity.publisher_name, identity.publisher_id, entry.publisher),
    version: first(identity.package_version, identity.version, entry.version),
    access: first(presentation.access_description, presentation.access, entry.access_description, entry.access),
    changeNote: first(presentation.change_note, entry.change_note),
  };
}

async function readCatalogFixture() {
  const fixturePath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CF_CATALOG_PATH?.trim() ?? null;
  if (!fixturePath) return { status: STATUS.BLOCKED, path: null, catalog: null, basis: "The signed C-F 100-entry catalog fixture is not supplied to the native verifier." };
  try {
    await access(fixturePath, constants.R_OK);
    return { status: STATUS.PASS, path: fixturePath, catalog: JSON.parse(await readFile(fixturePath, "utf8")), basis: "The C-F catalog fixture is readable." };
  } catch (error) {
    return { status: STATUS.FAIL, path: fixturePath, catalog: null, basis: `The configured C-F catalog fixture is not readable JSON: ${error.message}` };
  }
}

/** Review the C-F browse-only catalog contract for FR-7 and FR-8. */
export async function reviewCatalogInventory({
  renderedEntries = [],
  detailsRendered = false,
  browseObservation = null,
  candidate = null,
} = {}) {
  const fixture = await readCatalogFixture();
  const publicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CF_PUBLIC_KEY_PATH?.trim() ?? null;
  const fixtureRoot = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CF_FIXTURE_ROOT?.trim() ?? null;
  const publicKeyPem = publicKeyPath ? await readFile(publicKeyPath, "utf8").catch(() => null) : null;
  const packetIntegrity = fixture.status === STATUS.PASS
    ? await verifyExternalPacket(fixture.catalog, { publicKeyPem, candidate, fixturePath: fixtureRoot })
    : { valid: false, reason: fixture.basis };
  const catalog = fixture.catalog?.payload ?? fixture.catalog;
  const entries = catalog?.entries ?? catalog?.apps ?? [];
  const fields = entries.map(entryFields);
  const missingFields = fields.flatMap((entry, index) => Object.entries(entry).filter(([, value]) => !value).map(([key]) => `${index}:${key}`));
  const renderedCount = renderedEntries.length;
  const packageDownloadEvidenceAvailable = Number.isInteger(browseObservation?.packageDownloadRequests);
  const noPackageSideEffects = browseObservation?.packageStoreUnchanged === true
    && browseObservation?.stagingUnchanged === true
    && browseObservation?.newProcesses?.length === 0
    && browseObservation?.packageDownloadRequests === 0;
  const installedFirst = browseObservation?.installedFirst === true;
  const renderedMetadataMissing = fields.flatMap((entry) => {
    const rendered = renderedEntries.find((candidate) => candidate.appKey === entry.appId || candidate.packageId === entry.appId);
    if (!rendered) return [`${entry.appId ?? "unknown"}:rendered-entry`];
    const text = String(rendered.text ?? "").toLowerCase();
    return [
      ["name", entry.name],
      ["publisher", entry.publisher],
      ["version", entry.version],
    ].filter(([, value]) => value && !text.includes(String(value).toLowerCase())).map(([key]) => `${entry.appId ?? "unknown"}:rendered-${key}`);
  });
  const identityParity = fields.length > 0 && fields.every((entry) => {
    if (!entry.appId) return false;
    const comparison = (browseObservation?.manifestParity ?? []).find((candidate) => candidate.appId === entry.appId);
    if (!comparison?.matches) return false;
    return ["displayName", "publisher", "version"].every((key) => !comparison[key] || comparison[key] === entry[{ displayName: "name", publisher: "publisher", version: "version" }[key]]);
  });
  const rows = {
    "FR-7": fixture.status !== STATUS.PASS || !packetIntegrity.valid
      ? row(fixture.status === STATUS.FAIL || (fixture.status === STATUS.PASS && !packetIntegrity.valid) ? STATUS.FAIL : STATUS.BLOCKED, `The C-F catalog packet is not acceptable: ${packetIntegrity.reason ?? fixture.basis}`)
      : !packageDownloadEvidenceAvailable
        ? row("blocked", "The C-F browse run did not provide the required package-network capture; metadata-only catalog tracing cannot prove zero package downloads.")
      : entries.length === 100 && renderedCount === 100 && detailsRendered && noPackageSideEffects && installedFirst
        ? row(STATUS.PASS, "All 100 C-F entries rendered in details mode, the installed entry was first, and browsing caused no package download, staging write, or new process.")
        : row(STATUS.FAIL, `C-F browse contract failed. Fixture entries: ${entries.length}; rendered: ${renderedCount}; details rendered: ${detailsRendered}; installed first: ${installedFirst}; side effects clean: ${noPackageSideEffects}.`),
    "FR-8": fixture.status !== STATUS.PASS || !packetIntegrity.valid
      ? row(fixture.status === STATUS.FAIL || (fixture.status === STATUS.PASS && !packetIntegrity.valid) ? STATUS.FAIL : STATUS.BLOCKED, `The C-F catalog packet is not acceptable: ${packetIntegrity.reason ?? fixture.basis}`)
      : missingFields.length === 0 && identityParity
        && renderedMetadataMissing.length === 0
        ? row(STATUS.PASS, "Every C-F entry carries identity, purpose, publisher, version, access description, and change note, with displayed identity matching the verified manifest.")
        : row(STATUS.BLOCKED, `Catalog metadata or manifest parity is incomplete. Missing fields: ${missingFields.join(", ") || "none"}; rendered identity gaps: ${renderedMetadataMissing.join(", ") || "none"}; identity parity: ${identityParity}.`),
  };
  return { review: "E-2 C-F catalog inventory", fixture, packetIntegrity, entryCount: entries.length, missingFields, renderedCount, detailsRendered, browseObservation, rows, status: reviewStatus(rows) };
}
