import { useCallback, useEffect } from "react";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import type { HomeSearch } from "./routes/index";

// Flags whose history entries we pushed, oldest first. Only the newest can be
// closed by going back; popping an older one would close the wrong view.
const pushed: (keyof HomeSearch)[] = [];
// Flags closed out of order. Their older history entries still carry them, so
// going back would quietly reopen the view; strip them when that happens.
const dismissed = new Set<keyof HomeSearch>();

export function useSearchFlag(key: keyof HomeSearch) {
  const navigate = useNavigate({ from: "/" });
  const router = useRouter();
  const on = useSearch({ from: "/" })[key] === 1;

  useEffect(() => {
    // The browser's own Back closed it.
    if (!on && pushed.includes(key)) pushed.splice(pushed.indexOf(key), 1);
    if (on && dismissed.has(key)) {
      dismissed.delete(key);
      void navigate({
        search: ({ [key]: _, ...rest }) => rest,
        replace: true,
      });
    }
  }, [on, key, navigate]);

  const set = useCallback(
    (open: boolean) => {
      const isOpen =
        new URLSearchParams(window.location.search).get(key) === "1";
      if (open === isOpen) return;
      if (open) {
        dismissed.delete(key);
        pushed.push(key);
        void navigate({ search: (prev) => ({ ...prev, [key]: 1 }) });
      } else if (pushed.at(-1) === key) {
        pushed.pop();
        router.history.back();
      } else {
        if (pushed.includes(key)) {
          pushed.splice(pushed.indexOf(key), 1);
          dismissed.add(key);
        }
        void navigate({
          search: ({ [key]: _, ...rest }) => rest,
          replace: true,
        });
      }
    },
    [key, navigate, router],
  );
  return [on, set] as const;
}
