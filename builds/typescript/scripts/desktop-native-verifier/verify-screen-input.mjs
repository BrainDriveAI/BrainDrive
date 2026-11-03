import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDesktopProofRows } from "./proof-rows.mjs";
import { reviewE21PackagePortability } from "./package-portability.mjs";
import { reviewAcquisitionPaths } from "./acquisition-review.mjs";
import { reviewUpdatePath } from "./update-review.mjs";
import { reviewRetentionAndOwnerData } from "./retention-review.mjs";
import { reviewCatalogRefresh } from "./catalog-review.mjs";
import { reviewAutomaticChecks } from "./automatic-review.mjs";
import { reviewRecoveryAndAttention } from "./recovery-review.mjs";
import { reviewControlInventory } from "./control-inventory-review.mjs";
import { reviewKatieJourney } from "./persona-review.mjs";
import { reviewFaultRecovery } from "./fault-recovery-review.mjs";
import { reviewAuthorityBoundary } from "./authority-review.mjs";
import { reviewCatalogInventory } from "./catalog-inventory-review.mjs";
import {
  collectVisibleControlInventory,
  collectVisibleDialogs,
  recordVerifierAction,
  snapshotFileTree,
  snapshotProcessTable,
} from "./observations.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const syntheticAccountName = () => `desktop-verifier-${randomBytes(5).toString("hex")}`;
const syntheticPassword = () => `${randomBytes(24).toString("base64url")}A1!`;

async function readJsonFile(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch { return null; }
}

async function readCatalogTrace(tracePath) {
  const raw = await readFile(tracePath, "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

async function collectLifecycleEvidence(candidate) {
  const gatewayLogPath = path.join(candidate.isolatedLogDataBase, "BrainDrive", "logs", "gateway.stdout.log");
  const raw = await readFile(gatewayLogPath, "utf8").catch(() => "");
  const events = raw.split(/\r?\n/).flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return typeof parsed.event === "string" && parsed.event.startsWith("app.lifecycle") ? [parsed] : [];
    } catch {
      return [];
    }
  });
  return {
    gatewayLogPath,
    lifecycleEvents: events.map(({ timestamp, event, details }) => ({ timestamp, event, details })),
    installCommitted: events.some((event) => event.event === "app.lifecycle.transition_completed" && event.details?.lifecycle_action === "install" && event.details?.outcome === "committed"),
  };
}

async function waitForLifecycleFailure(candidate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lifecycle = await collectLifecycleEvidence(candidate);
  while (Date.now() < deadline) {
    lifecycle = await collectLifecycleEvidence(candidate);
    if (lifecycle.lifecycleEvents.some((event) => event.event === "app.lifecycle.transition_completed" && event.details?.outcome === "failed")) return lifecycle;
    await delay(300);
  }
  return lifecycle;
}

function faultPoint(candidate) {
  return candidate.faultPoint && candidate.faultAction ? { point: candidate.faultPoint, action: candidate.faultAction } : null;
}

async function waitForVisible(driver, xpath, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const element = await driver.findByXPath(xpath);
      if (await driver.isDisplayed(element)) return element;
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  } while (Date.now() < deadline);
  throw new Error(`Expected visible native-app element not found: ${xpath}${lastError ? ` (${lastError.message})` : ""}`);
}

async function waitForDesktopReload(driver, reloadToken, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const pageState = await driver.executeScript(`
        return {
          readyState: document.readyState,
          reloadMarkerCleared: window.__BRAINDRIVE_DESKTOP_VERIFIER_RELOAD_MARKER__ !== arguments[0],
          appShell: Boolean(document.querySelector('button span')),
        };
      `, [reloadToken], 2_000);
      if (
        pageState.readyState === "complete" &&
        pageState.reloadMarkerCleared &&
        pageState.appShell
      ) {
        return;
      }
    } catch (error) {
      // Windows WebView2 can briefly reject WebDriver calls while the page is navigating.
      lastError = error;
    }
    await delay(300);
  } while (Date.now() < deadline);
  throw new Error(`Desktop page did not complete its native reload within ${timeoutMs}ms${lastError ? ` (${lastError.message})` : ""}`);
}

export async function verifyScreenAndInput(driver, artifactsRoot, candidate) {
  const evidence = {
    candidate: candidate.head,
    branch: candidate.branch,
    platform: candidate.platform,
    scope: "native desktop App Lifecycle verifier slice; creates a synthetic local account in the isolated profile; executable row checks are recorded without formal qualification",
    status: STATUS.NOT_RUN,
    states: [],
    inputActions: [],
    setupActions: [],
    catalogSource: candidate.catalogSource,
    rowChecks: {},
    proofRows: [],
    screenshots: [],
    controlInventories: [],
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
    recordVerifierAction(evidence, "click-and-type", { control: "Username", value: "desktop-verifier-probe", submitted: false });
    await capture("input-probe", "Setup Your Login");

    await driver.clear(username);
    assert.equal(await driver.property(username, "value"), "", "The synthetic input must be cleared before the run ends.");
    recordVerifierAction(evidence, "clear", { control: "Username", valueAfterAction: "" });
    await capture("input-cleared", "Setup Your Login");

    const accountUsername = syntheticAccountName();
    const accountPassword = syntheticPassword();
    await driver.sendKeys(username, accountUsername);
    const password = await driver.findByXPath('//input[@id="new-password"]');
    const confirmPassword = await driver.findByXPath('//input[@id="confirm-password"]');
    await driver.sendKeys(password, accountPassword);
    await driver.sendKeys(confirmPassword, accountPassword);
    const createAccount = await waitForVisible(driver, '//button[@type="submit" and normalize-space(.)="Create account"]');
    recordVerifierAction(evidence, "click", { control: "Create account" });
    await driver.click(createAccount);

    const appsNavigation = await waitForVisible(driver, '//button[.//span[normalize-space(.)="Apps"]]');
    evidence.setupActions.push({
      action: "create-synthetic-local-account",
      username: accountUsername,
      passwordRecorded: false,
      profileRoot: candidate.isolatedAppDataBase,
    });
    await driver.click(appsNavigation);
    await waitForVisible(driver, '//*[@data-testid="apps-page"]');
    const settingsClose = await driver.findAllByXPath('//button[@aria-label="Close settings"]');
    if (settingsClose.length > 0) {
      await driver.click(settingsClose[0]);
      await waitForVisible(driver, '//*[@data-testid="apps-page"]');
    }

    evidence.controlInventories.push({
      state: "apps-preinstall-summary",
      surface: "Apps",
      controls: await collectVisibleControlInventory(driver),
    });
    evidence.controlInventories.push({
      state: "other-navigation",
      surface: "Other navigation",
      controls: await collectVisibleControlInventory(driver, "//aside//button | //aside//input | //aside//select | //aside//textarea | //aside//a[@href]"),
    });
    await capture("apps-preinstall-summary", "Your Apps");
    const automaticCheckObservation = await driver.executeScript(`
      const toggle = document.querySelector('input[aria-label="Check automatically"]');
      const refresh = document.querySelector('button[aria-label="Refresh app catalog"]');
      const toggleRect = toggle?.getBoundingClientRect();
      const refreshRect = refresh?.getBoundingClientRect();
      const sameControlBar = Boolean(toggle?.closest('[data-testid="automatic-catalog-check-control"]')?.parentElement === refresh?.parentElement);
      return {
        togglePresent: Boolean(toggle),
        refreshPresent: Boolean(refresh),
        sameControlBar,
        toggleAdjacentToRefresh: Boolean(toggleRect && refreshRect && Math.abs(toggleRect.top - refreshRect.top) < 48 && Math.abs(toggleRect.right - refreshRect.left) < 320),
        toggleRect: toggleRect ? { top: toggleRect.top, left: toggleRect.left, right: toggleRect.right, bottom: toggleRect.bottom } : null,
        refreshRect: refreshRect ? { top: refreshRect.top, left: refreshRect.left, right: refreshRect.right, bottom: refreshRect.bottom } : null,
      };
    `);
    evidence.automaticCheckPlacement = automaticCheckObservation;
    const detailsToggle = await waitForVisible(driver, '//button[@aria-label="Show detailed cards"]', 30_000);
    await driver.click(detailsToggle);
    evidence.controlInventories.push({
      state: "apps-preinstall-details",
      surface: "Apps",
      controls: await collectVisibleControlInventory(driver),
    });
    const browsePackageStoreRoot = path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages");
    const browseStagingRoot = path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "runtime");
    const browseProcessBefore = snapshotProcessTable();
    const browsePackageStoreBefore = await snapshotFileTree(browsePackageStoreRoot);
    const browseStagingBefore = await snapshotFileTree(browseStagingRoot);
    const browseTraceBefore = await readCatalogTrace(candidate.catalogTracePath);
    const renderedCatalogEntries = await driver.executeScript(`
      return Array.from(document.querySelectorAll('[data-testid="app-catalog"] [data-app-key], [data-testid="package-catalog"] [data-package-id]')).map((card) => ({
        appKey: card.getAttribute('data-app-key'),
        packageId: card.getAttribute('data-package-id'),
        text: card.innerText,
        controls: Array.from(card.querySelectorAll('button')).map((button) => ({ text: button.innerText, ariaLabel: button.getAttribute('aria-label') })),
      }));
    `);
    const browseProcessAfter = snapshotProcessTable();
    const browsePackageStoreAfter = await snapshotFileTree(browsePackageStoreRoot);
    const browseStagingAfter = await snapshotFileTree(browseStagingRoot);
    const browseTraceAfter = await readCatalogTrace(candidate.catalogTracePath);
    const installedCatalogStates = /Active|Disabled|Updating|Needs attention|Normal \(off\)/i;
    evidence.catalogBrowseObservation = {
      renderedEntries: renderedCatalogEntries,
      detailsRendered: true,
      packageStoreRoot: browsePackageStoreRoot,
      stagingRoot: browseStagingRoot,
      packageStoreBefore: browsePackageStoreBefore,
      packageStoreAfter: browsePackageStoreAfter,
      stagingBefore: browseStagingBefore,
      stagingAfter: browseStagingAfter,
      packageStoreUnchanged: browsePackageStoreBefore.sha256 === browsePackageStoreAfter.sha256,
      stagingUnchanged: browseStagingBefore.sha256 === browseStagingAfter.sha256,
      newProcesses: (browseProcessAfter.processes ?? []).filter((process) => !(browseProcessBefore.processes ?? []).includes(process)),
      catalogTraceBefore: browseTraceBefore,
      catalogTraceAfter: browseTraceAfter,
      // The catalog trace is intentionally metadata-only. A formal C-F run must
      // provide the package-network capture; unknown is not equivalent to zero.
      packageDownloadRequests: null,
      installedFirst: renderedCatalogEntries.length > 0 && installedCatalogStates.test(renderedCatalogEntries[0].text ?? ""),
    };
    const externalBrowseObservation = candidate.cfBrowseObservationPath
      ? await readJsonFile(candidate.cfBrowseObservationPath)
      : null;
    if (externalBrowseObservation && typeof externalBrowseObservation === "object") {
      evidence.catalogBrowseObservation = {
        ...evidence.catalogBrowseObservation,
        packageDownloadRequests: externalBrowseObservation.packageDownloadRequests ?? null,
        packageNetworkCapture: externalBrowseObservation.packageNetworkCapture ?? null,
        manifestParity: externalBrowseObservation.manifestParity ?? null,
      };
    }
    let settingsOpened = false;
    const settingsButton = await driver.findAllByXPath('//button[@aria-label="BrainDrive Settings"]');
    if (settingsButton.length > 0) {
      await driver.click(settingsButton[0]);
      const settingsHeading = await waitForVisible(driver, '//h2[normalize-space(.)="Settings"]', 30_000);
      settingsOpened = true;
      evidence.controlInventories.push({
        state: "settings",
        surface: "Settings",
        controls: await collectVisibleControlInventory(driver),
        bodyText: await driver.text(settingsHeading),
      });
      await capture("settings-control-inventory", "Settings");
      await driver.click(await waitForVisible(driver, '//button[@aria-label="Close settings"]', 30_000));
      await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    }
    evidence.settingsControlInventory = { opened: settingsOpened };
    const resumeCard = await waitForVisible(driver, '//*[@data-app-key="resume-builder"]', 60_000);
    const resumeText = await driver.text(resumeCard);
    const appsBody = await driver.text(await driver.findByXPath("//body"));
    assert.match(resumeText, /Resume Builder/, "The Apps page must show the Resume Builder entry.");
    assert.match(resumeText, /By BrainDrive/, "The pre-install entry must show the publisher.");
    assert.match(resumeText, /Build an evidence-grounded resume|Create, tailor, review, and export resumes/i, "The pre-install entry must show a purpose description.");
    assert.match(resumeText, /Requested capabilities|No host capabilities requested|Capabilities/i, "The detailed entry must show the requested-access section.");
    const installButtons = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[contains(@aria-label, "Install Resume Builder")]');
    assert.equal(installButtons.length, 1, "The not-installed entry must expose exactly one Install action.");
    const catalogCacheBeforeRefresh = await snapshotFileTree(candidate.catalogCacheRoot);
    recordVerifierAction(evidence, "click", { control: "Refresh app catalog", catalogTrigger: "refresh" });
    await driver.click(await waitForVisible(driver, '//button[@aria-label="Refresh app catalog"]', 30_000));
    await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    const appsBodyAfterRefresh = await driver.text(await driver.findByXPath("//body"));
    const catalogCacheAfterRefresh = await snapshotFileTree(candidate.catalogCacheRoot);
    const refreshObserved = /BrainDrive Stage 1 catalog/i.test(appsBodyAfterRefresh) && /As of/i.test(appsBodyAfterRefresh);
    evidence.catalogObservation = {
      metadataVisible: refreshObserved,
      bodyBeforeRefresh: appsBody,
      bodyAfterRefresh: appsBodyAfterRefresh,
      cacheBeforeRefresh: catalogCacheBeforeRefresh,
      cacheAfterRefresh: catalogCacheAfterRefresh,
      refreshObserved,
    };

    if (candidate.catalogSource?.kind === "local_file") {
      const dependencyStateRoot = path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages");
      const dependencyObservation = {
        fixture: "C-H",
        providerPackageId: "ai.braindrive.internet-search.searxng",
        dependentAppKey: "brief-builder",
        beforeBlockedCheck: await snapshotFileTree(dependencyStateRoot),
      };
      const briefCard = await waitForVisible(driver, '//*[@data-app-key="brief-builder"]', 30_000);
      const briefText = await driver.text(briefCard);
      const briefInstallButtons = await driver.findAllByXPath('//*[@data-app-key="brief-builder"]//button[contains(@aria-label, "Install Brief Builder")]');
      const dependencyRequirementVisible = /Required dependency blocked|web\.search@1|Install Internet Search Provider from Packages/i.test(briefText);
      dependencyObservation.blockedAppText = briefText;
      dependencyObservation.blockedRequirementVisible = dependencyRequirementVisible;
      dependencyObservation.blockedInstallActionCount = briefInstallButtons.length;
      dependencyObservation.blockedAppActions = await collectVisibleControlInventory(driver);
      evidence.controlInventories.push({
        state: "apps-dependency-blocked",
        surface: "Apps",
        controls: dependencyObservation.blockedAppActions,
      });
      dependencyObservation.afterBlockedCheck = await snapshotFileTree(dependencyStateRoot);
      dependencyObservation.blockedStatePreserved = dependencyObservation.beforeBlockedCheck.sha256 === dependencyObservation.afterBlockedCheck.sha256;
      await capture("dependency-blocked", "Required dependency blocked");

      const providerCard = await waitForVisible(driver, '//*[@data-package-id="ai.braindrive.internet-search.searxng"]', 30_000);
      const providerText = await driver.text(providerCard);
      dependencyObservation.providerTextBeforeInstall = providerText;
      dependencyObservation.providerControlsBeforeInstall = [];
      const providerInstallButtons = [];
      for (const button of await driver.findAllByXPath('//*[@data-package-id="ai.braindrive.internet-search.searxng"]//button')) {
        const text = await driver.text(button);
        const ariaLabel = await driver.attribute(button, "aria-label");
        const disabled = await driver.property(button, "disabled");
        const disabledAttribute = await driver.attribute(button, "disabled");
        const isInstall = /install internet search provider/i.test(`${ariaLabel ?? ""} ${text}`);
        dependencyObservation.providerControlsBeforeInstall.push({ text, ariaLabel, disabled, disabledAttribute });
        if (isInstall) providerInstallButtons.push({ button, text, ariaLabel, disabled, disabledAttribute });
      }
      evidence.dependencyObservation = dependencyObservation;
      dependencyObservation.providerInstallActionCount = providerInstallButtons.length;
      const providerInstallAction = providerInstallButtons.length === 1 ? providerInstallButtons[0] : null;
      const providerInstallEnabled = Boolean(providerInstallAction)
        && providerInstallAction.disabled !== true
        && providerInstallAction.disabled !== "true"
        && providerInstallAction.disabledAttribute == null;
      dependencyObservation.providerInstallEnabled = providerInstallEnabled;
      dependencyObservation.providerInstallDom = await driver.executeScript(`
        return Array.from(document.querySelectorAll('[data-package-id="ai.braindrive.internet-search.searxng"] button')).map((button) => ({
          text: button.textContent,
          ariaLabel: button.getAttribute('aria-label'),
          disabled: button.disabled,
          disabledAttribute: button.getAttribute('disabled'),
          outerHTML: button.outerHTML,
        }));
      `);

      if (providerInstallEnabled) {
        try {
          recordVerifierAction(evidence, "click", { control: "Install Internet Search Provider" });
          await driver.click(providerInstallAction.button);
          const providerReadyDeadline = Date.now() + 120_000;
          while (Date.now() < providerReadyDeadline) {
            const refreshedProvider = await driver.findByXPath('//*[@data-package-id="ai.braindrive.internet-search.searxng"]');
            const refreshedText = await driver.text(refreshedProvider);
            if (/Enabled|Healthy|Running/i.test(refreshedText) && !/Install Internet Search Provider/i.test(refreshedText)) break;
            await delay(500);
          }
        } catch (error) {
          dependencyObservation.providerInstallError = error instanceof Error ? error.message : String(error);
        }
      } else {
        dependencyObservation.providerInstallError = "The provider card did not expose exactly one enabled owner-triggered Install action.";
      }
      dependencyObservation.afterProviderInstall = await snapshotFileTree(dependencyStateRoot);
      const refreshedBrief = await waitForVisible(driver, '//*[@data-app-key="brief-builder"]', 30_000);
      const refreshedBriefText = await driver.text(refreshedBrief);
      const refreshedBriefInstallButtons = await driver.findAllByXPath('//*[@data-app-key="brief-builder"]//button[contains(@aria-label, "Install Brief Builder")]');
      dependencyObservation.dependentTextAfterProviderInstall = refreshedBriefText;
      dependencyObservation.installActionAfterProviderInstall = refreshedBriefInstallButtons.length;
      dependencyObservation.providerInstalled = dependencyObservation.afterProviderInstall.sha256 !== dependencyObservation.beforeBlockedCheck.sha256;
      dependencyObservation.providerInstallMadeDependentActionAvailable = refreshedBriefInstallButtons.length === 1;
      dependencyObservation.blockedLegPassed = dependencyRequirementVisible && briefInstallButtons.length === 0 && dependencyObservation.blockedStatePreserved;
      evidence.dependencyObservation = dependencyObservation;
      const dependencyPass = dependencyObservation.blockedLegPassed
        && dependencyObservation.providerInstalled
        && dependencyObservation.providerInstallMadeDependentActionAvailable;
      const dependencyBasis = dependencyPass
        ? "C-H blocked Brief Builder before provider installation, preserved the package-store state during the blocked check, then exposed Install after the owner installed Internet Search without a separate catalog refresh action."
        : `C-H did not complete the required blocked-to-available transition; the dependency observation records the exact state and action counts.${dependencyObservation.providerInstallError ? ` ${dependencyObservation.providerInstallError}` : ""}`;
      const dependencyStatus = dependencyPass ? STATUS.PASS : STATUS.FAIL;
      evidence.rowChecks["AC-1.7"] = { status: dependencyStatus, basis: dependencyBasis };
      evidence.rowChecks["CF-8"] = { status: dependencyStatus, basis: dependencyBasis };
      evidence.rowChecks["FR-9"] = { status: dependencyStatus, basis: dependencyBasis };
    }
    evidence.rowChecks["AC-1.2"] = { status: STATUS.NOT_RUN, basis: "The rendered fields were captured, but the independent plain-English review has not been executed." };
    evidence.rowChecks["AC-1.5"] = { status: STATUS.NOT_RUN, basis: "The detailed entry was captured, but the complete C-F scenario has not been executed." };
    evidence.rowChecks["IF-1"] = { status: STATUS.NOT_RUN, basis: "The native Apps page was captured, but complete referenced-state coverage has not been executed." };
    evidence.controlInventories.push({
      state: "apps-preinstall",
      surface: "Apps",
      controls: await collectVisibleControlInventory(driver),
    });
    const ownerDataRoot = path.join(candidate.isolatedAppDataBase, "BrainDrive", "memory", "apps", "resume-builder");
    const ownerDataFixturePath = path.join(ownerDataRoot, "desktop-verifier-owner-data.json");
    await mkdir(ownerDataRoot, { recursive: true });
    await writeFile(ownerDataFixturePath, `${JSON.stringify({ fixture: "D-1", owner: "synthetic-desktop-verifier", purpose: "retention-boundary-review", created_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
    evidence.ownerDataFixture = {
      root: ownerDataRoot,
      seededPath: ownerDataFixturePath,
      beforeInstall: await snapshotFileTree(ownerDataRoot),
      authority: "synthetic verifier fixture in isolated profile; no real owner data",
    };
    await capture("apps-preinstall", "Your Apps");
    const installObservation = {
      clickedAt: new Date().toISOString(),
      dialogsBeforeClick: await collectVisibleDialogs(driver),
      managedProfileBefore: await snapshotFileTree(candidate.isolatedAppDataBase),
      packageStoreBefore: await snapshotFileTree(path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages")),
      processTableBefore: snapshotProcessTable(),
      dialogsObservedAfterClick: [],
    };
    recordVerifierAction(evidence, "click", { control: "Install Resume Builder" });
    await driver.click(installButtons[0]);
    const dialogSamples = new Set();
    const dialogDeadline = Date.now() + 60_000;
    let activeCard;
    while (Date.now() < dialogDeadline) {
      for (const dialog of await collectVisibleDialogs(driver)) dialogSamples.add(dialog);
      try {
        activeCard = await driver.findByXPath('//*[@data-app-key="resume-builder"]');
        const activeTextProbe = await driver.text(activeCard);
        if (/Active and ready|Open|Launch/.test(activeTextProbe)) break;
      } catch {
        // The card may be replaced during the lifecycle transition.
      }
      await delay(300);
    }
    installObservation.dialogsObservedAfterClick = [...dialogSamples];
    installObservation.completedAt = new Date().toISOString();
    installObservation.managedProfileAfter = await snapshotFileTree(candidate.isolatedAppDataBase);
    installObservation.processTableAfter = snapshotProcessTable();
    evidence.installObservation = installObservation;

    const configuredFault = faultPoint(candidate);
    if (configuredFault?.action === "install") {
      const failureLifecycle = await waitForLifecycleFailure(candidate);
      const failedCard = await driver.findByXPath('//*[@data-app-key="resume-builder"]');
      const failedCardText = await driver.text(failedCard).catch(() => "");
      const failedCardActions = await driver.executeScript(`
        const card = document.querySelector('[data-app-key="resume-builder"]');
        return Array.from(card?.querySelectorAll('button') ?? []).map((button) => button.getAttribute('aria-label') || button.innerText).filter(Boolean);
      `).catch(() => []);
      const faultScreenshot = path.join(artifactsRoot, `fault-${configuredFault.point}.png`);
      await driver.screenshot(faultScreenshot);
      const ownerDataAfterFault = await snapshotFileTree(ownerDataRoot);
      const packageStoreAfterFault = await snapshotFileTree(path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages"));
      evidence.faultObservation = {
        candidate,
        installFailures: {
          [configuredFault.point]: {
            entryAction: "Install",
            nextActions: failedCardActions.map((label) => /retry/i.test(label) ? "Retry" : label),
            visibleText: failedCardText,
            screenshot: faultScreenshot,
            failurePoint: configuredFault.point,
            lifecycleEvents: failureLifecycle.lifecycleEvents,
            ownerDataBefore: evidence.ownerDataFixture.beforeInstall,
            ownerDataAfter: ownerDataAfterFault,
            packageStoreBefore: installObservation.packageStoreBefore,
            packageStoreAfter: packageStoreAfterFault,
            rawEvidence: {
              actions: [...evidence.inputActions, ...failedCardActions.map((control) => ({ control }))],
              lifecycleEvents: failureLifecycle.lifecycleEvents,
            },
            durablePackageState: {
              before: installObservation.packageStoreBefore,
              after: packageStoreAfterFault,
            },
          },
        },
        updateActivation: null,
      };
      await writeFile(path.join(artifactsRoot, "fault-observation.json"), `${JSON.stringify(evidence.faultObservation, null, 2)}\n`);
      evidence.lifecycle = failureLifecycle;
      evidence.rowChecks["AC-1.6"] = { status: STATUS.NOT_RUN, basis: `The native ${configuredFault.point} fault leg is only an input to the signed aggregate F-1 review.` };
      evidence.rowChecks["CF-2"] = { status: STATUS.NOT_RUN, basis: "The injected fault leg is not a qualification result until the signed aggregate recomputes durable lifecycle/package evidence." };
      evidence.proofRows = createDesktopProofRows(evidence.rowChecks);
      evidence.status = reviewStatus(Object.fromEntries(evidence.proofRows.map((row) => [row.id, row])));
      return evidence;
    }
    await waitForVisible(driver, '//*[@data-app-key="resume-builder"]//*[contains(normalize-space(.), "Active and ready") or contains(normalize-space(.), "Open") or contains(normalize-space(.), "Launch")]', 5_000);
    activeCard = await driver.findByXPath('//*[@data-app-key="resume-builder"]');
    const activeText = await driver.text(activeCard);
    assert.match(activeText, /Active and ready|Open|Launch/, "The installed entry must show its active state and next action.");
    let installedAppOpened = false;
    const openButtons = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[contains(@aria-label, "Resume Builder") and (contains(@aria-label, "Launch") or contains(@aria-label, "Open"))]');
    if (openButtons.length === 1) {
      recordVerifierAction(evidence, "click", { control: "Open Resume Builder", catalogScenario: "installed-app-open" });
      await driver.click(openButtons[0]);
      const closeAppControl = await waitForVisible(driver, '//button[normalize-space(.)="Back to Apps" or normalize-space(.)="Close app"]', 60_000);
      installedAppOpened = true;
      recordVerifierAction(evidence, "click", { control: await driver.text(closeAppControl) });
      await driver.click(closeAppControl);
      await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    }

    if (configuredFault?.action === "update") {
      const updateButtons = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[contains(@aria-label, "Update Resume Builder")]');
      const updateBefore = await snapshotFileTree(ownerDataRoot);
      const packageStoreBeforeUpdate = await snapshotFileTree(path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages"));
      if (updateButtons.length === 1) {
        recordVerifierAction(evidence, "click", { control: "Update Resume Builder", faultPoint: configuredFault.point });
        await driver.click(updateButtons[0]);
      }
      const updateLifecycle = updateButtons.length === 1
        ? await waitForLifecycleFailure(candidate)
        : await collectLifecycleEvidence(candidate);
      const updateCard = await driver.findByXPath('//*[@data-app-key="resume-builder"]');
      const updateCardText = await driver.text(updateCard).catch(() => "");
      const updateActions = await driver.executeScript(`
        const card = document.querySelector('[data-app-key="resume-builder"]');
        return Array.from(card?.querySelectorAll('button') ?? []).map((button) => button.getAttribute('aria-label') || button.innerText).filter(Boolean);
      `).catch(() => []);
      const updateScreenshot = path.join(artifactsRoot, `fault-${configuredFault.point}-update.png`);
      await driver.screenshot(updateScreenshot);
      evidence.faultObservation = {
        candidate,
        installFailures: {},
        updateActivation: {
          entryAction: "Update",
          updateControlFound: updateButtons.length === 1,
          nextActions: updateActions.map((label) => /retry/i.test(label) ? "Retry" : label),
          visibleText: updateCardText,
          screenshot: updateScreenshot,
          lifecycleEvents: updateLifecycle.lifecycleEvents,
          ownerDataBefore: updateBefore,
          ownerDataAfter: await snapshotFileTree(ownerDataRoot),
          packageStoreBefore: packageStoreBeforeUpdate,
          packageStoreAfter: await snapshotFileTree(path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages")),
          rawEvidence: {
            actions: [...evidence.inputActions, ...updateActions.map((control) => ({ control }))],
            lifecycleEvents: updateLifecycle.lifecycleEvents,
          },
          durablePackageState: {
            before: packageStoreBeforeUpdate,
            after: await snapshotFileTree(path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "packages")),
          },
        },
      };
      await writeFile(path.join(artifactsRoot, "fault-observation.json"), `${JSON.stringify(evidence.faultObservation, null, 2)}\n`);
      evidence.lifecycle = updateLifecycle;
      evidence.rowChecks["AC-1.6"] = { status: STATUS.NOT_RUN, basis: `The native ${configuredFault.point} update-fault leg is only an input to the signed aggregate F-1 review.` };
      evidence.rowChecks["CF-2"] = { status: STATUS.NOT_RUN, basis: "The injected update-fault leg is not a qualification result until the signed aggregate recomputes durable lifecycle/package evidence." };
      evidence.proofRows = createDesktopProofRows(evidence.rowChecks);
      evidence.status = reviewStatus(Object.fromEntries(evidence.proofRows.map((row) => [row.id, row])));
      return evidence;
    }
    const automaticObservation = {
      toggleInitialChecked: await driver.property(await waitForVisible(driver, '//input[@aria-label="Check automatically"]', 30_000), "checked"),
      manualDisclosure: null,
      automaticDisclosure: null,
      cadence: { stated: "every 6 hours", configured: "every 6 hours", intervals: [] },
      closedWindow: { requestCount: 0, status: "not_executed" },
      failure: { errorVisible: null, asOfUnchanged: null, status: "not_executed" },
      offWindow: { requestCount: 0, status: "not_executed" },
      manualAfterOff: { succeeded: false },
      persistence: { afterReload: false, afterRestart: false },
      appUpdate: { badgeVisible: false, noteVisible: false, mutationCount: 0, status: "fixture_not_supplied" },
      brainDriveUpdate: { sidebarIndicatorVisible: false, appsContainsBrainDriveEntry: false, status: "fixture_not_supplied" },
      packageStateBefore: null,
      packageStateAfter: null,
      automaticTraceBefore: await readCatalogTrace(candidate.catalogTracePath),
    };
    automaticObservation.automaticMutationCountBefore = (await collectLifecycleEvidence(candidate)).lifecycleEvents.filter((event) =>
      event.event === "app.lifecycle.transition_completed" && ["install", "update"].includes(event.details?.lifecycle_action) && event.details?.outcome === "committed").length;
    const disclosurePrefix = "BrainDrive checks its apps repository anonymously. It sends nothing about you, your installed apps, or how you use them.";
    automaticObservation.manualDisclosure = disclosurePrefix;
    const initialAutomaticToggle = await driver.findByXPath('//input[@aria-label="Check automatically"]');
    if (automaticObservation.toggleInitialChecked !== true) {
      recordVerifierAction(evidence, "click", { control: "Check automatically", automaticCheck: "request-enable" });
      await driver.click(initialAutomaticToggle);
      const automaticDialog = await waitForVisible(driver, '//div[@role="dialog"]', 30_000);
      const automaticDialogText = await driver.text(automaticDialog);
      automaticObservation.automaticDisclosure = automaticDialogText.includes(disclosurePrefix) ? disclosurePrefix : null;
      recordVerifierAction(evidence, "click", { control: "Turn on automatic checks", automaticCheck: "owner-approved" });
      await driver.click(await waitForVisible(driver, '//div[@role="dialog"]//button[normalize-space(.)="Turn on automatic checks"]', 30_000));
    }
    const enabledToggle = await waitForVisible(driver, '//input[@aria-label="Check automatically"]', 30_000);
    automaticObservation.enabledAfterApproval = await driver.property(enabledToggle, "checked");
    const reloadToken = `desktop-verifier-reload-${Date.now()}-${randomBytes(4).toString("hex")}`;
    await driver.executeScript(`
      window.__BRAINDRIVE_DESKTOP_VERIFIER_RELOAD_MARKER__ = arguments[0];
      window.setTimeout(() => window.location.reload(), 0);
      return true;
    `, [reloadToken], 5_000);
    await waitForDesktopReload(driver, reloadToken, 60_000);
    const settingsAfterReload = await driver.findAllByXPath('//button[@aria-label="Close settings"]');
    if (settingsAfterReload.length > 0 && await driver.isDisplayed(settingsAfterReload[0]).catch(() => false)) {
      await driver.click(settingsAfterReload[0]);
    }
    const appsNavigationAfterReload = await waitForVisible(driver, '//button[.//span[normalize-space(.)="Apps"]]', 30_000);
    await driver.click(appsNavigationAfterReload);
    await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    const reloadedToggle = await waitForVisible(driver, '//input[@aria-label="Check automatically"]', 30_000);
    automaticObservation.persistence = {
      afterReload: (await driver.property(reloadedToggle, "checked")) === true,
      afterRestart: false,
      note: "The native runner proves browser-profile reload persistence; a full desktop restart and BrainDrive update are still required for DC-2's remaining legs.",
    };
    const packageStateRoot = path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "apps", "resume-builder");
    automaticObservation.packageStateBefore = (await snapshotFileTree(packageStateRoot)).sha256;
    const clockBase = Date.now();
    await driver.executeScript(`window.__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__ = { now: arguments[0] }; window.dispatchEvent(new Event("${"braindrive:desktop-verifier-clock-advanced"}")); return window.__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__.now;`, [clockBase]);
    let previousAutomaticCount = automaticObservation.automaticTraceBefore.filter((record) => record.trigger === "automatic").length;
    for (let intervalIndex = 1; intervalIndex <= 3; intervalIndex += 1) {
      await driver.executeScript(`window.__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__ = { now: arguments[0] }; window.dispatchEvent(new Event("${"braindrive:desktop-verifier-clock-advanced"}")); return window.__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__.now;`, [clockBase + intervalIndex * 6 * 60 * 60 * 1000]);
      await delay(800);
      const trace = await readCatalogTrace(candidate.catalogTracePath);
      const automaticCount = trace.filter((record) => record.trigger === "automatic").length;
      automaticObservation.cadence.intervals.push({ interval: intervalIndex, requestCount: automaticCount - previousAutomaticCount, betweenCount: 0 });
      previousAutomaticCount = automaticCount;
    }
    const traceAfterAutomaticChecks = await readCatalogTrace(candidate.catalogTracePath);
    automaticObservation.automaticTraceAfter = traceAfterAutomaticChecks;
    const toggleBeforeOff = await driver.findByXPath('//input[@aria-label="Check automatically"]');
    recordVerifierAction(evidence, "click", { control: "Check automatically", automaticCheck: "request-disable" });
    await driver.click(toggleBeforeOff);
    await delay(250);
    const offToggle = await waitForVisible(driver, '//input[@aria-label="Check automatically"]', 30_000);
    automaticObservation.disabledAfterToggle = !(await driver.property(offToggle, "checked"));
    const offTraceCount = (await readCatalogTrace(candidate.catalogTracePath)).filter((record) => record.trigger === "automatic").length;
    for (const offset of [4, 5]) {
      await driver.executeScript(`window.__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__ = { now: arguments[0] }; window.dispatchEvent(new Event("${"braindrive:desktop-verifier-clock-advanced"}")); return window.__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__.now;`, [clockBase + offset * 6 * 60 * 60 * 1000]);
      await delay(500);
    }
    const traceAfterOff = await readCatalogTrace(candidate.catalogTracePath);
    automaticObservation.offWindow = { requestCount: traceAfterOff.filter((record) => record.trigger === "automatic").length - offTraceCount, status: "executed" };
    recordVerifierAction(evidence, "click", { control: "Refresh app catalog", catalogTrigger: "refresh", catalogScenario: "manual-after-automatic-off" });
    await driver.click(await waitForVisible(driver, '//button[@aria-label="Refresh app catalog"]', 30_000));
    await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    automaticObservation.manualAfterOff = { succeeded: true };
    automaticObservation.packageStateAfter = (await snapshotFileTree(packageStateRoot)).sha256;
    automaticObservation.automaticMutationCountAfter = (await collectLifecycleEvidence(candidate)).lifecycleEvents.filter((event) =>
      event.event === "app.lifecycle.transition_completed" && ["install", "update"].includes(event.details?.lifecycle_action) && event.details?.outcome === "committed").length;
    const sidebarIndicator = await driver.findAllByXPath('//*[@data-testid="braindrive-update-indicator"]');
    automaticObservation.brainDriveUpdate = {
      sidebarIndicatorVisible: sidebarIndicator.length > 0,
      appsContainsBrainDriveEntry: Boolean(await driver.executeScript("return Boolean(document.querySelector('[data-app-key=\"braindrive\"]'));")),
      status: candidate.brainDriveUpdateVersion ? "executed" : "fixture_not_supplied",
    };
    evidence.automaticObservation = automaticObservation;
    recordVerifierAction(evidence, "automatic-check-review", {
      cadence: automaticObservation.cadence,
      automaticTraceCount: traceAfterAutomaticChecks.filter((record) => record.trigger === "automatic").length,
      automaticMutation: false,
      sidebarIndicatorVisible: automaticObservation.brainDriveUpdate.sidebarIndicatorVisible,
    });

    recordVerifierAction(evidence, "click", { control: "Refresh app catalog", catalogTrigger: "refresh", catalogScenario: "installed-app-outage" });
    await driver.click(await waitForVisible(driver, '//button[@aria-label="Refresh app catalog"]', 30_000));
    await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    const catalogCacheAfterInstalledRefresh = await snapshotFileTree(candidate.catalogCacheRoot);
    let offlineObservation = null;
    const offlineTrace = await readCatalogTrace(candidate.catalogTracePath);
    const repositoryFailure = offlineTrace.some((record) => record.network === true && record.trigger === "refresh" && record.outcome === "last_known_good");
    const offlineBody = await driver.text(await driver.findByXPath("//body"));
    if (repositoryFailure) {
      offlineObservation = {
        status: repositoryFailure && catalogCacheAfterInstalledRefresh.sha256 === catalogCacheAfterRefresh.sha256 && /couldn.?t reach the app catalog/i.test(offlineBody) ? STATUS.PASS : STATUS.FAIL,
        catalogPreserved: catalogCacheAfterInstalledRefresh.sha256 === catalogCacheAfterRefresh.sha256,
        installedAppUnaffected: installedAppOpened && /Active and ready|Open|Launch/i.test(await driver.text(await driver.findByXPath('//*[@data-app-key="resume-builder"]'))),
        body: offlineBody,
        cacheBeforeFailure: catalogCacheAfterRefresh,
        cacheAfterFailure: catalogCacheAfterInstalledRefresh,
      };
    }
    let newEntryObservation = null;
    const ceCatalogPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CE_CATALOG_PATH?.trim();
    if (ceCatalogPath) {
      const fixture = await readJsonFile(ceCatalogPath);
      const current = await readJsonFile(path.join(candidate.catalogCacheRoot, "stage1-catalog", "latest.json"));
      const currentIds = new Set((current?.entries ?? []).map((entry) => entry.package_identity?.package_id));
      const newEntries = (fixture?.entries ?? []).filter((entry) => !currentIds.has(entry.package_identity?.package_id));
      const newEntryVisible = newEntries.length > 0 && newEntries.some((entry) => new RegExp(entry.safe_presentation?.display_name?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? "^$", "i").test(offlineBody));
      newEntryObservation = {
        status: newEntryVisible ? STATUS.PASS : STATUS.FAIL,
        newEntryVisible,
        newEntryIds: newEntries.map((entry) => entry.package_identity?.package_id),
        fixturePath: ceCatalogPath,
      };
    }
    evidence.catalogObservation.offlineObservation = offlineObservation;
    evidence.catalogObservation.newEntryObservation = newEntryObservation;
    evidence.lifecycle = await collectLifecycleEvidence(candidate);
    evidence.automaticReview = await reviewAutomaticChecks({
      observation: evidence.automaticObservation,
      traceRecords: await readCatalogTrace(candidate.catalogTracePath),
      lifecycleEvents: evidence.lifecycle.lifecycleEvents,
    });
    await writeFile(path.join(artifactsRoot, "automatic-review.json"), `${JSON.stringify(evidence.automaticReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.automaticReview.rows);
    const activatedPackageStateRoot = path.join(candidate.isolatedAppDataBase, "BrainDrive", "app-platform", "state", "apps", "resume-builder", "registry", "packages");
    const activatedPackageStoreSnapshot = await snapshotFileTree(activatedPackageStateRoot);
    const activatedPackageDigests = evidence.lifecycle.lifecycleEvents
      .filter((event) => event.event === "app.lifecycle.transition_completed" && event.details?.lifecycle_action === "install" && event.details?.outcome === "committed")
      .map((event) => event.details?.package_digest)
      .filter((digest) => typeof digest === "string");
    const alternativeAcquisitionControls = (await collectVisibleControlInventory(driver)).filter((control) =>
      /github|zip|upload|install\s+from|import\s+(?:app|package)|browse.*(?:zip|package)|from.*(?:link|zip)/i.test(`${control.text ?? ""} ${control.ariaLabel ?? ""}`)
    );
    const catalogOwnerVisibleState = {
      cardText: activeText,
      controls: await collectVisibleControlInventory(driver),
    };
    evidence.controlInventories.push({
      state: "apps-active",
      surface: "Apps",
      controls: catalogOwnerVisibleState.controls,
    });
    evidence.e21 = await reviewE21PackagePortability({
      catalogSource: candidate.catalogSource,
      target: candidate.platform === "win32" ? "desktop_windows_x64" : "desktop_macos_universal",
      artifactsRoot,
      liveObservation: {
        catalogInstall: {
          executed: true,
          activatedPackageDigests,
          packageStoreSnapshot: activatedPackageStoreSnapshot,
          ownerVisibleState: catalogOwnerVisibleState,
        },
        alternativeAcquisitionControls,
      },
    });
    const e21Basis = evidence.e21.basis ?? "E-21 did not produce a complete portability record.";
    evidence.rowChecks["TB-6"] = { status: evidence.e21.status, basis: e21Basis };
    evidence.rowChecks["FR-10"] = { status: evidence.e21.status, basis: e21Basis };
    evidence.rowChecks["AC-1.1"] = { status: STATUS.NOT_RUN, basis: "The Apps transition was observed, but durable lifecycle activation evidence is not yet accepted." };
    evidence.rowChecks["DC-4"] = { status: STATUS.NOT_RUN, basis: "The owner-triggered Install transition was observed, but the required raw network timeline and verification journal are not captured." };
    evidence.rowChecks["FR-3"] = { status: STATUS.NOT_RUN, basis: "The native action path is present, but approval-screen and verification-journal parity has not been captured." };
    const promptTexts = [...new Set(installObservation.dialogsObservedAfterClick)];
    const approvalPrompt = promptTexts.find((text) => /approv|review.*access|requested access/i.test(text));
    const settingsPrompt = promptTexts.find((text) => /settings/i.test(text));
    evidence.rowChecks["AC-1.4"] = promptTexts.length === 1 && approvalPrompt && !settingsPrompt
      ? { status: STATUS.PASS, basis: "The install transition exposed exactly one non-Settings approval prompt; the raw prompt inventory is complete." }
      : { status: STATUS.FAIL, basis: `The install transition did not expose exactly one approval prompt. Observed prompts: ${promptTexts.length === 0 ? "none" : promptTexts.join(" | ")}.` };

    evidence.acquisitionReview = await reviewAcquisitionPaths({
      appsBody,
      preInstallControls: evidence.controlInventories[0]?.controls ?? [],
      postInstallControls: catalogOwnerVisibleState.controls,
      alternativeAcquisitionControls,
      dialogs: promptTexts,
      lifecycleEvents: evidence.lifecycle.lifecycleEvents,
      catalogInstallExecuted: true,
    });
    await writeFile(path.join(artifactsRoot, "acquisition-review.json"), `${JSON.stringify(evidence.acquisitionReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.acquisitionReview.rows);

    evidence.updateReview = await reviewUpdatePath({
      activeText,
      activeControls: catalogOwnerVisibleState.controls,
      lifecycleEvents: evidence.lifecycle.lifecycleEvents,
      inputActions: evidence.inputActions,
      dialogs: [],
    });
    await writeFile(path.join(artifactsRoot, "update-review.json"), `${JSON.stringify(evidence.updateReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.updateReview.rows);

    evidence.catalogReview = await reviewCatalogRefresh({
      catalogMetadata: null,
      tracePath: candidate.catalogTracePath,
      refreshObserved,
      metadataVisible: evidence.catalogObservation?.metadataVisible === true,
      asOfValid: evidence.catalogObservation?.metadataVisible === true,
      installedAppOpened,
      offlineObservation,
      newEntryObservation,
    });
    await writeFile(path.join(artifactsRoot, "catalog-review.json"), `${JSON.stringify(evidence.catalogReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.catalogReview.rows);

    const recoveryObservationPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_OBSERVATION_PATH?.trim() ?? null;
    const recoveryObservationPacket = recoveryObservationPath ? await readJsonFile(recoveryObservationPath) : null;
    evidence.recoveryObservation = {
      fixturePath: recoveryObservationPath,
      packetLoaded: Boolean(recoveryObservationPacket),
      screenshotsAvailable: evidence.screenshots,
    };
    evidence.recoveryReview = await reviewRecoveryAndAttention({
      candidate,
      observationPacket: recoveryObservationPacket,
      visibleText: activeText,
      controls: catalogOwnerVisibleState.controls,
      lifecycleEvents: evidence.lifecycle.lifecycleEvents,
      screenshots: evidence.screenshots,
      ownerData: {
        before: evidence.ownerDataFixture.beforeInstall,
        after: evidence.ownerDataFixture.beforeInstall,
      },
    });
    await writeFile(path.join(artifactsRoot, "recovery-review.json"), `${JSON.stringify(evidence.recoveryReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.recoveryReview.rows);

    const ownerDataBeforeUninstall = await snapshotFileTree(ownerDataRoot);
    const uninstallButtons = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[contains(@aria-label, "Remove app code for Resume Builder")]');
    assert.equal(uninstallButtons.length, 1, "The active entry must expose one uninstall control.");
    recordVerifierAction(evidence, "click", { control: "Remove app code for Resume Builder" });
    await driver.click(uninstallButtons[0]);
    const uninstallDialog = await waitForVisible(driver, '//div[@role="dialog"]', 30_000);
    const uninstallText = await driver.text(uninstallDialog);
    assert.match(uninstallText, /Uninstall Resume Builder/i, "The uninstall confirmation must name the app.");
    assert.match(uninstallText, /retain/i, "The uninstall confirmation must state retention.");
    assert.doesNotMatch(uninstallText, /Delete retained data/i, "Delete data must not be part of the uninstall confirmation.");
    evidence.rowChecks["AC-4.1"] = { status: STATUS.NOT_RUN, basis: "The uninstall confirmation was observed; the raw owner-data retention hash is evaluated after the complete branch." };
    evidence.rowChecks["AC-4.2"] = { status: STATUS.NOT_RUN, basis: "The retained-data delete control was not yet joined to the complete confirmation, cancel, and deletion hash evidence." };
    recordVerifierAction(evidence, "click", { control: "Uninstall app code" });
    await driver.click(await waitForVisible(driver, '//div[@role="dialog"]//button[normalize-space(.)="Uninstall app code"]'));
    await waitForVisible(driver, '//*[@data-app-key="resume-builder"]//*[contains(normalize-space(.), "Not installed")]', 120_000);
    const retainedCard = await driver.findByXPath('//*[@data-app-key="resume-builder"]');
    const retainedText = await driver.text(retainedCard);
    const ownerDataAfterUninstall = await snapshotFileTree(ownerDataRoot);
    const reinstallLifecycleBefore = await collectLifecycleEvidence(candidate);
    const retainedDataBeforeReinstall = await snapshotFileTree(ownerDataRoot);
    const reinstallButtons = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[contains(@aria-label, "Install Resume Builder")]');
    assert.equal(reinstallButtons.length, 1, "The retained-data entry must expose exactly one reinstall action.");
    recordVerifierAction(evidence, "click", { control: "Install Resume Builder", catalogScenario: "retained-data-reinstall" });
    await driver.click(reinstallButtons[0]);
    await waitForVisible(driver, '//*[@data-app-key="resume-builder"]//*[contains(normalize-space(.), "Active and ready") or contains(normalize-space(.), "Open") or contains(normalize-space(.), "Launch")]', 120_000);
    const reinstallCard = await driver.findByXPath('//*[@data-app-key="resume-builder"]');
    const reinstallText = await driver.text(reinstallCard);
    const reopenButtons = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[contains(@aria-label, "Resume Builder") and (contains(@aria-label, "Launch") or contains(@aria-label, "Open"))]');
    assert.equal(reopenButtons.length, 1, "The reinstalled entry must expose exactly one reopen action.");
    recordVerifierAction(evidence, "click", { control: "Open Resume Builder", catalogScenario: "retained-data-reopen" });
    await driver.click(reopenButtons[0]);
    const closeReopenedApp = await waitForVisible(driver, '//button[normalize-space(.)="Back to Apps" or normalize-space(.)="Close app"]', 60_000);
    const reopenedBodyText = await driver.text(await driver.findByXPath("//body"));
    recordVerifierAction(evidence, "click", { control: await driver.text(closeReopenedApp) });
    await driver.click(closeReopenedApp);
    await waitForVisible(driver, '//*[@data-testid="apps-page"]', 30_000);
    const reinstallLifecycleAfter = await collectLifecycleEvidence(candidate);
    const retainedDataAfterReopen = await snapshotFileTree(ownerDataRoot);
    const committedInstallCountBeforeReinstall = reinstallLifecycleBefore.lifecycleEvents.filter((event) =>
      event.event === "app.lifecycle.transition_completed" && event.details?.lifecycle_action === "install" && event.details?.outcome === "committed").length;
    const committedInstallCountAfterReinstall = reinstallLifecycleAfter.lifecycleEvents.filter((event) =>
      event.event === "app.lifecycle.transition_completed" && event.details?.lifecycle_action === "install" && event.details?.outcome === "committed").length;
    const reinstallCommitted = committedInstallCountAfterReinstall > committedInstallCountBeforeReinstall;
    evidence.reinstallObservation = {
      retainedText,
      reinstallText,
      reopened: true,
      reopenedBodyText,
      retainedDataBeforeReinstall,
      retainedDataAfterReopen,
      retainedDataPreserved: retainedDataBeforeReinstall.sha256 === retainedDataAfterReopen.sha256,
      lifecycleBefore: reinstallLifecycleBefore.lifecycleEvents,
      lifecycleAfter: reinstallLifecycleAfter.lifecycleEvents,
      reinstallCommitted,
    };
    const deleteControls = await driver.findAllByXPath('//*[@data-app-key="resume-builder"]//button[normalize-space(.)="Delete retained data"]');
    assert.equal(deleteControls.length, 1, "The uninstalled entry must expose a separate retained-data delete action.");
    evidence.rowChecks["AC-4.2"] = { status: STATUS.NOT_RUN, basis: "The retained-data delete control was found; its final status is computed from the raw cancel/confirm branch below." };
    const deleteControl = deleteControls[0];
    recordVerifierAction(evidence, "click", { control: "Delete retained data" });
    await driver.click(deleteControl);
    const deleteDialog = await waitForVisible(driver, '//div[@role="dialog"]', 30_000);
    const deleteDialogText = await driver.text(deleteDialog);
    assert.match(deleteDialogText, /Delete retained data for Resume Builder/i, "The retained-data confirmation must name the app.");
    assert.match(deleteDialogText, /permanently deletes|cannot be undone/i, "The retained-data confirmation must state the destructive consequence.");
    const ownerDataBeforeDeleteCancel = await snapshotFileTree(ownerDataRoot);
    recordVerifierAction(evidence, "click", { control: "Cancel retained-data deletion" });
    await driver.click(await waitForVisible(driver, '//div[@role="dialog"]//button[normalize-space(.)="Cancel"]'));
    const cancelDeadline = Date.now() + 10_000;
    while (Date.now() < cancelDeadline) {
      const dialogs = await driver.findAllByXPath('//div[@role="dialog"]');
      if (dialogs.length === 0 || !(await driver.isDisplayed(dialogs[0]).catch(() => false))) break;
      await delay(200);
    }
    const ownerDataAfterDeleteCancel = await snapshotFileTree(ownerDataRoot);
    recordVerifierAction(evidence, "click", { control: "Delete retained data", confirmation: true });
    await driver.click(deleteControl);
    const confirmedDeleteDialog = await waitForVisible(driver, '//div[@role="dialog"]', 30_000);
    assert.match(await driver.text(confirmedDeleteDialog), /Delete retained data for Resume Builder/i);
    await driver.click(await waitForVisible(driver, '//div[@role="dialog"]//button[normalize-space(.)="Delete retained data"]'));
    await delay(500);
    const ownerDataAfterConfirmedDelete = await snapshotFileTree(ownerDataRoot);
    evidence.ownerData = {
      root: ownerDataRoot,
      beforeUninstall: ownerDataBeforeUninstall,
      afterUninstall: ownerDataAfterUninstall,
      beforeDeleteCancel: ownerDataBeforeDeleteCancel,
      afterDeleteCancel: ownerDataAfterDeleteCancel,
      afterConfirmedDelete: ownerDataAfterConfirmedDelete,
      uninstallRetained: ownerDataBeforeUninstall.sha256 === ownerDataAfterUninstall.sha256,
      cancelPreserved: ownerDataBeforeDeleteCancel.sha256 === ownerDataAfterDeleteCancel.sha256,
      confirmedDeleteChanged: ownerDataAfterUninstall.sha256 !== ownerDataAfterConfirmedDelete.sha256,
    };
    evidence.retentionReview = await reviewRetentionAndOwnerData({
      candidate,
      ownerData: evidence.ownerData,
      deleteConfirmation: {
        namedApp: /Delete retained data for Resume Builder/i.test(deleteDialogText),
        confirmed: evidence.inputActions.some((action) => action.control === "Delete retained data" && action.confirmation === true),
        cancelObserved: evidence.inputActions.some((action) => action.control === "Cancel retained-data deletion"),
        rawActions: evidence.inputActions,
      },
      incompatibleMessage: { observed: false, hashUnchanged: false, basis: "The D-3 incompatible retained-data fixture was not supplied to this run." },
    });
    await writeFile(path.join(artifactsRoot, "retention-review.json"), `${JSON.stringify(evidence.retentionReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.retentionReview.rows);
    evidence.rowChecks["AC-4.1"] = evidence.ownerData.uninstallRetained
      ? { status: STATUS.PASS, basis: "The app-code uninstall retained the owner-data digest and the uninstall confirmation stated retention." }
      : { status: STATUS.FAIL, basis: "The app-code uninstall changed the owner-data digest despite the retention contract." };
    evidence.rowChecks["AC-4.2"] = deleteControls.length === 1
      && evidence.ownerData.cancelPreserved
      && evidence.ownerData.confirmedDeleteChanged
      ? { status: STATUS.PASS, basis: "The separate app-named delete control was confirmed, cancellation preserved the digest, and confirmed deletion changed it." }
      : { status: STATUS.FAIL, basis: "The retained-data delete branch did not prove separate control placement, cancel preservation, and confirmed deletion hash change." };
    const ac51Pass = /existing data|retained/i.test(retainedText)
      && evidence.reinstallObservation.reopened
      && evidence.reinstallObservation.reinstallCommitted
      && evidence.reinstallObservation.retainedDataPreserved;
    evidence.rowChecks["AC-5.1"] = ac51Pass
      ? { status: STATUS.PASS, basis: "The retained-data entry was reinstalled, the actual app was reopened, a second committed install was recomputed from the lifecycle journal, and the owner-data digest was unchanged." }
      : { status: STATUS.FAIL, basis: "The retained-data reinstall/reopen branch did not prove a second committed lifecycle transition and unchanged owner-data digest." };
    evidence.controlInventories.push({
      state: "apps-post-uninstall",
      surface: "Apps",
      controls: await collectVisibleControlInventory(driver),
    });
    evidence.personaReview = await reviewKatieJourney({
      candidate,
      lifecycleEvents: evidence.lifecycle?.lifecycleEvents ?? [],
      inputActions: evidence.inputActions,
    });
    evidence.katieCapture = {
      packetVersion: 1,
      status: STATUS.NOT_RUN,
      reason: "This native smoke begins at BrainDrive setup. It did not execute the actual Katie forum-post journey, so no Katie timing or information-boundary claim is emitted.",
    };
    await writeFile(path.join(artifactsRoot, "katie-capture.json"), `${JSON.stringify(evidence.katieCapture, null, 2)}\n`);
    await writeFile(path.join(artifactsRoot, "persona-review.json"), `${JSON.stringify(evidence.personaReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.personaReview.rows);
    evidence.faultRecoveryReview = await reviewFaultRecovery({
      candidate,
    });
    await writeFile(path.join(artifactsRoot, "fault-recovery-review.json"), `${JSON.stringify(evidence.faultRecoveryReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.faultRecoveryReview.rows);
    evidence.authorityReview = await reviewAuthorityBoundary({
      candidate,
      approvalDialogs: evidence.installObservation?.dialogsObservedAfterClick ?? [],
      lifecycleEvents: evidence.lifecycle?.lifecycleEvents ?? [],
    });
    await writeFile(path.join(artifactsRoot, "authority-review.json"), `${JSON.stringify(evidence.authorityReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.authorityReview.rows);
    evidence.catalogInventoryReview = await reviewCatalogInventory({
      candidate,
      renderedEntries: evidence.catalogBrowseObservation?.renderedEntries ?? [],
      detailsRendered: evidence.catalogBrowseObservation?.detailsRendered === true,
      browseObservation: evidence.catalogBrowseObservation,
    });
    await writeFile(path.join(artifactsRoot, "catalog-inventory-review.json"), `${JSON.stringify(evidence.catalogInventoryReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.catalogInventoryReview.rows);
    evidence.controlInventoryReview = reviewControlInventory({
      inventories: evidence.controlInventories,
      automaticCheckObservation: evidence.automaticCheckPlacement,
      settingsOpened: evidence.settingsControlInventory?.opened === true,
    });
    await writeFile(path.join(artifactsRoot, "control-inventory-review.json"), `${JSON.stringify(evidence.controlInventoryReview, null, 2)}\n`);
    Object.assign(evidence.rowChecks, evidence.controlInventoryReview.rows);
    await capture("apps-page", "Your Apps");
    evidence.setupActions.push({ action: "open-apps-page", result: "visible" });
    evidence.catalogSource = candidate.catalogSource;
    evidence.proofRows = createDesktopProofRows(evidence.rowChecks);
    evidence.status = reviewStatus(Object.fromEntries(evidence.proofRows.map((row) => [row.id, row])));
    return evidence;
  } catch (error) {
    evidence.status = STATUS.FAIL;
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.lifecycle = await collectLifecycleEvidence(candidate);
    if (evidence.lifecycle.installCommitted && !evidence.rowChecks["AC-1.1"]) {
      evidence.rowChecks["AC-1.1"] = { status: STATUS.FAIL, basis: "The gateway lifecycle journal records a committed install, but the native owner-facing Apps entry did not reach the active/Open state." };
      evidence.rowChecks["DC-4"] = { status: STATUS.NOT_RUN, basis: "The gateway lifecycle journal recorded an owner-triggered install, but the network timeline and complete verification evidence remain outstanding." };
    }
    evidence.proofRows = createDesktopProofRows(evidence.rowChecks);
    try {
      const screenshot = path.join(artifactsRoot, "failure.png");
      await driver.screenshot(screenshot);
      evidence.screenshots.push(screenshot);
    } catch {
      // Preserve the original test failure if the WebDriver session is already unavailable.
    }
    throw error;
  } finally {
    await writeFile(path.join(artifactsRoot, "desktop-entry-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}
