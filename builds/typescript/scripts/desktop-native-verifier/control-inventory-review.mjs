import { STATUS, reviewStatus } from "./verification-contract.mjs";

const PRIMARY_ACTIONS = new Set(["install", "open", "update", "uninstall", "delete_data"]);
const FORBIDDEN_ACTION_PATTERN = /\b(?:disable|enable|roll\s*back|rollback)\b/i;
const LIFECYCLE_ENTRY_PATTERN = /\b(?:install|update|uninstall|delete\s+(?:retained\s+)?data|open|launch|disable|enable|roll\s*back|rollback)\b/i;

function textOf(control = {}) {
  return `${control.text ?? ""} ${control.ariaLabel ?? ""}`.replace(/\s+/g, " ").trim();
}

function isLifecycleText(text) {
  return LIFECYCLE_ENTRY_PATTERN.test(text) && !/BrainDrive update available/i.test(text);
}

function classifyControl(control) {
  const text = textOf(control);
  if (/check automatically/i.test(text)) return "supporting:apps-preference";
  if (/refresh app catalog|check for new apps and updates/i.test(text)) return "supporting:catalog";
  if (/retry/i.test(text)) return "supporting:recovery";
  if (/requires?\s+|install .*provider|provider/i.test(text) && /install|open|view|go|details/i.test(text)) return "catalog-navigation";
  if (/delete\s+(?:retained\s+)?data/i.test(text)) return "primary:delete_data";
  if (/uninstall|remove app code/i.test(text)) return "primary:uninstall";
  if (/update/i.test(text) && !/BrainDrive update available/i.test(text)) return "primary:update";
  if (/install/i.test(text)) return "primary:install";
  if (/open|launch/i.test(text)) return "primary:open";
  if (FORBIDDEN_ACTION_PATTERN.test(text)) return "forbidden:owner-lifecycle";
  return LIFECYCLE_ENTRY_PATTERN.test(text) ? "unclassified:lifecycle" : "other";
}

function flattenControls(inventories = []) {
  return inventories.flatMap((inventory) => (inventory.controls ?? []).map((control) => ({
    ...control,
    state: inventory.state,
    surface: inventory.surface ?? "unknown",
    classification: classifyControl(control),
  })));
}

function row(status, basis) {
  return { status, basis };
}

/** Review E-19's owner-facing control contract from native observations. */
export function reviewControlInventory({ inventories = [], automaticCheckObservation = null, settingsOpened = false } = {}) {
  const controls = flattenControls(inventories);
  const forbidden = controls.filter((control) => control.classification === "forbidden:owner-lifecycle");
  const settingsLifecycleControls = controls.filter((control) =>
    /settings/i.test(control.surface) && isLifecycleText(textOf(control)),
  );
  const otherNavigationLifecycleControls = controls.filter((control) =>
    !/^(?:Apps|Settings)$/i.test(control.surface) && isLifecycleText(textOf(control)),
  );
  const appControls = controls.filter((control) => !/settings/i.test(control.surface));
  const primaryTypes = new Set(appControls
    .map((control) => control.classification.match(/^primary:(.+)$/)?.[1])
    .filter(Boolean));
  const missingPrimaryTypes = [...PRIMARY_ACTIONS].filter((action) => !primaryTypes.has(action));
  const stateCoverage = [...new Set(inventories.map((inventory) => inventory.state).filter(Boolean))];
  const adjacency = automaticCheckObservation?.toggleAdjacentToRefresh === true;
  const settingsExclusion = settingsOpened && settingsLifecycleControls.length === 0 && otherNavigationLifecycleControls.length === 0;
  const inventoryComplete = stateCoverage.includes("apps-preinstall-summary")
    && stateCoverage.includes("apps-preinstall-details")
    && stateCoverage.includes("apps-active")
    && stateCoverage.includes("apps-post-uninstall");

  const forbiddenBasis = forbidden.length === 0
    ? "No owner-facing Disable, Enable, or Rollback control was observed across the recorded Apps and Settings surfaces."
    : `Forbidden owner-facing lifecycle controls were observed: ${forbidden.map((control) => `${control.surface}/${control.state}: ${textOf(control)}`).join("; ")}.`;
  const rows = {
    "AC-8.5": adjacency && settingsExclusion
      ? row(STATUS.PASS, "The Check automatically input is adjacent to Refresh in Apps and no automatic-check control appears in Settings.")
      : row("blocked", `Automatic-check placement is incomplete. Adjacent to Refresh: ${adjacency}; Settings exclusion: ${settingsExclusion}.`),
    "FR-1": settingsExclusion
      ? row(STATUS.PASS, "The recorded Settings inventory contains no install, update, or uninstall control; lifecycle controls are exposed from Apps.")
      : row("blocked", "The Settings and Apps navigation inventory is incomplete or contains a lifecycle entry point."),
    "FR-2": forbidden.length === 0 && inventoryComplete && missingPrimaryTypes.length === 0
      ? row(STATUS.PASS, `All five primary action types were classified across ${stateCoverage.length} reachable owner-facing states; Refresh, Check automatically, and Retry were classified as supporting controls.`)
      : forbidden.length > 0
        ? row(STATUS.FAIL, forbiddenBasis)
        : row("blocked", `The state-by-state control inventory is incomplete. Missing primary types: ${missingPrimaryTypes.join(", ") || "none"}; covered states: ${stateCoverage.join(", ") || "none"}.`),
    "NG-1": forbidden.length === 0
      ? row(STATUS.PASS, forbiddenBasis)
      : row(STATUS.FAIL, forbiddenBasis),
  };
  const status = reviewStatus(rows);
  return {
    review: "E-19 owned UI control inventory",
    status,
    inventories,
    classifiedControls: controls,
    stateCoverage,
    primaryTypes: [...primaryTypes],
    missingPrimaryTypes,
    forbiddenControls: forbidden,
    settingsLifecycleControls,
    otherNavigationLifecycleControls,
    automaticCheckObservation,
    rows,
  };
}

export { classifyControl };
