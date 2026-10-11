import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap,
  type LngLatBounds,
  type PointLike,
} from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import busModelUrl from "../assets/bus.glb?url";
import { BusMotion } from "../busMotion";
import { palette } from "../theme";
import {
  bounceOffset,
  busBounce,
  previewCrowding,
  type CrowdingPreview,
} from "../lib/busBounce";
import {
  busKey,
  occupancy,
  type LiveBus,
  type MapRoute,
  type Route,
} from "../types";
import {
  disposeObject,
  LocalFrame,
  mapRenderer,
  materialsOf,
  metersPerPixel,
  renderInto,
} from "./localFrame";

const BUS_LENGTH_METERS = 12;
// At network zoom a bus is never drawn shorter than this many pixels.
const MIN_BUS_PIXELS = 32;
const SELECTED_BUS_SCALE = 1.2;

// Paint: the model's white and blue panels become Metro red, and every
// surface is kept matte enough to read well under the map's flat light.
const BUS_RED = parseInt(palette.bus.slice(1), 16);
const RECOLOURED_MATERIALS = new Set(["white", "blue"]);
const MIN_ROUGHNESS = 0.55;
const MAX_METALNESS = 0.35;

// Lighting: a sky/ground fill plus one sun from the south-west, high up.
const SKY_COLOR = 0xffffff;
const GROUND_COLOR = 0x71808e;
const FILL_INTENSITY = 2.2;
const SUN_COLOR = 0xffffff;
const SUN_INTENSITY = 2.5;
const SUN_POSITION: [number, number, number] = [-100, 200, 100];

// Discs under each bus, in model metres before the zoom scale. Unit circles
// stretched to size; lifted a hair off the ground so they don't flicker
// against it, with the shadow above the halo.
const DISC_SEGMENTS = 32;
const SHADOW_COLOR = parseInt(palette.ink.slice(1), 16);
const SHADOW_OPACITY = 0.16;
const SHADOW_HEIGHT = 0.03;
const SHADOW_SIZE: [number, number] = [1.65, 6.3];
const HALO_OPACITY = 0.16;
const SELECTED_HALO_OPACITY = 0.3;
const HALO_HEIGHT = 0.02;
const HALO_RADIUS = 8;

type BusInstance = {
  group: THREE.Group;
  bouncer: THREE.Group;
  shadow: THREE.Mesh;
  halo: THREE.Mesh;
  offset: number;
};

const BOUNCE_FRAME_MS = 33;
// How much smaller the shadow gets per metre the bus is off the road.
const SHADOW_SHRINK_PER_METER = 0.15;

function discMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

// A disc lying flat on the ground (circles are built standing up in XY).
function groundDisc(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  height: number,
): THREE.Mesh {
  const disc = new THREE.Mesh(geometry, material);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = height;
  return disc;
}

function repaint(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  if (RECOLOURED_MATERIALS.has(material.name)) material.color.setHex(BUS_RED);
  material.roughness = Math.max(material.roughness, MIN_ROUGHNESS);
  material.metalness = Math.min(material.metalness, MAX_METALNESS);
}

function prepareModel(model: THREE.Group): THREE.Group {
  const merged = mergeByMaterial(model);
  fitToBusLength(merged);
  // The downloaded model faces +Z; we want its front at -Z (north).
  const oriented = new THREE.Group();
  oriented.rotation.y = Math.PI;
  oriented.add(merged);
  return oriented;
}

function mergeByMaterial(model: THREE.Group): THREE.Group {
  model.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    originals.add(geometry);
    const materials = materialsOf(object);
    materials.forEach(repaint);
    // This asset has one material per mesh; keep that invariant explicit.
    if (materials.length !== 1)
      throw new Error("Bus model contains an unsupported multi-material mesh");
    const material = materials[0];
    const batch = batches.get(material) ?? [];
    batch.push(geometry.clone().applyMatrix4(object.matrixWorld));
    batches.set(material, batch);
  });
  const result = new THREE.Group();
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((item) => item.dispose());
    if (!geometry) throw new Error("Cannot merge bus model geometry");
    result.add(new THREE.Mesh(geometry, material));
  }
  originals.forEach((geometry) => geometry.dispose());
  return result;
}

function fitToBusLength(model: THREE.Group): void {
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = BUS_LENGTH_METERS / (bounds.max.z - bounds.min.z);
  model.scale.setScalar(scale);
  model.position.set(
    -center.x * scale,
    -bounds.min.y * scale,
    -center.z * scale,
  );
}

function busScaleAtZoom(zoom: number): number {
  return Math.max(
    1,
    (MIN_BUS_PIXELS * metersPerPixel(zoom)) / BUS_LENGTH_METERS,
  );
}

export class BusModelLayer implements CustomLayerInterface {
  readonly id = "metro-live-buses";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map?: LibreMap;
  private renderer?: THREE.WebGLRenderer;
  private template?: THREE.Group;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly frame = new LocalFrame();
  private readonly raycaster = new THREE.Raycaster();
  private readonly near = new THREE.Vector3();
  private readonly far = new THREE.Vector3();

  private readonly motion = new BusMotion();
  private readonly vehicles = new Map<string, BusInstance>();
  private readonly positions = new Map<string, [number, number]>();
  private selected = "";
  private reducedMotion = false;
  // Set once removed, so a model that finishes loading late is thrown away.
  private disposed = false;
  private nextBounce?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly crowdingPreview: CrowdingPreview | null = null,
  ) {}

  private readonly discGeometry = new THREE.CircleGeometry(1, DISC_SEGMENTS);
  private readonly shadowMaterial = discMaterial(SHADOW_COLOR, SHADOW_OPACITY);
  private readonly haloMaterial = discMaterial(BUS_RED, HALO_OPACITY);
  private readonly selectedHaloMaterial = discMaterial(
    BUS_RED,
    SELECTED_HALO_OPACITY,
  );

  onAdd(
    map: LibreMap,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
  ): void {
    this.map = map;
    this.renderer = mapRenderer(map, gl);
    this.addLights();
    this.loadModel(map);
  }

  setFixes(buses: LiveBus[], geometries: MapRoute[], routes: Route[]): void {
    this.motion.setRoutes(geometries, routes);
    this.motion.update(buses, performance.now());
    this.map?.triggerRepaint();
  }

  setSelected(key: string): void {
    this.selected = key;
    this.map?.triggerRepaint();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.map?.triggerRepaint();
  }

  setHaloColor(hex: string | null): void {
    this.haloMaterial.color.setHex(
      hex ? Number.parseInt(hex.slice(1), 16) : BUS_RED,
    );
    this.map?.triggerRepaint();
  }

  positionOf(key: string): [number, number] | undefined {
    return this.positions.get(key);
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput,
  ): void {
    const map = this.map;
    const template = this.template;
    if (!this.renderer || !map || !template) return;
    const { moving, bouncing } = this.placeBuses(
      template,
      busScaleAtZoom(map.getZoom()),
      map.getBounds(),
    );
    if (!this.vehicles.size) return;
    this.frame.updateCamera(this.camera, args);
    renderInto(this.renderer, this.scene, this.camera);
    if (this.reducedMotion) return;
    // Keep sampling while any bus is still moving; new fixes, selection and
    // camera changes trigger a repaint again once they settle.
    if (moving) map.triggerRepaint();
    else if (bouncing && this.nextBounce === undefined)
      this.nextBounce = setTimeout(() => {
        this.nextBounce = undefined;
        map.triggerRepaint();
      }, BOUNCE_FRAME_MS);
  }

  pick(point: PointLike): string | null {
    if (!this.map || !this.vehicles.size) return null;
    const p = Array.isArray(point) ? { x: point[0], y: point[1] } : point;
    const canvas = this.map.getCanvas();
    const x = (p.x / canvas.clientWidth) * 2 - 1;
    const y = 1 - (p.y / canvas.clientHeight) * 2;
    this.near.set(x, y, -1).applyMatrix4(this.camera.projectionMatrixInverse);
    this.far.set(x, y, 1).applyMatrix4(this.camera.projectionMatrixInverse);
    this.raycaster.set(this.near, this.far.sub(this.near).normalize());
    // The halo counts as part of the bus, giving small models a usable touch target.
    for (const hit of this.raycaster.intersectObjects(
      this.scene.children,
      true,
    )) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.busId) object = object.parent;
      if (object) return String(object.userData.busId);
    }
    return null;
  }

  onRemove(): void {
    this.disposed = true;
    clearTimeout(this.nextBounce);
    this.vehicles.clear();
    this.positions.clear();
    this.scene.clear();
    if (this.template) disposeObject(this.template);
    this.discGeometry.dispose();
    this.shadowMaterial.dispose();
    this.haloMaterial.dispose();
    this.selectedHaloMaterial.dispose();
    this.renderer?.dispose();
    this.map = undefined;
  }

  private addLights(): void {
    this.scene.add(
      new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, FILL_INTENSITY),
    );
    const sunlight = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sunlight.position.set(...SUN_POSITION);
    this.scene.add(sunlight);
  }

  private loadModel(map: LibreMap): void {
    void new GLTFLoader()
      .loadAsync(busModelUrl)
      .then((gltf) => {
        const template = prepareModel(gltf.scene);
        if (this.disposed) {
          disposeObject(template);
          return;
        }
        this.template = template;
        map.triggerRepaint();
      })
      .catch((error) => {
        if (!this.disposed)
          map.fire("error", {
            error: new Error("Unable to load the 3D bus model", {
              cause: error,
            }),
          });
      });
  }

  private placeBuses(
    template: THREE.Group,
    scale: number,
    bounds: LngLatBounds,
  ): { moving: boolean; bouncing: boolean } {
    const present = new Set<string>();
    let moving = false;
    let bouncing = false;
    const now = performance.now();
    for (const bus of this.motion.sample(now, this.reducedMotion)) {
      const key = busKey(bus);
      present.add(key);
      const previous = this.positions.get(key);
      if (!previous || previous[0] !== bus.lng || previous[1] !== bus.lat)
        moving = true;
      this.positions.set(key, [bus.lng, bus.lat]);
      const { group, bouncer, shadow, halo, offset } = this.instanceFor(
        key,
        template,
      );
      this.frame.toLocal(bus.lng, bus.lat, group.position);
      const crowding = previewCrowding(
        this.crowdingPreview,
        key,
        occupancy(bus)?.crowding ?? null,
      );
      const bounce = this.reducedMotion
        ? busBounce(null, now, offset)
        : busBounce(crowding, now, offset);
      bouncer.position.y = bounce.lift;
      bouncer.scale.set(
        bounce.grow * (1 + bounce.squash / 2),
        bounce.grow * (1 - bounce.squash),
        bounce.grow * (1 + bounce.squash / 2),
      );
      bouncer.rotation.set(0, bounce.wiggle, bounce.rock);
      const shrink = 1 - SHADOW_SHRINK_PER_METER * bounce.lift;
      shadow.scale.set(SHADOW_SIZE[0] * shrink, SHADOW_SIZE[1] * shrink, 1);
      if (
        !this.reducedMotion &&
        (crowding === "filling" || crowding === "crowded") &&
        bounds.contains([bus.lng, bus.lat])
      )
        bouncing = true;
      // Headings are clockwise from north; three.js turns anticlockwise.
      group.rotation.y = -THREE.MathUtils.degToRad(bus.heading ?? 0);
      const selected = key === this.selected;
      group.scale.setScalar(scale * (selected ? SELECTED_BUS_SCALE : 1));
      halo.material = selected ? this.selectedHaloMaterial : this.haloMaterial;
    }
    for (const [key, { group }] of this.vehicles) {
      if (present.has(key)) continue;
      this.scene.remove(group);
      this.vehicles.delete(key);
      this.positions.delete(key);
    }
    return { moving, bouncing };
  }

  private instanceFor(key: string, template: THREE.Group): BusInstance {
    const existing = this.vehicles.get(key);
    if (existing) return existing;
    const group = new THREE.Group();
    // pick() walks up from whatever was hit to find this.
    group.userData.busId = key;
    const bouncer = new THREE.Group();
    bouncer.add(template.clone(true));
    group.add(bouncer);
    const shadow = groundDisc(
      this.discGeometry,
      this.shadowMaterial,
      SHADOW_HEIGHT,
    );
    shadow.scale.set(...SHADOW_SIZE, 1);
    group.add(shadow);
    const halo = groundDisc(this.discGeometry, this.haloMaterial, HALO_HEIGHT);
    halo.scale.setScalar(HALO_RADIUS);
    group.add(halo);
    const instance = {
      group,
      bouncer,
      shadow,
      halo,
      offset: bounceOffset(key),
    };
    this.vehicles.set(key, instance);
    this.scene.add(group);
    return instance;
  }
}
