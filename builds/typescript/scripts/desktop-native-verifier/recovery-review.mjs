import { access, constants, readFile } from "node:fs/promises";
import { verifyExternalPacket } from "./packet-tools.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

const REQUIRED_FIXTURES = ["S-1", "RV-1"];
const ALLOWED_ACTIONS = new Set(["retry", "update_brain_drive", "remove"]);

const EXPECTED_PROJECTIONS = {
  staged_interrupted_install: {
    hostState: "staged",
    ownerState: "Needs attention",
    reason: "This app didn't finish installing.",
    action: "retry",
  },
  disabled_host: {
    hostState: "disabled",
    ownerState: "Needs attention",
    reason: "This app needs a newer BrainDrive.",
    action: "update_brain_drive",
  },
  quarantined: {
    hostState: "quarantined",
    ownerState: "Needs attention",
    reason: "BrainDrive stopped this app for safety. Your data is kept.",
    action: "remove",
  },
  failed_recoverable: {
    hostState: "failed_recoverable",
    ownerState: "Needs attention",
    reason: "The last app change didn't finish. Your data is kept.",
    action: "retry",
  },
  disabled_owner: {
    hostState: "disabled",
    ownerState: "Normal (off)",
    reason: null,
    action: null,
  },
};

const RETRY_EXPECTATIONS = {
  interrupted_install: ["resume", "retry"],
  interrupted_update: ["resume", "retry", "restore_last_known_good", "restart_last_known_good"],
  interrupted_uninstall: ["finish_uninstall_cleanup"],
  revoked_package: ["refuse_into_quarantine"],
};

function blocked(basis) {
  return { status: STATUS.BLOCKED, basis };
}

function failed(basis) {
  return { status: STATUS.FAIL, basis };
}

function implemented(basis) {
  return { status: STATUS.PASS, basis };
}

function textOf(value) {
  return typeof value === "string" ? value : "";
}

function controlsText(controls = []) {
  return controls.map((control) => `${textOf(control.text)} ${textOf(control.ariaLabel)}`).join(" ");
}

function actionValues(observation) {
  if (Array.isArray(observation?.actions)) return observation.actions;
  if (Array.isArray(observation?.controls)) return observation.controls
    .filter((control) => control?.visible !== false)
    .map((control) => control.action ?? control.text ?? control.ariaLabel)
    .filter(Boolean);
  return [];
}

function sentenceCount(value) {
  const text = textOf(value).trim();
  if (!text) return 0;
  return text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

function hashUnchanged(observation) {
  const before = observation?.ownerDataBefore?.sha256;
  const after = observation?.ownerDataAfter?.sha256;
  return typeof before === "string" && before.length > 0 && before === after;
}

function sameHash(before, after) {
  return Boolean(before?.sha256 && after?.sha256 && before.sha256 === after.sha256);
}

async function fixturePacketState() {
  const root = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT?.trim();
  if (!root) {
    return {
      status: "blocked",
      root: null,
      missing: REQUIRED_FIXTURES,
      basis: "The accepted S-1 durable-state seed and RV-1 signed revocation fixtures are not supplied to the native verifier.",
    };
  }

  const entries = {};
  for (const fixture of REQUIRED_FIXTURES) {
    const candidates = [
      `${root}/${fixture}`,
      `${root}/${fixture.toLowerCase()}`,
      `${root}/${fixture}.json`,
      `${root}/${fixture.toLowerCase()}.json`,
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
    entries[fixture] = found ? { status: "ready", path: found } : { status: "missing" };
  }
  const missing = REQUIRED_FIXTURES.filter((fixture) => entries[fixture].status !== "ready");
  return {
    status: missing.length === 0 ? "ready" : "blocked",
    root,
    entries,
    missing,
    basis: missing.length === 0
      ? "The S-1 and RV-1 fixture packet is available to the native verifier."
      : `The recovery fixture packet is incomplete: ${missing.join(", ")}.`,
  };
}

async function projectionCheck(observation, expected, visibleText) {
  const hostStatePass = observation?.hostState === expected.hostState;
  const state = observation?.ownerState ?? observation?.stateText;
  const reason = observation?.reason ?? observation?.reasonText;
  const actions = actionValues(observation);
  const visible = `${textOf(observation?.visibleText)} ${visibleText}`;
  const reasonPass = expected.reason === null
    ? !reason && !/needs attention/i.test(visible)
    : reason === expected.reason
      && visible.includes(expected.reason)
      // The accepted AC-9.3 table contains two exact retention-disclosure
      // strings; those remain authoritative even though AC-9.1 calls the
      // reason a one-sentence explanation.
      && (sentenceCount(reason) === 1
        || reason === EXPECTED_PROJECTIONS.quarantined.reason
        || reason === EXPECTED_PROJECTIONS.failed_recoverable.reason);
  const statePass = state === expected.ownerState && visible.includes(expected.ownerState);
  const actionPass = expected.action === null
    ? actions.length === 0
    : actions.length === 1 && actions[0] === expected.action;
  const screenshotPass = typeof observation?.screenshot === "string" && observation.screenshot.length > 0
    && await access(observation.screenshot, constants.R_OK).then(() => true, () => false);
  return {
    pass: hostStatePass && statePass && reasonPass && actionPass && hashUnchanged(observation) && screenshotPass,
    hostStatePass,
    statePass,
    reasonPass,
    actionPass,
    dataPass: hashUnchanged(observation),
    screenshotPass,
    observed: { state, reason, actions, screenshot: observation?.screenshot ?? null },
  };
}

function retryCheck(observation) {
  const expected = RETRY_EXPECTATIONS[observation?.scenario] ?? [];
  const before = observation?.operationBefore;
  const after = observation?.operationAfter;
  const recordedAction = after?.recoveryAction ?? after?.action ?? after?.result?.recovery_action;
  const recordPresent = Boolean(before?.operationId && after?.operationId && before.operationId === after.operationId);
  const actionPass = expected.includes(recordedAction);
  const lifecycle = observation?.rawEvidence?.lifecycleEvents ?? observation?.lifecycleEvents ?? [];
  const failureAt = lifecycle.find((event) => event?.details?.outcome === "failed")?.timestamp;
  const noPartialActivation = Boolean(failureAt) && !lifecycle.some((event) => event?.details?.outcome === "committed" && String(event.timestamp) >= String(failureAt));
  const lastKnownGoodSafe = observation?.scenario !== "interrupted_update"
    || (observation?.rawEvidence?.lastKnownGood?.active === true && sameHash(observation?.rawEvidence?.packageBefore, observation?.rawEvidence?.packageAfter));
  return {
    pass: recordPresent && actionPass && noPartialActivation && hashUnchanged(observation) && lastKnownGoodSafe,
    recordPresent,
    actionPass,
    noPartialActivation,
    dataPass: hashUnchanged(observation),
    lastKnownGoodSafe,
    recordedAction: recordedAction ?? null,
  };
}

function allChecksPass(checks) {
  return checks.length > 0 && checks.every((check) => check.pass);
}

/**
 * Review US-9's owner-facing recovery contract. The native driver supplies
 * the observations after S-1 has seeded a host state and the owner has taken
 * the offered action. Fixture absence is infrastructure-blocked; malformed or
 * contradictory observations are product/evidence failures.
 */
export async function reviewRecoveryAndAttention({
  candidate = null,
  observationPacket = null,
  visibleText = "",
  controls = [],
  lifecycleEvents = [],
  screenshots = [],
  ownerData = null,
} = {}) {
  const fixture = await fixturePacketState();
  const packet = observationPacket && typeof observationPacket === "object" ? observationPacket : {};
  const publicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_PUBLIC_KEY_PATH?.trim() ?? null;
  const publicKeyPem = publicKeyPath ? await readFile(publicKeyPath, "utf8").catch(() => null) : null;
  const packetIntegrity = observationPacket
    ? await verifyExternalPacket(observationPacket, { publicKeyPem, candidate, fixturePath: fixture.root })
    : { valid: false, reason: "The signed recovery observation packet is not supplied." };
  const states = Array.isArray(packet.states) ? packet.states : [];
  const retries = Array.isArray(packet.retries) ? packet.retries : [];
  const disabledStates = states.filter((state) => state?.id === "disabled_owner" || state?.id === "disabled_host");
  const visible = `${textOf(visibleText)} ${controlsText(controls)}`;
  const normalizedStates = states.map((state) => ({
    ...state,
    screenshot: state?.screenshot ?? null,
    ownerDataBefore: state?.ownerDataBefore ?? null,
    ownerDataAfter: state?.ownerDataAfter ?? null,
  }));
  const stateChecks = await Promise.all(normalizedStates.map(async (state) => {
    const expected = EXPECTED_PROJECTIONS[state.id];
    return { id: state.id, expected, ...expected ? await projectionCheck(state, expected, visible) : { pass: false, reasonPass: false, statePass: false, actionPass: false, dataPass: false, screenshotPass: false } };
  }));
  const retryChecks = retries.map((retry) => ({ scenario: retry.scenario, ...retryCheck(retry) }));
  const recoveryRowsReady = fixture.status === STATUS.PASS && packetIntegrity.valid && states.length > 0;
  const stateBasis = fixture.status === "blocked"
    ? `${fixture.basis} E-17 cannot seed or drive its owner-visible state matrix.`
    : !recoveryRowsReady
      ? "The recovery fixture packet is present, but the native run supplied no seeded host-state observations."
      : allChecksPass(stateChecks)
        ? "Every supplied S-1 state projected to one owner-facing state, one reason, one action, screenshot, and unchanged owner-data digest."
        : "At least one supplied S-1 state did not satisfy the exact owner-facing projection, screenshot, action-count, or owner-data invariant.";
  const retryBasis = fixture.status === "blocked"
    ? `${fixture.basis} AC-9.6 requires a durable operation-record snapshot before and after every Retry.`
    : retries.length === 0
      ? "The recovery fixture packet is present, but no before/after Retry operation records were supplied."
      : allChecksPass(retryChecks)
        ? "Every Retry used the durable operation record to select the paired recovery action and preserved data without partial activation."
        : "At least one Retry record is missing, mismatched, partially activating, or changes owner data.";
  const disabledPairPass = recoveryRowsReady
    && disabledStates.some((state) => state.id === "disabled_owner")
    && disabledStates.some((state) => state.id === "disabled_host")
    && stateChecks.filter((check) => check.id === "disabled_owner" || check.id === "disabled_host").every((check) => check.pass)
    && !/\bEnable\b/i.test(visible);
  const revoked = packet.revocation ?? null;
  const revocationScreenshotPass = typeof revoked?.screenshot === "string"
    && await access(revoked.screenshot, constants.R_OK).then(() => true, () => false);
  const revocationPass = recoveryRowsReady
    && Boolean(revoked)
    && revoked.openAttempt?.opened === false
    && revoked.ownerState === "Needs attention"
    && revoked.reason === EXPECTED_PROJECTIONS.quarantined.reason
    && ["remove", "update"].includes(revoked.nextAction)
    && hashUnchanged(revoked)
    && revocationScreenshotPass;
  const anyRawHostState = /\b(staged|failed_recoverable|quarantined|rollback_pending|uninstalling)\b/i.test(visible);
  const exactReasonStates = stateChecks.filter((state) => state.id !== "disabled_owner");
  const if2Pass = recoveryRowsReady && allChecksPass(exactReasonStates) && !anyRawHostState;
  const if3Pass = recoveryRowsReady && exactReasonStates.every((state) => {
    const expected = EXPECTED_PROJECTIONS[state.id];
    return expected && ALLOWED_ACTIONS.has(expected.action);
  });
  const rows = {
    "AC-9.1": fixture.status === "blocked" ? blocked(stateBasis) : recoveryRowsReady && allChecksPass(stateChecks) ? implemented(stateBasis) : failed(stateBasis),
    "AC-9.2": fixture.status === "blocked" ? blocked(`${fixture.basis} Owner-data hashes cannot be joined to seeded abnormal states.`) : recoveryRowsReady && stateChecks.every((check) => check.dataPass) ? implemented("Every seeded abnormal-state observation kept the owner-data digest unchanged.") : failed("At least one abnormal-state observation does not prove owner-data retention."),
    "AC-9.3": fixture.status === "blocked" ? blocked(stateBasis) : recoveryRowsReady && allChecksPass(stateChecks) ? implemented("The supplied S-1 state matrix matches the accepted host-state to owner-state, reason, and action table.") : failed("The supplied state matrix does not match the accepted AC-9.3 projection table."),
    "AC-9.4": fixture.status === "blocked" ? blocked(`${fixture.basis} No seeded next-action transitions can be driven.`) : recoveryRowsReady && normalizedStates.every((state) => state.transition && state.transition.deadEnd !== true) ? implemented("Each supplied next-action observation includes a non-dead-end transition.") : failed("A supplied next-action observation is missing or leaves the owner at a dead end."),
    "AC-9.5": fixture.status === "blocked" ? blocked(`${fixture.basis} Both disabled causes must be seeded before their projection can be compared.`) : disabledPairPass ? implemented("Owner-disabled remains normal/off while host-disabled projects Needs attention, and no general Enable control is exposed.") : failed("The disabled owner/host cause split or no-general-Enable control was not proven."),
    "AC-9.6": fixture.status === "blocked" ? blocked(retryBasis) : retries.length > 0 && allChecksPass(retryChecks) ? implemented(retryBasis) : failed(retryBasis),
    "CF-5": fixture.status === "blocked" ? blocked(`${fixture.basis} E-18 cannot apply a signed revocation or attempt the quarantined app.`) : revocationPass ? implemented("RV-1 stopped the app from opening, projected the quoted safety reason, offered removal/update, and retained owner data.") : failed("The revocation observation did not prove stop-opening, quoted reason, allowed action, screenshot, and data retention."),
    "IF-2": fixture.status === "blocked" ? blocked(`${fixture.basis} The complete seeded abnormal-state surface is not executable.`) : if2Pass ? implemented("Every supplied abnormal installed-app state projected one Needs attention surface with one plain-English reason and one action, without exposing host state names.") : failed("The owner-facing abnormal-state surface exposes more than the accepted Needs attention projection or lacks its reason/action."),
    "IF-3": fixture.status === "blocked" ? blocked(`${fixture.basis} Failure-state controls cannot be checked across the required seeded states.`) : if3Pass ? implemented("Every supplied failure state maps to one allowed plain-language next action.") : failed("A supplied failure state has no single allowed plain-language next action."),
  };
  return {
    review: "US-9 recovery, quarantine, and owner-facing failure states",
    fixture,
    packetIntegrity,
    states: stateChecks,
    retries: retryChecks,
    revocation: revoked,
    lifecycleEvents: lifecycleEvents.length,
    surface: { visibleText, controls, rawHostStateDetected: anyRawHostState },
    rows,
    status: reviewStatus(rows),
  };
}
