import { FC, useMemo, useState } from 'react';
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
import {
  DisplayWindow,
  Field,
  Grip,
  Input,
  Led,
  Legend,
  Panel,
  PanelKey,
  Pill,
  Plate,
  SevenSegment,
  cx,
} from '../../ui';
import { slotNumber } from '../../utils/format';
import s from './SortView.module.css';

interface SortViewProps {
  patches: Patch[];
  onApply: (newOrder: Patch[]) => void;
  onCancel: () => void;
}

interface SortablePatchItemProps {
  patch: Patch;
  isModified: boolean;
  /** 1-based position in the working order: the slot the patch gets on apply. */
  position: number;
}

const SortablePatchItem: FC<SortablePatchItemProps> = ({ patch, isModified, position }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: patch.dir,
  });

  const patchName = patch.data.JamManPatch.PatchName?.[0] || '';
  const targetSlot = String(position).padStart(2, '0');

  return (
    <Plate
      ref={setNodeRef}
      className={s.plate}
      lifted={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${patchName || 'Untitled'}, ${patch.dir}, goes to slot ${targetSlot}`}
    >
      <Grip />
      <DisplayWindow>
        <SevenSegment value={targetSlot} height={24} />
      </DisplayWindow>
      <span className={s.text}>
        <span className={s.name}>{patchName || 'Untitled'}</span>
        <span className={s.meta}>{patch.dir}</span>
      </span>
      {isModified && <Pill>was {slotNumber(patch.dir)}</Pill>}
    </Plate>
  );
};

const QUICK_SORTS: Array<{ value: string; label: string }> = [
  { value: 'az', label: 'Name A–Z' },
  { value: 'za', label: 'Name Z–A' },
  { value: 'number', label: 'Slot number' },
  { value: 'bpm', label: 'Tempo (first phrase)' },
  { value: 'reverse', label: 'Reverse' },
];

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
    const sorted = [...workingOrder];

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

  const moving = modifiedPatches.size;

  return (
    <div className={s.view}>
      <Panel as="header" screws="all" className={s.header}>
        <DisplayWindow>
          <SevenSegment value={String(Math.min(moving, 99)).padStart(2, '0')} height={34} />
        </DisplayWindow>
        <div className={s.status}>
          <Led color="yellow" on={hasChanges} />
          <Legend tone={hasChanges ? 'default' : 'muted'}>Moving</Legend>
        </div>
        <div className={s.brand}>
          <h1 className={s.title}>Reorder patches</h1>
          <p className={s.lede}>
            Drag patches into the order you want. Applying renumbers them from Patch01.
          </p>
        </div>
        <div className={s.toolbar}>
          <PanelKey label="Cancel" onClick={onCancel} />
          <PanelKey
            label="Apply order"
            led={hasChanges}
            onClick={() => onApply(workingOrder)}
            disabled={!hasChanges}
          />
        </div>
      </Panel>

      <main className={s.main}>
        <Panel as="aside" screws="top" className={s.side}>
          <section className={s.group} aria-labelledby="quick-sort-heading">
            <h2 id="quick-sort-heading" className={s.heading}>
              Quick sort
            </h2>
            <div className={s.quick}>
              {QUICK_SORTS.map(sort => (
                <PanelKey
                  key={sort.value}
                  label={sort.label}
                  led={selectedSort === sort.value}
                  aria-pressed={selectedSort === sort.value}
                  className={s.quickKey}
                  onClick={() => handleQuickSort(sort.value)}
                />
              ))}
            </div>
            <PanelKey label="Back to current order" size="sm" onClick={handleReset} />
          </section>

          <section className={cx(s.group, s.reference)} aria-labelledby="current-order-heading">
            <h2 id="current-order-heading" className={s.heading}>
              Current order
            </h2>
            <ol className={s.refList}>
              {patches.map(patch => (
                <li key={patch.dir}>
                  <span className={s.refSlot}>{slotNumber(patch.dir)}</span>
                  <span className={s.refName}>
                    {patch.data.JamManPatch.PatchName?.[0] || 'Untitled'}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </Panel>

        <section className={s.work} aria-labelledby="new-order-heading">
          <Panel className={s.searchBar}>
            <h2 id="new-order-heading" className={s.heading}>
              New order
            </h2>
            <Field label="Search" htmlFor="sort-search" className={s.search}>
              <Input
                id="sort-search"
                type="search"
                placeholder="Name or patch number"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <span className={s.count} role="status">
              {searchQuery
                ? `${filteredPatches.length} of ${workingOrder.length} shown`
                : hasChanges
                  ? `${moving} ${moving === 1 ? 'patch moves' : 'patches move'}`
                  : 'No changes yet'}
            </span>
          </Panel>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredPatches.map(p => p.dir)}
              strategy={verticalListSortingStrategy}
            >
              <ol className={s.list}>
                {filteredPatches.map(patch => (
                  <SortablePatchItem
                    key={patch.dir}
                    patch={patch}
                    isModified={modifiedPatches.has(patch.dir)}
                    position={workingOrder.indexOf(patch) + 1}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </section>
      </main>
    </div>
  );
};
