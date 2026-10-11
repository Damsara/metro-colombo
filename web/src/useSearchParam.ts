import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

export function useSearchParam(key: "journey" | "ride") {
  const navigate = useNavigate({ from: "/" });
  const value = useSearch({ from: "/" })[key];
  const set = useCallback(
    (next: string | null) =>
      navigate({
        search: (previous) => {
          const { [key]: _, ...rest } = previous;
          return next === null ? rest : { ...rest, [key]: next };
        },
        replace: true,
      }),
    [key, navigate],
  );
  return [value, set] as const;
}
