import { useCallback, useRef } from "react";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import type { HomeSearch } from "./routes/index";

/**
 * A view kept in the URL (`?map=1`, `?trip=1`) so the browser's Back button
 * closes it. Opening pushes a history entry; closing pops the entry we
 * pushed, so Back never reopens it.
 */
export function useSearchFlag(key: keyof HomeSearch) {
  const navigate = useNavigate({ from: "/" });
  const router = useRouter();
  const on = useSearch({ from: "/" })[key] === 1;
  const pushed = useRef(false);
  const set = useCallback(
    (open: boolean) => {
      const isOpen =
        new URLSearchParams(window.location.search).get(key) === "1";
      if (open === isOpen) return;
      if (open) {
        pushed.current = true;
        void navigate({ search: (prev) => ({ ...prev, [key]: 1 }) });
      } else if (pushed.current) {
        pushed.current = false;
        router.history.back();
      } else {
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
