import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Brief Builder primary resource", () => {
  it("is one sandbox-safe, direct-entry, accessible screen", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("<title>Brief Builder</title>");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('for="source"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="tab-source"');
    expect(html).toContain('id="tab-brief"');
    expect(html).toContain('id="tab-search"');
    expect(html).toContain("Internet Search");
    expect(html).toContain('request("capability.discover"');
    expect(html).toContain('send("web.search@1"');
    expect(html).toContain('send("web.read@1"');
    expect(html).toContain('busy=true;readEnvelope=null;selectedReadIndex=null;searchEnvelope=null;internetRunId=id();setStatus("Calling web.search@1.");render()');
    expect(html).toContain('catch{searchEnvelope=null;setStatus("Search call failed safely.","error")}finally{busy=false;render()}');
    expect(html).toContain('busy=true;selectedReadIndex=index;readEnvelope=null;setStatus("Calling web.read@1.");render()');
    expect(html).toContain('catch{readEnvelope=null;setStatus("Read call failed safely.","error")}finally{busy=false;render()}');
    expect(html).toContain("External untrusted source material");
    expect(html).toContain("external-untrusted");
    expect(html).toContain('supported_capabilities:["brief.records.read","brief.records.write","brief.approvals.confirm","app.inference.request","web.search@1","web.read@1"]');
    expect(html).toContain('class="brief-document"');
    expect(html).toContain("Key points");
    expect(html).toContain("View supporting sources");
    expect(html).toContain("Show source for statement");
    expect(html).toContain("Review and approve");
    expect(html).toContain("Reject draft");
    expect(html).toContain("The draft was rejected. Your prior approved revision is unchanged.");
    expect(html).toContain("Your selected BrainDrive model is not yet compatible with Brief Builder. Choose a compatible model in BrainDrive Settings.");
    expect(html).toContain('const errorCode=message?.error?.code');
    expect(html).toContain('new Error(validErrorCode?errorCode:"safe_failure")');
    expect(html).not.toContain("message?.error?.error");
    expect(html).toContain('rpcRequest("ui/initialize"');
    expect(html).toContain('rpcNotify("ui/notifications/initialized"');
    expect(html).toContain("crypto.getRandomValues");
    expect(html).not.toContain("crypto.randomUUID");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/searxng|localhost|127\.|0\.0\.0\.0|\bport\b|provider_url|endpoint_url/i);
    expect(html).not.toContain("Career");
    expect(html).not.toContain("resume");
  });

  it("declares only the accepted package identity and surface", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson).toMatchObject({
      name: "@braindrive/brief-builder",
      version: "1.2.1",
      braindrive: {
        appId: "ai.braindrive.brief-builder",
        routeKey: "brief-builder",
        primaryResource: "ui://brief-builder/main",
        inferencePurpose: "brief.generate@1",
        capabilityDependencies: [
          {
            operationId: "web.search@1",
            requirement: "optional",
            unavailableBehavior: "degrade_with_safe_status",
            providerSelection: "owner_or_admin_policy",
            silentInstallOrSwitch: false,
          },
          {
            operationId: "web.read@1",
            requirement: "optional",
            unavailableBehavior: "degrade_with_safe_status",
            providerSelection: "owner_or_admin_policy",
            silentInstallOrSwitch: false,
          },
        ],
      },
    });
  });
});
