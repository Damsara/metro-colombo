import { useCallback, useMemo, useState } from "react";
import { useOccasions } from "../api";
import {
  colomboDate,
  festiveOff,
  markMomentPlayed,
  parseOccasionKind,
  setFestiveOff,
  shouldPlayMoment,
  todaysOccasion,
} from "../lib/occasions";
import { useMediaQuery } from "../lib/useMediaQuery";
import { browserStore, playedThisLoad } from "./festive";
import { themeFor } from "./themes";

export function useOccasion() {
  const { data } = useOccasions();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [off, setOff] = useState(() => festiveOff(browserStore()));
  const preview = parseOccasionKind(
    new URLSearchParams(window.location.search).get("occasion"),
  );
  const occasion = useMemo(
    () => todaysOccasion(data ?? [], colomboDate(new Date()), preview),
    [data, preview],
  );
  const theme = occasion && !off ? themeFor(occasion.kind) : null;
  const [playMoment, setPlayMoment] = useState(true);
  const canPlay =
    playMoment &&
    !reduced &&
    !!theme?.moment &&
    !!occasion &&
    shouldPlayMoment(browserStore(), occasion, playedThisLoad);
  const momentDone = useCallback(() => {
    if (occasion) markMomentPlayed(browserStore(), occasion, playedThisLoad);
    setPlayMoment(false);
  }, [occasion]);
  const turnOff = useCallback(() => {
    setFestiveOff(browserStore(), true);
    setOff(true);
  }, []);
  return { occasion, theme, playMoment: canPlay, momentDone, turnOff };
}
