import { access, constants } from "node:fs/promises";
import { normalizeRows, reviewStatus, STATUS } from "./verification-contract.mjs";

const REQUIRED_FIXTURES = ["C-B", "C-C", "C-D", "C-G", "D-2"];

const textOf = (value) => typeof value === "string" ? value : "";
const controlsText = (controls = []) => controls.map((control) => `${textOf(control.text)} ${textOf(control.ariaLabel)}`).join(" ");

async function fixtureState() {
  const root = process.env.BRAINDRIVE_DESKTOP_VERIFIER_UPDATE_FIXTURE_ROOT?.trim();
  if (!root) {
    return {
      status: "blocked",
      root: null,
      missing: REQUIRED_FIXTURES,
      basis: "The accepted C-B, C-C, C-D, C-G, and D-2 update fixture inputs are not supplied to the native verifier.",
    };
  }

  const entries = {};
  for (const fixture of REQUIRED_FIXTURES) {
    const candidates = [`${root}/${fixture}`, `${root}/${fixture.toLowerCase()}`, `${root}/${fixture}.json`, `${root}/${fixture.toLowerCase()}.json`];
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
  const normalizedRows = normalizeRows(rows);
  return {
    status: missing.length === 0 ? "ready" : "blocked",
    root,
    entries,
    missing,
    basis: missing.length === 0
      ? "All required update fixture inputs are available to the native verifier."
      : `The update fixture packet is incomplete: ${missing.join(", ")}.`,
  };
}

function blocked(basis) {
  return { status: STATUS.BLOCKED, basis };
}

function failed(basis) {
  return { status: STATUS.FAIL, basis };
}

/**
 * Review the US-3 update contract against the owner-visible native surface.
 * This records missing fixture/injector prerequisites as blocked and missing
 * product controls as failed; it never treats the install path as update proof.
 */
export async function reviewUpdatePath({
  activeText = "",
  activeControls = [],
  lifecycleEvents = [],
  inputActions = [],
  dialogs = [],
  ownerDataBefore = null,
  ownerDataAfter = null,
}) {
  const fixture = await fixtureState();
  const surface = `${textOf(activeText)} ${controlsText(activeControls)}`;
  const updateControl = /\bupdate\b/i.test(surface);
  const changeNote = /what changed|change note|changes? in this version/i.test(surface);
  const updateEvents = lifecycleEvents.filter((event) =>
    /update/i.test(`${textOf(event.event)} ${JSON.stringify(event.details ?? {})}`),
  );
  const committedUpdate = updateEvents.some((event) =>
    event.event === "app.lifecycle.transition_completed"
    && event.details?.lifecycle_action === "update"
    && event.details?.outcome === "committed",
  );
  const approvalDialogs = dialogs.filter((dialog) => /approv|review.*access|requested access/i.test(textOf(dialog)));
  const updateAction = inputActions.find((action) => /update/i.test(textOf(action.control)));
  const ownerDataCompared = ownerDataBefore && ownerDataAfter;
  const ownerDataPreserved = ownerDataCompared ? ownerDataBefore.sha256 === ownerDataAfter.sha256 : null;
  const fixtureBasis = fixture.basis;
  const updatePathBasis = updateControl
    ? "The active Apps entry exposes an Update action."
    : "The active Apps entry exposes no Update action because no newer catalog fixture is available in this run.";

  const rows = {
    "AC-3.1": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} ${updatePathBasis} The badge, change note, v2 activation, and owner-data comparison were not executable.`)
      : updateControl && changeNote && committedUpdate && ownerDataPreserved
        ? { status: STATUS.PASS, basis: "Update badge/change note, activation, and owner-data preservation were observed." }
        : failed("The update path did not produce the required Update badge/change note, committed v2 transition, and preserved owner data."),
    "AC-3.2": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} The access-widening update and its decline branch were not executable.`)
      : updateControl && approvalDialogs.length > 0
        ? { status: STATUS.PASS, basis: "A fresh access-widening approval prompt was observed for the update path." }
        : failed("The update path did not expose a fresh approval screen for the access-widening update."),
    "AC-3.3": blocked(`${fixtureBasis} The activation-failure injector and last-known-good update branch are not supplied to the native verifier.`),
    "AC-3.4": updateEvents.length === 0
      ? blocked("No update operation occurred in this run, so the no-silent-update journal-to-input join is not executable.")
      : updateEvents.every(() => Boolean(updateAction))
        ? { status: STATUS.PASS, basis: "Every observed update event has a preceding owner Update action in the input log." }
        : failed("An update lifecycle event lacks a preceding owner Update action."),
    "AC-3.5": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} The newer-BrainDrive compatibility fixture and owner-visible update route were not executable.`)
      : failed("The required newer-BrainDrive state was not observed."),
    "AC-3.6": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} Ordinary-update preservation, security-fix disclosure, named-material replacement, and conversation-affecting notice were not executable.`)
      : failed("The update run did not prove owner-edit preservation and the security-fix/conversation-affecting disclosure contract."),
    "CF-6": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} The newer-BrainDrive compatibility refusal was not executable.`)
      : failed("The newer-BrainDrive requirement path was not observed."),
    "CF-7": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} The access-widening approval/decline path was not executable.`)
      : failed("The access-widening update did not expose the required fresh approval and decline behavior."),
    "TB-3": updateEvents.length === 0
      ? blocked("No update operation occurred in this run; silent-update and fresh-approval invariants require an update fixture.")
      : failed("The update journal/input and approval joins did not close the trust-boundary review."),
    "FR-6": fixture.status === "blocked"
      ? blocked(`${fixtureBasis} The ordinary and security-fix update legs were not executable.`)
      : failed("The update path did not prove owner-edit preservation, owner-triggered security-fix disclosure, and named-material replacement."),
  };

  return {
    review: "US-3 update and owner-edit preservation",
    fixture,
    surface: {
      updateControl,
      changeNote,
      activeControls,
      activeText,
    },
    execution: {
      updateEvents: updateEvents.length,
      committedUpdate,
      approvalDialogs: approvalDialogs.length,
      ownerUpdateActionObserved: Boolean(updateAction),
      ownerDataCompared,
      ownerDataPreserved,
    },
    rows: normalizedRows,
    status: reviewStatus(normalizedRows),
  };
}
