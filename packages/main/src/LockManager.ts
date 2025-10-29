import log from 'electron-log';

/**
 * Simple mutex-based lock manager for preventing concurrent file operations
 * on the same patch directories.
 */
export class LockManager {
  private locks: Map<string, Promise<void>> = new Map();
  private lockTimeouts: Map<string, NodeJS.Timeout> = new Map();
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
    log.info(`Attempting to acquire lock for: ${key}`);

    // Wait for any existing lock to be released
    while (this.locks.has(key)) {
      log.info(`Waiting for lock to be released: ${key}`);
      await this.locks.get(key);
    }

    // Create a new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    this.locks.set(key, lockPromise);

    // Set timeout to automatically release lock if forgotten
    const timeoutId = setTimeout(() => {
      log.warn(`Lock timeout exceeded for: ${key}, force releasing`);
      this.release(key);
    }, timeoutMs);

    this.lockTimeouts.set(key, timeoutId);

    log.info(`Lock acquired for: ${key}`);

    // Store the release function for later use
    (lockPromise as any).release = releaseLock!;
  }

  /**
   * Release a lock for the given resource key.
   *
   * @param key - Unique identifier for the resource
   */
  release(key: string): void {
    const lockPromise = this.locks.get(key);

    if (!lockPromise) {
      log.warn(`Attempted to release non-existent lock: ${key}`);
      return;
    }

    // Clear timeout
    const timeoutId = this.lockTimeouts.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.lockTimeouts.delete(key);
    }

    // Release the lock
    const releaseFn = (lockPromise as any).release;
    if (releaseFn) {
      releaseFn();
    }

    this.locks.delete(key);
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
    await this.acquire(key, timeoutMs);
    try {
      return await fn();
    } finally {
      this.release(key);
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
  }
}

// Export singleton instance
export const lockManager = new LockManager();
