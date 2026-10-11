import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as LibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { StopStand, Wind } from "../occasions/types";
import {
  disposeObject,
  LocalFrame,
  mapRenderer,
  metersPerPixel,
  renderInto,
} from "./localFrame";

export type StandStop = {
  lngLat: [number, number];
  // Degrees clockwise from north, either way along the road; null off-road.
  roadBearing: number | null;
};

const STREET_ZOOM = 15;
const CITY_ZOOM = 12;
// Stands closer than this many model heights on screen hide the later one.
const STAND_SPACING = 1.6;
const GUST_WAVELENGTH_METERS = 900;
const FRAME_MS = 33;
const POLE_RADIUS = 0.035;
const ARM_RISE = 0.18;
// Ground stands sit this many model heights back from the stop, on the roadside.
const GROUND_SETBACK = 0.45;

type Stand = {
  group: THREE.Group;
  pivot: THREE.Group;
  stop: THREE.Vector3;
  toRoad: THREE.Vector2;
  wind: THREE.Vector2;
};

type Pole = {
  pole: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  tip: THREE.Vector3;
  material: THREE.Material;
};

function standScale(stand: StopStand, zoom: number): number {
  const t = THREE.MathUtils.clamp(
    (zoom - CITY_ZOOM) / (STREET_ZOOM - CITY_ZOOM),
    0,
    1,
  );
  const pixels = THREE.MathUtils.lerp(
    stand.pixels.city,
    stand.pixels.street,
    t,
  );
  return Math.max(stand.meters, pixels * metersPerPixel(zoom));
}

// A steady lean, gusts that roll across the map, and each stand's own swing.
function windTilt(
  wind: Wind,
  position: THREE.Vector3,
  index: number,
  now: number,
): number {
  const along =
    (position.x * wind.towards.x + position.z * wind.towards.z) /
    GUST_WAVELENGTH_METERS;
  const gust = 0.5 + 0.5 * Math.sin(now / 2600 - along * Math.PI * 2);
  const swing = Math.sin(now / 620 + index * 1.7) * (0.5 + gust);
  return wind.lean + wind.gust * gust * gust + wind.sway * swing;
}

// Across the road from the stand's pole; downwind when there's no road nearby.
function towardsRoad(
  roadBearing: number | null,
  wind: Wind | undefined,
): THREE.Vector2 {
  if (roadBearing === null)
    return wind
      ? new THREE.Vector2(wind.towards.x, wind.towards.z).normalize()
      : new THREE.Vector2(1, 0);
  const radians = THREE.MathUtils.degToRad(roadBearing);
  return new THREE.Vector2(Math.cos(radians), Math.sin(radians));
}

function buildPole(pole: NonNullable<StopStand["pole"]>): Pole {
  const top = new THREE.Vector3(0, pole.height * 0.96, 0);
  const tip = top.clone().add(new THREE.Vector3(pole.arm, ARM_RISE, 0));
  const direction = tip.clone().sub(top);
  const arm = new THREE.CylinderGeometry(
    POLE_RADIUS * 0.45,
    POLE_RADIUS * 0.6,
    direction.length(),
    6,
  )
    .translate(0, direction.length() / 2, 0)
    .applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      ),
    )
    .translate(top.x, top.y, top.z);
  return {
    pole: new THREE.CylinderGeometry(
      POLE_RADIUS * 0.8,
      POLE_RADIUS,
      pole.height,
      8,
    ).translate(0, pole.height / 2, 0),
    arm,
    tip,
    material: new THREE.MeshStandardMaterial({
      color: pole.color,
      roughness: 0.85,
    }),
  };
}

function disposePole(pole: Pole | undefined): void {
  pole?.pole.dispose();
  pole?.arm.dispose();
  pole?.material.dispose();
}

function sameStops(a: StandStop[], b: StandStop[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (stop, index) =>
        stop.lngLat[0] === b[index].lngLat[0] &&
        stop.lngLat[1] === b[index].lngLat[1] &&
        stop.roadBearing === b[index].roadBearing,
    )
  );
}

export class StandModelLayer implements CustomLayerInterface {
  readonly id = "metro-festive-stands";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map?: LibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly frame = new LocalFrame();

  private stand?: StopStand;
  private stops: StandStop[] = [];
  private variants: THREE.Object3D[] = [];
  private pole?: Pole;
  private stands: Stand[] = [];
  private loadingModel?: string;
  private readonly failedModels = new Set<string>();
  private reducedMotion = false;
  private nextFrame?: ReturnType<typeof setTimeout>;
  private disposed = false;

  onAdd(
    map: LibreMap,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
  ): void {
    this.map = map;
    this.renderer = mapRenderer(map, gl);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-100, 200, 100);
    this.scene.add(sun);
    this.rebuild();
  }

  show(stand: StopStand | undefined, stops: StandStop[]): void {
    const nextStops = stand ? stops : [];
    if (stand === this.stand && sameStops(nextStops, this.stops)) return;
    if (stand?.model !== this.stand?.model) this.dropModel();
    if (stand?.pole !== this.stand?.pole) {
      disposePole(this.pole);
      this.pole = stand?.pole ? buildPole(stand.pole) : undefined;
    }
    this.stand = stand;
    this.stops = nextStops;
    if (stand && nextStops.length) this.load(stand.model);
    this.rebuild();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.map?.triggerRepaint();
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput,
  ): void {
    const map = this.map;
    const stand = this.stand;
    if (!this.renderer || !map || !stand || !this.stands.length) return;
    const now = performance.now();
    const wind = this.reducedMotion ? undefined : stand.wind;
    const scale = standScale(stand, map.getZoom());
    const spacing = scale * STAND_SPACING;
    const reach = (this.pole ? stand.pole!.arm : GROUND_SETBACK) * scale;
    const shown: THREE.Vector3[] = [];
    this.stands.forEach(
      ({ group, pivot, stop, toRoad, wind: local }, index) => {
        group.visible = shown.every(
          (other) => other.distanceTo(stop) >= spacing,
        );
        if (!group.visible) return;
        shown.push(stop);
        group.scale.setScalar(scale);
        group.position.set(
          stop.x - toRoad.x * reach,
          0,
          stop.z - toRoad.y * reach,
        );
        const tilt = wind ? windTilt(wind, stop, index, now) : 0;
        pivot.rotation.set(-tilt * local.y, 0, tilt * local.x);
      },
    );
    this.frame.updateCamera(this.camera, args);
    renderInto(this.renderer, this.scene, this.camera);
    if (wind && this.onScreen(map)) this.scheduleFrame(map);
  }

  onRemove(): void {
    this.disposed = true;
    clearTimeout(this.nextFrame);
    this.scene.clear();
    this.dropModel();
    disposePole(this.pole);
    this.renderer?.dispose();
    this.map = undefined;
  }

  private onScreen(map: LibreMap): boolean {
    const bounds = map.getBounds();
    return this.stops.some((stop) => bounds.contains(stop.lngLat));
  }

  private scheduleFrame(map: LibreMap): void {
    if (this.nextFrame !== undefined) return;
    this.nextFrame = setTimeout(() => {
      this.nextFrame = undefined;
      map.triggerRepaint();
    }, FRAME_MS);
  }

  private dropModel(): void {
    this.variants.forEach(disposeObject);
    this.variants = [];
    this.loadingModel = undefined;
  }

  private load(model: string): void {
    if (
      this.variants.length ||
      this.loadingModel === model ||
      this.failedModels.has(model)
    )
      return;
    this.loadingModel = model;
    void new GLTFLoader()
      .loadAsync(model)
      .then((gltf) => {
        if (this.disposed || this.loadingModel !== model) {
          disposeObject(gltf.scene);
          return;
        }
        const root =
          gltf.scene.children.length === 1
            ? gltf.scene.children[0]
            : gltf.scene;
        this.variants = [...root.children];
        this.loadingModel = undefined;
        this.rebuild();
      })
      .catch((error: unknown) => {
        if (this.loadingModel === model) this.loadingModel = undefined;
        this.failedModels.add(model);
        console.warn("Festive decoration model failed to load", error);
      });
  }

  private rebuild(): void {
    for (const { group } of this.stands) this.scene.remove(group);
    this.stands = [];
    const stand = this.stand;
    if (stand && this.variants.length) {
      this.stops.forEach(({ lngLat: [lng, lat], roadBearing }, index) => {
        const toRoad = towardsRoad(roadBearing, stand.wind);
        const yaw = Math.atan2(-toRoad.y, toRoad.x);
        const group = new THREE.Group();
        group.rotation.y = yaw;
        if (this.pole) {
          group.add(new THREE.Mesh(this.pole.pole, this.pole.material));
          group.add(new THREE.Mesh(this.pole.arm, this.pole.material));
        }
        const pivot = new THREE.Group();
        if (this.pole) pivot.position.copy(this.pole.tip);
        const model = this.variants[index % this.variants.length].clone(true);
        model.rotation.y = index * 0.9;
        pivot.add(model);
        group.add(pivot);
        const stop = this.frame.toLocal(lng, lat);
        const towards = stand.wind?.towards ?? { x: 1, z: 0 };
        const wind = new THREE.Vector2(
          towards.x * Math.cos(yaw) - towards.z * Math.sin(yaw),
          towards.x * Math.sin(yaw) + towards.z * Math.cos(yaw),
        );
        group.position.copy(stop);
        this.scene.add(group);
        this.stands.push({ group, pivot, stop, toRoad, wind });
      });
    }
    this.map?.triggerRepaint();
  }
}
