import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface CounterState {
  value: number;
  updated_at: string;
  idempotency: Record<string, { previous: number; current: number; updated_at: string }>;
}

const EMPTY_STATE: CounterState = {
  value: 0,
  updated_at: new Date(0).toISOString(),
  idempotency: {},
};

export interface CounterSnapshot {
  [key: string]: unknown;
  value: number;
  updated_at: string;
}

export interface CounterIncrementResult {
  [key: string]: unknown;
  previous: number;
  current: number;
  by: number;
  idempotency_applied: boolean;
  updated_at: string;
}

export interface CounterResetResult {
  [key: string]: unknown;
  previous: number;
  current: 0;
  updated_at: string;
}

export class CounterStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly stateFile: string) {}

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async readState(): Promise<CounterState> {
    try {
      const raw = await readFile(this.stateFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<CounterState>;
      return {
        value: Number.isFinite(parsed.value) ? Number(parsed.value) : 0,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
        idempotency:
          parsed.idempotency && typeof parsed.idempotency === "object" ? parsed.idempotency : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...EMPTY_STATE, updated_at: new Date().toISOString() };
      }
      throw error;
    }
  }

  private async writeState(state: CounterState): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async get(): Promise<CounterSnapshot> {
    return this.withLock(async () => {
      const state = await this.readState();
      if (state.updated_at === EMPTY_STATE.updated_at) {
        state.updated_at = new Date().toISOString();
        await this.writeState(state);
      }
      return {
        value: state.value,
        updated_at: state.updated_at,
      };
    });
  }

  async increment(by: number, idempotencyKey?: string): Promise<CounterIncrementResult> {
    return this.withLock(async () => {
      const state = await this.readState();
      const now = new Date().toISOString();

      if (idempotencyKey && state.idempotency[idempotencyKey]) {
        const existing = state.idempotency[idempotencyKey];
        return {
          previous: existing.previous,
          current: existing.current,
          by,
          idempotency_applied: true,
          updated_at: existing.updated_at,
        };
      }

      const previous = state.value;
      const current = previous + by;
      state.value = current;
      state.updated_at = now;

      if (idempotencyKey) {
        state.idempotency[idempotencyKey] = {
          previous,
          current,
          updated_at: now,
        };
      }

      await this.writeState(state);
      return {
        previous,
        current,
        by,
        idempotency_applied: false,
        updated_at: now,
      };
    });
  }

  async reset(): Promise<CounterResetResult> {
    return this.withLock(async () => {
      const state = await this.readState();
      const previous = state.value;
      const now = new Date().toISOString();
      state.value = 0;
      state.updated_at = now;
      await this.writeState(state);
      return {
        previous,
        current: 0,
        updated_at: now,
      };
    });
  }
}
