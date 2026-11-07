/**
 * Read-only view of the operation queue.
 *
 * Channels: `operation-queue:status`, `operation-queue:statistics`.
 *
 * @module ipc/queue
 */
import type { IpcHandlers } from '@app/preload/ipc-contract';
import type { IpcDeps } from './deps.js';

export type QueueChannel = 'operation-queue:status' | 'operation-queue:statistics';

export function createQueueHandlers({
  log,
  operationQueue,
}: Pick<IpcDeps, 'log' | 'operationQueue'>): IpcHandlers<QueueChannel> {
  return {
    'operation-queue:status': async () => {
      try {
        return operationQueue.getStatus();
      } catch (error) {
        log.error('Error getting operation queue status:', error);
        throw new Error('Failed to get operation queue status');
      }
    },

    'operation-queue:statistics': async () => {
      try {
        return operationQueue.getStatistics();
      } catch (error) {
        log.error('Error getting operation queue statistics:', error);
        throw new Error('Failed to get operation queue statistics');
      }
    },
  };
}
