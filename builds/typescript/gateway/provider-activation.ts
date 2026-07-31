export type ClaimProviderActivationDecision =
  | "activated"
  | "retained"
  | "already_applied"
  | "preserved_newer_intent"
  | "skipped_missing_revision"
  | "preserved_revision_mismatch";

export type ClaimProviderActivationResult = {
  decision: ClaimProviderActivationDecision;
  activeProviderProfile: string | undefined;
  providerActivationRevision: number;
  shouldPersist: boolean;
};

export type ExplicitProviderActivationResult = {
  decision: "activated" | "retained";
  previousProviderProfile: string | undefined;
  activeProviderProfile: string | undefined;
  previousProviderActivationRevision: number;
  providerActivationRevision: number;
};

export function normalizeProviderActivationRevision(revision: number | undefined): number {
  if (revision === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("Provider activation revision must be a non-negative safe integer");
  }
  return revision;
}

export function decideClaimProviderActivation(input: {
  currentProviderProfile: string | undefined;
  currentRevision: number | undefined;
  revisionAtClaimStart: number | undefined;
  targetProviderProfile: string;
}): ClaimProviderActivationResult {
  const currentRevision = normalizeProviderActivationRevision(input.currentRevision);

  if (input.revisionAtClaimStart === undefined) {
    return {
      decision: "skipped_missing_revision",
      activeProviderProfile: input.currentProviderProfile,
      providerActivationRevision: currentRevision,
      shouldPersist: false,
    };
  }

  const revisionAtClaimStart = normalizeProviderActivationRevision(input.revisionAtClaimStart);
  if (currentRevision === revisionAtClaimStart) {
    const nextRevision = incrementProviderActivationRevision(currentRevision);
    return {
      decision:
        input.currentProviderProfile === input.targetProviderProfile ? "retained" : "activated",
      activeProviderProfile: input.targetProviderProfile,
      providerActivationRevision: nextRevision,
      shouldPersist: true,
    };
  }

  if (
    currentRevision > revisionAtClaimStart &&
    input.currentProviderProfile === input.targetProviderProfile
  ) {
    return {
      decision: "already_applied",
      activeProviderProfile: input.currentProviderProfile,
      providerActivationRevision: currentRevision,
      shouldPersist: false,
    };
  }

  return {
    decision:
      currentRevision > revisionAtClaimStart
        ? "preserved_newer_intent"
        : "preserved_revision_mismatch",
    activeProviderProfile: input.currentProviderProfile,
    providerActivationRevision: currentRevision,
    shouldPersist: false,
  };
}

export function decideExplicitProviderActivation(input: {
  currentProviderProfile: string | undefined;
  currentRevision: number | undefined;
  targetProviderProfile: string | undefined;
}): ExplicitProviderActivationResult {
  const currentRevision = normalizeProviderActivationRevision(input.currentRevision);
  return {
    decision:
      input.currentProviderProfile === input.targetProviderProfile ? "retained" : "activated",
    previousProviderProfile: input.currentProviderProfile,
    activeProviderProfile: input.targetProviderProfile,
    previousProviderActivationRevision: currentRevision,
    providerActivationRevision: incrementProviderActivationRevision(currentRevision),
  };
}

function incrementProviderActivationRevision(currentRevision: number): number {
  const nextRevision = currentRevision + 1;
  if (!Number.isSafeInteger(nextRevision)) {
    throw new RangeError("Provider activation revision cannot be incremented safely");
  }
  return nextRevision;
}
