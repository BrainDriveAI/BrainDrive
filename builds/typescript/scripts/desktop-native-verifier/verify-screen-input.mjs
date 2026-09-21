import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifyScreenAndInput(driver, artifactsRoot, candidate) {
  const evidence = {
    candidate: candidate.head,
    branch: candidate.branch,
    platform: candidate.platform,
    scope: "native-shell screen/input capture prototype; no account or lifecycle mutations",
    status: "running",
    states: [],
    inputActions: [],
    screenshots: [],
  };

  const capture = async (name, marker) => {
    let body;
    const deadline = Date.now() + 60_000;
    do {
      const bodyId = await driver.findByXPath("//body");
      body = await driver.text(bodyId);
      if (body.includes(marker)) break;
      await delay(300);
    } while (Date.now() < deadline);
    assert.ok(body?.includes(marker), `Expected rendered marker not found: ${marker}`);

    const screenshot = path.join(artifactsRoot, `${String(evidence.states.length + 1).padStart(2, "0")}-${name}.png`);
    await driver.screenshot(screenshot);
    evidence.states.push({ name, visibleMarker: marker, title: await driver.title() });
    evidence.screenshots.push(screenshot);
  };

  await mkdir(artifactsRoot, { recursive: true });
  try {
    await capture("setup", "Setup Your Login");

    const username = await driver.findByXPath('//input[@id="username"]');
    assert.equal(await driver.isDisplayed(username), true, "The first-run Username field must be visible.");
    await driver.click(username);
    await driver.sendKeys(username, "desktop-verifier-probe");
    assert.equal(await driver.property(username, "value"), "desktop-verifier-probe", "Typed test input must appear in the focused field.");
    evidence.inputActions.push({ control: "Username", action: "click-and-type", value: "desktop-verifier-probe", submitted: false });
    await capture("input-probe", "Setup Your Login");

    await driver.clear(username);
    assert.equal(await driver.property(username, "value"), "", "The synthetic input must be cleared before the run ends.");
    evidence.inputActions.push({ control: "Username", action: "clear", valueAfterAction: "" });
    await capture("input-cleared", "Setup Your Login");
    evidence.status = "passed";
    return evidence;
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    try {
      const screenshot = path.join(artifactsRoot, "failure.png");
      await driver.screenshot(screenshot);
      evidence.screenshots.push(screenshot);
    } catch {
      // Preserve the original test failure if the WebDriver session is already unavailable.
    }
    throw error;
  } finally {
    await writeFile(path.join(artifactsRoot, "screen-input-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}
