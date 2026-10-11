import { useEffect, useState, type RefObject } from "react";

/** `window.innerHeight`, the height Vaul measures its snap points against. */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return height;
}

export function useSafeAreaBottom(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)";
    document.body.append(probe);
    const update = () =>
      setInset(parseFloat(getComputedStyle(probe).paddingBottom) || 0);
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      probe.remove();
    };
  }, []);
  return inset;
}

export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setHeight(element.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
