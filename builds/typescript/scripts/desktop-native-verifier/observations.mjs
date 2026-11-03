import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ignoredNames = new Set([".DS_Store"]);

export function recordVerifierAction(evidence, action, details = {}) {
  evidence.inputActions.push({
    sequence: evidence.inputActions.length + 1,
    timestamp: new Date().toISOString(),
    action,
    ...details,
  });
}

async function walk(root, relative = "") {
  const current = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walk(root, childRelative));
    } else if (entry.isFile()) {
      results.push(childRelative);
    }
  }
  return results;
}

export async function snapshotFileTree(root) {
  const files = await walk(root);
  const digest = createHash("sha256");
  const entries = [];
  for (const relative of files.sort()) {
    const absolute = path.join(root, relative);
    try {
      const metadata = await stat(absolute);
      const content = await readFile(absolute);
      const fileDigest = createHash("sha256").update(content).digest("hex");
      entries.push({ path: relative, size: metadata.size, sha256: fileDigest });
      digest.update(`${relative}\0${metadata.size}\0${fileDigest}\n`);
    } catch {
      // A concurrently removed file is recorded by the surrounding run log.
    }
  }
  return {
    root,
    fileCount: entries.length,
    sha256: digest.digest("hex"),
    files: entries,
  };
}

export function snapshotProcessTable() {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
      return {
        command: "tasklist /FO CSV /NH",
        processes: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      };
    }
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" });
    return {
      command: "ps -axo pid=,ppid=,comm=",
      processes: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    };
  } catch (error) {
    return {
      command: process.platform === "win32" ? "tasklist" : "ps",
      processes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function collectVisibleDialogs(driver) {
  const dialogs = await driver.findAllByXPath('//*[@role="dialog"]');
  const visible = [];
  for (const id of dialogs) {
    try {
      if (await driver.isDisplayed(id)) visible.push(await driver.text(id));
    } catch {
      // A transient dialog can disappear while it is being sampled.
    }
  }
  return visible;
}

export async function collectVisibleControlInventory(driver, xpath = "//button | //input | //select | //textarea | //a[@href]") {
  const controls = await driver.findAllByXPath(xpath);
  const inventory = [];
  for (const id of controls) {
    try {
      if (!(await driver.isDisplayed(id))) continue;
      inventory.push({
        type: await driver.attribute(id, "type"),
        text: await driver.text(id),
        ariaLabel: await driver.attribute(id, "aria-label"),
        disabled: await driver.property(id, "disabled"),
        href: await driver.attribute(id, "href"),
      });
    } catch {
      // A transient control can disappear while the inventory is collected.
    }
  }
  return inventory;
}
