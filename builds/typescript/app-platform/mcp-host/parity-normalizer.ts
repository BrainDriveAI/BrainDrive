import { canonicalJson } from "../contracts/common.js";
import { Spec05ParityEvidenceSchema } from "../contracts/spec-05-foundation.js";

export type Spec05RuntimeObservation = {
  scenarioId: string;
  runtime: {
    target: "docker" | "windows";
    transport: string;
    processIsolation: string;
    packageRootRef: string;
    cacheRootRef: string;
    diagnosticPlatform: string;
  };
  semantics: {
    protocol: string;
    appsExtension: string;
    resourceMime: string;
    orderedContentTypes: string[];
    appVisibleTools: string[];
    lifecycleStates: string[];
    reconnect: { stableView: boolean; stableOperation: boolean; generationRotated: boolean; staleRejected: boolean };
    concurrency: { crossViewDenied: boolean; cancelIsolated: boolean; activeViews: number };
    sideEffects: { writes: number; exports: number; inferenceDispatches: number };
    errors: string[];
  };
};

export function normalizeSpec05Observation(observation: Spec05RuntimeObservation): Spec05RuntimeObservation["semantics"] {
  return {
    ...observation.semantics,
    orderedContentTypes: [...observation.semantics.orderedContentTypes],
    appVisibleTools: [...observation.semantics.appVisibleTools].sort(),
    lifecycleStates: [...observation.semantics.lifecycleStates],
    errors: [...observation.semantics.errors].sort(),
  };
}

export function compareSpec05RuntimeParity(
  scenarioId: string,
  docker: Spec05RuntimeObservation | null,
  windows: Spec05RuntimeObservation | null,
) {
  const permittedDifferences = differingRuntimeFields(docker, windows);
  const unexpectedDifferences = docker && windows
    ? semanticDifferences(normalizeSpec05Observation(docker), normalizeSpec05Observation(windows))
    : [docker ? "windows_ground_truth_unavailable" : windows ? "docker_ground_truth_unavailable" : "both_ground_truth_targets_unavailable"];
  return Spec05ParityEvidenceSchema.parse({
    evidence_version: 1,
    scenario_id: scenarioId,
    docker_outcome: docker ? "pass" : "blocked",
    windows_outcome: windows ? "pass" : "blocked",
    normalized_semantics_equal: unexpectedDifferences.length === 0,
    permitted_differences: permittedDifferences,
    unexpected_differences: unexpectedDifferences,
  });
}

function differingRuntimeFields(
  docker: Spec05RuntimeObservation | null,
  windows: Spec05RuntimeObservation | null,
): Array<"transport" | "process_isolation" | "package_root_ref" | "cache_root_ref" | "diagnostic_platform"> {
  if (!docker || !windows) return [];
  const fields = [
    ["transport", docker.runtime.transport, windows.runtime.transport],
    ["process_isolation", docker.runtime.processIsolation, windows.runtime.processIsolation],
    ["package_root_ref", docker.runtime.packageRootRef, windows.runtime.packageRootRef],
    ["cache_root_ref", docker.runtime.cacheRootRef, windows.runtime.cacheRootRef],
    ["diagnostic_platform", docker.runtime.diagnosticPlatform, windows.runtime.diagnosticPlatform],
  ] as const;
  return fields.filter(([, left, right]) => left !== right).map(([name]) => name);
}

function semanticDifferences(left: unknown, right: unknown, path = "semantics"): string[] {
  if (Object.is(left, right)) return [];
  if (left === undefined || right === undefined) return [path];
  if (canonicalJson(left) === canonicalJson(right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const differences: string[] = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) differences.push(...semanticDifferences(left[index], right[index], `${path}[${index}]`));
    return differences;
  }
  if (isRecord(left) && isRecord(right)) {
    const differences: string[] = [];
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) differences.push(...semanticDifferences(left[key], right[key], `${path}.${key}`));
    return differences;
  }
  return [path];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
