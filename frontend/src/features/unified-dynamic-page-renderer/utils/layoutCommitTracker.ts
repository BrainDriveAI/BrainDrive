/**
 * LayoutCommitTracker - Dev-only utility for tracking layout commits
 * Part of Phase 1: Instrumentation & Verification
 */

export interface CommitMetadata {
  version: number;
  hash: string;
  timestamp: number;
}

export interface PendingCommit {
  version: number;
  hash: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

class LayoutCommitTracker {
  private static instance: LayoutCommitTracker | null = null;
  private lastCommit: CommitMetadata | null = null;
  private pendingCommits: Map<string, PendingCommit> = new Map();
  private isDebugMode: boolean;

  private constructor() {
    this.isDebugMode = import.meta.env.VITE_LAYOUT_DEBUG === 'true';
  }

  static getInstance(): LayoutCommitTracker {
    if (!LayoutCommitTracker.instance) {
      LayoutCommitTracker.instance = new LayoutCommitTracker();
    }
    return LayoutCommitTracker.instance;
  }

  /**
   * Record a new commit
   */
  recordCommit(metadata: CommitMetadata): void {
    if (!this.isDebugMode) return;

    this.lastCommit = metadata;
    
    // Resolve any pending flush promises for this hash or older versions
    // In practice the debounced pipeline may change the final hash; consider
    // the commit authoritative and resolve all <= version entries.
    const toResolve: string[] = [];
    for (const [hash, pending] of this.pendingCommits.entries()) {
      if (pending.version <= metadata.version || hash === metadata.hash) {
        pending.resolve();
        toResolve.push(hash);
      }
    }
    toResolve.forEach(hash => this.pendingCommits.delete(hash));

    this.log(`Commit recorded: v${metadata.version} hash:${metadata.hash}`);
  }

  /**
   * Start tracking a pending commit
   */
  trackPending(version: number, hash: string): Promise<void> {
    if (!this.isDebugMode) {
      return Promise.resolve();
    }

    // If already committed, resolve immediately
    if (this.lastCommit?.hash === hash) {
      return Promise.resolve();
    }

    // Check if already tracking this hash
    const existing = this.pendingCommits.get(hash);
    if (existing) {
      return existing.promise;
    }

    // Create new pending promise
    let resolve: () => void;
    let reject: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const pending: PendingCommit = {
      version,
      hash,
      promise,
      resolve: resolve!,
      reject: reject!
    };

    this.pendingCommits.set(hash, pending);

    // Add timeout to prevent hanging
    setTimeout(() => {
      if (this.pendingCommits.has(hash)) {
        this.log(`Pending commit timeout: v${version} hash:${hash}`, 'warn');
        pending.resolve(); // Resolve anyway to prevent deadlock
        this.pendingCommits.delete(hash);
      }
    }, 5000); // 5 second timeout

    this.log(`Tracking pending: v${version} hash:${hash}`);
    return promise;
  }

  /**
   * Get the last committed metadata
   */
  getLastCommit(): CommitMetadata | null {
    return this.lastCommit;
  }

  /**
   * Get all pending commits
   */
  getPendingCommits(): CommitMetadata[] {
    return Array.from(this.pendingCommits.values()).map(p => ({
      version: p.version,
      hash: p.hash,
      timestamp: Date.now() // Approximate
    }));
  }

  /**
   * Check if there are pending commits
   */
  hasPendingCommits(): boolean {
    return this.pendingCommits.size > 0;
  }

  /**
   * Flush all pending commits (wait for them to complete or timeout)
   */
  async flush(): Promise<void> {
    if (!this.isDebugMode) return;

    const promises = Array.from(this.pendingCommits.values()).map(p => p.promise);
    if (promises.length > 0) {
      this.log(`Flushing ${promises.length} pending commits`);
      await Promise.all(promises);
    }
  }

  /**
   * Clear all tracking (for cleanup/reset)
   */
  clear(): void {
    this.lastCommit = null;
    this.pendingCommits.clear();
  }

  private log(message: string, level: 'log' | 'warn' | 'error' = 'log'): void {
    if (!this.isDebugMode) return;
    console[level](`[LayoutCommitTracker] ${message}`);
  }
}

// Export singleton instance getter
export const getLayoutCommitTracker = (): LayoutCommitTracker => {
  return LayoutCommitTracker.getInstance();
};

// Export helper to generate hash from layout data
export const generateLayoutHash = (data: any): string => {
  // Simple hash function for dev purposes
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
};
