import type { Locator, Page } from "@playwright/test";

/**
 * Log in through the local auth form.
 *
 * The current helper submits fixed synthetic credentials to the real local
 * login endpoint. It therefore requires an initialized isolated account with
 * matching credentials; arbitrary non-empty values do not create a session.
 * Until that seed contract exists, this helper is not clean-start evidence.
 */
export async function loginAsLocalUser(page: Page) {
  await page.goto("/");
  await page.locator("#identifier").fill("testuser");
  await page.locator("#password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for the main app shell to appear.
  // Use a visible textarea selector because the app renders both a desktop and
  // mobile composer — only one is visible depending on viewport width.
  await page.locator('textarea[placeholder="Message your BrainDrive..."]:visible').waitFor({
    state: "visible",
    timeout: 10_000,
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
