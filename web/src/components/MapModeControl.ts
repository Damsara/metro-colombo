import type maplibregl from "maplibre-gl";
import type { MapMode } from "../lib/mapCamera";

type Labels = (mode: MapMode) => { aria: string; title: string };

export class MapModeControl implements maplibregl.IControl {
  private container: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;

  constructor(
    private mode: MapMode,
    private labels: Labels,
    private onToggle: () => void,
  ) {}

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    // Shares the live-bus toggle's look: muted when off, brand when pressed.
    this.button.className = "map-live-toggle-ctrl";
    this.button.style.fontSize = "12px";
    this.button.style.fontWeight = "700";
    this.button.textContent = "3D";
    this.button.addEventListener("click", this.onToggle);
    this.container.appendChild(this.button);
    this.update(this.mode);
    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.onToggle);
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
    this.button = null;
  }

  update(mode: MapMode): void {
    this.mode = mode;
    if (!this.button) return;
    const { aria, title } = this.labels(mode);
    this.button.setAttribute("aria-pressed", String(mode === "3d"));
    this.button.setAttribute("aria-label", aria);
    this.button.setAttribute("title", title);
  }

  setLabels(labels: Labels): void {
    this.labels = labels;
    this.update(this.mode);
  }
}
