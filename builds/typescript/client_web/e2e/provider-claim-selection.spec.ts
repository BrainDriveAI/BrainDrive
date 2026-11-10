import { expect, test, type Page, type Route } from "@playwright/test";

import type { GatewaySettings } from "../src/api/types";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type SettingsRequest = {
  active_provider_profile?: string | null;
};

type ModelsRuntimeScenario =
  | "post-claim-layout-shift"
  | "existing-credential-grant"
  | "no-matching-grant";

const EXISTING_CREDENTIAL_REF = "provider/ai-gateway/e2e-existing-key";

const JSON_HEADERS = { "content-type": "application/json" };

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function initialSettings(scenario: ModelsRuntimeScenario = "post-claim-layout-shift"): GatewaySettings {
  const hasExistingCredential = scenario === "existing-credential-grant";
  return {
    default_model: "braindrive-models-default",
    approval_mode: "ask-on-write",
    active_provider_profile: "braindrive-models",
    provider_activation_revision: 0,
    default_provider_profile: "braindrive-models",
    available_models: ["braindrive-models-default"],
    provider_profiles: [
      {
        id: "braindrive-models",
        provider_id: "braindrive-models",
        base_url: "https://models.invalid/v1",
        model: "braindrive-models-default",
        credential_mode: hasExistingCredential ? "secret_ref" : "unset",
        credential_ref: hasExistingCredential ? EXISTING_CREDENTIAL_REF : null,
      },
      {
        id: "openrouter",
        provider_id: "openrouter",
        base_url: "https://openrouter.invalid/v1",
        model: "openrouter-test-model",
        credential_mode: "secret_ref",
        credential_ref: "provider/openrouter/e2e-placeholder",
      },
      {
        id: "ollama",
        provider_id: "ollama",
        base_url: "http://127.0.0.1:11434/v1",
        model: "ollama-test-model",
        credential_mode: "unset",
        credential_ref: null,
      },
    ],
    braindrive_models_key: hasExistingCredential
      ? { status: "zero_balance", checkout_pending: false }
      : null,
    memory_backup: null,
  };
}

function claimedSettings(settings: GatewaySettings): GatewaySettings {
  return {
    ...settings,
    active_provider_profile: "braindrive-models",
    provider_activation_revision: 1,
    provider_profiles: settings.provider_profiles.map((profile) =>
      profile.id === "braindrive-models"
        ? {
            ...profile,
            credential_mode: "secret_ref",
            credential_ref: profile.credential_ref ?? "provider/ai-gateway/e2e-placeholder",
          }
        : profile
    ),
    braindrive_models_key: {
      status: "ready",
      checkout_pending: false,
    },
  };
}

async function fulfillJson(route: Route, json: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, headers: JSON_HEADERS, json });
}

// Candidate-bound Models V1 runtime: every API request is intercepted and any
// unlisted route fails, so these scenarios cannot contact a hosted or paid service.
async function installDeterministicGateway(
  page: Page,
  scenario: ModelsRuntimeScenario = "post-claim-layout-shift"
): Promise<{
  claimResponse: Deferred<void>;
  claimRequestCount: () => number;
  settingsRequests: SettingsRequest[];
  claimedCredentialRef: () => string | null;
}> {
  let settings = initialSettings(scenario);
  let claimRequestCount = 0;
  let credentialRefAfterClaim: string | null = null;
  const claimResponse = createDeferred<void>();
  const settingsRequests: SettingsRequest[] = [];

  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/config" && method === "GET") {
      await fulfillJson(route, {
        mode: "local",
        gateway_url: "/api",
        billing_url: "https://billing.invalid/credits",
        install_mode: "dev",
        install_location: "local",
        app_version: "e2e",
      });
      return;
    }
    if (path === "/api/auth/bootstrap-status" && method === "GET") {
      await fulfillJson(route, { account_initialized: true, mode: "local" });
      return;
    }
    if (path === "/api/auth/refresh" && method === "POST") {
      await fulfillJson(route, { access_token: "e2e-session-token" });
      return;
    }
    if (path === "/api/session" && method === "GET") {
      await fulfillJson(route, {
        mode: "local",
        user: {
          id: "owner",
          name: "Local Owner",
          initials: "LO",
          email: "owner@local.braindrive",
          role: "owner",
        },
      });
      return;
    }
    if (path === "/api/projects" && method === "GET") {
      await fulfillJson(route, { projects: [] });
      return;
    }
    if (path === "/api/settings/onboarding-status" && method === "GET") {
      await fulfillJson(route, {
        onboarding_required: true,
        active_provider_profile: "braindrive-models",
        default_provider_profile: "braindrive-models",
        providers: [
          {
            profile_id: "braindrive-models",
            provider_id: "braindrive-models",
            credential_mode: "unset",
            credential_ref: null,
            requires_secret: true,
            credential_resolved: false,
            resolution_source: "none",
            resolution_error: null,
          },
        ],
      });
      return;
    }
    if (path === "/api/settings" && method === "GET") {
      await fulfillJson(route, settings);
      return;
    }
    if (path === "/api/settings" && method === "PUT") {
      const body = request.postDataJSON() as SettingsRequest;
      settingsRequests.push(body);
      expect(body).toEqual({ active_provider_profile: "openrouter" });
      settings = {
        ...settings,
        default_model: "openrouter-test-model",
        active_provider_profile: "openrouter",
        provider_activation_revision: 2,
      };
      await fulfillJson(route, settings);
      return;
    }
    if (path === "/api/settings/models" && method === "GET") {
      const providerProfile = new URL(request.url()).searchParams.get("provider_profile");
      await fulfillJson(route, {
        provider_profile: providerProfile,
        provider_id: providerProfile,
        source: "fallback",
        models: [],
      });
      return;
    }
    if (path === "/api/credits/entitlements/capability" && method === "GET") {
      await fulfillJson(route, { available: true, version: "e2e" });
      return;
    }
    if (path === "/api/credits/entitlements/status" && method === "GET") {
      await fulfillJson(
        route,
        { error: "No claim operation is available", code: "no_claim_operation" },
        404
      );
      return;
    }
    if (path === "/api/credits/entitlements/claim" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["email"]);
      expect(body.email).toMatch(/@example\.test$/);
      claimRequestCount += 1;
      if (scenario === "no-matching-grant") {
        await fulfillJson(
          route,
          { error: "No available email credit was found", code: "no_available_credit" },
          404
        );
        return;
      }
      await claimResponse.promise;
      settings = claimedSettings(settings);
      credentialRefAfterClaim = settings.provider_profiles.find(
        (profile) => profile.id === "braindrive-models"
      )?.credential_ref ?? null;
      await fulfillJson(route, {
        state: "completed",
        operation_id: "operation-e2e-claim",
        applied_cents: 1250,
        balance: {
          remaining_usd: 12.5,
          total_purchased_usd: 12.5,
          total_spent_usd: 0,
          key_valid: true,
          purchase_status: "ready",
        },
        settings,
      });
      return;
    }
    if (path === "/api/credits/status" && method === "GET") {
      if (scenario === "existing-credential-grant") {
        await fulfillJson(route, {
          remaining_usd: 0,
          total_purchased_usd: 0,
          total_spent_usd: 0,
          key_valid: true,
          purchase_status: "zero_balance",
        });
        return;
      }
      await fulfillJson(route, {
        remaining_usd: 12.5,
        total_purchased_usd: 12.5,
        total_spent_usd: 0,
        key_valid: true,
        purchase_status: "ready",
      });
      return;
    }

    await fulfillJson(route, { error: "Unmocked API route", path, method }, 404);
  });

  return {
    claimResponse,
    claimRequestCount: () => claimRequestCount,
    settingsRequests,
    claimedCredentialRef: () => credentialRefAfterClaim,
  };
}

test("post-claim layout shift cannot activate OpenRouter without a second deliberate gesture", async ({
  page,
}, testInfo) => {
  const gateway = await installDeterministicGateway(page);
  const claimStarted = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/credits/entitlements/claim" &&
      request.method() === "POST"
  );

  await page.goto("/");

  const settingsHeading = page.getByRole("heading", { name: "Settings" }).filter({
    visible: true,
  });
  await expect(settingsHeading).toBeVisible();

  const brainDriveCard = page.locator(
    'button[aria-label^="BrainDrive Models provider settings"]:visible'
  );
  const openRouterCard = page.locator(
    'button[aria-label^="OpenRouter provider settings"]:visible'
  );
  const emailInput = page.locator("#bd-models-billing-email:visible");
  const checkoutButton = page.getByRole("button", {
    name: /Continue to checkout/i,
  }).filter({ visible: true });

  await expect(brainDriveCard).toHaveAttribute("aria-expanded", "true");
  await expect(brainDriveCard).toHaveAttribute("aria-current", "true");
  await expect(openRouterCard).toHaveAttribute("aria-expanded", "false");
  await expect(checkoutButton).toBeVisible();

  await emailInput.fill(["rendered-claim", "example.test"].join("@"));
  await claimStarted;
  await expect.poll(gateway.claimRequestCount).toBe(1);

  const initialOpenRouterBox = await openRouterCard.boundingBox();
  const checkoutBox = await checkoutButton.boundingBox();
  expect(initialOpenRouterBox).not.toBeNull();
  expect(checkoutBox).not.toBeNull();

  const parkedPointer = {
    x: checkoutBox!.x + checkoutBox!.width / 2,
    y: checkoutBox!.y + checkoutBox!.height / 2,
  };
  expect(parkedPointer.y).toBeLessThan(initialOpenRouterBox!.y);
  await page.mouse.move(parkedPointer.x, parkedPointer.y);

  gateway.claimResponse.resolve(undefined);
  await expect(page.getByRole("status").filter({ visible: true })).toContainText(
    "$12.50 email credit applied."
  );
  await expect(page.getByText("$12.50", { exact: true }).filter({ visible: true })).toBeVisible();

  const shiftedOpenRouterBox = await openRouterCard.boundingBox();
  expect(shiftedOpenRouterBox).not.toBeNull();
  expect(shiftedOpenRouterBox!.y).toBeLessThan(initialOpenRouterBox!.y);
  expect(parkedPointer.x).toBeGreaterThanOrEqual(shiftedOpenRouterBox!.x);
  expect(parkedPointer.x).toBeLessThanOrEqual(
    shiftedOpenRouterBox!.x + shiftedOpenRouterBox!.width
  );
  expect(parkedPointer.y).toBeGreaterThanOrEqual(shiftedOpenRouterBox!.y);
  expect(parkedPointer.y).toBeLessThanOrEqual(
    shiftedOpenRouterBox!.y + shiftedOpenRouterBox!.height
  );

  // Keep the pointer at the pre-collapse screen coordinate and click the card
  // that moved underneath it. The displaced gesture may disclose OpenRouter,
  // but it must not mutate the authoritative provider.
  await page.mouse.down();
  await page.mouse.up();
  await expect(openRouterCard).toHaveAttribute("aria-expanded", "true");
  await expect(openRouterCard).toBeFocused();
  await expect(brainDriveCard).toHaveAttribute("aria-current", "true");
  await expect(openRouterCard).not.toHaveAttribute("aria-current", "true");
  expect(gateway.settingsRequests).toHaveLength(0);

  await testInfo.attach("post-claim-displaced-click", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  // The first displaced click focuses and discloses the one-click card without
  // activating it. A subsequent keyboard gesture on that focused card is
  // deliberate and may perform the activation.
  await expect(openRouterCard).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(openRouterCard).toHaveAttribute("aria-current", "true");
  await expect(brainDriveCard).not.toHaveAttribute("aria-current", "true");
  expect(gateway.settingsRequests).toEqual([
    { active_provider_profile: "openrouter" },
  ]);

  await testInfo.attach("deliberate-openrouter-activation", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("email grant preserves an existing credential and reports the funded ready state", async ({
  page,
}) => {
  const gateway = await installDeterministicGateway(page, "existing-credential-grant");

  await page.goto("/");

  const brainDriveCard = page.locator(
    'button[aria-label^="BrainDrive Models provider settings"]:visible'
  );
  await expect(brainDriveCard).toHaveAttribute("aria-current", "true");

  const emailInput = page.locator("#bd-models-billing-email:visible");
  await expect(emailInput).toBeVisible();
  await emailInput.fill("existing-recipient@example.test");
  await expect.poll(gateway.claimRequestCount).toBe(1);

  gateway.claimResponse.resolve(undefined);
  await expect(page.getByRole("status").filter({ visible: true })).toHaveText(
    "$12.50 email credit applied."
  );
  expect(gateway.claimedCredentialRef()).toBe(EXISTING_CREDENTIAL_REF);
  expect(gateway.settingsRequests).toHaveLength(0);

  const panelId = await brainDriveCard.getAttribute("aria-controls");
  expect(panelId).not.toBeNull();
  const panelText = await page.locator(`#${panelId}`).innerText();
  expect(panelText).not.toMatch(/\b(API key|route|provider|token|LiteLLM|webhook)\b/i);
});

test("an unmatched grant email reports no credit without disclosing grant state", async ({ page }) => {
  const gateway = await installDeterministicGateway(page, "no-matching-grant");

  await page.goto("/");
  await page.locator("#bd-models-billing-email:visible").fill("unmatched@example.test");
  await expect.poll(gateway.claimRequestCount).toBe(1);

  await expect(page.getByRole("status").filter({ visible: true })).toHaveText(
    "No credit was added."
  );
  await expect(page.getByText("$12.50", { exact: true }).filter({ visible: true })).not.toBeVisible();
  await expect(page.getByRole("status").filter({ visible: true })).not.toContainText(/grant|available/i);
});
