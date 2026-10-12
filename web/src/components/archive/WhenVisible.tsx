import { useEffect, useRef, useState, type ReactNode } from "react";

// Each chart runs its own query, so it waits until a reader scrolls near it.
export function WhenVisible({ children }: { children: ReactNode }) {
  const marker = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = marker.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return <div ref={marker}>{seen ? children : null}</div>;
}
