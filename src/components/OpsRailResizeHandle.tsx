import { useCallback, useRef, type PointerEvent } from "react";
import { opsRailWidthForPointerDelta } from "../core/opsRailLayout";

type OpsRailResizeHandleProps = {
  width: number;
  onWidthChange: (width: number) => void;
};

export function OpsRailResizeHandle({ width, onWidthChange }: OpsRailResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) {
        return;
      }
      const deltaX = event.clientX - dragRef.current.startX;
      onWidthChange(opsRailWidthForPointerDelta(dragRef.current.startWidth, deltaX));
    },
    [onWidthChange],
  );

  return (
    <div
      className="ops-rail-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    />
  );
}
