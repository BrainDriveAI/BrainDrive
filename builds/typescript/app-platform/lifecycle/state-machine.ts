import type { z } from "zod";

import {
  assertLifecycleTransition,
  LifecycleRecordSchema,
  type LifecycleState,
} from "../contracts/lifecycle.js";

export type DurableLifecycleRecord = z.infer<typeof LifecycleRecordSchema>;

export type LifecycleClock = {
  now(): Date;
};

export const SYSTEM_LIFECYCLE_CLOCK: LifecycleClock = {
  now: () => new Date(),
};

const TRANSIENT_STATES = new Set<LifecycleState>([
  "staged",
  "updating",
  "rollback_pending",
  "uninstalling",
]);

export type LifecycleTransitionRequest = {
  operationId: string;
  to: LifecycleState;
  authority?: Partial<
    Pick<
      DurableLifecycleRecord,
      | "installation_id"
      | "active_package_digest"
      | "last_known_good_package_digest"
      | "grant_id"
      | "successful_use_checkpoint"
    >
  >;
};

/**
 * The only M2 authority for producing a new lifecycle generation.
 *
 * Operation semantics remain outside this class. It validates one accepted
 * edge, increments exactly one generation, and normalizes authority removal.
 */
export class LifecycleStateMachine {
  constructor(private readonly clock: LifecycleClock = SYSTEM_LIFECYCLE_CLOCK) {}

  transition(
    currentInput: DurableLifecycleRecord,
    request: LifecycleTransitionRequest,
  ): DurableLifecycleRecord {
    const current = LifecycleRecordSchema.parse(currentInput);
    assertLifecycleTransition(current.state, request.to);

    const authority = request.authority ?? {};
    const next = request.to === "not_installed"
      ? {
          ...current,
          installation_id: null,
          active_package_digest: null,
          last_known_good_package_digest: null,
          grant_id: null,
          successful_use_checkpoint: null,
        }
      : { ...current, ...authority };

    return LifecycleRecordSchema.parse({
      ...next,
      state: request.to,
      generation: current.generation + 1,
      pending_operation_id: TRANSIENT_STATES.has(request.to) ? request.operationId : null,
      updated_at: this.clock.now().toISOString(),
    });
  }
}
