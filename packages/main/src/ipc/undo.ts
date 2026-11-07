/**
 * Undo snapshots: pre-operation copies that let the renderer undo/redo
 * deletes, edits and backup restores. The logic lives in `PatchRestore.ts`;
 * these handlers only wire it to IPC.
 *
 * Channels: `undo:createSnapshot`, `undo:restoreSnapshot`, `undo:discardSnapshot`.
 *
 * @module ipc/undo
 */
import type { IpcHandlers } from '@app/preload/ipc-contract';
import { OperationPriority } from '../OperationQueue.js';
import { toIpcResult } from '../PatchRestore.js';
import type { IpcDeps } from './deps.js';

export type UndoChannel = 'undo:createSnapshot' | 'undo:restoreSnapshot' | 'undo:discardSnapshot';

export function createUndoHandlers({
  folderAccess,
  operationQueue,
  patchCache,
  patchRestore,
}: Pick<
  IpcDeps,
  'folderAccess' | 'operationQueue' | 'patchCache' | 'patchRestore'
>): IpcHandlers<UndoChannel> {
  return {
    'undo:createSnapshot': (basePath, scope) =>
      operationQueue.enqueue(
        'undo:createSnapshot',
        'Create undo snapshot',
        () =>
          toIpcResult(async () => {
            // Security: approved folder only
            folderAccess.assertRoot(basePath);
            return { snapshot: await patchRestore.createSnapshot(basePath, scope) };
          }),
        OperationPriority.HIGH,
      ),

    'undo:restoreSnapshot': (snapshotId, basePath, mode, only) =>
      operationQueue.enqueue(
        'undo:restoreSnapshot',
        'Restore undo snapshot',
        async () => {
          try {
            return await toIpcResult(async () => {
              // Security: approved folder only
              folderAccess.assertRoot(basePath);
              return patchRestore.restoreSnapshot(snapshotId, basePath, mode, only);
            });
          } finally {
            patchCache.invalidate(basePath);
          }
        },
        OperationPriority.HIGH,
      ),

    'undo:discardSnapshot': snapshotId => patchRestore.discardSnapshot(snapshotId),
  };
}
