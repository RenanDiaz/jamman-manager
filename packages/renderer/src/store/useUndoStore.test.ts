import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUndoStore, getSnapshotIds, type UndoAction } from './useUndoStore';

const discard = vi.fn(async () => undefined);
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

const del = (n: number): UndoAction => ({
  type: 'DELETE_PATCH',
  timestamp: n,
  description: `Delete ${n}`,
  folder: '/sd',
  directory: `Patch0${n}`,
  snapshotId: `snap-del-${n}`,
});

const update = (redoSnapshotId?: string | null): UndoAction => ({
  type: 'UPDATE_PATCH',
  timestamp: 1,
  description: 'Edit',
  folder: '/sd',
  directory: 'Patch01',
  beforeSnapshotId: 'snap-before',
  redoSnapshotId,
});

const discarded = () => discard.mock.calls.map(c => (c as unknown[])[0]).sort();

beforeEach(() => {
  discard.mockClear();
  vi.stubGlobal('window', { electronAPI: { discardUndoSnapshot: discard } });
  useUndoStore.setState({ undoStack: [], redoStack: [], maxHistorySize: 50 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUndoStore', () => {
  it('moves actions between the stacks on undo and redo', () => {
    const store = useUndoStore.getState();
    store.pushUndo(del(1));
    store.pushUndo(del(2));

    expect(useUndoStore.getState().undo()?.description).toBe('Delete 2');
    expect(useUndoStore.getState().getRedoDescription()).toBe('Delete 2');
    expect(useUndoStore.getState().getUndoDescription()).toBe('Delete 1');
    expect(useUndoStore.getState().redo()?.description).toBe('Delete 2');
    expect(useUndoStore.getState().canRedo()).toBe(false);
    expect(discard).not.toHaveBeenCalled();
  });

  it('lists the snapshots every action depends on', () => {
    expect(getSnapshotIds(del(1))).toEqual(['snap-del-1']);
    expect(getSnapshotIds(update())).toEqual(['snap-before']);
    expect(getSnapshotIds(update('snap-redo'))).toEqual(['snap-before', 'snap-redo']);
    expect(getSnapshotIds(update(null))).toEqual(['snap-before']);
    expect(
      getSnapshotIds({
        type: 'REORDER_PATCHES',
        timestamp: 1,
        description: 'r',
        folder: '/sd',
        previousOrder: [],
        newOrder: [],
      }),
    ).toEqual([]);
  });

  it('frees snapshots of the oldest action when the history is full', async () => {
    useUndoStore.setState({ maxHistorySize: 2 });
    const store = useUndoStore.getState();
    store.pushUndo(del(1));
    store.pushUndo(del(2));
    store.pushUndo(del(3));
    await flush();
    expect(useUndoStore.getState().undoStack.map(a => a.description)).toEqual([
      'Delete 2',
      'Delete 3',
    ]);
    expect(discarded()).toEqual(['snap-del-1']);
  });

  it('frees the snapshots of the redo stack when a new action arrives', async () => {
    const store = useUndoStore.getState();
    store.pushUndo(del(1));
    store.pushUndo(update('snap-redo'));
    useUndoStore.getState().undo();
    useUndoStore.getState().pushUndo(del(2));
    await flush();
    expect(discarded()).toEqual(['snap-before', 'snap-redo']);
  });

  it('clearHistory frees everything', async () => {
    const store = useUndoStore.getState();
    store.pushUndo(del(1));
    store.pushUndo(del(2));
    useUndoStore.getState().undo();
    useUndoStore.getState().clearHistory();
    await flush();
    expect(discarded()).toEqual(['snap-del-1', 'snap-del-2']);
    expect(useUndoStore.getState().canUndo()).toBe(false);
    expect(useUndoStore.getState().canRedo()).toBe(false);
  });

  it('revertUndo / revertRedo put a failed action back without touching the other stack', () => {
    const store = useUndoStore.getState();
    store.pushUndo(del(1));
    store.pushUndo(del(2));

    const undone = useUndoStore.getState().undo()!;
    useUndoStore.getState().revertUndo(undone);
    expect(useUndoStore.getState().undoStack).toHaveLength(2);
    expect(useUndoStore.getState().redoStack).toHaveLength(0);

    useUndoStore.getState().undo();
    const redone = useUndoStore.getState().redo()!;
    useUndoStore.getState().revertRedo(redone);
    expect(useUndoStore.getState().undoStack).toHaveLength(1);
    expect(useUndoStore.getState().redoStack).toHaveLength(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it('dropAction removes the action wherever it is and frees its snapshots', async () => {
    const store = useUndoStore.getState();
    const a = del(1);
    store.pushUndo(a);
    store.pushUndo(del(2));
    useUndoStore.getState().dropAction(a);
    await flush();
    expect(useUndoStore.getState().undoStack.map(x => x.description)).toEqual(['Delete 2']);
    expect(discarded()).toEqual(['snap-del-1']);
  });
});
