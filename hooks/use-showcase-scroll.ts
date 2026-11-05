"use client";

import { useEffect, useRef } from "react";

/** Keep native touch/keyboard scrolling and distinguish a drag from a card click. */
export function useShowcaseScroll(cardCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let drag: { id: number; x: number; left: number; moved: boolean } | null =
      null;
    let suppressClick = false;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const distance =
        delta *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientWidth
            : 1);
      const next = Math.max(
        0,
        Math.min(
          element.scrollWidth - element.clientWidth,
          element.scrollLeft + distance
        )
      );
      if (Math.abs(next - element.scrollLeft) < 0.5) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    const down = (event: PointerEvent) => {
      suppressClick = false;
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        element.scrollWidth <= element.clientWidth
      )
        return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        left: element.scrollLeft,
        moved: false
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientX - drag.x) < 6) return;
      drag.moved = true;
      suppressClick = true;
      element.dataset.dragging = "true";
      if (!element.hasPointerCapture(event.pointerId))
        element.setPointerCapture(event.pointerId);
      element.scrollLeft = drag.left - (event.clientX - drag.x);
      event.preventDefault();
    };
    const end = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      delete element.dataset.dragging;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const preventImageDrag = (event: DragEvent) => event.preventDefault();
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    element.addEventListener("lostpointercapture", end);
    element.addEventListener("click", click, true);
    element.addEventListener("dragstart", preventImageDrag);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      element.removeEventListener("lostpointercapture", end);
      element.removeEventListener("click", click, true);
      element.removeEventListener("dragstart", preventImageDrag);
      delete element.dataset.dragging;
    };
  }, [cardCount]);
  return ref;
}
