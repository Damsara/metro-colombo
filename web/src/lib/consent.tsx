import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  analyticsAvailable,
  initAnalytics,
  stopAnalytics,
  trackPage,
} from "./analytics";

export type ConsentChoice = "granted" | "denied";

// Bump the version when what we collect, or why, changes so everyone is asked again.
const STORAGE_KEY = "metro.analytics-consent.v1";

export function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function saveConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private mode: the choice lasts this visit.
  }
}

interface Consent {
  available: boolean;
  choice: ConsentChoice | null;
  asking: boolean;
  allow: () => void;
  decline: () => void;
  reopen: () => void;
  dismiss: () => void;
}

const ConsentContext = createContext<Consent | null>(null);

export function ConsentProvider({
  measurementId,
  children,
}: {
  measurementId: string | undefined;
  children: ReactNode;
}) {
  const available = analyticsAvailable(measurementId);
  const [choice, setChoice] = useState<ConsentChoice | null>(() => {
    const saved = available ? readConsent() : null;
    if (saved === "granted") initAnalytics(measurementId);
    return saved;
  });
  const [reopened, setReopened] = useState(false);

  const decide = useCallback(
    (next: ConsentChoice) => {
      saveConsent(next);
      setChoice(next);
      setReopened(false);
      if (next === "granted") {
        initAnalytics(measurementId);
        trackPage(window.location.pathname);
      } else {
        stopAnalytics(measurementId);
      }
    },
    [measurementId],
  );

  const value = useMemo<Consent>(
    () => ({
      available,
      choice,
      asking: available && (choice === null || reopened),
      allow: () => decide("granted"),
      decline: () => decide("denied"),
      reopen: () => setReopened(true),
      dismiss: () => setReopened(false),
    }),
    [available, choice, reopened, decide],
  );
  return <ConsentContext value={value}>{children}</ConsentContext>;
}

export function useConsent(): Consent {
  const consent = useContext(ConsentContext);
  if (!consent) throw new Error("useConsent needs a ConsentProvider");
  return consent;
}
