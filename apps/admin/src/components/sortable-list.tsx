import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, type ReactNode } from "react";

class DragProgress {
  hasMoved = false;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function announcementsFor(
  noun: string,
  total: number,
  nameOf: (id: UniqueIdentifier) => string,
  positionOf: (id: UniqueIdentifier) => number,
  progress: DragProgress,
): Announcements {
  const Noun = capitalize(noun);
  return {
    onDragStart: ({ active }) => {
      progress.hasMoved = false;
      return `Picked up ${noun} ${nameOf(active.id)}. It is in position ${positionOf(active.id)} of ${total}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!progress.hasMoved && over?.id === active.id) return undefined;
      progress.hasMoved = true;
      return over === null
        ? `${Noun} ${nameOf(active.id)} is no longer over the list.`
        : `${Noun} ${nameOf(active.id)} moved to position ${positionOf(over.id)} of ${total}.`;
    },
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${Noun} ${nameOf(active.id)} was dropped back in place.`
        : `${Noun} ${nameOf(active.id)} was dropped in position ${positionOf(over.id)} of ${total}.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${Noun} ${nameOf(active.id)} went back to position ${positionOf(active.id)} of ${total}.`,
  };
}

function screenReaderInstructionsFor(noun: string) {
  return {
    draggable: `To reorder, press Space or Enter to pick up the ${noun}, use the up and down arrow keys to move it, then press Space or Enter again to drop it, or Escape to cancel.`,
  };
}

export interface UseSortableListOptions {
  noun: string;
  total: number;
  nameOf: (id: UniqueIdentifier) => string;
  positionOf: (id: UniqueIdentifier) => number;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart?: () => void;
  onDragCancel?: () => void;
}

export interface SortableListControls {
  sensors: ReturnType<typeof useSensors>;
  liveRegion: ReactNode;
  accessibility: {
    announcements: Announcements;
    screenReaderInstructions: { draggable: string };
    container: HTMLElement | undefined;
  };
  onDragStart?: () => void;
  onDragCancel?: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export function useSortableList({
  noun,
  total,
  nameOf,
  positionOf,
  onDragEnd,
  onDragStart,
  onDragCancel,
}: UseSortableListOptions): SortableListControls {
  const [dragProgress] = useState(() => new DragProgress());
  const [liveRegionContainer, setLiveRegionContainer] = useState<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  return {
    sensors,
    liveRegion: <div ref={setLiveRegionContainer} />,
    accessibility: {
      announcements: announcementsFor(noun, total, nameOf, positionOf, dragProgress),
      screenReaderInstructions: screenReaderInstructionsFor(noun),
      container: liveRegionContainer ?? undefined,
    },
    onDragStart,
    onDragCancel,
    onDragEnd,
  };
}

export function SortableList({
  ids,
  controls,
  strategy,
  children,
}: {
  ids: UniqueIdentifier[];
  controls: SortableListControls;
  strategy: SortingStrategy;
  children: ReactNode;
}) {
  return (
    <>
      {controls.liveRegion}
      <DndContext
        sensors={controls.sensors}
        collisionDetection={closestCenter}
        accessibility={controls.accessibility}
        onDragStart={controls.onDragStart}
        onDragCancel={controls.onDragCancel}
        onDragEnd={controls.onDragEnd}
      >
        <SortableContext items={ids} strategy={strategy}>
          {children}
        </SortableContext>
      </DndContext>
    </>
  );
}

export interface SortableRowRenderProps {
  setNodeRef: (node: HTMLElement | null) => void;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  style: { transform: string | undefined; transition: string | undefined };
  isDragging: boolean;
}

export function SortableRow({
  id,
  disabled,
  children,
}: {
  id: UniqueIdentifier;
  disabled?: boolean;
  children: (props: SortableRowRenderProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return children({
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    style: { transform: CSS.Translate.toString(transform), transition },
    isDragging,
  });
}
