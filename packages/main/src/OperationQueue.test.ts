/**
 * OperationQueue tests — real class; Electron (BrowserWindow) and the logger are mocked
 * at the edges. Date is faked only where durations are asserted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { OperationPriority, OperationQueue, OperationStatus } from './OperationQueue.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

/** A promise you resolve/reject by hand, to hold an operation "running". */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('OperationQueue', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('execution', () => {
    it('runs an operation and resolves with its result', async () => {
      const queue = new OperationQueue();
      await expect(queue.enqueue('t', 'desc', async () => 'value')).resolves.toBe('value');
    });

    it('starts immediately when below the concurrency limit', async () => {
      const queue = new OperationQueue(2);
      const gate = deferred();
      const fn = vi.fn(() => gate.promise);
      const p = queue.enqueue('t', 'd', fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(queue.getStatus().running).toHaveLength(1);
      gate.resolve();
      await p;
    });

    it('never runs more than maxConcurrent operations at once', async () => {
      const queue = new OperationQueue(2);
      let active = 0;
      let peak = 0;
      const gates = Array.from({ length: 5 }, () => deferred());

      const results = gates.map((g, i) =>
        queue.enqueue('t', `op${i}`, async () => {
          active++;
          peak = Math.max(peak, active);
          await g.promise;
          active--;
          return i;
        }),
      );

      await tick();
      expect(active).toBe(2);
      expect(queue.getStatus().stats).toMatchObject({ runningCount: 2, queuedCount: 3 });

      for (const g of gates) {
        g.resolve();
        await tick();
      }
      expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4]);
      expect(peak).toBe(2);
    });

    it('defaults to 3 concurrent operations', () => {
      expect(new OperationQueue().getStatus().stats.maxConcurrent).toBe(3);
    });

    it('assigns unique, increasing operation IDs', async () => {
      const queue = new OperationQueue();
      await queue.enqueue('t', 'a', async () => {});
      await queue.enqueue('t', 'b', async () => {});
      expect(queue.getStatus().completed.map(o => o.id)).toEqual(['op_1', 'op_2']);
    });
  });

  describe('priority', () => {
    /** Fills the only slot, enqueues the rest, then drains and returns the execution order. */
    async function drainOrder(items: [string, OperationPriority?][]) {
      const queue = new OperationQueue(1);
      const blocker = deferred();
      const order: string[] = [];
      const pending = [queue.enqueue('block', 'blocker', () => blocker.promise)];
      for (const [name, priority] of items) {
        pending.push(
          queue.enqueue(
            'job',
            name,
            async () => {
              order.push(name);
            },
            priority,
          ),
        );
      }
      blocker.resolve();
      await Promise.all(pending);
      return order;
    }

    it('runs HIGH before NORMAL before LOW regardless of arrival order', async () => {
      const order = await drainOrder([
        ['low', OperationPriority.LOW],
        ['normal', OperationPriority.NORMAL],
        ['high', OperationPriority.HIGH],
      ]);
      expect(order).toEqual(['high', 'normal', 'low']);
    });

    it('keeps FIFO order within the same priority', async () => {
      const order = await drainOrder([
        ['h1', OperationPriority.HIGH],
        ['n1', OperationPriority.NORMAL],
        ['h2', OperationPriority.HIGH],
        ['n2', OperationPriority.NORMAL],
        ['l1', OperationPriority.LOW],
        ['h3', OperationPriority.HIGH],
      ]);
      expect(order).toEqual(['h1', 'h2', 'h3', 'n1', 'n2', 'l1']);
    });

    it('defaults to NORMAL priority', async () => {
      const order = await drainOrder([
        ['default'],
        ['low', OperationPriority.LOW],
        ['high', OperationPriority.HIGH],
      ]);
      expect(order).toEqual(['high', 'default', 'low']);
    });

    it('does not preempt an operation that is already running', async () => {
      const queue = new OperationQueue(1);
      const gate = deferred();
      const low = queue.enqueue('t', 'low', () => gate.promise, OperationPriority.LOW);
      const started = vi.fn(async () => {});
      const high = queue.enqueue('t', 'high', started, OperationPriority.HIGH);

      await tick();
      expect(started).not.toHaveBeenCalled();
      expect(queue.getStatus().running[0].description).toBe('low');

      gate.resolve();
      await Promise.all([low, high]);
      expect(started).toHaveBeenCalledTimes(1);
    });

    it('lists queued operations in execution order', async () => {
      const queue = new OperationQueue(1);
      const gate = deferred();
      queue.enqueue('t', 'blocker', () => gate.promise);
      queue.enqueue('t', 'low', async () => {}, OperationPriority.LOW);
      queue.enqueue('t', 'high', async () => {}, OperationPriority.HIGH);

      expect(queue.getStatus().queued.map(o => o.description)).toEqual(['high', 'low']);
      gate.resolve();
      await tick();
    });
  });

  describe('errors', () => {
    it('rejects the caller with the original error', async () => {
      const queue = new OperationQueue();
      const error = new Error('disk full');
      await expect(
        queue.enqueue('t', 'd', async () => {
          throw error;
        }),
      ).rejects.toBe(error);
    });

    it('keeps processing after a failure (the queue is not blocked)', async () => {
      const queue = new OperationQueue(1);
      const failing = queue.enqueue('t', 'bad', async () => {
        throw new Error('nope');
      });
      const after = queue.enqueue('t', 'good', async () => 'still works');

      await expect(failing).rejects.toThrow('nope');
      await expect(after).resolves.toBe('still works');
      expect(queue.getStatus().stats).toMatchObject({ runningCount: 0, queuedCount: 0 });
    });

    it('frees the slot after a failure so queued work continues', async () => {
      const queue = new OperationQueue(1);
      const gate = deferred();
      const first = queue.enqueue('t', 'first', () => gate.promise);
      const second = queue.enqueue('t', 'second', async () => 2);
      const third = queue.enqueue('t', 'third', async () => 3);

      gate.reject(new Error('first failed'));
      await expect(first).rejects.toThrow('first failed');
      await expect(Promise.all([second, third])).resolves.toEqual([2, 3]);
    });

    it('handles a function that throws synchronously', async () => {
      const queue = new OperationQueue(1);
      const bad = queue.enqueue('t', 'sync', (() => {
        throw new Error('sync boom');
      }) as () => Promise<void>);
      const next = queue.enqueue('t', 'next', async () => 'ok');

      await expect(bad).rejects.toThrow('sync boom');
      await expect(next).resolves.toBe('ok');
    });

    it('records the failure in history, stringifying non-Error rejections', async () => {
      const queue = new OperationQueue();
      await queue.enqueue('t', 'a', () => Promise.reject(new Error('real error'))).catch(() => {});
      await queue.enqueue('t', 'b', () => Promise.reject('plain string')).catch(() => {});

      const [a, b] = queue.getStatus().completed;
      expect(a).toMatchObject({ status: OperationStatus.FAILED, error: 'real error' });
      expect(b).toMatchObject({ status: OperationStatus.FAILED, error: 'plain string' });
    });

    it('does not let one failing operation reject its siblings', async () => {
      const queue = new OperationQueue(3);
      const results = await Promise.allSettled([
        queue.enqueue('t', 'a', async () => 'a'),
        queue.enqueue('t', 'b', async () => {
          throw new Error('b');
        }),
        queue.enqueue('t', 'c', async () => 'c'),
      ]);
      expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    });
  });

  describe('status and statistics', () => {
    it('starts empty', () => {
      const queue = new OperationQueue(2);
      expect(queue.getStatus()).toEqual({
        queued: [],
        running: [],
        completed: [],
        stats: { queuedCount: 0, runningCount: 0, completedCount: 0, maxConcurrent: 2 },
      });
      expect(queue.getStatistics()).toEqual({
        totalCompleted: 0,
        successful: 0,
        failed: 0,
        successRate: 0,
        averageDuration: 0,
        currentlyQueued: 0,
        currentlyRunning: 0,
      });
    });

    it('reports queued and running operations with their metadata', async () => {
      const queue = new OperationQueue(1);
      const gate = deferred();
      queue.enqueue('backup', 'Backing up', () => gate.promise, OperationPriority.HIGH);
      queue.enqueue('delete', 'Deleting', async () => {});

      const status = queue.getStatus();
      expect(status.running[0]).toMatchObject({
        id: 'op_1',
        type: 'backup',
        description: 'Backing up',
        priority: OperationPriority.HIGH,
        status: OperationStatus.RUNNING,
      });
      expect(status.running[0].startedAt).toBeInstanceOf(Date);
      expect(status.queued[0]).toMatchObject({
        id: 'op_2',
        type: 'delete',
        status: OperationStatus.QUEUED,
      });
      expect(status.stats).toMatchObject({ queuedCount: 1, runningCount: 1 });

      gate.resolve();
      await tick();
    });

    it('counts successes, failures and success rate', async () => {
      const queue = new OperationQueue();
      await queue.enqueue('t', 'ok1', async () => {});
      await queue.enqueue('t', 'ok2', async () => {});
      await queue.enqueue('t', 'ok3', async () => {});
      await queue.enqueue('t', 'bad', () => Promise.reject(new Error('x'))).catch(() => {});

      expect(queue.getStatistics()).toMatchObject({
        totalCompleted: 4,
        successful: 3,
        failed: 1,
        successRate: 75,
        currentlyQueued: 0,
        currentlyRunning: 0,
      });
    });

    it('computes the rounded average duration of finished operations', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(0);
      const queue = new OperationQueue(1);
      for (const ms of [100, 200, 301]) {
        await queue.enqueue('t', `${ms}`, async () => {
          vi.setSystemTime(Date.now() + ms);
        });
      }
      expect(queue.getStatistics().averageDuration).toBe(200); // (100+200+301)/3 = 200.33
    });

    it('includes failed operations in the average duration', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(0);
      const queue = new OperationQueue(1);
      await queue.enqueue('t', 'ok', async () => vi.setSystemTime(Date.now() + 100));
      await queue
        .enqueue('t', 'bad', async () => {
          vi.setSystemTime(Date.now() + 300);
          throw new Error('x');
        })
        .catch(() => {});
      expect(queue.getStatistics().averageDuration).toBe(200);
    });

    it('getStatus().completed shows only the last 10, stats count the retained history', async () => {
      const queue = new OperationQueue(1);
      for (let i = 1; i <= 12; i++) await queue.enqueue('t', `op${i}`, async () => {});

      const status = queue.getStatus();
      expect(status.completed).toHaveLength(10);
      expect(status.completed[0].description).toBe('op3');
      expect(status.completed[9].description).toBe('op12');
      expect(status.stats.completedCount).toBe(12);
    });

    it('keeps only the last 50 completed operations', async () => {
      const queue = new OperationQueue(1);
      for (let i = 1; i <= 55; i++) await queue.enqueue('t', `op${i}`, async () => {});

      expect(queue.getStatistics().totalCompleted).toBe(50);
      expect(queue.getStatus().completed.at(-1)?.description).toBe('op55');
      expect(queue.getStatus().stats.completedCount).toBe(50);
    });

    it('clearCompleted wipes history but not pending work', async () => {
      const queue = new OperationQueue(1);
      await queue.enqueue('t', 'done', async () => {});
      const gate = deferred();
      queue.enqueue('t', 'running', () => gate.promise);

      queue.clearCompleted();

      expect(queue.getStatistics()).toMatchObject({ totalCompleted: 0, currentlyRunning: 1 });
      gate.resolve();
      await tick();
    });

    it('does not expose the execute/resolve/reject internals through getStatus', async () => {
      const queue = new OperationQueue(1);
      const gate = deferred();
      queue.enqueue('t', 'running', () => gate.promise);
      queue.enqueue('t', 'queued', async () => {});
      const { running, queued } = queue.getStatus();
      for (const op of [...running, ...queued]) {
        expect(op).not.toHaveProperty('execute');
        expect(op).not.toHaveProperty('resolve');
        expect(op).not.toHaveProperty('reject');
      }
      gate.resolve();
      await tick();
    });
  });

  describe('renderer notifications', () => {
    it('pushes the status to the first window on enqueue, start and finish', async () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { webContents: { send } },
        { webContents: { send: vi.fn() } },
      ] as never);
      const queue = new OperationQueue();

      await queue.enqueue('t', 'd', async () => {});

      expect(send.mock.calls.length).toBeGreaterThanOrEqual(3);
      for (const [channel, status] of send.mock.calls) {
        expect(channel).toBe('operation-queue:status');
        expect(status).toHaveProperty('stats');
      }
      const last = send.mock.calls.at(-1)![1];
      expect(last.stats).toMatchObject({ runningCount: 0, queuedCount: 0, completedCount: 1 });
    });

    it('works when there is no window', async () => {
      const queue = new OperationQueue();
      await expect(queue.enqueue('t', 'd', async () => 1)).resolves.toBe(1);
    });

    // The renderer window can be gone/destroyed (webContents.send throws). That must not
    // lose or wedge queued operations.
    it('still runs operations when sending the status to the renderer throws', async () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        {
          webContents: {
            send: () => {
              throw new Error('Object has been destroyed');
            },
          },
        },
      ] as never);
      const queue = new OperationQueue(1);

      await expect(queue.enqueue('t', 'd', async () => 'ran')).resolves.toBe('ran');
      await expect(queue.enqueue('t', 'd2', async () => 'ran2')).resolves.toBe('ran2');
      expect(queue.getStatus().stats).toMatchObject({ runningCount: 0, queuedCount: 0 });
    });
  });

  describe('not implemented', () => {
    it.todo('cancels a queued operation (OperationQueue has no cancel API yet)');
    it.todo('times out an operation that never settles (no per-operation timeout yet)');
  });
});
