import { describe, expect, it } from "vitest";

import type { AuthActor } from "../contracts.js";
import { AUTH_OPERATIONS, evaluateAuthorization, ownerActor, validatePaaAuthContext } from "./policy.js";

const owner: AuthActor = {
  id: "owner",
  type: "owner",
  status: "active",
  created: "2026-11-04T00:00:00.000Z",
};

const request = (overrides: Partial<Parameters<typeof evaluateAuthorization>[0]> = {}) => ({
  actor: owner,
  resource: "conversation",
  action: "read",
  correlation_id: "corr-1",
  ...overrides,
});

describe("PAA v1 resource/action authorization", () => {
  it("keeps the initial route/action inventory explicit", () => {
    expect([...AUTH_OPERATIONS.conversation]).toEqual(["read", "write"]);
    expect([...AUTH_OPERATIONS.tool]).toEqual(["execute"]);
    expect([...AUTH_OPERATIONS.auth]).toEqual(["whoami", "check", "export"]);
  });

  it("allows an active owner for a known operation", () => {
    expect(evaluateAuthorization(request())).toEqual({ allowed: true, reason: "allowed" });
  });

  it.each([
    ["unknown actor", { actor: { ...owner, id: "" } }, "unknown_actor"],
    ["inactive actor", { actor: { ...owner, status: "revoked" } }, "inactive_actor"],
    ["unknown resource", { resource: "settings" }, "unknown_resource"],
    ["unknown action", { action: "delete" }, "unknown_action"],
    ["non-owner actor", { actor: { ...owner, id: "agent-1", type: "agent" } }, "policy_denied"],
  ] as const)("denies %s", (_label, overrides, reason) => {
    expect(evaluateAuthorization(request(overrides))).toEqual({ allowed: false, reason });
  });

  it("derives a PAA actor without exposing permissions", () => {
    expect(ownerActor({ actor_id: "owner", actor_type: "owner", created_at: "created" })).toEqual({
      id: "owner",
      type: "owner",
      status: "active",
      created: "created",
    });
  });

  it("rejects caller-supplied permission fields and expired contexts", () => {
    const context = {
      actor: owner,
      authentication_id: "auth-1",
      authenticated_at: "2026-11-04T00:00:00.000Z",
      expires_at: "2026-11-04T00:01:00.000Z",
      correlation_id: "corr-1",
    };
    expect(() => validatePaaAuthContext(context, new Date("2026-11-04T00:00:30.000Z"))).not.toThrow();
    expect(() => validatePaaAuthContext({ ...context, permissions: {} } as never)).toThrow(
      "Invalid auth context fields",
    );
    expect(() => validatePaaAuthContext(context, new Date("2026-11-04T00:02:00.000Z"))).toThrow(
      "Expired auth context",
    );
  });
});
