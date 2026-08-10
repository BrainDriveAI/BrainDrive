import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

async function confirmOwnerAction(page: Page, label: RegExp) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(label, { timeout: 20_000 });
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openCareerApps(page: Page) {
  await page.getByRole("button", { name: "Career", exact: true }).click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
}

async function installAndLaunchCareer(page: Page): Promise<FrameLocator> {
  const install = page.getByRole("button", { name: "Install Resume Builder" });
  await expect(install).toBeVisible({ timeout: 15_000 });
  await install.click();
  const launch = page.getByRole("button", { name: "Continue from Career" });
  await expect(launch).toBeVisible({ timeout: 15_000 });
  await launch.click();
  const frame = resumeBuilderFrame(page);
  await expect(frame.getByRole("heading", { name: "Start with what BrainDrive already knows" })).toBeVisible({ timeout: 15_000 });
  return frame;
}

function resumeBuilderFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Resume Builder sandbox proxy"]').frameLocator('iframe[title="Resume Builder"]');
}

test.describe("Resume Builder owner journey", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The complete owner journey is exercised in desktop Chrome; responsive behavior has focused component and resource coverage.");
    await loginAsLocalUser(page);
  });

  test("completes Career entry, owner approvals, PDF export, history, and direct reopen", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await openCareerApps(page);
    let frame = await installAndLaunchCareer(page);
    const proxy = page.locator('iframe[title="Resume Builder sandbox proxy"]');
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    await expect(proxy).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    await expect(proxy).not.toHaveAttribute("srcdoc", /.+/);
    const proxySource = await proxy.getAttribute("src");
    expect(proxySource).toMatch(/^data:text\/html/);
    expect(proxySource).not.toContain("bridge_token_id");
    const innerSecurity = await frame.locator("html").evaluate(() => {
      let storage = "available";
      let parentDom = "available";
      let cookie = "available";
      try { void window.localStorage.length; } catch { storage = "blocked"; }
      try { void window.parent.document.body; } catch { parentDom = "blocked"; }
      try { cookie = document.cookie; } catch { cookie = "blocked"; }
      return {
        origin: window.origin,
        storage,
        parentDom,
        cookie,
        tauri: typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
        csp: Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).map((item) => item.getAttribute("content")),
      };
    });
    expect(innerSecurity).toMatchObject({ origin: "null", storage: "blocked", parentDom: "blocked", cookie: "blocked", tauri: "undefined" });
    expect(innerSecurity.csp.join("; ")).toContain("connect-src 'none'");
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Enter app" }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Resume Builder sandbox proxy");

    let forgedSideEffects = 0;
    page.on("request", (request) => { if (request.url().includes("/apps/resume-builder/apps-bridge")) forgedSideEffects += 1; });
    await proxy.evaluate((element) => (element as HTMLIFrameElement).contentWindow?.postMessage({ jsonrpc: "2.0", id: "forged", method: "tools/call", params: { name: "fixture.status" } }, "*"));
    await page.waitForTimeout(100);
    expect(forgedSideEffects).toBe(0);
    await frame.getByRole("button", { name: "Continue to interview" }).click();
    await frame.getByLabel("Your answer").fill("Delivered synthetic TypeScript systems for owners");
    await frame.getByRole("button", { name: "Review and confirm" }).click();
    await confirmOwnerAction(page, /Confirm career fact/);
    for (let remaining = 0; remaining < 4; remaining += 1) {
      await frame.getByRole("button", { name: "Skip for now" }).click();
    }

    await expect(frame.getByRole("heading", { name: "Review confirmed facts" })).toBeVisible();
    await frame.getByRole("button", { name: "Create general draft" }).click();
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Validate and approve" }).click();
    await confirmOwnerAction(page, /Approve resume version/);

    await expect(frame.getByRole("heading", { name: "Paste the target job description" })).toBeVisible({ timeout: 15_000 });
    await frame.getByLabel("Role label").fill("Synthetic TypeScript role");
    await frame.getByLabel("Job description").fill("Requires TypeScript delivery and respectful collaboration with product owners.");
    await frame.getByRole("button", { name: "Analyze evidence" }).click();
    await expect(frame.getByRole("heading", { name: "Requirement evidence" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Create tailored variant" }).click();
    await expect(frame.getByRole("heading", { name: "Tailored resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Validate and approve" }).click();
    await confirmOwnerAction(page, /Approve resume version/);

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Create preview" }).click();
    await expect(frame.getByText("ATS parse-back passed")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("resume-builder-career-preview.png"), fullPage: true });
    const download = page.waitForEvent("download");
    await frame.getByRole("button", { name: "Export PDF" }).click();
    await confirmOwnerAction(page, /Export resume PDF/);
    expect((await download).suggestedFilename()).toBe("resume.pdf");
    await expect(frame.getByRole("alert")).toContainText("Export ready: resume.pdf");

    await frame.locator("#history").click();
    await expect(frame.getByRole("heading", { name: "Resume history" })).toBeVisible();
    await expect(frame.getByText(/targeted · approved/)).toBeVisible();

    const reconnectEvents: Array<{ kind: "launch" | "close"; body?: unknown }> = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/apps/resume-builder/launch") && request.method() === "POST") {
        reconnectEvents.push({ kind: "launch", body: request.postDataJSON() });
      } else if (/\/sessions\/[^/]+$/.test(pathname)) {
        reconnectEvents.push({ kind: "close" });
      }
    });
    await page.getByRole("button", { name: "Reload app" }).click();
    await expect.poll(async () => await proxy.getAttribute("src")).not.toBe(proxySource);
    frame = resumeBuilderFrame(page);
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    expect(reconnectEvents[0]).toMatchObject({
      kind: "launch",
      body: {
        entry_point: "career",
        resume: {
          session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          view_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          bridge_generation: 1,
        },
      },
    });

    await page.getByRole("button", { name: "Close app" }).click();
    await page.getByRole("button", { name: "Your Agent", exact: true }).click();
    await page.getByRole("button", { name: "Apps", exact: true }).click();
    await page.getByRole("button", { name: "Launch", exact: true }).click();
    const reopened = resumeBuilderFrame(page);
    await expect(reopened.getByText("Direct resume workspace")).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByRole("heading", { name: "Preview approved resume" })).toBeVisible();
  });
});
