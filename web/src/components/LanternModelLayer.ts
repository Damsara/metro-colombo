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
const SWAY_RADIANS = 0.08;
const SWAY_MS = 10_000;

function lanternScaleAtZoom(zoom: number): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_METERS * Math.cos((ORIGIN[1] * Math.PI) / 180)) /
    (WORLD_PIXELS_AT_ZOOM_0 * 2 ** zoom);
  return Math.max(LANTERN_METERS, MIN_LANTERN_PIXELS * metersPerPixel);
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
  private swayUntil = 0;

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
    this.swayUntil = performance.now() + SWAY_MS;
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
    const swaying = !this.reducedMotion && now < this.swayUntil;
    const scale = lanternScaleAtZoom(map.getZoom());
    this.lanterns.forEach((lantern, index) => {
      lantern.scale.setScalar(scale);
      lantern.position.y = scale * (1 + HANG_ABOVE_GROUND);
      const fade = swaying ? (this.swayUntil - now) / SWAY_MS : 0;
      lantern.rotation.z =
        Math.sin(now / 700 + index * 1.7) * SWAY_RADIANS * fade;
    });
    this.projection.fromArray(args.defaultProjectionData.mainMatrix);
    this.camera.projectionMatrix
      .copy(this.projection)
      .multiply(this.localToMercator);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    if (swaying) map.triggerRepaint();
  }

  onRemove(): void {
    this.disposed = true;
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
        lantern.add(this.templates[index % this.templates.length].clone(true));
        lantern.position.set(
          (coordinate.x - this.origin.x) / this.meter,
          0,
          (coordinate.y - this.origin.y) / this.meter,
        );
        lantern.rotation.y = index * 0.9;
        this.scene.add(lantern);
        this.lanterns.push(lantern);
      });
    }
    this.map?.triggerRepaint();
  }
}
