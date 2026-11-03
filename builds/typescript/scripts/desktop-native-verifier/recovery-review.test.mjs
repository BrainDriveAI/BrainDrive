import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reviewRecoveryAndAttention } from "./recovery-review.mjs";

const data = () => ({ ownerDataBefore: { sha256: "sha256:owner-data" }, ownerDataAfter: { sha256: "sha256:owner-data" } });

test("blocks the recovery review when S-1 and RV-1 are absent", async () => {
  const prior = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT;
  delete process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT;
  try {
    const review = await reviewRecoveryAndAttention();
    assert.equal(review.status, "blocked");
    assert.equal(review.rows["AC-9.1"].status, "blocked");
    assert.equal(review.rows["CF-5"].status, "blocked");
  } finally {
    if (prior === undefined) delete process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT;
    else process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT = prior;
  }
});

test("rejects unsigned AC-9/E-17/E-18 observations even when their claims look complete", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "braindrive-recovery-review-"));
  await Promise.all(["S-1", "RV-1"].map((fixture) => writeFile(path.join(root, fixture), "fixture\n")));
  const screenshot = path.join(root, "state.png");
  await writeFile(screenshot, "screenshot placeholder\n");
  const state = (id, hostState, ownerState, reason, actions) => ({
    id,
    hostState,
    ownerState,
    reason,
    actions,
    visibleText: [ownerState, reason, ...actions].filter(Boolean).join(" "),
    screenshot,
    transition: { deadEnd: false },
    ...data(),
  });
  const packet = {
    states: [
      state("staged_interrupted_install", "staged", "Needs attention", "This app didn't finish installing.", ["retry"]),
      state("disabled_host", "disabled", "Needs attention", "This app needs a newer BrainDrive.", ["update_brain_drive"]),
      state("quarantined", "quarantined", "Needs attention", "BrainDrive stopped this app for safety. Your data is kept.", ["remove"]),
      state("failed_recoverable", "failed_recoverable", "Needs attention", "The last app change didn't finish. Your data is kept.", ["retry"]),
      state("disabled_owner", "disabled", "Normal (off)", null, []),
    ],
    retries: [
      { scenario: "interrupted_install", operationBefore: { operationId: "install-op" }, operationAfter: { operationId: "install-op", recoveryAction: "retry" }, ...data() },
      { scenario: "interrupted_update", operationBefore: { operationId: "update-op" }, operationAfter: { operationId: "update-op", recoveryAction: "restore_last_known_good" }, ...data() },
      { scenario: "interrupted_uninstall", operationBefore: { operationId: "uninstall-op" }, operationAfter: { operationId: "uninstall-op", recoveryAction: "finish_uninstall_cleanup" }, ...data() },
      { scenario: "revoked_package", operationBefore: { operationId: "revoked-op" }, operationAfter: { operationId: "revoked-op", recoveryAction: "refuse_into_quarantine" }, ...data() },
    ],
    revocation: {
      openAttempt: { opened: false },
      ownerState: "Needs attention",
      reason: "BrainDrive stopped this app for safety. Your data is kept.",
      nextAction: "remove",
      screenshot,
      ...data(),
    },
  };
  const prior = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT;
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT = root;
  try {
    const review = await reviewRecoveryAndAttention({ observationPacket: packet });
    assert.equal(review.status, "fail");
    assert.equal(review.rows["AC-9.1"].status, "fail");
    assert.match(review.packetIntegrity.reason, /signed packet|signature|digest/i);
  } finally {
    if (prior === undefined) delete process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT;
    else process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT = prior;
  }
});
