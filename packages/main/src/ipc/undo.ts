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
import { PatchRestoreError, toIpcResult } from '../PatchRestore.js';
import { PEDAL_SNAPSHOT_PREFIX } from '../usb/PedalEditor.js';
import { isPedalPath, parseBankPath } from '../usb/pedalPaths.js';
import type { IpcDeps } from './deps.js';

export type UndoChannel = 'undo:createSnapshot' | 'undo:restoreSnapshot' | 'undo:discardSnapshot';

export function createUndoHandlers({
  folderAccess,
  operationQueue,
  patchCache,
  patchRestore,
  pedal,
}: Pick<
  IpcDeps,
  'folderAccess' | 'operationQueue' | 'patchCache' | 'patchRestore' | 'pedal'
>): IpcHandlers<UndoChannel> {
  /** The bank of a pedal folder path, or an INVALID_ARGUMENT failure. */
  const pedalBank = (basePath: string) => {
    const bank = parseBankPath(basePath);
    if (!bank) throw new PatchRestoreError('INVALID_ARGUMENT', 'Invalid pedal folder path');
    return bank;
  };

  return {
    'undo:createSnapshot': (basePath, scope) =>
      isPedalPath(basePath)
        ? toIpcResult(async () => ({
            snapshot: await pedal.createSnapshot(pedalBank(basePath), scope),
          }))
        : operationQueue.enqueue(
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
      isPedalPath(basePath)
        ? toIpcResult(() => pedal.restoreSnapshot(snapshotId, pedalBank(basePath), mode, only))
        : operationQueue.enqueue(
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

    'undo:discardSnapshot': snapshotId =>
      typeof snapshotId === 'string' && snapshotId.startsWith(PEDAL_SNAPSHOT_PREFIX)
        ? pedal.discardSnapshot(snapshotId)
        : patchRestore.discardSnapshot(snapshotId),
  };
}
