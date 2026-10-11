import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import lanternsUrl from "../assets/occasions/vesak-lanterns.glb?url";

const ORIGIN: [number, number] = [79.8612, 6.9271];
const EARTH_CIRCUMFERENCE_METERS = 40075016.686;
const WORLD_PIXELS_AT_ZOOM_0 = 512;

const LANTERN_METERS = 9;
const STREET_ZOOM = 15;
const CITY_ZOOM = 12;
const STREET_LANTERN_PIXELS = 44;
const CITY_LANTERN_PIXELS = 20;
// Stands closer than this many lantern heights on screen hide the later one.
const STAND_SPACING = 1.6;
// The south-west monsoon: lanterns lean towards the north-east.
const WIND_TOWARDS = new THREE.Vector2(1, -1).normalize();
const LEAN_RADIANS = 0.07;
const GUST_RADIANS = 0.09;
const SWAY_RADIANS = 0.06;
const GUST_WAVELENGTH_METERS = 900;
const FRAME_MS = 33;

// A bamboo pole beside the stop, in lantern heights.
const POLE_HEIGHT = 2.6;
const POLE_RADIUS = 0.035;
const ARM_LENGTH = 0.55;
const ARM_RISE = 0.18;
const BAMBOO = 0xc8a464;

type Stand = { group: THREE.Group; pivot: THREE.Group };

function lanternScaleAtZoom(zoom: number): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_METERS * Math.cos((ORIGIN[1] * Math.PI) / 180)) /
    (WORLD_PIXELS_AT_ZOOM_0 * 2 ** zoom);
  const t = THREE.MathUtils.clamp(
    (zoom - CITY_ZOOM) / (STREET_ZOOM - CITY_ZOOM),
    0,
    1,
  );
  const pixels = THREE.MathUtils.lerp(
    CITY_LANTERN_PIXELS,
    STREET_LANTERN_PIXELS,
    t,
  );
  return Math.max(LANTERN_METERS, pixels * metersPerPixel);
}

// A steady lean, gusts that roll across the map, and each lantern's own swing.
function windTilt(position: THREE.Vector3, index: number, now: number): number {
  const along =
    (position.x * WIND_TOWARDS.x - position.z * WIND_TOWARDS.y) /
    GUST_WAVELENGTH_METERS;
  const gust = 0.5 + 0.5 * Math.sin(now / 2600 - along * Math.PI * 2);
  const swing = Math.sin(now / 620 + index * 1.7) * (0.5 + gust);
  return LEAN_RADIANS + GUST_RADIANS * gust * gust + SWAY_RADIANS * swing;
}

function dispose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function poleParts(): {
  pole: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  tip: THREE.Vector3;
} {
  const pole = new THREE.CylinderGeometry(
    POLE_RADIUS * 0.8,
    POLE_RADIUS,
    POLE_HEIGHT,
    8,
  ).translate(0, POLE_HEIGHT / 2, 0);
  const top = new THREE.Vector3(0, POLE_HEIGHT * 0.96, 0);
  const tip = top
    .clone()
    .add(
      new THREE.Vector3(
        WIND_TOWARDS.x * ARM_LENGTH,
        ARM_RISE,
        WIND_TOWARDS.y * ARM_LENGTH,
      ),
    );
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
  return { pole, arm, tip };
}

export class LanternModelLayer implements CustomLayerInterface {
  readonly id = "metro-festive-lanterns";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map?: LibreMap;
  private renderer?: THREE.WebGLRenderer;
  private templates: THREE.Object3D[] = [];
  private loading = false;
  private disposed = false;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly origin = MercatorCoordinate.fromLngLat(ORIGIN);
  private readonly meter = this.origin.meterInMercatorCoordinateUnits();
  private readonly localToMercator = new THREE.Matrix4()
    .makeTranslation(this.origin.x, this.origin.y, 0)
    .scale(new THREE.Vector3(this.meter, -this.meter, this.meter))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  private readonly projection = new THREE.Matrix4();
  private readonly parts = poleParts();
  private readonly bamboo = new THREE.MeshStandardMaterial({
    color: BAMBOO,
    roughness: 0.85,
  });

  private stops: [number, number][] = [];
  private stands: Stand[] = [];
  private reducedMotion = false;
  private nextFrame?: ReturnType<typeof setTimeout>;

  onAdd(
    map: LibreMap,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
  ): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
    });
    this.renderer.autoClear = false;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-100, 200, 100);
    this.scene.add(sun);
    this.rebuild();
  }

  setStops(stops: [number, number][]): void {
    this.stops = stops;
    if (stops.length) this.load();
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
    if (!this.renderer || !map || !this.stands.length) return;
    const now = performance.now();
    const windy = !this.reducedMotion;
    const scale = lanternScaleAtZoom(map.getZoom());
    const spacing = scale * STAND_SPACING;
    const shown: THREE.Vector3[] = [];
    this.stands.forEach(({ group, pivot }, index) => {
      group.visible = shown.every(
        (other) => other.distanceTo(group.position) >= spacing,
      );
      if (!group.visible) return;
      shown.push(group.position);
      group.scale.setScalar(scale);
      const tilt = windy ? windTilt(group.position, index, now) : 0;
      pivot.rotation.set(-tilt * WIND_TOWARDS.y, 0, tilt * WIND_TOWARDS.x);
    });
    this.projection.fromArray(args.defaultProjectionData.mainMatrix);
    this.camera.projectionMatrix
      .copy(this.projection)
      .multiply(this.localToMercator);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    if (windy && this.onScreen(map)) this.scheduleFrame(map);
  }

  onRemove(): void {
    this.disposed = true;
    clearTimeout(this.nextFrame);
    this.scene.clear();
    this.templates.forEach(dispose);
    this.parts.pole.dispose();
    this.parts.arm.dispose();
    this.bamboo.dispose();
    this.renderer?.dispose();
    this.map = undefined;
  }

  private onScreen(map: LibreMap): boolean {
    const bounds = map.getBounds();
    return this.stops.some((stop) => bounds.contains(stop));
  }

  private scheduleFrame(map: LibreMap): void {
    if (this.nextFrame !== undefined) return;
    this.nextFrame = setTimeout(() => {
      this.nextFrame = undefined;
      map.triggerRepaint();
    }, FRAME_MS);
  }

  private load(): void {
    if (this.loading || this.templates.length) return;
    this.loading = true;
    void new GLTFLoader()
      .loadAsync(lanternsUrl)
      .then((gltf) => {
        if (this.disposed) {
          dispose(gltf.scene);
          return;
        }
        const root = gltf.scene.getObjectByName("VesakLanterns") ?? gltf.scene;
        this.templates = [...root.children];
        this.rebuild();
      })
      .catch((error) => {
        this.loading = false;
        this.map?.fire("error", {
          error: new Error("Unable to load the Vesak lanterns", {
            cause: error,
          }),
        });
      });
  }

  private rebuild(): void {
    for (const { group } of this.stands) this.scene.remove(group);
    this.stands = [];
    if (this.templates.length) {
      this.stops.forEach(([lng, lat], index) => {
        const coordinate = MercatorCoordinate.fromLngLat({ lng, lat });
        const group = new THREE.Group();
        group.add(new THREE.Mesh(this.parts.pole, this.bamboo));
        group.add(new THREE.Mesh(this.parts.arm, this.bamboo));
        const pivot = new THREE.Group();
        pivot.position.copy(this.parts.tip);
        const model = this.templates[index % this.templates.length].clone(true);
        model.rotation.y = index * 0.9;
        pivot.add(model);
        group.add(pivot);
        group.position.set(
          (coordinate.x - this.origin.x) / this.meter,
          0,
          (coordinate.y - this.origin.y) / this.meter,
        );
        this.scene.add(group);
        this.stands.push({ group, pivot });
      });
    }
    this.map?.triggerRepaint();
  }
}
