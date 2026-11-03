import { access, constants } from "node:fs/promises";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

const OWNER_FIELD_PATTERN = /owner[_ -]?(?:id|identity|email|name)|installed[_ -]?apps?|usage|telemetry|credential|token|password|api[_ -]?key/i;

async function updateFixtureState() {
  const path = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CB_CATALOG_PATH?.trim() ?? null;
  if (!path) return { status: "blocked", path: null, basis: "The C-B catalog fixture for an automatic app-update observation was not supplied." };
  try {
    await access(path, constants.R_OK);
    return { status: "ready", path, basis: "The C-B catalog fixture is available to the native verifier." };
  } catch {
    return { status: "blocked", path, basis: "The configured C-B catalog fixture is not readable." };
  }
}

function row(status, basis) {
  return { status, basis };
}

/** Review E-16 and the automatic-check rows without treating UI presence as formal qualification. */
export async function reviewAutomaticChecks({
  observation,
  traceRecords = [],
  lifecycleEvents = [],
}) {
  const fixture = await updateFixtureState();
  const automaticTrace = traceRecords.filter((record) => record.trigger === "automatic");
  const privacyClean = automaticTrace.every((record) =>
    (record.request_body_fields ?? []).length === 0 &&
    (record.owner_data_fields ?? []).length === 0 &&
    (record.installed_app_fields ?? []).length === 0 &&
    (record.usage_fields ?? []).length === 0 &&
    !OWNER_FIELD_PATTERN.test(JSON.stringify({ target: record.target, error: record.error, request_body_fields: record.request_body_fields })),
  );
  const automaticLifecycleMutations = Math.max(0, (observation?.automaticMutationCountAfter ?? 0) - (observation?.automaticMutationCountBefore ?? 0));
  const defaultOff = observation?.toggleInitialChecked === false;
  const disclosureMatch = Boolean(observation?.manualDisclosure && observation?.automaticDisclosure && observation.manualDisclosure === observation.automaticDisclosure);
  const cadencePass = observation?.cadence?.stated === observation?.cadence?.configured && observation?.cadence?.intervals?.length >= 3 && observation.cadence.intervals.every((interval) => interval.requestCount === 1 && interval.betweenCount === 0);
  const closedPass = observation?.closedWindow?.requestCount === 0;
  const discoverOnlyPass = automaticLifecycleMutations === 0 && observation?.packageStateBefore && observation.packageStateBefore === observation.packageStateAfter;
  const silentFailurePass = observation?.failure?.errorVisible === false && observation.failure.asOfUnchanged === true;
  const offSwitchPass = observation?.offWindow?.requestCount === 0 && observation?.manualAfterOff?.succeeded === true;
  const persistencePass = observation?.persistence?.afterReload === true && observation.persistence.afterRestart === true;
  const appUpdatePass = observation?.appUpdate?.badgeVisible === true && observation.appUpdate.noteVisible === true && observation.appUpdate.mutationCount === 0;
  const brainDriveUpdatePass = observation?.brainDriveUpdate?.sidebarIndicatorVisible === true && observation.brainDriveUpdate.appsContainsBrainDriveEntry === false;

  const rows = {
    "AC-8.1": defaultOff && disclosureMatch && cadencePass && closedPass && privacyClean
      ? row(STATUS.PASS, "The fresh profile defaulted off, the turn-on disclosure matched the manual disclosure, controlled-clock windows produced one attributed automatic check per cadence interval, and no checks fired while closed.")
      : row("blocked", `Controlled-clock cadence evidence is incomplete. Default off: ${defaultOff}; disclosure match: ${disclosureMatch}; cadence: ${cadencePass}; closed window: ${closedPass}; trace privacy: ${privacyClean}.`),
    "AC-8.2": appUpdatePass && discoverOnlyPass
      ? row(STATUS.PASS, "The automatic catalog check surfaced the app Update badge and what-changed note while the lifecycle journal and package state stayed unchanged until owner action.")
      : row("blocked", `The C-B automatic-update fixture or discover-only badge observation is incomplete. ${fixture.basis}`),
    "AC-8.3": silentFailurePass
      ? row(STATUS.PASS, "A failed automatic check left the as-of date unchanged and produced no owner-visible error, dialog, toast, or badge change.")
      : row("blocked", "The native run did not yet capture a controlled automatic repository failure and UI-state diff."),
    "AC-8.4": offSwitchPass
      ? row(STATUS.PASS, "After the owner turned automatic checks off, two controlled-clock intervals produced no automatic request while a manual refresh still succeeded.")
      : row("blocked", "The controlled two-interval off-window and manual-refresh-after-off evidence is incomplete."),
    "AC-8.6": brainDriveUpdatePass
      ? row(STATUS.PASS, "One automatic catalog check fed the existing sidebar BrainDrive update indicator without creating a BrainDrive entry in Apps.")
      : row("blocked", "The BrainDrive update fixture and sidebar indicator observation were not supplied to this native run."),
    "DC-2": persistencePass
      ? row(STATUS.PASS, "The Apps preference stayed enabled after reload and restart; the BrainDrive-update persistence leg still requires a second host build if not captured.")
      : row("blocked", "Automatic-check preference persistence across reload/restart and the BrainDrive-update leg are not fully captured."),
    "FR-5": defaultOff && discoverOnlyPass && brainDriveUpdatePass
      ? row(STATUS.PASS, "The automatic-check preference is opt-in, discover-only, and feeds both app and BrainDrive update indicators without automatic lifecycle mutation.")
      : row("blocked", "FR-5 closes by reference to AC-8.1, AC-8.2, and AC-8.6; one or more referenced automatic-check observations remain incomplete."),
    "NG-2": defaultOff && privacyClean && discoverOnlyPass && automaticTrace.every((record) => record.trigger === "automatic")
      ? row(STATUS.PASS, "Automatic checks were off by default, every observed automatic request was attributed to the automatic trigger, no owner fields were present, and no install/update committed.")
      : row("blocked", "The no-background-network/no-automatic-mutation invariant needs the complete controlled-clock capture and lifecycle join."),
  };
  const status = reviewStatus(rows);
  return { review: "US-8 automatic checks", fixture, observation, automaticTrace, privacyClean, rows, status };
}
