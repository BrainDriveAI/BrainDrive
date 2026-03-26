import { describe, expect, it } from "vitest";

import { evaluateSignupBootstrapAccess, isLoopbackIp, SIGNUP_BOOTSTRAP_TOKEN_HEADER } from "./signup-bootstrap.js";

describe("signup bootstrap gate", () => {
  it("allows local signup from loopback when no bootstrap token is configured", () => {
    expect(evaluateSignupBootstrapAccess({ ip: "127.0.0.1" })).toMatchObject({ allowed: true, reason: "loopback" });
    expect(evaluateSignupBootstrapAccess({ ip: "::1" })).toMatchObject({ allowed: true, reason: "loopback" });
    expect(evaluateSignupBootstrapAccess({ ip: "::ffff:127.0.0.1" })).toMatchObject({
      allowed: true,
      reason: "loopback",
    });
  });

  it("rejects non-loopback signup when no bootstrap token is configured", () => {
    expect(evaluateSignupBootstrapAccess({ ip: "10.0.0.5" })).toMatchObject({
      allowed: false,
      reason: "signup_local_only",
    });
  });

  it("requires a matching bootstrap token when configured", () => {
    expect(
      evaluateSignupBootstrapAccess(
        {
          ip: "127.0.0.1",
          headers: {
            [SIGNUP_BOOTSTRAP_TOKEN_HEADER]: "expected-token",
          },
        },
        "expected-token"
      )
    ).toMatchObject({
      allowed: true,
      reason: "bootstrap_token",
    });

    expect(
      evaluateSignupBootstrapAccess(
        {
          ip: "127.0.0.1",
          headers: {
            [SIGNUP_BOOTSTRAP_TOKEN_HEADER]: "wrong-token",
          },
        },
        "expected-token"
      )
    ).toMatchObject({
      allowed: false,
      reason: "signup_bootstrap_token_required",
    });
  });

  it("reads token header case-insensitively and from array values", () => {
    expect(
      evaluateSignupBootstrapAccess(
        {
          ip: "203.0.113.8",
          headers: {
            "X-PAA-Bootstrap-Token": ["expected-token"],
          },
        },
        "expected-token"
      )
    ).toMatchObject({
      allowed: true,
      reason: "bootstrap_token",
    });
  });
});

describe("isLoopbackIp", () => {
  it("detects canonical loopback values", () => {
    expect(isLoopbackIp("127.0.0.1")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackIp("localhost")).toBe(true);
  });

  it("rejects non-loopback values", () => {
    expect(isLoopbackIp("10.1.2.3")).toBe(false);
    expect(isLoopbackIp("203.0.113.10")).toBe(false);
  });
});
