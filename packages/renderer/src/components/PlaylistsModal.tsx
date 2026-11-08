import { FC, useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Patch } from '../types';
import {
  cx,
  Dialog,
  DisplayWindow,
  Field,
  Grip,
  Input,
  Led,
  Notice,
  PanelKey,
  SevenSegment,
} from '../ui';
import { isPedalPath } from '../utils/pedal';
import s from './PlaylistsModal.module.css';

interface Playlist {
  id: string;
  name: string;
  patches: string[];
  createdAt: string;
  updatedAt: string;
}

interface PlaylistsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFolder: string | null;
  patches: Patch[];
  selectedPatchDirs: string[];
  onMovePlaylistToTop?: (playlistId: string) => void;
}

interface SortablePatchItemProps {
  patchDir: string;
  index: number;
  patchName: string;
  onRemove: (patchDir: string) => void;
}

const SortablePatchItem: FC<SortablePatchItemProps> = ({
  patchDir,
  index,
  patchName,
  onRemove,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: patchDir,
  });

  return (
    <li
      ref={setNodeRef}
      className={cx(s.entry, isDragging && s.entryLifted)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${index + 1}. ${patchDir}${patchName ? ` ${patchName}` : ''}`}
    >
      <Grip />
      <DisplayWindow className={s.order}>
        <SevenSegment value={String(index + 1).padStart(2, '0')} height={18} />
      </DisplayWindow>
      <span className={s.entryText}>
        <span className={s.entryName}>{patchName || 'Untitled'}</span>
        <span className={s.muted}>{patchDir}</span>
      </span>
      <PanelKey
        label="Remove"
        size="sm"
        aria-label={`Remove ${patchDir} from the playlist`}
        onClick={e => {
          e.stopPropagation();
          onRemove(patchDir);
        }}
        onPointerDown={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      />
    </li>
  );
};

export const PlaylistsModal: FC<PlaylistsModalProps> = ({
  isOpen,
  onClose,
  currentFolder,
  patches,
  selectedPatchDirs,
  onMovePlaylistToTop,
}) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editPlaylistName, setEditPlaylistName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Folder whose playlists were last fetched when the modal opened. Until it matches the
  // current folder, the first load is still in flight.
  const [fetchedFolder, setFetchedFolder] = useState<string | null>(null);
  const initialLoading = isOpen && !!currentFolder && fetchedFolder !== currentFolder;
  /** What the open folder is called in texts: a card, or a bank of a pedal over USB. */
  const source = isPedalPath(currentFolder) ? 'bank' : 'card';
  const busy = loading || initialLoading;

  const applyPlaylists = useCallback((list: Playlist[]) => {
    setPlaylists(list);

    // If a playlist was selected, refresh it
    setSelectedPlaylist(selected =>
      selected ? list.find(p => p.id === selected.id) || null : null,
    );
  }, []);

  const loadPlaylists = useCallback(async () => {
    if (!currentFolder) return;

    try {
      setLoading(true);
      const data = await window.electronAPI.loadPlaylists(currentFolder);
      applyPlaylists(data.playlists);
    } catch (error) {
      console.error('Error loading playlists:', error);
      toast.error('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  }, [currentFolder, applyPlaylists]);

  // Load playlists when modal opens. State is only set once the request settles, and a
  // response for a folder that is no longer current is dropped.
  useEffect(() => {
    if (!isOpen || !currentFolder) return;

    let cancelled = false;
    window.electronAPI.loadPlaylists(currentFolder).then(
      data => {
        if (cancelled) return;
        applyPlaylists(data.playlists);
        setFetchedFolder(currentFolder);
      },
      error => {
        if (cancelled) return;
        console.error('Error loading playlists:', error);
        toast.error('Failed to load playlists');
        setFetchedFolder(currentFolder);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentFolder, applyPlaylists]);

  const handleCreatePlaylist = async () => {
    if (!currentFolder || !newPlaylistName.trim()) return;

    try {
      setLoading(true);
      const playlist = await window.electronAPI.createPlaylist(
        currentFolder,
        newPlaylistName.trim(),
        selectedPatchDirs,
      );
      toast.success(`Playlist "${playlist.name}" created`);
      setNewPlaylistName('');
      setCreating(false);
      await loadPlaylists();
      setSelectedPlaylist(playlist);
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Failed to create playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlaylist = async (playlistId: string, playlistName: string) => {
    if (!currentFolder) return;
    setConfirmingDelete(false);

    try {
      setLoading(true);
      await window.electronAPI.deletePlaylist(currentFolder, playlistId);
      toast.success(`Playlist "${playlistName}" deleted`);

      if (selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist(null);
      }

      await loadPlaylists();
    } catch (error) {
      console.error('Error deleting playlist:', error);
      toast.error('Failed to delete playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleRenamePlaylist = async () => {
    if (!currentFolder || !selectedPlaylist || !editPlaylistName.trim()) return;

    try {
      setLoading(true);
      const updated = await window.electronAPI.updatePlaylist(currentFolder, selectedPlaylist.id, {
        name: editPlaylistName.trim(),
      });
      toast.success(`Playlist renamed to "${updated.name}"`);
      setEditing(false);
      setEditPlaylistName('');
      await loadPlaylists();
      setSelectedPlaylist(updated);
    } catch (error) {
      console.error('Error renaming playlist:', error);
      toast.error('Failed to rename playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSelectedPatches = async () => {
    if (!currentFolder || !selectedPlaylist || selectedPatchDirs.length === 0) return;

    try {
      setLoading(true);
      const updated = await window.electronAPI.addPatchesToPlaylist(
        currentFolder,
        selectedPlaylist.id,
        selectedPatchDirs,
      );
      toast.success(`Added ${selectedPatchDirs.length} patches to "${selectedPlaylist.name}"`);
      await loadPlaylists();
      setSelectedPlaylist(updated);
    } catch (error) {
      console.error('Error adding patches:', error);
      toast.error('Failed to add patches');
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePatch = async (patchDir: string) => {
    if (!currentFolder || !selectedPlaylist) return;

    try {
      setLoading(true);
      const updated = await window.electronAPI.removePatchesFromPlaylist(
        currentFolder,
        selectedPlaylist.id,
        [patchDir],
      );
      toast.success(`Removed ${patchDir} from "${selectedPlaylist.name}"`);
      await loadPlaylists();
      setSelectedPlaylist(updated);
    } catch (error) {
      console.error('Error removing patch:', error);
      toast.error('Failed to remove patch');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPlaylist = async () => {
    if (!currentFolder || !selectedPlaylist) return;

    try {
      setLoading(true);
      const result = await window.electronAPI.exportPlaylist(currentFolder, selectedPlaylist.id);

      if (result.canceled) return;

      if (result.success && result.filePath) {
        toast.success(`Playlist exported to ${result.filePath}`);
      }
    } catch (error) {
      console.error('Error exporting playlist:', error);
      toast.error('Failed to export playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToTop = () => {
    if (selectedPlaylist && onMovePlaylistToTop) {
      onMovePlaylistToTop(selectedPlaylist.id);
      onClose();
    }
  };

  const getPatchName = (patchDir: string) => {
    const patch = patches.find(p => p.dir === patchDir);
    return patch?.data?.JamManPatch?.PatchName?.[0] || '';
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!currentFolder || !selectedPlaylist) return;

    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = selectedPlaylist.patches.findIndex(p => p === active.id);
      const newIndex = selectedPlaylist.patches.findIndex(p => p === over?.id);
      const newOrder = arrayMove(selectedPlaylist.patches, oldIndex, newIndex);

      // Optimistically update UI
      setSelectedPlaylist({
        ...selectedPlaylist,
        patches: newOrder,
      });

      try {
        setLoading(true);
        const updated = await window.electronAPI.reorderPlaylistPatches(
          currentFolder,
          selectedPlaylist.id,
          newOrder,
        );
        await loadPlaylists();
        setSelectedPlaylist(updated);
      } catch (error) {
        console.error('Error reordering patches:', error);
        toast.error('Failed to reorder patches');
        // Reload to revert optimistic update
        await loadPlaylists();
      } finally {
        setLoading(false);
      }
    }
  };

  const selectPlaylist = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setEditing(false);
    setConfirmingDelete(false);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      title="Playlists"
      subtitle={`Group patches into setlists, then move a setlist to the first slots of the ${source}.`}
      footer={<PanelKey label="Close" onClick={onClose} disabled={busy} />}
    >
      {!currentFolder ? (
        <Notice tone="warning">
          <p>Load a card first to use playlists.</p>
        </Notice>
      ) : (
        <div className={s.layout}>
          <section className={s.side} aria-labelledby="playlists-heading">
            <div className={s.sideHead}>
              <h3 id="playlists-heading" className={s.heading}>
                Your playlists
              </h3>
              {!creating && <PanelKey label="New" size="sm" onClick={() => setCreating(true)} />}
            </div>

            {creating && (
              <div className={s.create}>
                <Field
                  label="Name"
                  htmlFor="new-playlist-name"
                  hint={
                    selectedPatchDirs.length > 0
                      ? `Starts with the ${selectedPatchDirs.length} selected patches.`
                      : undefined
                  }
                >
                  <Input
                    id="new-playlist-name"
                    type="text"
                    value={newPlaylistName}
                    onChange={e => setNewPlaylistName(e.target.value)}
                    placeholder="Friday set"
                    autoFocus
                    autoComplete="off"
                    onKeyDown={e => e.key === 'Enter' && handleCreatePlaylist()}
                  />
                </Field>
                <div className={s.keys}>
                  <PanelKey label="Cancel" size="sm" onClick={() => setCreating(false)} />
                  <PanelKey
                    label="Create"
                    size="sm"
                    led
                    onClick={handleCreatePlaylist}
                    disabled={!newPlaylistName.trim()}
                  />
                </div>
              </div>
            )}

            {busy && playlists.length === 0 ? (
              <p className={s.status} role="status">
                <Led color="red" on blinkSeconds={0.4} />
                Loading playlists…
              </p>
            ) : playlists.length === 0 ? (
              <p className={s.muted}>No playlists yet. Use New to start one.</p>
            ) : (
              <ul className={s.playlists}>
                {playlists.map(playlist => {
                  const current = selectedPlaylist?.id === playlist.id;
                  return (
                    <li key={playlist.id}>
                      <button
                        type="button"
                        className={cx(s.playlist, current && s.playlistCurrent)}
                        aria-pressed={current}
                        onClick={() => selectPlaylist(playlist)}
                      >
                        <Led color="red" on={current} />
                        <span className={s.playlistName}>{playlist.name}</span>
                        <span className={s.muted}>
                          {playlist.patches.length}{' '}
                          {playlist.patches.length === 1 ? 'patch' : 'patches'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={s.detail} aria-label="Playlist">
            {selectedPlaylist ? (
              <>
                <div className={s.detailHead}>
                  {editing ? (
                    <div className={s.rename}>
                      <Field label="Name" htmlFor="rename-playlist" className={s.grow}>
                        <Input
                          id="rename-playlist"
                          type="text"
                          value={editPlaylistName}
                          onChange={e => setEditPlaylistName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRenamePlaylist()}
                          autoFocus
                          autoComplete="off"
                        />
                      </Field>
                      <PanelKey
                        label="Cancel"
                        size="sm"
                        onClick={() => {
                          setEditing(false);
                          setEditPlaylistName('');
                        }}
                      />
                      <PanelKey label="Save" size="sm" led onClick={handleRenamePlaylist} />
                    </div>
                  ) : (
                    <>
                      <div className={s.title}>
                        <h3 className={s.name}>{selectedPlaylist.name}</h3>
                        <span className={s.muted}>
                          {selectedPlaylist.patches.length}{' '}
                          {selectedPlaylist.patches.length === 1 ? 'patch' : 'patches'}, updated{' '}
                          {new Date(selectedPlaylist.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className={s.keys}>
                        <PanelKey
                          label="Rename"
                          size="sm"
                          onClick={() => {
                            setConfirmingDelete(false);
                            setEditing(true);
                            setEditPlaylistName(selectedPlaylist.name);
                          }}
                        />
                        <PanelKey
                          label="Delete"
                          size="sm"
                          tone="danger"
                          aria-expanded={confirmingDelete}
                          onClick={() => setConfirmingDelete(true)}
                        />
                      </div>
                    </>
                  )}
                </div>

                {confirmingDelete && (
                  <Notice tone="warning" title={`Delete the playlist “${selectedPlaylist.name}”?`}>
                    <p>Its patches stay on the {source}.</p>
                    <div className={s.keys}>
                      <PanelKey
                        label="Keep it"
                        size="sm"
                        onClick={() => setConfirmingDelete(false)}
                      />
                      <PanelKey
                        label="Delete playlist"
                        size="sm"
                        tone="danger"
                        onClick={() =>
                          handleDeletePlaylist(selectedPlaylist.id, selectedPlaylist.name)
                        }
                      />
                    </div>
                  </Notice>
                )}

                <div className={s.actions}>
                  {selectedPatchDirs.length > 0 && (
                    <PanelKey
                      label={`Add selected (${selectedPatchDirs.length})`}
                      onClick={handleAddSelectedPatches}
                    />
                  )}
                  {selectedPlaylist.patches.length > 0 && (
                    <>
                      <PanelKey label="Export setlist" onClick={handleExportPlaylist} />
                      <PanelKey
                        label="Move to top"
                        hint={`Renumbers the ${source}`}
                        led
                        onClick={handleMoveToTop}
                      />
                    </>
                  )}
                </div>

                {selectedPlaylist.patches.length === 0 ? (
                  <Notice>
                    <p>
                      This playlist is empty. Select patches in the main list, then use Add
                      selected.
                    </p>
                  </Notice>
                ) : (
                  <div className={s.setlist}>
                    <p className={s.muted} id="setlist-help">
                      Drag to change the order, or focus a row and use Space and the arrow keys.
                    </p>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={selectedPlaylist.patches}
                        strategy={verticalListSortingStrategy}
                      >
                        <ol className={s.entries}>
                          {selectedPlaylist.patches.map((patchDir, index) => (
                            <SortablePatchItem
                              key={patchDir}
                              patchDir={patchDir}
                              index={index}
                              patchName={getPatchName(patchDir)}
                              onRemove={handleRemovePatch}
                            />
                          ))}
                        </ol>
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </>
            ) : (
              <p className={cx(s.muted, s.placeholder)}>
                Pick a playlist to see its patches, or start a new one.
              </p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
};

export default PlaylistsModal;
