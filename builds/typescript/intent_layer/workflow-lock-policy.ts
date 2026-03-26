const MULTI_TURN_PROFILE_IDS = new Set(["interview"]);
const CLEAR_LOCK_PHRASES = [
  "stop interview",
  "end interview",
  "cancel interview",
  "skip interview",
  "no more questions",
  "stop asking questions",
  "move on",
  "switch gears",
];
const SWITCH_HINTS = ["actually", "instead", "switch", "now", "rather"];

export function isMultiTurnProfile(profileId: string): boolean {
  const normalized = profileId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return MULTI_TURN_PROFILE_IDS.has(normalized) || normalized.includes("interview");
}

export function wantsToClearWorkflowLock(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase();
  return CLEAR_LOCK_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function wantsToSwitchWorkflow(userMessage: string, nextProfileId: string | null, activeProfileId: string): boolean {
  if (!nextProfileId) {
    return false;
  }

  const normalizedNext = nextProfileId.trim().toLowerCase();
  const normalizedActive = activeProfileId.trim().toLowerCase();
  if (!normalizedNext || normalizedNext === normalizedActive) {
    return false;
  }

  const normalizedMessage = userMessage.toLowerCase();
  if (normalizedMessage.includes(normalizedNext.replace(/-/g, " "))) {
    return true;
  }

  return SWITCH_HINTS.some((hint) => normalizedMessage.includes(hint));
}
