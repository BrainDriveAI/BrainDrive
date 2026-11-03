import assert from "node:assert/strict";
import test from "node:test";

import { classifyControl, reviewControlInventory } from "./control-inventory-review.mjs";

const control = (text, extra = {}) => ({ text, ariaLabel: text, ...extra });

test("classifies the Apps control classes", () => {
  assert.equal(classifyControl(control("Install Resume Builder")), "primary:install");
  assert.equal(classifyControl(control("Delete retained data")), "primary:delete_data");
  assert.equal(classifyControl(control("Check automatically")), "supporting:apps-preference");
  assert.equal(classifyControl(control("Refresh app catalog")), "supporting:catalog");
  assert.equal(classifyControl(control("Disable Resume Builder")), "forbidden:owner-lifecycle");
});

test("passes a complete E-19 inventory without owner disable/enable/rollback", () => {
  const controls = [
    control("Install Resume Builder"),
    control("Open Resume Builder"),
    control("Update Resume Builder"),
    control("Remove app code for Resume Builder"),
    control("Delete retained data"),
    control("Check automatically"),
    control("Refresh app catalog"),
    control("Retry recovery Resume Builder"),
  ];
  const review = reviewControlInventory({
    settingsOpened: true,
    automaticCheckObservation: { toggleAdjacentToRefresh: true },
    inventories: [
      { state: "apps-preinstall-summary", surface: "Apps", controls },
      { state: "apps-preinstall-details", surface: "Apps", controls },
      { state: "apps-active", surface: "Apps", controls },
      { state: "apps-post-uninstall", surface: "Apps", controls },
      { state: "settings", surface: "Settings", controls: [control("Save provider settings")] },
    ],
  });
  assert.equal(review.status, "pass");
  for (const row of Object.values(review.rows)) assert.equal(row.status, "pass");
});

test("fails E-19 when a general Disable control remains visible", () => {
  const review = reviewControlInventory({
    settingsOpened: true,
    automaticCheckObservation: { toggleAdjacentToRefresh: true },
    inventories: [
      { state: "apps-active", surface: "Apps", controls: [control("Disable Resume Builder")] },
      { state: "settings", surface: "Settings", controls: [] },
    ],
  });
  assert.equal(review.status, "fail");
  assert.equal(review.rows["FR-2"].status, "fail");
  assert.equal(review.rows["NG-1"].status, "fail");
});
