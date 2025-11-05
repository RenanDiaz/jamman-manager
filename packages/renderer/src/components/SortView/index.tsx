import { FC, useState, useMemo } from 'react';
import {
  Button,
  ButtonGroup,
  Col,
  Container,
  Input,
  InputGroup,
  InputGroupText,
  ListGroup,
  Row,
} from 'reactstrap';
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
import { Patch } from '../../types';

interface SortViewProps {
  patches: Patch[];
  onApply: (newOrder: Patch[]) => void;
  onCancel: () => void;
}

interface SortablePatchItemProps {
  patch: Patch;
  isModified: boolean;
  originalIndex: number;
}

const SortablePatchItem: FC<SortablePatchItemProps> = ({ patch, isModified, originalIndex }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: patch.dir,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  const patchName = patch.data.JamManPatch.PatchName?.[0] || 'Unnamed';

  return (
    <div
      ref={setNodeRef}
      className="list-group-item d-flex align-items-center justify-content-between"
      style={style}
      {...attributes}
      {...listeners}
    >
      <div className="d-flex align-items-center gap-2">
        <span className="text-muted">::</span>
        <div>
          <strong>{patch.dir}</strong>
          <small className="ms-2 text-muted">{patchName}</small>
        </div>
      </div>
      {isModified && (
        <span className="badge bg-warning text-dark" style={{ fontSize: '0.7rem' }}>
          Moved from #{originalIndex + 1}
        </span>
      )}
    </div>
  );
};

export const SortView: FC<SortViewProps> = ({ patches, onApply, onCancel }) => {
  const [workingOrder, setWorkingOrder] = useState<Patch[]>(patches);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState<string>('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Track which patches have been moved
  const modifiedPatches = useMemo(() => {
    const modified = new Set<string>();
    workingOrder.forEach((patch, index) => {
      const originalIndex = patches.findIndex(p => p.dir === patch.dir);
      if (originalIndex !== index) {
        modified.add(patch.dir);
      }
    });
    return modified;
  }, [workingOrder, patches]);

  // Filter patches based on search
  const filteredPatches = useMemo(() => {
    if (!searchQuery.trim()) return workingOrder;

    const query = searchQuery.toLowerCase();
    return workingOrder.filter(patch => {
      const patchName = patch.data.JamManPatch.PatchName?.[0] || '';
      return patch.dir.toLowerCase().includes(query) || patchName.toLowerCase().includes(query);
    });
  }, [workingOrder, searchQuery]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = workingOrder.findIndex(p => p.dir === active.id);
      const newIndex = workingOrder.findIndex(p => p.dir === over?.id);
      setWorkingOrder(arrayMove(workingOrder, oldIndex, newIndex));
      setSelectedSort('custom');
    }
  };

  const handleQuickSort = (sortType: string) => {
    setSelectedSort(sortType);
    let sorted = [...workingOrder];

    switch (sortType) {
      case 'az':
        sorted.sort((a, b) => {
          const nameA = a.data.JamManPatch.PatchName?.[0] || '';
          const nameB = b.data.JamManPatch.PatchName?.[0] || '';
          return nameA.localeCompare(nameB);
        });
        break;
      case 'za':
        sorted.sort((a, b) => {
          const nameA = a.data.JamManPatch.PatchName?.[0] || '';
          const nameB = b.data.JamManPatch.PatchName?.[0] || '';
          return nameB.localeCompare(nameA);
        });
        break;
      case 'number':
        sorted.sort((a, b) => {
          const numA = parseInt(a.dir.replace('Patch', ''), 10);
          const numB = parseInt(b.dir.replace('Patch', ''), 10);
          return numA - numB;
        });
        break;
      case 'bpm':
        sorted.sort((a, b) => {
          const bpmA = parseInt(a.phrases[0]?.data?.JamManPhrase?.BeatsPerMinute?.[0] || '120', 10);
          const bpmB = parseInt(b.phrases[0]?.data?.JamManPhrase?.BeatsPerMinute?.[0] || '120', 10);
          return bpmA - bpmB;
        });
        break;
      case 'reverse':
        sorted.reverse();
        break;
      default:
        break;
    }

    setWorkingOrder(sorted);
  };

  const handleReset = () => {
    setWorkingOrder([...patches]);
    setSelectedSort('');
    setSearchQuery('');
  };

  const hasChanges = useMemo(() => {
    return workingOrder.some((patch, index) => patches[index].dir !== patch.dir);
  }, [workingOrder, patches]);

  return (
    <Container fluid style={{ height: '100vh', overflow: 'hidden' }}>
      <Row className="h-100">
        {/* Header */}
        <Col xs={12} className="py-3 border-bottom bg-dark">
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <h3 className="mb-1">Sort Patches</h3>
              <small className="text-muted">
                Drag patches to reorder or use quick sort options
              </small>
            </div>
            <div className="d-flex gap-2">
              <Button color="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button color="primary" onClick={() => onApply(workingOrder)} disabled={!hasChanges}>
                Apply Changes
              </Button>
            </div>
          </div>
        </Col>

        {/* Main Content */}
        <Col xs={12} style={{ height: 'calc(100vh - 100px)', overflow: 'auto' }}>
          <Row className="h-100 g-3 p-3">
            {/* Left Panel: Quick Sort Options & Original Order */}
            <Col md={4} className="d-flex flex-column gap-3">
              {/* Quick Sort Options */}
              <div className="bg-dark p-3 rounded">
                <h5 className="mb-3">Quick Sort</h5>
                <div className="d-flex flex-column gap-2">
                  <ButtonGroup vertical>
                    <Button
                      color={selectedSort === 'az' ? 'primary' : 'outline-primary'}
                      onClick={() => handleQuickSort('az')}
                      className="text-start"
                    >
                      A → Z (by name)
                    </Button>
                    <Button
                      color={selectedSort === 'za' ? 'primary' : 'outline-primary'}
                      onClick={() => handleQuickSort('za')}
                      className="text-start"
                    >
                      Z → A (by name)
                    </Button>
                    <Button
                      color={selectedSort === 'number' ? 'primary' : 'outline-primary'}
                      onClick={() => handleQuickSort('number')}
                      className="text-start"
                    >
                      By Patch Number
                    </Button>
                    <Button
                      color={selectedSort === 'bpm' ? 'primary' : 'outline-primary'}
                      onClick={() => handleQuickSort('bpm')}
                      className="text-start"
                    >
                      By BPM (first phrase)
                    </Button>
                    <Button
                      color={selectedSort === 'reverse' ? 'primary' : 'outline-primary'}
                      onClick={() => handleQuickSort('reverse')}
                      className="text-start"
                    >
                      Reverse Order
                    </Button>
                  </ButtonGroup>
                  <Button color="warning" outline onClick={handleReset} size="sm">
                    Reset to Original
                  </Button>
                </div>
              </div>

              {/* Original Order Reference */}
              <div className="bg-dark p-3 rounded flex-grow-1" style={{ overflow: 'auto' }}>
                <h5 className="mb-3">Original Order (Reference)</h5>
                <ListGroup>
                  {patches.map((patch, index) => {
                    const patchName = patch.data.JamManPatch.PatchName?.[0] || 'Unnamed';
                    return (
                      <div key={patch.dir} className="list-group-item">
                        <div className="d-flex align-items-center justify-content-between">
                          <div>
                            <strong>{patch.dir}</strong>
                            <small className="ms-2 text-muted">{patchName}</small>
                          </div>
                          <span className="badge bg-secondary">#{index + 1}</span>
                        </div>
                      </div>
                    );
                  })}
                </ListGroup>
              </div>
            </Col>

            {/* Right Panel: Working Order */}
            <Col md={8} className="d-flex flex-column gap-3">
              {/* Search/Filter */}
              <div>
                <InputGroup>
                  <InputGroupText>🔍</InputGroupText>
                  <Input
                    type="text"
                    placeholder="Search patches by name or number..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <Button color="secondary" onClick={() => setSearchQuery('')}>
                      Clear
                    </Button>
                  )}
                </InputGroup>
                {searchQuery && (
                  <small className="text-muted">
                    Showing {filteredPatches.length} of {workingOrder.length} patches
                  </small>
                )}
              </div>

              {/* Status */}
              <div className="d-flex align-items-center justify-content-between p-2 bg-dark rounded">
                <div>
                  {hasChanges ? (
                    <span className="text-warning">
                      ⚠️ {modifiedPatches.size} patches will be reordered
                    </span>
                  ) : (
                    <span className="text-muted">No changes made</span>
                  )}
                </div>
                {selectedSort && (
                  <span className="badge bg-info">
                    Sort: {selectedSort === 'custom' ? 'Custom' : selectedSort.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Working Order List */}
              <div className="bg-dark p-3 rounded flex-grow-1" style={{ overflow: 'auto' }}>
                <h5 className="mb-3">Working Order</h5>
                <ListGroup>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={filteredPatches.map(p => p.dir)}
                      strategy={verticalListSortingStrategy}
                    >
                      {filteredPatches.map(patch => {
                        const originalIndex = patches.findIndex(p => p.dir === patch.dir);
                        const isModified = modifiedPatches.has(patch.dir);

                        return (
                          <SortablePatchItem
                            key={patch.dir}
                            patch={patch}
                            isModified={isModified}
                            originalIndex={originalIndex}
                          />
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                </ListGroup>
              </div>
            </Col>
          </Row>
        </Col>
      </Row>
    </Container>
  );
};
