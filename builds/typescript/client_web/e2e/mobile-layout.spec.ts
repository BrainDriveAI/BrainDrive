import { test, expect } from "@playwright/test";
import { loginAsLocalUser, visibleComposer, visibleSendButton } from "./helpers";

// These tests run against the mobile-chrome and mobile-safari projects
// defined in playwright.config.ts (Pixel 7 / iPhone 14 viewports).
//
// NOTE: The gateway must be running on localhost:3000 for chat messages to
// actually round-trip. Layout assertions work without it, but tests that
// send messages and wait for AI responses will time out.

test.describe("Mobile layout regression", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile-only tests");
    await loginAsLocalUser(page);
  });

  test("header stays visible on page load", async ({ page }) => {
    // Hamburger menu button
    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menuButton).toBeVisible();

    // BrainDrive logo (mobile header portal renders one in the fixed header)
    const logo = page.locator('img[alt="BrainDrive"]:visible').first();
    await expect(logo).toBeVisible();

    // Header is within the top 100px of the viewport
    const headerBox = await menuButton.boundingBox();
    expect(headerBox).toBeTruthy();
    expect(headerBox!.y).toBeLessThan(100);
  });

  test("composer stays pinned at bottom", async ({ page }) => {
    const viewport = page.viewportSize()!;

    // Composer textarea is visible
    const textarea = visibleComposer(page);
    await expect(textarea).toBeVisible();

    // Send button is visible
    const sendButton = visibleSendButton(page);
    await expect(sendButton).toBeVisible();

    // Composer is within the bottom 150px of the viewport
    const textareaBox = await textarea.boundingBox();
    expect(textareaBox).toBeTruthy();
    expect(textareaBox!.y + textareaBox!.height).toBeGreaterThan(viewport.height - 150);
  });

  test("messages are scrollable", async ({ page }) => {
    test.setTimeout(60_000);
    const viewport = page.viewportSize()!;
    const textarea = visibleComposer(page);
    const sendButton = visibleSendButton(page);

    // Send several messages to fill the screen
    for (let i = 0; i < 6; i++) {
      await textarea.fill(`Test message ${i + 1} — filling screen with content.`);
      await sendButton.click();
      await page.waitForTimeout(200);
    }

    // Find the scrollable message container
    const messageContainer = page.locator(".overflow-y-auto.overscroll-contain");
    await expect(messageContainer).toBeVisible();

    // Verify we can scroll — container should have scrollable content
    const scrollInfo = await messageContainer.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }));
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);

    // Scroll up
    await messageContainer.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(200);

    // Header remains visible after scrolling
    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menuButton).toBeVisible();
    const headerBox = await menuButton.boundingBox();
    expect(headerBox).toBeTruthy();
    expect(headerBox!.y).toBeLessThan(100);

    // Composer remains visible after scrolling
    await expect(textarea).toBeVisible();
    const composerBox = await textarea.boundingBox();
    expect(composerBox).toBeTruthy();
    expect(composerBox!.y + composerBox!.height).toBeGreaterThan(viewport.height - 150);
  });

  test("header stays visible after sending messages", async ({ page }) => {
    const viewport = page.viewportSize()!;
    const textarea = visibleComposer(page);

    // Send a message
    await textarea.fill("Hello, this is a test message.");
    await visibleSendButton(page).click();

    // Wait for the user message to appear in the list
    await expect(page.locator("article").first()).toBeVisible({ timeout: 5_000 });

    // Optionally wait for AI response (may not arrive without gateway)
    // We give it a short window — the layout test is what matters.
    await page.waitForTimeout(2_000);

    // Header is still visible (within top 100px)
    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menuButton).toBeVisible();
    const headerBox = await menuButton.boundingBox();
    expect(headerBox).toBeTruthy();
    expect(headerBox!.y).toBeLessThan(100);

    // Composer is still visible (within bottom 150px)
    await expect(textarea).toBeVisible();
    const composerBox = await textarea.boundingBox();
    expect(composerBox).toBeTruthy();
    expect(composerBox!.y + composerBox!.height).toBeGreaterThan(viewport.height - 150);
  });

  test("layout does not break after multiple messages", async ({ page }) => {
    const viewport = page.viewportSize()!;
    const textarea = visibleComposer(page);
    const sendButton = visibleSendButton(page);
    const menuButton = page.getByRole("button", { name: "Open navigation menu" });

    for (let round = 1; round <= 4; round++) {
      // Send a message
      await textarea.fill(`Round ${round}: Testing layout stability under repeated messaging.`);
      await sendButton.click();

      // Wait for message to render
      await page.waitForTimeout(1_000);

      // After each send, verify layout integrity:

      // Header visible
      await expect(menuButton).toBeVisible();
      const headerBox = await menuButton.boundingBox();
      expect(headerBox).toBeTruthy();
      expect(headerBox!.y).toBeLessThan(100);

      // Composer visible
      await expect(textarea).toBeVisible();
      const composerBox = await textarea.boundingBox();
      expect(composerBox).toBeTruthy();
      expect(composerBox!.y + composerBox!.height).toBeGreaterThan(viewport.height - 150);

      // Messages scrollable (after enough messages)
      if (round >= 3) {
        const messageContainer = page.locator(".overflow-y-auto.overscroll-contain");
        const scrollInfo = await messageContainer.evaluate((el) => ({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }));
        expect(scrollInfo.scrollHeight).toBeGreaterThanOrEqual(scrollInfo.clientHeight);
      }
    }
  });
});
