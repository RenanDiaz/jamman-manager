/**
 * LockManager tests — real class, real timers semantics (fake timers where time matters).
 * Only the logger is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import log from 'electron-log';
import { LockManager } from './LockManager.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Lets queued promise callbacks run. */
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('LockManager', () => {
  let locks: LockManager;

  beforeEach(() => {
    locks = new LockManager();
    vi.mocked(log.warn).mockClear();
  });

  afterEach(() => {
    locks.clearAll();
    vi.useRealTimers();
  });

  describe('acquire / release', () => {
    it('acquires a free lock immediately', async () => {
      expect(locks.isLocked('a')).toBe(false);
      await locks.acquire('a');
      expect(locks.isLocked('a')).toBe(true);
      expect(locks.getLockedResources()).toEqual(['a']);
    });

    it('releases a held lock', async () => {
      await locks.acquire('a');
      locks.release('a');
      expect(locks.isLocked('a')).toBe(false);
      expect(locks.getLockedResources()).toEqual([]);
    });

    it('can be re-acquired after release', async () => {
      await locks.acquire('a');
      locks.release('a');
      await locks.acquire('a');
      expect(locks.isLocked('a')).toBe(true);
    });

    it('releasing a lock that is not held only warns', () => {
      expect(() => locks.release('ghost')).not.toThrow();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('non-existent lock: ghost'));
    });

    it('locks different keys independently', async () => {
      await locks.acquire('a');
      await locks.acquire('b'); // would hang if keys shared a lock
      expect(locks.getLockedResources().sort()).toEqual(['a', 'b']);
      locks.release('a');
      expect(locks.isLocked('a')).toBe(false);
      expect(locks.isLocked('b')).toBe(true);
    });
  });

  describe('contention', () => {
    it('makes a second acquire wait until the first is released', async () => {
      await locks.acquire('a');
      let secondAcquired = false;
      const second = locks.acquire('a').then(() => {
        secondAcquired = true;
      });

      await tick();
      expect(secondAcquired).toBe(false);

      locks.release('a');
      await second;
      expect(secondAcquired).toBe(true);
      expect(locks.isLocked('a')).toBe(true); // now held by the second owner
    });

    it('lets only one of two simultaneous acquisitions in at a time', async () => {
      let holders = 0;
      let maxHolders = 0;
      const order: string[] = [];

      const worker = async (name: string) => {
        await locks.acquire('a');
        holders++;
        maxHolders = Math.max(maxHolders, holders);
        order.push(`${name}:start`);
        await tick();
        await tick();
        order.push(`${name}:end`);
        holders--;
        locks.release('a');
      };

      await Promise.all([worker('1'), worker('2')]);

      expect(maxHolders).toBe(1);
      expect(order).toEqual(['1:start', '1:end', '2:start', '2:end']);
    });

    it('keeps mutual exclusion and FIFO order with many waiters', async () => {
      let holders = 0;
      let maxHolders = 0;
      const order: number[] = [];

      await Promise.all(
        [1, 2, 3, 4, 5].map(async n => {
          await locks.acquire('a');
          holders++;
          maxHolders = Math.max(maxHolders, holders);
          order.push(n);
          await tick();
          holders--;
          locks.release('a');
        }),
      );

      expect(maxHolders).toBe(1);
      expect(order).toEqual([1, 2, 3, 4, 5]);
      expect(locks.isLocked('a')).toBe(false);
    });
  });

  describe('timeout (orphaned locks)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('force-releases a lock that is never released once the timeout expires', async () => {
      await locks.acquire('a', 1000);

      await vi.advanceTimersByTimeAsync(999);
      expect(locks.isLocked('a')).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(locks.isLocked('a')).toBe(false);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Lock timeout exceeded'));
    });

    it('uses a 30 s default timeout', async () => {
      await locks.acquire('a');
      await vi.advanceTimersByTimeAsync(29_999);
      expect(locks.isLocked('a')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(locks.isLocked('a')).toBe(false);
    });

    it('lets a waiter in when the orphaned holder times out', async () => {
      await locks.acquire('a', 1000); // never released: orphan
      let acquired = false;
      const waiter = locks.acquire('a', 5000).then(() => {
        acquired = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(acquired).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await waiter;
      expect(acquired).toBe(true);
      expect(locks.isLocked('a')).toBe(true);
    });

    it('cancels the timeout on normal release (no late warning, no timers left)', async () => {
      await locks.acquire('a', 1000);
      locks.release('a');
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(5000);
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('starts a fresh timeout for each new owner', async () => {
      await locks.acquire('a', 1000);
      const second = locks.acquire('a', 1000);
      await vi.advanceTimersByTimeAsync(600);
      locks.release('a'); // first owner done at t=600
      await second; // second owner starts counting at t=600

      await vi.advanceTimersByTimeAsync(999); // t=1599, before second owner's deadline
      expect(locks.isLocked('a')).toBe(true);
      await vi.advanceTimersByTimeAsync(1); // t=1600
      expect(locks.isLocked('a')).toBe(false);
    });

    // Regression: without an owner token, a holder whose lock had timed out released the
    // NEW owner's lock when it finally finished. (Raw acquire()/release() carry no owner,
    // so this protection applies to withLock, which is what the app uses.)
    it('does not let a stale withLock holder release the new owner’s lock', async () => {
      let finishSlow!: () => void;
      const slow = locks.withLock('a', () => new Promise<void>(r => (finishSlow = r)), 1000);
      let finishSecond!: () => void;
      const second = locks.withLock('a', () => new Promise<void>(r => (finishSecond = r)), 60_000);

      await vi.advanceTimersByTimeAsync(1000); // slow holder times out; second takes over
      expect(locks.isLocked('a')).toBe(true);

      finishSlow(); // slow holder finally finishes and releases "its" lock
      await slow;
      expect(locks.isLocked('a')).toBe(true); // second owner is still protected

      finishSecond();
      await second;
      expect(locks.isLocked('a')).toBe(false);
    });
  });

  describe('withLock', () => {
    it('returns the function result and releases afterwards', async () => {
      const result = await locks.withLock('a', async () => {
        expect(locks.isLocked('a')).toBe(true);
        return 42;
      });
      expect(result).toBe(42);
      expect(locks.isLocked('a')).toBe(false);
    });

    it('releases the lock when the function throws and rethrows the error', async () => {
      await expect(
        locks.withLock('a', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(locks.isLocked('a')).toBe(false);
    });

    it('does not stay stuck after a failure: the next caller can acquire', async () => {
      await locks.withLock('a', () => Promise.reject(new Error('x'))).catch(() => {});
      await expect(locks.withLock('a', async () => 'ok')).resolves.toBe('ok');
    });

    it('runs concurrent withLock calls on the same key one after another', async () => {
      const events: string[] = [];
      const job = (name: string) =>
        locks.withLock('a', async () => {
          events.push(`${name}:start`);
          await tick();
          events.push(`${name}:end`);
        });

      await Promise.all([job('x'), job('y'), job('z')]);

      expect(events).toEqual(['x:start', 'x:end', 'y:start', 'y:end', 'z:start', 'z:end']);
    });

    it('lets a failing job hand the lock to a waiting job', async () => {
      const failing = locks.withLock('a', async () => {
        await tick();
        throw new Error('first failed');
      });
      const waiting = locks.withLock('a', async () => 'second ran');

      await expect(failing).rejects.toThrow('first failed');
      await expect(waiting).resolves.toBe('second ran');
    });

    it('runs different keys in parallel', async () => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      const slow = locks.withLock('a', () => gate);
      const fast = await locks.withLock('b', async () => 'done'); // not blocked by 'a'
      expect(fast).toBe('done');
      release();
      await slow;
    });
  });

  describe('clearAll', () => {
    it('releases every lock and cancels every timeout', async () => {
      vi.useFakeTimers();
      await locks.acquire('a');
      await locks.acquire('b');

      locks.clearAll();

      expect(locks.getLockedResources()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('unblocks waiters', async () => {
      await locks.acquire('a');
      let acquired = false;
      const waiter = locks.acquire('a').then(() => {
        acquired = true;
      });
      await tick();
      expect(acquired).toBe(false);

      locks.clearAll();
      await waiter;
      expect(acquired).toBe(true);
    });
  });
});
