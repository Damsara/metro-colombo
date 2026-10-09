import { useEffect, useRef } from "react";

/**
 * The phone's full-screen map: moves focus into it and back out to the button
 * that opened it, and nudges MapLibre to resize once it's visible.
 */
export function useFullScreenMap(open: boolean) {
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) backButtonRef.current?.focus();
    else if (wasOpen.current) openButtonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return { openButtonRef, backButtonRef };
}
