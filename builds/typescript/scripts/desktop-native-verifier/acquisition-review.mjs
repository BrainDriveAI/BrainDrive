import { access, constants } from "node:fs/promises";
import { normalizeRows, reviewStatus, STATUS } from "./verification-contract.mjs";

const REQUIRED_PATHS = ["catalog", "link", "zip"];
const INVALID_FIXTURES = [
  { id: "PK-2", defect: "invalid signature", expectedReason: /signature/i },
  { id: "PK-3", defect: "bad archive digest", expectedReason: /digest/i },
  { id: "PK-4", defect: "malformed archive", expectedReason: /archive|format|parse|zip/i },
  { id: "PK-5", defect: "unregistered package", expectedReason: /register|review|authority/i },
];

const textOf = (value) => typeof value === "string" ? value : "";
const controlsText = (controls = []) => controls.map((control) => `${textOf(control.text)} ${textOf(control.ariaLabel)}`).join(" ");

async function fixturePacketState() {
  const root = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FIXTURE_ROOT?.trim();
  if (!root) {
    return {
      status: "blocked",
      root: null,
      basis: "The accepted PK-2–PK-5 concrete fixture packet and test signing authority are not supplied to the native verifier.",
    };
  }

  const entries = {};
  for (const fixture of INVALID_FIXTURES) {
    entries[fixture.id] = {};
    for (const channel of ["link", "zip"]) {
      const candidates = [
        `${root}/${fixture.id}/${channel}`,
        `${root}/${fixture.id}-${channel}`,
        `${root}/${fixture.id}.${channel}`,
      ];
      let found = null;
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.R_OK);
          found = candidate;
          break;
        } catch {
          // Continue through the documented fixture naming forms.
        }
      }
      entries[fixture.id][channel] = found ? { status: "ready", path: found } : { status: "missing" };
    }
  }
  const missing = INVALID_FIXTURES.flatMap((fixture) => ["link", "zip"].map((channel) =>
    entries[fixture.id][channel].status === "ready" ? null : `${fixture.id}/${channel}`)).filter(Boolean);
  const normalizedRows = normalizeRows(rows);
  return {
    status: missing.length === 0 ? "ready" : "blocked",
    root,
    entries,
    missing,
    basis: missing.length === 0
      ? "All PK-2–PK-5 link and ZIP fixture inputs are available to the native verifier."
      : `The PK-2–PK-5 fixture packet is incomplete: ${missing.join(", ")}.`,
  };
}

function unavailablePath(path, reason) {
  return {
    status: "fail",
    exercised: false,
    ownerFacingControl: false,
    sideEffectCheck: "not_run",
    reason,
    requiredFor: path,
  };
}

/**
 * Review the US-2 acquisition/verification slice without manufacturing link or
 * ZIP UI. The lifecycle plan requires those paths, so their absence is a
 * product failure (not an implementation pass); missing concrete PK fixtures
 * remain a separate blocked instrumentation prerequisite.
 */
export async function reviewAcquisitionPaths({
  appsBody,
  preInstallControls = [],
  postInstallControls = [],
  alternativeAcquisitionControls = [],
  dialogs = [],
  lifecycleEvents = [],
  catalogInstallExecuted = false,
}) {
  const visibleText = `${textOf(appsBody)} ${controlsText(preInstallControls)} ${controlsText(postInstallControls)} ${controlsText(alternativeAcquisitionControls)}`;
  const linkControl = /github|install\s+from\s+(?:link|url)|from\s+link|repository\s+link/i.test(visibleText);
  const zipControl = /zip|upload|import\s+(?:app|package)|browse.*package/i.test(visibleText);
  const originRule = /not from BrainDrive and cannot be installed yet|github\.com\/BrainDriveAI|origin rule|BrainDrive origin/i.test(visibleText);
  const approvalPrompt = dialogs.find((dialog) => /approv|review.*access|requested access/i.test(textOf(dialog))) ?? null;
  const verificationEvents = lifecycleEvents.filter((event) =>
    /verif/i.test(`${textOf(event.event)} ${JSON.stringify(event.details ?? {})}`),
  );
  const fixturePacket = await fixturePacketState();

  const paths = {
    catalog: {
      status: catalogInstallExecuted ? "observed" : "not_run",
      exercised: catalogInstallExecuted,
      ownerFacingControl: true,
      approvalPromptObserved: Boolean(approvalPrompt),
      verificationEvidenceObserved: verificationEvents.length > 0,
      sideEffectCheck: catalogInstallExecuted ? "observed" : "not_run",
    },
    link: linkControl
      ? { status: "available", exercised: false, ownerFacingControl: true, sideEffectCheck: "not_run", reason: "A reviewed-link control is visible, but the native run did not submit a link fixture." }
      : unavailablePath("reviewed BrainDriveAI link", "The Apps surface has no owner-facing reviewed-link acquisition control."),
    zip: zipControl
      ? { status: "available", exercised: false, ownerFacingControl: true, sideEffectCheck: "not_run", reason: "A ZIP/import control is visible, but the native run did not submit a ZIP fixture." }
      : unavailablePath("verified ZIP", "The Apps surface has no owner-facing ZIP/import acquisition control."),
  };

  const pathParity = REQUIRED_PATHS.every((path) => paths[path].status === "observed" || paths[path].status === "available");
  const linkZipAvailable = paths.link.ownerFacingControl && paths.zip.ownerFacingControl;
  const validParity = paths.catalog.status === "observed" && linkZipAvailable && Boolean(approvalPrompt);
  const invalidFixturePaths = Object.fromEntries(INVALID_FIXTURES.map((fixture) => [fixture.id, {
    defect: fixture.defect,
    link: {
      ...(fixturePacket.entries?.[fixture.id]?.link ?? { status: "missing" }),
      expectedOutcome: "refused_before_approval",
      expectedReason: fixture.expectedReason.source,
      attempted: false,
      sideEffects: "not_observed: no reviewed-link control",
    },
    zip: {
      ...(fixturePacket.entries?.[fixture.id]?.zip ?? { status: "missing" }),
      expectedOutcome: "refused_before_approval",
      expectedReason: fixture.expectedReason.source,
      attempted: false,
      sideEffects: "not_observed: no ZIP/import control",
    },
  }]));

  const originBasis = originRule
    ? "The rendered Apps surface includes the accepted BrainDrive-origin rule text."
    : "The rendered Apps surface contains no pre-input origin-rule screen or accepted BrainDriveAI-link gate.";
  const invalidBasis = `${fixturePacket.basis} No invalid-package attempt can be made through the owner-facing link/ZIP paths until those paths and concrete fixtures exist.`;
  const rows = {
    "AC-2.1": {
      status: validParity ? STATUS.PASS : STATUS.FAIL,
      basis: validParity
        ? "Catalog, reviewed link, and verified ZIP paths expose the same approval contract."
        : "The catalog install path is observed, but the accepted reviewed-link and verified-ZIP owner paths are absent; identical entry/state/action parity cannot be claimed.",
    },
    "AC-2.2": {
      status: linkZipAvailable && originRule ? STATUS.PASS : STATUS.FAIL,
      basis: originBasis,
    },
    "AC-2.3": {
      status: linkZipAvailable && fixturePacket.status === "ready" ? STATUS.PASS : STATUS.FAIL,
      basis: invalidBasis,
    },
    "AC-2.4": {
      status: originRule ? STATUS.PASS : STATUS.FAIL,
      basis: originBasis,
    },
    "CF-3": {
      status: linkZipAvailable && originRule ? STATUS.PASS : STATUS.FAIL,
      basis: `Origin gate review: ${originBasis}`,
    },
    "CF-4": {
      status: linkZipAvailable && fixturePacket.status === "ready" ? STATUS.PASS : STATUS.FAIL,
      basis: `Host-verification negative-path review: ${invalidBasis}`,
    },
    "TB-4": {
      status: linkZipAvailable && fixturePacket.status === "ready" ? STATUS.PASS : STATUS.FAIL,
      basis: `Origin filtering is not accepted as a verification substitute. ${invalidBasis}`,
    },
    "FR-3": {
      status: validParity ? STATUS.PASS : STATUS.FAIL,
      basis: validParity
        ? "All acquisition paths share the observed approval and verification contract."
        : "Only the catalog-mediated install path exists in the desktop client; link/ZIP approval and verification parity is not available to test.",
    },
  };

  return {
    review: "US-2 acquisition and verification",
    requiredPaths: REQUIRED_PATHS,
    paths,
    originRule: { visible: originRule, basis: originBasis },
    approvalPrompt: approvalPrompt ? { observed: true, text: approvalPrompt } : { observed: false },
    verificationEvents: verificationEvents.length,
    pathParity,
    validParity,
    fixturePacket,
    invalidFixtures: invalidFixturePaths,
    rows: normalizedRows,
    status: reviewStatus(normalizedRows),
  };
}
