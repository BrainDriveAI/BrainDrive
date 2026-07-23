import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES,
  classifyProcessGuardrailProvider,
  decideProcessGuardrailActivation,
} from "./activation.js";
import type {
  ProcessGuardrailActivationInput,
  ProcessGuardrailScope,
} from "./contracts.js";

const eligiblePage = {
  id: "career",
  files: [...PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES],
};

const scopes = ["none", "local", "cloud", "all"] as const satisfies readonly ProcessGuardrailScope[];
const providerCases = [
  { providerId: "ollama", providerClass: "local", enabledScopes: ["local", "all"] },
  { providerId: "braindrive-models", providerClass: "cloud", enabledScopes: ["cloud", "all"] },
  { providerId: "openrouter", providerClass: "cloud", enabledScopes: ["cloud", "all"] },
  { providerId: "future-provider", providerClass: "unclassified", enabledScopes: [] },
] as const;

function activationInput(
  overrides: Partial<ProcessGuardrailActivationInput> = {}
): ProcessGuardrailActivationInput {
  return {
    scope: "all",
    providerId: "ollama",
    page: eligiblePage,
    processStartRequested: true,
    resumableStateEligible: false,
    ...overrides,
  };
}

describe("process guardrail provider classification", () => {
  it.each(providerCases)(
    "classifies $providerId as $providerClass",
    ({ providerId, providerClass }) => {
      expect(classifyProcessGuardrailProvider(providerId)).toBe(providerClass);
    }
  );

  it.each([undefined, null, "", "OLLAMA", "https://localhost:11434/v1"])(
    "does not guess an unknown provider from %s",
    (providerId) => {
      expect(classifyProcessGuardrailProvider(providerId)).toBe("unclassified");
    }
  );
});

describe("process guardrail activation", () => {
  for (const scope of scopes) {
    for (const providerCase of providerCases) {
      it(`${scope} with ${providerCase.providerId} matches the activation matrix`, () => {
        const decision = decideProcessGuardrailActivation(
          activationInput({
            scope,
            providerId: providerCase.providerId,
          })
        );
        const expectedEnabled = (providerCase.enabledScopes as readonly string[]).includes(scope);

        expect(decision.providerClass).toBe(providerCase.providerClass);
        expect(decision.enterGuardrails).toBe(expectedEnabled);
        expect(decision.exposeProcessStart).toBe(expectedEnabled);
        expect(decision.requestedWork).toEqual({
          state: expectedEnabled,
          trace: expectedEnabled,
          validation: expectedEnabled,
          guardedModel: expectedEnabled,
        });
      });
    }
  }

  it("keeps missing pages on the unguarded path", () => {
    const decision = decideProcessGuardrailActivation(activationInput({ page: null }));

    expect(decision).toMatchObject({
      decisionCode: "page_missing",
      pageEligibility: "missing",
      exposeProcessStart: false,
      enterGuardrails: false,
    });
    expect(decision.requestedWork).toEqual({
      state: false,
      trace: false,
      validation: false,
      guardedModel: false,
    });
  });

  it.each(["your-agent", "braindrive-plus-one"])(
    "keeps root page %s on the unguarded path",
    (pageId) => {
      const decision = decideProcessGuardrailActivation(
        activationInput({
          page: {
            id: pageId,
            files: [...PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES],
          },
        })
      );

      expect(decision).toMatchObject({
        decisionCode: "page_root_ineligible",
        pageEligibility: "root_ineligible",
        exposeProcessStart: false,
        enterGuardrails: false,
      });
    }
  );

  it("keeps a page missing a fixed process file on the unguarded path", () => {
    const decision = decideProcessGuardrailActivation(
      activationInput({
        page: {
          id: "career",
          files: PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES.filter((file) => file !== "run-journal.md"),
        },
      })
    );

    expect(decision).toMatchObject({
      decisionCode: "page_process_files_missing",
      pageEligibility: "process_files_missing",
      exposeProcessStart: false,
      enterGuardrails: false,
    });
  });

  it("offers only the structural start affordance before a start signal", () => {
    const decision = decideProcessGuardrailActivation(
      activationInput({
        processStartRequested: false,
        resumableStateEligible: false,
      })
    );

    expect(decision).toMatchObject({
      decisionCode: "process_start_available",
      exposeProcessStart: true,
      enterGuardrails: false,
    });
    expect(decision.requestedWork).toEqual({
      state: false,
      trace: false,
      validation: false,
      guardedModel: false,
    });
  });

  it("enters a structurally requested new process", () => {
    const decision = decideProcessGuardrailActivation(
      activationInput({
        processStartRequested: true,
        resumableStateEligible: false,
      })
    );

    expect(decision).toMatchObject({
      decisionCode: "process_start_eligible",
      exposeProcessStart: true,
      enterGuardrails: true,
      resumeProcess: false,
    });
  });

  it("resumes eligible state without requiring or exposing a start signal", () => {
    const decision = decideProcessGuardrailActivation(
      activationInput({
        processStartRequested: false,
        resumableStateEligible: true,
      })
    );

    expect(decision).toMatchObject({
      decisionCode: "resumable_state_eligible",
      exposeProcessStart: false,
      enterGuardrails: true,
      resumeProcess: true,
    });
    expect(decision.requestedWork).toEqual({
      state: true,
      trace: true,
      validation: true,
      guardedModel: true,
    });
  });

  it.each([
    {
      label: "scope disabled",
      overrides: {
        scope: "none" as const,
        providerId: "ollama",
        resumableStateEligible: true,
      },
      code: "scope_disabled",
    },
    {
      label: "unknown provider",
      overrides: {
        scope: "all" as const,
        providerId: "future-provider",
        resumableStateEligible: true,
      },
      code: "provider_unclassified",
    },
    {
      label: "provider disabled by scope",
      overrides: {
        scope: "local" as const,
        providerId: "openrouter",
        resumableStateEligible: true,
      },
      code: "provider_disabled_by_scope",
    },
  ])("$label requests no guardrail work", ({ overrides, code }) => {
    const decision = decideProcessGuardrailActivation(activationInput(overrides));

    expect(decision.decisionCode).toBe(code);
    expect(decision.enterGuardrails).toBe(false);
    expect(decision.exposeProcessStart).toBe(false);
    expect(decision.requestedWork).toEqual({
      state: false,
      trace: false,
      validation: false,
      guardedModel: false,
    });
  });

  it("returns sanitized diagnostics without arbitrary provider or page input", () => {
    const providerInput = "https://example.invalid/v1?token=owner-secret";
    const pageInput = "owner-private-page-name";
    const decision = decideProcessGuardrailActivation(
      activationInput({
        providerId: providerInput,
        page: {
          id: pageInput,
          files: [...PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES],
        },
      })
    );
    const serializedDiagnostic = JSON.stringify(decision.diagnostic);

    expect(serializedDiagnostic).not.toContain(providerInput);
    expect(serializedDiagnostic).not.toContain(pageInput);
    expect(serializedDiagnostic).not.toContain("owner-secret");
    expect(decision.diagnostic).toEqual({
      resolved_scope: "all",
      provider_id: "unclassified",
      provider_class: "unclassified",
      page_eligibility: "eligible",
      process_start_requested: true,
      resumable_state_eligible: false,
      decision_code: "provider_unclassified",
    });
  });
});

describe("process guardrail deployment configuration", () => {
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const composeFiles = [
    "installer/docker/compose.dev.yml",
    "installer/docker/compose.local.yml",
    "installer/docker/compose.prod.yml",
    "builds/typescript/docker-compose.yml",
  ];

  it.each(composeFiles)("%s passes the defaulted scope to the app process", async (relativePath) => {
    const content = await readFile(path.join(repositoryRoot, relativePath), "utf8");

    expect(content).toContain(
      "BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE: ${BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE:-all}"
    );
  });

  it("documents the value and non-destructive none rollback", async () => {
    const envExample = await readFile(
      path.join(repositoryRoot, "installer/docker/.env.example"),
      "utf8"
    );
    const dockerReadme = await readFile(
      path.join(repositoryRoot, "installer/docker/README.md"),
      "utf8"
    );

    expect(envExample).toContain("BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE=all");
    expect(dockerReadme).toContain("`none`, `local`, `cloud`, and `all`");
    expect(dockerReadme).toContain("non-destructive rollback");
  });
});
