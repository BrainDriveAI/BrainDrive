import { AppPlatformError } from "./errors.js";

export type DesktopVerifierFaultPoint = "network" | "disk" | "restart" | "verification" | "activation";

export type LifecycleFaultInjector = {
  beforeStage: (input: { kind: string; stage: string; operationId: string }) => Promise<void> | void;
};

const stageForPoint: Record<DesktopVerifierFaultPoint, string> = {
  network: "verifying_source",
  disk: "granting",
  restart: "starting",
  verification: "verifying_package",
  activation: "switching_active_pointer",
};

/**
 * Creates a one-shot fault injector only when the native verifier explicitly
 * opts in. The injector can create a failure, but it has no recovery API and
 * never mutates lifecycle state itself.
 */
export function createDesktopVerifierFaultInjector(env: NodeJS.ProcessEnv = process.env): LifecycleFaultInjector | undefined {
  if (env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_INJECTION !== "1") return undefined;
  const point = env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT as DesktopVerifierFaultPoint | undefined;
  const action = env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_ACTION?.trim() || "install";
  if (!point || !(point in stageForPoint)) throw new Error("BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT must be network, disk, restart, verification, or activation");
  const targetStage = stageForPoint[point];
  let consumed = false;
  return {
    beforeStage(input) {
      if (consumed || input.kind !== action || input.stage !== targetStage) return;
      consumed = true;
      throw new AppPlatformError("recoverable_internal_failure", `Desktop verifier injected ${point} failure at ${targetStage}`);
    },
  };
}
