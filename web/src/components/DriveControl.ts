import type maplibregl from "maplibre-gl";

type Labels = (driving: boolean) => string;

const WHEEL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7"/><path d="M10 12H3.5"/><path d="M14 12h6.5"/></svg>';

export class DriveControl implements maplibregl.IControl {
  private container: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private visible = false;
  private driving = false;

  constructor(
    private labels: Labels,
    private onToggle: () => void,
  ) {}

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "map-live-toggle-ctrl";
    this.button.innerHTML = WHEEL_ICON;
    this.button.addEventListener("click", this.onToggle);
    this.container.appendChild(this.button);
    this.update(this.visible, this.driving);
    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.onToggle);
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
    this.button = null;
  }

  update(visible: boolean, driving: boolean): void {
    this.visible = visible;
    this.driving = driving;
    if (!this.container || !this.button) return;
    this.container.hidden = !visible;
    const label = this.labels(driving);
    this.button.setAttribute("aria-pressed", String(driving));
    this.button.setAttribute("aria-label", label);
    this.button.setAttribute("title", label);
  }

  setLabels(labels: Labels): void {
    this.labels = labels;
    this.update(this.visible, this.driving);
  }
}
