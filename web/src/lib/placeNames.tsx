import { useCallback } from "react";
import { useStopsByName } from "../state/TransitData";
import { placeName, stopName } from "../types";
import { useLanguage } from "./language";

// Route ends ("Makumbura", "COLOMBO FORT") only come in English, sometimes in
// capitals. Most are also stop names, and stops do have Sinhala and Tamil.

export function usePlaceName(): (name: string) => string {
  const stops = useStopsByName();
  const { language } = useLanguage();
  return useCallback(
    (name: string) => {
      const stop = stops.get(name.trim().toLowerCase());
      return stop ? stopName(stop, language) : placeName(name);
    },
    [stops, language],
  );
}
