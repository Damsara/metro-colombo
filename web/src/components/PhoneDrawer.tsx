import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import { cycleSnap, SNAPS, type Snap } from "../lib/drawerSnap";

// A press that moves further than this is a drag, not a tap.
const TAP_SLOP_PX = 8;

export function PhoneDrawer({
  label,
  snap,
  heights,
  viewport,
  onSnapChange,
  children,
}: {
  label: string;
  snap: Snap;
  heights: Record<Snap, number>;
  viewport: number;
  onSnapChange: (snap: Snap) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const stateId = useId();
  const previous = useRef<Snap | null>(null);
  const shown = useRef(snap);
  useEffect(() => {
    if (shown.current === snap) return;
    previous.current = shown.current;
    shown.current = snap;
  }, [snap]);
  // Radix adds focus guards around the page for its dialogs; a drawer that
  // never traps focus doesn't need them as extra stops in the Tab order.
  useEffect(() => {
    document
      .querySelectorAll<HTMLElement>("[data-radix-focus-guard]")
      .forEach((guard) => (guard.tabIndex = -1));
  }, []);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Vaul re-snaps whenever this array changes identity, so keep it stable.
  const points = useMemo(
    () => SNAPS.map((name) => `${heights[name]}px`),
    [heights.peek, heights.half, heights.full],
  );

  const change = (next: Snap) => {
    if (next !== snap) onSnapChange(next);
  };
  const stateText = {
    peek: t`Panel: minimised`,
    half: t`Panel: half height`,
    full: t`Panel: full height`,
  }[snap];

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      noBodyStyles
      repositionInputs={false}
      snapPoints={points}
      // There's no overlay, so nothing dims the map. Fading "from" the lowest
      // snap keeps Vaul's fade maths from blocking a fling down from full.
      fadeFromIndex={0}
      activeSnapPoint={points[SNAPS.indexOf(snap)]}
      setActiveSnapPoint={(point) => {
        const index = points.indexOf(String(point));
        if (index >= 0) change(SNAPS[index]);
      }}
    >
      {/* Vaul never tells Radix it isn't modal, so on its own the content traps
          focus and hides the header and map from screen readers. A non-modal
          dialog root closer in takes over. */}
      <Dialog.Root open modal={false}>
        <Drawer.Content
          role="region"
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-30 flex flex-col rounded-t-2xl border-t border-line bg-paper shadow-[0_-6px_24px_#211d1922] outline-none"
          style={{ height: viewport, paddingBottom: viewport - heights.full }}
          // Drags that start on a button must not end up pressing it.
          onPointerDownCapture={(event) => {
            press.current = {
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
          }}
          onPointerMoveCapture={(event) => {
            const start = press.current;
            if (
              start &&
              Math.hypot(event.clientX - start.x, event.clientY - start.y) >
                TAP_SLOP_PX
            )
              start.moved = true;
          }}
          onClickCapture={(event) => {
            // Keyboard clicks (detail 0) are never drags.
            if (event.detail === 0 || !press.current?.moved) return;
            press.current = null;
            event.preventDefault();
            event.stopPropagation();
          }}
          // Tabbing to something below the screen brings the whole panel up.
          onFocusCapture={(event) => {
            if (snap === "full") return;
            const bottom = event.target.getBoundingClientRect().bottom;
            if (bottom > window.innerHeight) change("full");
          }}
        >
          <Drawer.Title className="sr-only">{label}</Drawer.Title>
          <button
            type="button"
            className="relative grid h-11 w-full shrink-0 cursor-grab place-items-center rounded-t-2xl focus-visible:outline-offset-[-4px] active:cursor-grabbing"
            aria-label={t`Drag to resize`}
            aria-describedby={stateId}
            onClick={() => change(cycleSnap(snap, previous.current))}
          >
            <span
              className="h-1 w-9 rounded-full bg-stripe"
              aria-hidden="true"
            />
          </button>
          <span id={stateId} className="sr-only" role="status">
            {stateText}
          </span>
          {children}
        </Drawer.Content>
      </Dialog.Root>
    </Drawer.Root>
  );
}
