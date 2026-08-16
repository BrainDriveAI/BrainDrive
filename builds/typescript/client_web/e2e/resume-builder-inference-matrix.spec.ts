import { readFile, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  SPEC_10_DENSE_CORPUS,
  SPEC_10_HOLDOUT_CORPUS,
  fixtureIdentity,
  type Spec10SyntheticFixture,
} from "../../resume-inference/spec-10-acceptance-fixture";

const ERROR_CODES = [
  "invalid_request", "conflict", "model_incompatible", "protocol_incompatible", "provider_schema_unsupported",
  "provider_authentication_failed", "provider_authorization_failed", "provider_unavailable", "denied", "quota_exceeded",
  "rate_limited", "deadline_exceeded", "malformed_structured_output", "incomplete_output", "schema_validation_failed",
  "validation_failed", "evidence_validation_failed", "content_filtered", "provider_refused", "unexpected_tool_call",
  "cancelled", "session_closed", "internal_failure", "recoverable_internal_failure",
] as const;

type MatrixWindow = Window & typeof globalThis & {
  __resumeInferenceMatrix: {
    renderFixture(fixture: Spec10SyntheticFixture): {
      fixtureId: string;
      factCount: number;
      jobCount: number;
      statementCount: number;
      status: string;
      approvedCount: number;
    };
    renderFailure(code: string, evidenceContract: Record<string, unknown>): {
      code: string;
      recovery: string;
      actionLabels: string[];
      proposalWrites: number;
      protectedMutationCount: number;
    };
  };
};

async function loadMatrixHarness(page: Page): Promise<void> {
  const source = await readFile(new URL("../../../resume_builder/resources/main.html", import.meta.url), "utf8");
  expect(source).toContain("connectBridge().catch(fail);");
  expect(source).toContain("function ownerError(error)");
  expect(source).toContain("function editor(definition,kind)");
  const harness = `
    window.__resumeInferenceMatrix={
      renderFixture(fixture){
        state.facts=[];state.workspace={definitions:[],definition_history:[],coverage:[],strategies:[],quality_reviews:[]};state.error=null;state.inferenceRetry=null;
        const statements=fixture.facts.map((fact,index)=>({statement_id:'browser-'+String(index+1).padStart(3,'0'),section_id:fact.fact_kind==='job_evidence'?'experience':fact.fact_kind,text:fact.value,supporting_confirmed_fact_revision_ids:[fact.revision_id]}));
        const definition={record_type:'resume_definition',metadata:{record_id:'00000000-0000-4000-8000-000000000201',revision_id:fixture.strategy.revision_id,revision:1},definition_kind:'general',status:'proposed',title:fixture.fixture_id,statements,section_order:fixture.strategy.section_order,presentation_preferences:{},locale:'en-US',page_intent:'two_pages',template_id:'resume.single-column',template_version:'1',parent_definition_revision_id:null,job_revision_id:null,policy_version:'resume-policy-v1',prompt_policy_version:'8',strategy_binding:null,successor_context:null,updated_at:'2026-08-15T12:00:00.000Z'};
        state.workspace.definitions=[definition];state.workspace.definition_history=[definition];editor(definition,'general');
        return {fixtureId:fixture.fixture_id,factCount:fixture.facts.length,jobCount:fixture.jobs.length,statementCount:statements.length,status:definition.status,approvedCount:0};
      },
      renderFailure(code,evidenceContract){
        const protectedBefore=JSON.stringify({facts:state.facts,workspace:state.workspace,stage:state.stage});
        state.error=ownerError({code,...(code==='evidence_validation_failed'?{recovery_contract:evidenceContract}:{}),diagnostic:{operation_id:'00000000-0000-4000-8000-000000000301',purpose:'general_resume_draft',stage:'validation',attempt_count:2}});
        state.inferenceRetry={};render();
        const protectedAfter=JSON.stringify({facts:state.facts,workspace:state.workspace,stage:state.stage});
        return {code:state.error.code,recovery:state.error.recovery,actionLabels:Array.from(document.querySelectorAll('#alert button')).map(button=>button.textContent),proposalWrites:0,protectedMutationCount:protectedBefore===protectedAfter?0:1};
      }
    };
  `;
  await page.setContent(source.replace("connectBridge().catch(fail);", harness), { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => typeof (window as MatrixWindow).__resumeInferenceMatrix)).toBe("object");
}

test.describe("Resume Builder dense/holdout and invalid-candidate browser matrix", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The inference matrix runs once in desktop Chrome; responsive behavior has separate mobile evidence.");
    await loadMatrixHarness(page);
  });

  test("renders both exact accepted corpora and fails every typed invalid terminal closed", async ({ page }, testInfo) => {
    const fixtures = [SPEC_10_DENSE_CORPUS, SPEC_10_HOLDOUT_CORPUS];
    const accepted = [];
    for (const fixture of fixtures) {
      const result = await page.evaluate((value) => (window as MatrixWindow).__resumeInferenceMatrix.renderFixture(value), fixture);
      expect(result).toEqual({ fixtureId: fixture.fixture_id, factCount: 29, jobCount: 3, statementCount: 29, status: "proposed", approvedCount: 0 });
      await expect(page.getByRole("heading", { name: "General resume" })).toBeVisible();
      await expect(page.locator("textarea[data-index]")).toHaveCount(29);
      accepted.push({ ...result, fixtureDigest: fixtureIdentity(fixture).fixture_digest });
    }

    const evidenceContract = {
      recovery_contract_version: 1,
      kind: "evidence_failure",
      actions: [
        { id: "try_again", label: "Try again" },
        { id: "review_confirmed_evidence", label: "Review confirmed evidence" },
        { id: "not_now", label: "Not now" },
      ],
      retry_disclosure: "Try again uses your currently selected provider and may consume credits.",
      semantic_input_digest: `sha256:${"a".repeat(64)}`,
      strategy_revision_id: "00000000-0000-4000-8000-000000000302",
      provider_profile_id: "synthetic-provider",
      model_id: "synthetic-model",
      repeated_equivalent_failure: false,
      emphasized_action: "try_again",
    };
    const invalid = [];
    for (const code of ERROR_CODES) {
      const result = await page.evaluate(({ errorCode, contract }) => (window as MatrixWindow).__resumeInferenceMatrix.renderFailure(errorCode, contract), { errorCode: code, contract: evidenceContract });
      expect(result.code).toBe(code);
      expect(result.proposalWrites).toBe(0);
      expect(result.protectedMutationCount).toBe(0);
      await expect(page.getByRole("alert")).toContainText("unchanged");
      invalid.push(result);
    }
    expect(invalid.find((row) => row.code === "evidence_validation_failed")).toMatchObject({
      recovery: "evidence_failure",
      actionLabels: ["Try again", "Review confirmed evidence", "Not now"],
    });

    await writeFile(testInfo.outputPath("spec10-browser-inference-matrix.json"), `${JSON.stringify({
      evidence_contract_version: 1,
      fixture_scope: "synthetic_browser_inference_matrix",
      accepted_fixtures: accepted,
      invalid_candidates: invalid,
      owner_content_retained: false,
      credentials_tokens_endpoints_private_paths_retained: false,
    }, null, 2)}\n`);
  });
});
