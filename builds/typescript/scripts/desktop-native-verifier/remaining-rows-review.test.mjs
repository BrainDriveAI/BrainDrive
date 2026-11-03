import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reviewKatieJourney } from "./persona-review.mjs";
import { reviewFaultRecovery } from "./fault-recovery-review.mjs";
import { reviewAuthorityBoundary } from "./authority-review.mjs";
import { reviewCatalogInventory } from "./catalog-inventory-review.mjs";

async function writeJson(root, name, value) {
  const target = path.join(root, name);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function hashes() {
  return { sha256: "sha256:unchanged" };
}

test("rejects unsigned or summary-only remaining-row packets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "braindrive-remaining-rows-"));
  const fixtureRoot = path.join(root, "fault-fixtures");
  await mkdir(fixtureRoot);
  const katiePath = await writeJson(root, "katie.json", {
    startedAt: "2026-09-22T12:00:00.000Z",
    openVisibleAt: "2026-09-22T12:02:00.000Z",
    informationBoundary: { signed: true, sources: ["forum post text", "production client"] },
    path: ["forum", "Apps", "Install", "Open"],
  });
  const faultLeg = { entryAction: "Install", nextActions: ["Retry"], ownerDataBefore: hashes(), ownerDataAfter: hashes(), packageStoreBefore: hashes(), packageStoreAfter: hashes() };
  const faultPath = await writeJson(root, "faults.json", {
    installFailures: { network: faultLeg, disk: faultLeg, restart: faultLeg, verification: faultLeg },
    updateActivation: { entryAction: "Update", ownerDataBefore: hashes(), ownerDataAfter: hashes(), lastKnownGoodState: { active: true } },
  });
  const authorityPath = await writeJson(root, "authority.json", {
    manifest: { requested_capabilities: ["memory.read", "memory.write"] },
    approval: { access: ["memory.read", "memory.write"] },
    hostContract: { allowed_capabilities: ["memory.read", "memory.write", "web.search@1"] },
  });
  const entries = Array.from({ length: 100 }, (_, index) => ({
    package_identity: { app_id: `ai.example.app-${index}`, display_name: `App ${index}`, publisher_id: "ai.example", package_version: "1.0.0" },
    safe_presentation: { display_name: `App ${index}`, summary: "Do a useful thing.", publisher_name: "Example", access_description: "Reads only the approved app data.", change_note: "Improves the app." },
  }));
  const catalogPath = await writeJson(root, "c-f.json", { entries });
  const prior = { ...process.env };
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_KATIE_OBSERVATION_PATH = katiePath;
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT = fixtureRoot;
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH = faultPath;
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_TB5_AUTHORITY_PATH = authorityPath;
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_CF_CATALOG_PATH = catalogPath;
  try {
    const commonEvents = [{ event: "app.lifecycle.transition_completed", details: { lifecycle_action: "install", outcome: "committed" } }];
    const katie = await reviewKatieJourney({ lifecycleEvents: commonEvents, inputActions: [{ control: "Install Resume Builder" }], openControlVisible: true, openVisibleAt: "2026-09-22T12:02:00.000Z", screenshots: ["journey.png"] });
    assert.notEqual(katie.rows["AC-1.3"].status, "pass");
    const fault = await reviewFaultRecovery();
    assert.notEqual(fault.rows["AC-1.6"].status, "pass");
    assert.notEqual(fault.rows["CF-2"].status, "pass");
    const authority = await reviewAuthorityBoundary({ approvalDialogs: ["Review requested access"] });
    assert.notEqual(authority.rows["TB-5"].status, "pass");
    const catalog = await reviewCatalogInventory({
      renderedEntries: entries.map((entry, index) => ({ appKey: `ai.example.app-${index}`, text: `${entry.safe_presentation.display_name} ${entry.safe_presentation.summary} ${entry.safe_presentation.publisher_name} Version 1.0.0 Install` })),
      detailsRendered: true,
      browseObservation: {
        packageStoreUnchanged: true,
        stagingUnchanged: true,
        newProcesses: [],
        packageDownloadRequests: 0,
        installedFirst: true,
        manifestParity: entries.map((entry, index) => ({ appId: `ai.example.app-${index}`, matches: true })),
      },
    });
    assert.notEqual(catalog.rows["FR-7"].status, "pass");
    assert.notEqual(catalog.rows["FR-8"].status, "pass");
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in prior)) delete process.env[key];
    }
    Object.assign(process.env, prior);
  }
});

test("keeps all remaining rows blocked without their accepted observation inputs", async () => {
  const keys = [
    "BRAINDRIVE_DESKTOP_VERIFIER_KATIE_OBSERVATION_PATH",
    "BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT",
    "BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH",
    "BRAINDRIVE_DESKTOP_VERIFIER_TB5_AUTHORITY_PATH",
    "BRAINDRIVE_DESKTOP_VERIFIER_CF_CATALOG_PATH",
  ];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    assert.equal((await reviewKatieJourney()).rows["AC-1.3"].status, "blocked");
    assert.equal((await reviewFaultRecovery()).rows["CF-2"].status, "blocked");
    assert.equal((await reviewAuthorityBoundary()).rows["TB-5"].status, "blocked");
    assert.equal((await reviewCatalogInventory()).rows["FR-7"].status, "blocked");
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
