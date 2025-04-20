import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FC } from "react";
import { Patch } from "../../types";
import { ListGroup } from "reactstrap";

interface Props {
  patches: Patch[];
  onReorder: (newOrder: Patch[]) => void;
}

const PatchItem: FC<{ patch: Patch }> = ({ patch }) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: patch.dir,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: "grab",
  };

  const patchName = patch.data.JamManPatch.PatchName?.[0] || "";

  return (
    <div
      ref={setNodeRef}
      className="list-group-item"
      style={style}
      {...attributes}
      {...listeners}
    >
      <div className="d-flex align-items-center">
        <strong>{patch.dir}</strong>
        {!!patchName && <small className="ms-2">{patchName}</small>}
      </div>
    </div>
  );
};

export const PatchList: FC<Props> = ({ patches, onReorder }) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = patches.findIndex((p) => p.dir === active.id);
      const newIndex = patches.findIndex((p) => p.dir === over?.id);
      const newOrder = arrayMove(patches, oldIndex, newIndex);
      onReorder(newOrder);
    }
  };

  return (
    <ListGroup tag="div">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={patches.map((p) => p.dir)}
          strategy={verticalListSortingStrategy}
        >
          {patches.map((patch) => (
            <PatchItem key={patch.dir} patch={patch} />
          ))}
        </SortableContext>
      </DndContext>
    </ListGroup>
  );
};
