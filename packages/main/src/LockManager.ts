import log from 'electron-log';

/**
 * Simple mutex-based lock manager for preventing concurrent file operations
 * on the same patch directories.
 */
export class LockManager {
  private locks: Map<string, Promise<void>> = new Map();
  private lockTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private owners: Map<string, symbol> = new Map();
  /** Resolves the promise that waiters of each lock are blocked on. */
  private releasers: Map<string, () => void> = new Map();
  private readonly DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

  /**
   * Acquire a lock for the given resource key.
   * If the resource is already locked, waits until it's available.
   *
   * @param key - Unique identifier for the resource (e.g., patch directory path)
   * @param timeoutMs - Maximum time to wait for lock (default: 30s)
   * @returns Promise that resolves when lock is acquired
   */
  async acquire(key: string, timeoutMs: number = this.DEFAULT_TIMEOUT_MS): Promise<void> {
    await this.acquireOwned(key, timeoutMs);
  }

  /**
   * Same as acquire() but returns an owner token. Passing it to release() makes the
   * release a no-op if the lock has since timed out and been taken over by someone else.
   */
  private async acquireOwned(key: string, timeoutMs: number): Promise<symbol> {
    log.info(`Attempting to acquire lock for: ${key}`);

    // Wait for any existing lock to be released
    while (this.locks.has(key)) {
      log.info(`Waiting for lock to be released: ${key}`);
      await this.locks.get(key);
    }

    // Create a new lock
    let releaseLock: () => void = () => undefined;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    const owner = Symbol(key);
    this.locks.set(key, lockPromise);
    this.owners.set(key, owner);

    // Set timeout to automatically release lock if forgotten
    const timeoutId = setTimeout(() => {
      log.warn(`Lock timeout exceeded for: ${key}, force releasing`);
      this.release(key, owner);
    }, timeoutMs);

    this.lockTimeouts.set(key, timeoutId);

    log.info(`Lock acquired for: ${key}`);

    // Store the release function for later use
    this.releasers.set(key, releaseLock);

    return owner;
  }

  /**
   * Release a lock for the given resource key.
   *
   * @param key - Unique identifier for the resource
   * @param owner - Optional owner token; if given and the lock now belongs to someone
   *   else (e.g. it timed out and was re-acquired), nothing is released
   */
  release(key: string, owner?: symbol): void {
    const lockPromise = this.locks.get(key);

    if (!lockPromise) {
      log.warn(`Attempted to release non-existent lock: ${key}`);
      return;
    }

    if (owner !== undefined && this.owners.get(key) !== owner) {
      log.warn(`Ignoring stale release for: ${key} (lock now held by another owner)`);
      return;
    }

    // Clear timeout
    const timeoutId = this.lockTimeouts.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.lockTimeouts.delete(key);
    }

    // Release the lock
    this.releasers.get(key)?.();
    this.releasers.delete(key);

    this.locks.delete(key);
    this.owners.delete(key);
    log.info(`Lock released for: ${key}`);
  }

  /**
   * Execute a function with automatic lock acquisition and release.
   *
   * @param key - Unique identifier for the resource
   * @param fn - Async function to execute while holding the lock
   * @param timeoutMs - Maximum time to wait for lock (default: 30s)
   * @returns Result of the function
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs: number = this.DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const owner = await this.acquireOwned(key, timeoutMs);
    try {
      return await fn();
    } finally {
      this.release(key, owner);
    }
  }

  /**
   * Check if a resource is currently locked.
   *
   * @param key - Unique identifier for the resource
   * @returns true if locked, false otherwise
   */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /**
   * Get all currently locked resources.
   *
   * @returns Array of locked resource keys
   */
  getLockedResources(): string[] {
    return Array.from(this.locks.keys());
  }

  /**
   * Clear all locks (use with caution).
   */
  clearAll(): void {
    log.warn('Clearing all locks');

    // Clear all timeouts
    for (const timeoutId of this.lockTimeouts.values()) {
      clearTimeout(timeoutId);
    }

    // Release all locks
    for (const key of this.locks.keys()) {
      this.release(key);
    }

    this.locks.clear();
    this.lockTimeouts.clear();
    this.owners.clear();
  }
}

// Export singleton instance
export const lockManager = new LockManager();
