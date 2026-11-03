import { access, constants, readFile } from "node:fs/promises";
import { verifyExternalPacket } from "./packet-tools.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

const INSTALL_LEGS = ["network", "disk", "restart", "verification"];

function row(status, basis) {
  return { status, basis };
}

async function readObservation() {
  const fixtureRoot = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT?.trim() ?? null;
  const observationPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH?.trim() ?? null;
  if (!fixtureRoot || !observationPath) return { status: STATUS.BLOCKED, fixtureRoot, path: observationPath, observation: null, basis: "The signed F-1 fault packet and fixture root are not supplied." };
  try {
    await access(fixtureRoot, constants.R_OK);
    await access(observationPath, constants.R_OK);
    return { status: STATUS.PASS, fixtureRoot, path: observationPath, observation: JSON.parse(await readFile(observationPath, "utf8")), basis: "The F-1 packet is readable." };
  } catch (error) {
    return { status: STATUS.FAIL, fixtureRoot, path: observationPath, observation: null, basis: `The F-1 packet is not valid readable JSON: ${error.message}` };
  }
}

function sameHash(before, after) {
  return Boolean(before?.sha256 && after?.sha256 && before.sha256 === after.sha256);
}

function rawLifecycle(leg) {
  return leg?.rawEvidence?.lifecycleEvents ?? leg?.lifecycleEvents ?? [];
}

function rawActions(leg) {
  return leg?.rawEvidence?.actions ?? leg?.actions ?? [];
}

function lifecycleFailureObserved(leg) {
  return rawLifecycle(leg).some((event) => event?.event === "app.lifecycle.transition_completed" && event?.details?.outcome === "failed");
}

function noCommittedActivationAfterFailure(leg) {
  const events = rawLifecycle(leg);
  const failureAt = events.find((event) => event?.details?.outcome === "failed")?.timestamp;
  return Boolean(failureAt) && !events.some((event) => event?.details?.outcome === "committed" && String(event.timestamp) >= String(failureAt));
}

function lastKnownGoodWasActive(leg) {
  const events = rawLifecycle(leg);
  const failureAt = events.find((event) => event?.details?.outcome === "failed")?.timestamp;
  return Boolean(failureAt)
    && events.some((event) => event?.details?.outcome === "committed" && String(event.timestamp) < String(failureAt))
    && Boolean(leg?.durablePackageState?.before?.sha256);
}

function actionCount(leg, matcher) {
  return rawActions(leg).filter((action) => matcher.test(String(action.control ?? action.label ?? action.action ?? ""))).length;
}

function durableInstallLegPass(leg) {
  return leg?.entryAction === "Install"
    && actionCount(leg, /^Install(?: Resume Builder)?$/i) === 1
    && actionCount(leg, /^Retry(?:.*)?$/i) === 1
    && lifecycleFailureObserved(leg)
    && noCommittedActivationAfterFailure(leg)
    && sameHash(leg.ownerDataBefore, leg.ownerDataAfter)
    && sameHash(leg.packageStoreBefore, leg.packageStoreAfter)
    && Boolean(leg.durablePackageState?.before?.sha256 && leg.durablePackageState?.after?.sha256);
}

function durableUpdateLegPass(leg) {
  return leg?.entryAction === "Update"
    && actionCount(leg, /^Update(?: Resume Builder)?$/i) === 1
    && actionCount(leg, /^Retry(?:.*)?$/i) === 1
    && lifecycleFailureObserved(leg)
    && noCommittedActivationAfterFailure(leg)
    && sameHash(leg.ownerDataBefore, leg.ownerDataAfter)
    && Boolean(leg.durablePackageState?.before?.sha256 && leg.durablePackageState?.after?.sha256)
    && lastKnownGoodWasActive(leg);
}

/** Review F-1 only from signed, candidate/fixture-bound durable observations. */
export async function reviewFaultRecovery({ candidate = null } = {}) {
  const fixture = await readObservation();
  if (fixture.status !== STATUS.PASS) {
    const rows = { "AC-1.6": row(fixture.status, fixture.basis), "CF-2": row(fixture.status, fixture.basis) };
    return { review: "E-3/E-9 F-1 fault recovery", fixture, rows, status: fixture.status };
  }

  const publicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_PUBLIC_KEY_PATH?.trim() ?? null;
  const publicKeyPem = publicKeyPath ? await readFile(publicKeyPath, "utf8").catch(() => null) : null;
  const packetIntegrity = await verifyExternalPacket(fixture.observation, {
    publicKeyPem,
    candidate: candidate ?? fixture.observation.candidate,
    fixturePath: fixture.fixtureRoot,
  });
  if (!packetIntegrity.valid) {
    const basis = `The F-1 packet is not acceptable: ${packetIntegrity.reason}`;
    const rows = { "AC-1.6": row(STATUS.FAIL, basis), "CF-2": row(STATUS.FAIL, basis) };
    return { review: "E-3/E-9 F-1 fault recovery", fixture, packetIntegrity, rows, status: STATUS.FAIL };
  }

  const observation = fixture.observation;
  const legs = observation.installFailures ?? observation.install_failures ?? {};
  const missingLegs = INSTALL_LEGS.filter((leg) => !legs[leg]);
  const failedInstallLegs = INSTALL_LEGS.filter((leg) => legs[leg] && !durableInstallLegPass(legs[leg]));
  const updateLeg = observation.updateActivation ?? observation.update_activation ?? null;
  const installPass = missingLegs.length === 0 && failedInstallLegs.length === 0;
  const updatePass = durableUpdateLegPass(updateLeg);
  const rows = {
    "AC-1.6": missingLegs.length || failedInstallLegs.length
      ? row(STATUS.FAIL, `F-1 durable install coverage is incomplete. Missing: ${missingLegs.join(", ") || "none"}; failed: ${failedInstallLegs.join(", ") || "none"}.`)
      : row(STATUS.PASS, "All four fresh-profile fault legs recomputed failure, action counts, unchanged owner data, unchanged durable package state, and no committed activation after failure."),
    "CF-2": installPass && updatePass
      ? row(STATUS.PASS, "Install and update fault observations contain signed durable lifecycle/package evidence and a working last-known-good state without injector-supplied recovery.")
      : row(STATUS.FAIL, `Durable install pass: ${installPass}; durable update pass: ${updatePass}.`),
  };
  return { review: "E-3/E-9 F-1 fault recovery", fixture, packetIntegrity, missingLegs, failedInstallLegs, updatePass, rows, status: reviewStatus(rows) };
}
