import { describe, expect, it } from "vitest";

import {
  decideClaimProviderActivation,
  decideExplicitProviderActivation,
  normalizeProviderActivationRevision,
} from "./provider-activation.js";

describe("normalizeProviderActivationRevision", () => {
  it("uses revision zero when the persisted revision is missing", () => {
    expect(normalizeProviderActivationRevision(undefined)).toBe(0);
    expect(normalizeProviderActivationRevision(0)).toBe(0);
  });
});

describe("decideClaimProviderActivation", () => {
  it("applies a first claim when the captured and current revisions match", () => {
    expect(
      decideClaimProviderActivation({
        currentProviderProfile: "openrouter",
        currentRevision: 3,
        revisionAtClaimStart: 3,
        targetProviderProfile: "braindrive-models",
      })
    ).toEqual({
      decision: "activated",
      activeProviderProfile: "braindrive-models",
      providerActivationRevision: 4,
      shouldPersist: true,
    });
  });

  it("records first application when the target provider is already active", () => {
    expect(
      decideClaimProviderActivation({
        currentProviderProfile: "braindrive-models",
        currentRevision: undefined,
        revisionAtClaimStart: 0,
        targetProviderProfile: "braindrive-models",
      })
    ).toEqual({
      decision: "retained",
      activeProviderProfile: "braindrive-models",
      providerActivationRevision: 1,
      shouldPersist: true,
    });
  });

  it("makes replay after application a no-op without advancing again", () => {
    expect(
      decideClaimProviderActivation({
        currentProviderProfile: "braindrive-models",
        currentRevision: 4,
        revisionAtClaimStart: 3,
        targetProviderProfile: "braindrive-models",
      })
    ).toEqual({
      decision: "already_applied",
      activeProviderProfile: "braindrive-models",
      providerActivationRevision: 4,
      shouldPersist: false,
    });
  });

  it("preserves a newer explicit provider intent", () => {
    expect(
      decideClaimProviderActivation({
        currentProviderProfile: "ollama",
        currentRevision: 4,
        revisionAtClaimStart: 3,
        targetProviderProfile: "braindrive-models",
      })
    ).toEqual({
      decision: "preserved_newer_intent",
      activeProviderProfile: "ollama",
      providerActivationRevision: 4,
      shouldPersist: false,
    });
  });

  it("preserves the current provider for a legacy operation without a captured revision", () => {
    expect(
      decideClaimProviderActivation({
        currentProviderProfile: "openrouter",
        currentRevision: undefined,
        revisionAtClaimStart: undefined,
        targetProviderProfile: "braindrive-models",
      })
    ).toEqual({
      decision: "skipped_missing_revision",
      activeProviderProfile: "openrouter",
      providerActivationRevision: 0,
      shouldPersist: false,
    });
  });
});

describe("decideExplicitProviderActivation", () => {
  it("advances from revision zero when the persisted revision is missing", () => {
    expect(
      decideExplicitProviderActivation({
        currentProviderProfile: "braindrive-models",
        currentRevision: undefined,
        targetProviderProfile: "ollama",
      })
    ).toEqual({
      decision: "activated",
      previousProviderProfile: "braindrive-models",
      activeProviderProfile: "ollama",
      previousProviderActivationRevision: 0,
      providerActivationRevision: 1,
    });
  });

  it("advances explicit re-selection so it remains newer than an in-flight claim", () => {
    expect(
      decideExplicitProviderActivation({
        currentProviderProfile: "openrouter",
        currentRevision: 7,
        targetProviderProfile: "openrouter",
      })
    ).toEqual({
      decision: "retained",
      previousProviderProfile: "openrouter",
      activeProviderProfile: "openrouter",
      previousProviderActivationRevision: 7,
      providerActivationRevision: 8,
    });
  });
});
