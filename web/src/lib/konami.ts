export const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export function pushKey(recent: readonly string[], key: string): string[] {
  const normalised = key.length === 1 ? key.toLowerCase() : key;
  return [...recent, normalised].slice(-KONAMI.length);
}

export const isKonami = (recent: readonly string[]) =>
  recent.join() === KONAMI.join();

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, textarea, select"));

export function listenForKonami(onMatch: () => void) {
  let recent: string[] = [];
  document.addEventListener("keydown", (event) => {
    if (isTyping(event.target)) return;
    recent = pushKey(recent, event.key);
    if (!isKonami(recent)) return;
    recent = [];
    onMatch();
  });
}
