import { describe, expect, it } from "vitest";

import { compareSpec05RuntimeParity, type Spec05RuntimeObservation } from "./parity-normalizer.js";

function observation(target: "docker" | "windows", overrides: Partial<Spec05RuntimeObservation["semantics"]> = {}): Spec05RuntimeObservation {
  return {
    scenarioId: "m7-neutral-and-resume",
    runtime: {
      target,
      transport: target === "docker" ? "container_internal" : "loopback",
      processIsolation: target === "docker" ? "process_group" : "windows_job_object",
      packageRootRef: target === "docker" ? "docker-package-root" : "desktop-package-root",
      cacheRootRef: target === "docker" ? "docker-cache-root" : "desktop-cache-root",
      diagnosticPlatform: target,
    },
    semantics: {
      protocol: "2026-07-28",
      appsExtension: "2026-01-26",
      resourceMime: "text/html;profile=mcp-app",
      orderedContentTypes: ["text", "resource_link", "resource"],
      appVisibleTools: ["fixture.status"],
      lifecycleStates: ["active", "disabled", "active", "not_installed"],
      reconnect: { stableView: true, stableOperation: true, generationRotated: true, staleRejected: true },
      concurrency: { crossViewDenied: true, cancelIsolated: true, activeViews: 2 },
      sideEffects: { writes: 1, exports: 1, inferenceDispatches: 1 },
      errors: ["bridge_denied", "session_closed"],
      ...overrides,
    },
  };
}

describe("M7 black-box parity normalization", () => {
  it("ignores only the five accepted runtime differences", () => {
    const evidence = compareSpec05RuntimeParity("m7-neutral-and-resume", observation("docker"), observation("windows"));
    expect(evidence).toMatchObject({
      docker_outcome: "pass",
      windows_outcome: "pass",
      normalized_semantics_equal: true,
      permitted_differences: ["transport", "process_isolation", "package_root_ref", "cache_root_ref", "diagnostic_platform"],
      unexpected_differences: [],
    });
  });

  it("reports semantic drift and unavailable selected-target evidence without manufacturing parity", () => {
    expect(compareSpec05RuntimeParity("m7-drift", observation("docker"), observation("windows", {
      sideEffects: { writes: 2, exports: 1, inferenceDispatches: 1 },
    }))).toMatchObject({ normalized_semantics_equal: false, unexpected_differences: ["semantics.sideEffects.writes"] });
    expect(compareSpec05RuntimeParity("m7-blocked", observation("docker"), null)).toMatchObject({
      docker_outcome: "pass",
      windows_outcome: "blocked",
      normalized_semantics_equal: false,
      unexpected_differences: ["windows_ground_truth_unavailable"],
    });
  });
});
