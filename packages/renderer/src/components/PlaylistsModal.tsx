import { FC, useState, useEffect } from 'react';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Input,
  ListGroup,
  ListGroupItem,
  Badge,
  FormGroup,
  Label,
  Alert,
  Spinner,
} from 'reactstrap';
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    padding: '12px',
    backgroundColor: isDragging ? '#2c3e50' : '#212529',
    border: '1px solid #495057',
    borderRadius: '4px',
    marginBottom: '8px',
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      className="d-flex justify-content-between align-items-center"
      style={style}
      {...attributes}
      {...listeners}
    >
      <div className="d-flex align-items-center gap-2 flex-grow-1">
        <span
          className="text-muted"
          style={{ userSelect: 'none', padding: '0 8px', fontSize: '18px' }}
        >
          ⋮⋮
        </span>
        <Badge color="secondary">{index + 1}</Badge>
        <div>
          <strong>{patchDir}</strong>
          {patchName && <small className="ms-2 text-muted">{patchName}</small>}
        </div>
      </div>
      <Button
        color="danger"
        size="sm"
        outline
        onClick={e => {
          e.stopPropagation();
          onRemove(patchDir);
        }}
        onPointerDown={e => e.stopPropagation()}
      >
        Remove
      </Button>
    </div>
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

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Load playlists when modal opens
  useEffect(() => {
    if (isOpen && currentFolder) {
      loadPlaylists();
    }
  }, [isOpen, currentFolder]);

  const loadPlaylists = async () => {
    if (!currentFolder) return;

    try {
      setLoading(true);
      const data = await window.electronAPI.loadPlaylists(currentFolder);
      setPlaylists(data.playlists);

      // If a playlist was selected, refresh it
      if (selectedPlaylist) {
        const updated = data.playlists.find((p: Playlist) => p.id === selectedPlaylist.id);
        setSelectedPlaylist(updated || null);
      }
    } catch (error) {
      console.error('Error loading playlists:', error);
      toast.error('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  };

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
    if (!confirm(`Are you sure you want to delete "${playlistName}"?`)) return;

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

  return (
    <Modal isOpen={isOpen} toggle={onClose} size="xl">
      <ModalHeader toggle={onClose}>Playlists</ModalHeader>
      <ModalBody>
        {!currentFolder && (
          <Alert color="warning">Please load a folder first to use playlists.</Alert>
        )}

        {currentFolder && (
          <div className="d-flex" style={{ minHeight: '500px' }}>
            {/* Left Panel: Playlist List */}
            <div
              className="border-end pe-3"
              style={{ width: '300px', overflowY: 'auto', maxHeight: '500px' }}
            >
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">Your Playlists</h6>
                <Button color="primary" size="sm" onClick={() => setCreating(true)}>
                  + New
                </Button>
              </div>

              {creating && (
                <div className="mb-3 p-2 border rounded bg-dark">
                  <FormGroup>
                    <Label size="sm">Playlist Name</Label>
                    <Input
                      type="text"
                      bsSize="sm"
                      value={newPlaylistName}
                      onChange={e => setNewPlaylistName(e.target.value)}
                      placeholder="My Playlist"
                      onKeyDown={e => e.key === 'Enter' && handleCreatePlaylist()}
                    />
                  </FormGroup>
                  <div className="d-flex gap-1">
                    <Button
                      color="primary"
                      size="sm"
                      onClick={handleCreatePlaylist}
                      disabled={!newPlaylistName.trim()}
                    >
                      Create
                    </Button>
                    <Button color="secondary" size="sm" outline onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  </div>
                  {selectedPatchDirs.length > 0 && (
                    <small className="text-muted d-block mt-1">
                      Will include {selectedPatchDirs.length} selected patches
                    </small>
                  )}
                </div>
              )}

              {loading && playlists.length === 0 ? (
                <div className="text-center py-4">
                  <Spinner size="sm" />
                  <p className="text-muted mt-2 mb-0">Loading...</p>
                </div>
              ) : playlists.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-muted mb-0">No playlists yet</p>
                  <small className="text-muted">Create one to get started</small>
                </div>
              ) : (
                <ListGroup>
                  {playlists.map(playlist => (
                    <ListGroupItem
                      key={playlist.id}
                      action
                      active={selectedPlaylist?.id === playlist.id}
                      onClick={() => setSelectedPlaylist(playlist)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <strong>{playlist.name}</strong>
                          <br />
                          <small className="text-muted">{playlist.patches.length} patches</small>
                        </div>
                        <Badge color="primary" pill>
                          {playlist.patches.length}
                        </Badge>
                      </div>
                    </ListGroupItem>
                  ))}
                </ListGroup>
              )}
            </div>

            {/* Right Panel: Playlist Details */}
            <div className="flex-grow-1 ps-3" style={{ overflowY: 'auto', maxHeight: '500px' }}>
              {selectedPlaylist ? (
                <>
                  <div className="d-flex justify-content-between align-items-start mb-3">
                    <div>
                      {editing ? (
                        <div className="d-flex gap-2 align-items-center">
                          <Input
                            type="text"
                            value={editPlaylistName}
                            onChange={e => setEditPlaylistName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRenamePlaylist()}
                            style={{ width: '250px' }}
                          />
                          <Button color="primary" size="sm" onClick={handleRenamePlaylist}>
                            Save
                          </Button>
                          <Button
                            color="secondary"
                            size="sm"
                            outline
                            onClick={() => {
                              setEditing(false);
                              setEditPlaylistName('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <h5>{selectedPlaylist.name}</h5>
                          <small className="text-muted">
                            {selectedPlaylist.patches.length} patches •{' '}
                            {new Date(selectedPlaylist.updatedAt).toLocaleDateString()}
                          </small>
                        </>
                      )}
                    </div>
                    {!editing && (
                      <div className="d-flex gap-1">
                        <Button
                          color="secondary"
                          size="sm"
                          outline
                          onClick={() => {
                            setEditing(true);
                            setEditPlaylistName(selectedPlaylist.name);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          color="danger"
                          size="sm"
                          outline
                          onClick={() =>
                            handleDeletePlaylist(selectedPlaylist.id, selectedPlaylist.name)
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mb-3 d-flex gap-2 flex-wrap">
                    {selectedPatchDirs.length > 0 && (
                      <Button color="primary" size="sm" onClick={handleAddSelectedPatches}>
                        + Add Selected ({selectedPatchDirs.length})
                      </Button>
                    )}
                    {selectedPlaylist.patches.length > 0 && (
                      <>
                        <Button color="secondary" size="sm" outline onClick={handleExportPlaylist}>
                          ⤓ Export Setlist
                        </Button>
                        <Button color="primary" size="sm" onClick={handleMoveToTop}>
                          ⬆️ Move to Top
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Patches in Playlist */}
                  <div>
                    <h6 className="mb-2">Patches in this Playlist</h6>
                    {selectedPlaylist.patches.length === 0 ? (
                      <Alert color="info">
                        <small>
                          This playlist is empty. Select patches in the main view and click "Add
                          Selected" to add them.
                        </small>
                      </Alert>
                    ) : (
                      <div>
                        <small className="text-muted d-block mb-2">
                          💡 Drag patches to reorder them within the playlist
                        </small>
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleDragEnd}
                        >
                          <SortableContext
                            items={selectedPlaylist.patches}
                            strategy={verticalListSortingStrategy}
                          >
                            <div style={{ minHeight: '50px' }}>
                              {selectedPlaylist.patches.map((patchDir, index) => {
                                const patchName = getPatchName(patchDir);
                                return (
                                  <SortablePatchItem
                                    key={patchDir}
                                    patchDir={patchDir}
                                    index={index}
                                    patchName={patchName}
                                    onRemove={handleRemovePatch}
                                  />
                                );
                              })}
                            </div>
                          </SortableContext>
                        </DndContext>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="d-flex align-items-center justify-content-center h-100">
                  <div className="text-center text-muted">
                    <p>Select a playlist to view details</p>
                    <small>or create a new one</small>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={onClose} disabled={loading}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default PlaylistsModal;
