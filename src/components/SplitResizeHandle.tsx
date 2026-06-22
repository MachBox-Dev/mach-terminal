import { useCallback, useRef, type PointerEvent } from "react";
import type { SplitDirection } from "../state/splitTree";

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

type SplitResizeHandleProps = {
  direction: SplitDirection;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onDragEnd?: () => void;
};

export function SplitResizeHandle({ direction, ratio, onRatioChange, onDragEnd }: SplitResizeHandleProps) {
  const dragRef = useRef<{
    startCoord: number;
    startRatio: number;
    containerSize: number;
    ratio: number;
  } | null>(null);

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      onDragEnd?.();
    }
    dragRef.current = null;
  }, [onDragEnd]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const container = event.currentTarget.parentElement;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const containerSize = direction === "column" ? rect.width : rect.height;
      dragRef.current = {
        startCoord: direction === "column" ? event.clientX : event.clientY,
        startRatio: ratio,
        containerSize,
        ratio,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [direction],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) {
        return;
      }
      const coord = direction === "column" ? event.clientX : event.clientY;
      const delta = coord - dragRef.current.startCoord;
      const size = Math.max(1, dragRef.current.containerSize);
      const next = dragRef.current.startRatio + delta / size;
      const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, next));
      dragRef.current.ratio = clamped;
      onRatioChange(clamped);
    },
    [direction, onRatioChange],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onRatioChange(0.5);
    },
    [onRatioChange],
  );

  return (
    <div
      className={`split-resize-handle split-resize-handle-${direction}`}
      role="separator"
      aria-orientation={direction === "column" ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onDoubleClick}
    />
  );
}
