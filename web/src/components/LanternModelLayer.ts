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
const MIN_LANTERN_PIXELS = 44;
const HANG_ABOVE_GROUND = 1.35;
// The south-west monsoon: lanterns lean towards the north-east.
const WIND_TOWARDS = new THREE.Vector2(1, -1).normalize();
const LEAN_RADIANS = 0.07;
const GUST_RADIANS = 0.09;
const SWAY_RADIANS = 0.06;
const GUST_WAVELENGTH_METERS = 900;
const FRAME_MS = 33;

function lanternScaleAtZoom(zoom: number): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_METERS * Math.cos((ORIGIN[1] * Math.PI) / 180)) /
    (WORLD_PIXELS_AT_ZOOM_0 * 2 ** zoom);
  return Math.max(LANTERN_METERS, MIN_LANTERN_PIXELS * metersPerPixel);
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

  private stops: [number, number][] = [];
  private lanterns: THREE.Group[] = [];
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
    if (!this.renderer || !map || !this.lanterns.length) return;
    const now = performance.now();
    const windy = !this.reducedMotion;
    const scale = lanternScaleAtZoom(map.getZoom());
    this.lanterns.forEach((lantern, index) => {
      lantern.scale.setScalar(scale);
      lantern.position.y = scale * (1 + HANG_ABOVE_GROUND);
      const tilt = windy ? windTilt(lantern.position, index, now) : 0;
      lantern.rotation.set(-tilt * WIND_TOWARDS.y, 0, tilt * WIND_TOWARDS.x);
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

  onRemove(): void {
    this.disposed = true;
    clearTimeout(this.nextFrame);
    this.scene.clear();
    this.templates.forEach(dispose);
    this.renderer?.dispose();
    this.map = undefined;
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
    for (const lantern of this.lanterns) this.scene.remove(lantern);
    this.lanterns = [];
    if (this.templates.length) {
      this.stops.forEach(([lng, lat], index) => {
        const coordinate = MercatorCoordinate.fromLngLat({ lng, lat });
        const lantern = new THREE.Group();
        const model = this.templates[index % this.templates.length].clone(true);
        model.rotation.y = index * 0.9;
        lantern.add(model);
        lantern.position.set(
          (coordinate.x - this.origin.x) / this.meter,
          0,
          (coordinate.y - this.origin.y) / this.meter,
        );
        this.scene.add(lantern);
        this.lanterns.push(lantern);
      });
    }
    this.map?.triggerRepaint();
  }
}
