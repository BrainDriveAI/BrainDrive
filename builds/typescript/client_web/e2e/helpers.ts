import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";

export type FirstPartyAppName = "Resume Builder" | "Brief Builder";
export type WorkspaceReadiness =
  | { kind: "chat_workspace"; workspace: Locator }
  | { kind: "sandbox"; frame: FrameLocator; proxy: Locator };

/**
 * Log in through the local auth form.
 *
 * The isolated E2E runner creates a disposable local account matching these
 * environment-provided synthetic credentials before Playwright starts.
 */
export async function loginAsLocalUser(page: Page) {
  await page.goto("/");
  await page.locator("#identifier").fill(
    process.env.BRAINDRIVE_E2E_IDENTIFIER ?? "synthetic-e2e-owner"
  );
  await page.locator("#password").fill(
    process.env.BRAINDRIVE_E2E_PASSWORD ?? "synthetic-e2e-password-26!"
  );
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for the main app shell to appear.
  // Use a visible textarea selector because the app renders both a desktop and
  // mobile composer — only one is visible depending on viewport width.
  await page.locator('textarea[placeholder="Message your BrainDrive..."]:visible').waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

/**
 * Get the visible composer textarea.
 *
 * The app renders two <textarea> elements with the same placeholder — one
 * inline (desktop, hidden on mobile via `hidden md:block`) and one portalled
 * to document.body (mobile, hidden on desktop via `md:hidden`).
 */
export function visibleComposer(page: Page): Locator {
  return page.locator('textarea[placeholder="Message your BrainDrive..."]:visible');
}

/**
 * Get the visible send button.
 *
 * Like the composer, the send button exists in both desktop and mobile
 * versions. Returns the visible one.
 */
export function visibleSendButton(page: Page): Locator {
  return page.locator('button[aria-label="Send message"]:visible');
}

export function appSandboxFrame(page: Page, appName: FirstPartyAppName): FrameLocator {
  return page.frameLocator(`iframe[title="${appName} sandbox proxy"]`).frameLocator(`iframe[title="${appName}"]`);
}

export function appLaunchButton(card: Locator, appName: FirstPartyAppName): Locator {
  if (appName === "Resume Builder") {
    return card.getByRole("button", { name: /^(Launch|Continue from Career)$/ });
  }
  return card.getByRole("button", { name: /^(Launch|Brief Chat)$/ });
}

export async function expectAppWorkspaceReady(page: Page, appName: FirstPartyAppName): Promise<WorkspaceReadiness> {
  const nativeWorkspace = page.getByTestId("app-chat-workspace");
  const sandboxReady = page.getByRole("status").filter({ hasText: "App ready" });
  await expect(nativeWorkspace.or(sandboxReady)).toBeVisible({ timeout: 20_000 });

  if (await nativeWorkspace.isVisible()) {
    await expect(
      page.getByRole("navigation", { name: `${appName} workspace navigation` })
        .or(page.getByRole("button", { name: "Open workspace navigation menu" })),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('textarea[placeholder="Message your BrainDrive..."]:visible')).toBeVisible();
    return { kind: "chat_workspace", workspace: nativeWorkspace };
  }

  const proxy = page.locator(`iframe[title="${appName} sandbox proxy"]`);
  const frame = appSandboxFrame(page, appName);
  await expect(proxy).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
  await expect(proxy).not.toHaveAttribute("srcdoc", /.+/);
  return { kind: "sandbox", frame, proxy };
}

export async function closeAppWorkspace(page: Page, readiness: WorkspaceReadiness) {
  await page.getByRole("button", { name: readiness.kind === "chat_workspace" ? "Back to Apps" : "Close app" }).click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
}
