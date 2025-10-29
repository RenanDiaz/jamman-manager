import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FC, MouseEvent, useState, useEffect } from 'react';
import { Patch } from '../../types';
import { ListGroup, Input } from 'reactstrap';
import { usePatchStore } from '../../store/usePatchStore';

interface Props {
  patches: Patch[];
  onReorder: (newOrder: Patch[]) => void;
}

interface PatchItemProps {
  patch: Patch;
  isSelected: boolean;
  isDragging: boolean;
  onSelect: (dir: string, event: MouseEvent) => void;
  onToggle: (dir: string) => void;
}

const PatchItem: FC<PatchItemProps> = ({ patch, isSelected, isDragging, onSelect, onToggle }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: patch.dir,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: isSelected ? 'rgba(13, 110, 253, 0.2)' : undefined,
    borderColor: isSelected ? '#0d6efd' : undefined,
    opacity: isDragging || isSortableDragging ? 0 : 1,
  };

  const patchName = patch.data.JamManPatch.PatchName?.[0] || '';

  return (
    <div ref={setNodeRef} className="list-group-item" style={style}>
      <div className="d-flex align-items-center">
        <Input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(patch.dir)}
          onClick={e => e.stopPropagation()}
          className="me-2"
          style={{ cursor: 'pointer' }}
        />
        <div
          className="flex-grow-1"
          style={{ cursor: 'grab' }}
          onClick={e => onSelect(patch.dir, e)}
          {...attributes}
          {...listeners}
        >
          <strong>{patch.dir}</strong>
          {!!patchName && <small className="ms-2">{patchName}</small>}
        </div>
      </div>
    </div>
  );
};

export const PatchList: FC<Props> = ({ patches, onReorder }) => {
  const { selectedPatchDirs, toggleSelection, selectRange, clearSelection, selectAll } =
    usePatchStore();

  const [lastClickedDir, setLastClickedDir] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Keyboard shortcuts for multi-select
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A: Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
      }
      // Escape: Clear selection
      else if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectAll, clearSelection]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleToggle = (dir: string) => {
    // Simple toggle for checkbox clicks
    toggleSelection(dir);
    setLastClickedDir(dir);
  };

  const handleSelect = (dir: string, event: MouseEvent) => {
    if (event.shiftKey && lastClickedDir) {
      // Range selection: Shift + click
      selectRange(lastClickedDir, dir);
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle selection: Ctrl/Cmd + click
      toggleSelection(dir);
      setLastClickedDir(dir);
    } else {
      // Simple click on text: just toggle this item
      toggleSelection(dir);
      setLastClickedDir(dir);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (active.id !== over?.id) {
      const activeDir = active.id as string;
      const overDir = over?.id as string;

      // Check if we're dragging a selected item
      const isDraggingSelected = selectedPatchDirs.includes(activeDir);

      if (isDraggingSelected && selectedPatchDirs.length > 1) {
        // Batch move: move all selected items to the target position
        const selectedPatches = patches.filter(p => selectedPatchDirs.includes(p.dir));
        const unselectedPatches = patches.filter(p => !selectedPatchDirs.includes(p.dir));
        const targetIndex = patches.findIndex(p => p.dir === overDir);

        // Insert selected patches at the target position
        const newOrder = [...unselectedPatches];
        newOrder.splice(
          targetIndex <= patches.findIndex(p => p.dir === selectedPatches[0].dir)
            ? targetIndex
            : targetIndex - selectedPatches.length + 1,
          0,
          ...selectedPatches,
        );

        onReorder(newOrder);
      } else {
        // Single item move
        const oldIndex = patches.findIndex(p => p.dir === activeDir);
        const newIndex = patches.findIndex(p => p.dir === overDir);
        const newOrder = arrayMove(patches, oldIndex, newIndex);
        onReorder(newOrder);
      }
    }
  };

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3 p-2 bg-dark rounded">
        <div>
          <strong className="text-light">
            {selectedPatchDirs.length > 0 ? `${selectedPatchDirs.length} selected` : 'No selection'}
          </strong>
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={selectAll}
            disabled={selectedPatchDirs.length === patches.length}
          >
            Select All
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={clearSelection}
            disabled={selectedPatchDirs.length === 0}
          >
            Clear Selection
          </button>
        </div>
      </div>

      <ListGroup tag="div">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={patches.map(p => p.dir)} strategy={verticalListSortingStrategy}>
            {patches.map(patch => {
              const isSelected = selectedPatchDirs.includes(patch.dir);
              const isDragging =
                activeDragId !== null &&
                selectedPatchDirs.includes(activeDragId) &&
                isSelected &&
                patch.dir !== activeDragId;

              return (
                <PatchItem
                  key={patch.dir}
                  patch={patch}
                  isSelected={isSelected}
                  isDragging={isDragging}
                  onSelect={handleSelect}
                  onToggle={handleToggle}
                />
              );
            })}
          </SortableContext>
          <DragOverlay>
            {activeDragId ? (
              <div style={{ minWidth: '300px' }}>
                {selectedPatchDirs.includes(activeDragId) && selectedPatchDirs.length > 1 ? (
                  // Multi-select: show all selected patches
                  <div>
                    {patches
                      .filter(p => selectedPatchDirs.includes(p.dir))
                      .map((patch, index) => {
                        const patchName = patch.data.JamManPatch.PatchName?.[0] || '';
                        return (
                          <div
                            key={patch.dir}
                            className="list-group-item"
                            style={{
                              backgroundColor: 'rgba(13, 110, 253, 0.3)',
                              borderColor: '#0d6efd',
                              marginBottom: index < selectedPatchDirs.length - 1 ? '4px' : '0',
                              cursor: 'grabbing',
                            }}
                          >
                            <div className="d-flex align-items-center">
                              <Input
                                type="checkbox"
                                checked={true}
                                readOnly
                                className="me-2"
                                style={{ pointerEvents: 'none' }}
                              />
                              <div className="flex-grow-1">
                                <strong>{patch.dir}</strong>
                                {!!patchName && <small className="ms-2">{patchName}</small>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  // Single item: show just the one patch
                  (() => {
                    const patch = patches.find(p => p.dir === activeDragId);
                    if (!patch) return null;
                    const patchName = patch.data.JamManPatch.PatchName?.[0] || '';
                    return (
                      <div
                        className="list-group-item"
                        style={{
                          backgroundColor: 'rgba(13, 110, 253, 0.3)',
                          borderColor: '#0d6efd',
                          cursor: 'grabbing',
                        }}
                      >
                        <div className="d-flex align-items-center">
                          <div className="flex-grow-1">
                            <strong>{patch.dir}</strong>
                            {!!patchName && <small className="ms-2">{patchName}</small>}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </ListGroup>

      <div className="mt-3 text-muted small">
        <p className="mb-1">
          <strong>Multi-select tips:</strong>
        </p>
        <ul className="mb-0" style={{ paddingLeft: '1.2rem' }}>
          <li>Click checkboxes or patch names to toggle selections</li>
          <li>
            <kbd>Shift</kbd> + Click to select a range
          </li>
          <li>
            <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>A</kbd> to select all
          </li>
          <li>
            <kbd>Esc</kbd> to clear selection
          </li>
          <li>Drag any selected patch to move all selected patches together</li>
          <li>Selection clears automatically after reordering</li>
        </ul>
      </div>
    </>
  );
};
