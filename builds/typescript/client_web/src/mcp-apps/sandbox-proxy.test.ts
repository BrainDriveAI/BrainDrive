import type { AppLaunch } from "@/api/apps-adapter";

import {
  OUTER_PROXY_SANDBOX,
  VIEW_PERMISSION_POLICY,
  VIEW_SANDBOX,
  buildViewCsp,
  createSafeHostContext,
  createSandboxProxyUrl,
  createSandboxResourceNotification,
} from "./sandbox-proxy";

const launch: AppLaunch = {
  launch_version: 1,
  session_id: "00000000-0000-4000-8000-000000000001",
  installation_id: "00000000-0000-4000-8000-000000000002",
  view_id: "00000000-0000-4000-8000-000000000003",
  operation_id: "00000000-0000-4000-8000-000000000004",
  bridge_generation: 1,
  resumed: false,
  bridge_token_id: "00000000-0000-4000-8000-000000000005",
  server_id: "00000000-0000-4000-8000-000000000006",
  expires_at: "2030-01-01T00:00:00.000Z",
  protocol: {
    core: "2026-07-28",
    apps_extension: "2026-01-26",
    server_name: "fixture",
    server_version: "3.0.0",
  },
  resource: {
    uri: "ui://resume-builder/main",
    mime_type: "text/html;profile=mcp-app",
    content_digest: `sha256:${"a".repeat(64)}`,
    size_bytes: 45,
    html: "<!doctype html><html><body>Fixture</body></html>",
  },
  allowed_tools: ["fixture.status"],
  allowed_capabilities: ["career.context.read"],
  entry_point: "career",
};

describe("MCP Apps sandbox proxy", () => {
  it("uses the accepted distinct-origin outer proxy and opaque inner view policy", () => {
    expect(OUTER_PROXY_SANDBOX).toBe("allow-scripts allow-same-origin");
    expect(VIEW_SANDBOX).toBe("allow-scripts");
    expect(VIEW_PERMISSION_POLICY).toContain("camera 'none'");
    expect(VIEW_PERMISSION_POLICY).toContain("clipboard-write 'none'");

    const url = createSandboxProxyUrl("proxy-nonce-for-test");
    expect(url).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(decodeURIComponent(url.split(",", 2)[1]!)).toContain("ui/notifications/sandbox-proxy-ready");
    expect(url).not.toContain(launch.session_id);
    expect(url).not.toContain(launch.bridge_token_id);
    expect(url).not.toContain(launch.resource.html);
  });

  it("renders a bounded generic title without allowing a manifest string to escape the proxy script", () => {
    const url = createSandboxProxyUrl("proxy-nonce-for-test", '</script><script>globalThis.forged=true</script>');
    const html = decodeURIComponent(url.split(",", 2)[1]!);
    expect(html).not.toContain("</script><script>globalThis.forged");
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
  });

  it("constructs a restrictive CSP with no ambient network, form, object, or frame authority", () => {
    const policy = buildViewCsp({
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    });
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("sends only verified HTML and restrictive policy to the proxy, never host authority", () => {
    const notification = createSandboxResourceNotification(launch.resource);
    expect(notification).toMatchObject({
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-resource-ready",
      params: {
        html: launch.resource.html,
        sandbox: VIEW_SANDBOX,
        permissions: {},
      },
    });
    const serialized = JSON.stringify(notification);
    expect(serialized).not.toContain(launch.session_id);
    expect(serialized).not.toContain(launch.installation_id);
    expect(serialized).not.toContain(launch.bridge_token_id);
    expect(serialized).not.toContain("desktop-token");
    expect(serialized).not.toMatch(/\/(?:home|Users|tmp|var)\//);
  });

  it("creates a minimal host context without runtime credentials or raw paths", () => {
    const context = createSafeHostContext(launch.entry_point, {
      width: 900,
      height: 640,
      platform: "desktop",
    });
    expect(context).toMatchObject({
      theme: "dark",
      displayMode: "inline",
      entryPoint: "career",
      containerDimensions: { width: 900, height: 640 },
      platform: "desktop",
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(launch.session_id);
    expect(serialized).not.toContain(launch.bridge_token_id);
    expect(serialized).not.toMatch(/token|credential|path/i);
  });
});
