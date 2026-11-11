import { test, expect } from "@playwright/test";
import { loginAsLocalUser, visibleComposer, visibleSendButton } from "./helpers";

// These tests run against the desktop-chrome project defined in
// playwright.config.ts (1280x720 viewport). They are skipped on mobile projects.

test.describe("Desktop layout regression", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop-only tests");
    await loginAsLocalUser(page);
  });

  test("sidebar visible on desktop", async ({ page }) => {
    // The desktop sidebar wrapper is visible
    const sidebarWrapper = page.locator(".hidden.md\\:flex.md\\:shrink-0");
    await expect(sidebarWrapper).toBeVisible();

    // BrainDrive logo should be present in the sidebar
    const logo = page.getByAltText("BrainDrive").first();
    await expect(logo).toBeVisible();

    // Profile menu button exists in the sidebar
    const profileButton = page.getByRole("button", { name: "Open profile menu" });
    await expect(profileButton).toBeVisible();
  });

  test("desktop layout has no hamburger menu", async ({ page }) => {
    // The hamburger menu button should not be visible on desktop
    // It exists in the DOM (portal) but is hidden via md:hidden
    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menuButton).not.toBeVisible();
  });

  test("composer visible on desktop", async ({ page }) => {
    // Desktop composer (inline, not portal)
    const textarea = visibleComposer(page);
    await expect(textarea).toBeVisible();

    const sendButton = visibleSendButton(page);
    await expect(sendButton).toBeVisible();
  });

  test("desktop page has no horizontal overflow and primary controls stay reachable", async ({ page }) => {
    const viewport = page.viewportSize()!;
    const profileButton = page.getByRole("button", { name: "Open profile menu" });
    const composer = visibleComposer(page);
    const sendButton = visibleSendButton(page);

    await expect(profileButton).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(sendButton).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

    for (const control of [profileButton, composer, sendButton]) {
      const box = await control.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
  });

  test("first Page screen shows a readable empty state with controls inside the viewport", async ({ page }) => {
    const viewport = page.viewportSize()!;
    const heading = page.getByRole("heading", { name: "Welcome to BrainDrive" });
    const description = page.getByText(/Pick something on your mind right now/);
    const composer = visibleComposer(page);
    const sendButton = visibleSendButton(page);

    await expect(heading).toBeVisible();
    await expect(description).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(sendButton).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

    for (const element of [heading, description, composer, sendButton]) {
      const box = await element.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
  });
});
