import {
  MercatorCoordinate,
  type CustomRenderMethodInput,
  type Map as LibreMap,
} from "maplibre-gl";
import * as THREE from "three";

// Colombo; 3D scenes work in metres from here.
export const ORIGIN: [number, number] = [79.8612, 6.9271];
const EARTH_CIRCUMFERENCE_METERS = 40075016.686;
// MapLibre's whole world is this many pixels wide at zoom 0.
const WORLD_PIXELS_AT_ZOOM_0 = 512;

export function metersPerPixel(zoom: number): number {
  return (
    (EARTH_CIRCUMFERENCE_METERS * Math.cos((ORIGIN[1] * Math.PI) / 180)) /
    (WORLD_PIXELS_AT_ZOOM_0 * 2 ** zoom)
  );
}

// Local metres around ORIGIN (x east, y up, z south), because Mercator units are tiny and float32 would make models jitter.
export class LocalFrame {
  readonly origin = MercatorCoordinate.fromLngLat(ORIGIN);
  readonly meter = this.origin.meterInMercatorCoordinateUnits();
  private readonly localToMercator = new THREE.Matrix4()
    .makeTranslation(this.origin.x, this.origin.y, 0)
    .scale(new THREE.Vector3(this.meter, -this.meter, this.meter))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  private readonly projection = new THREE.Matrix4();

  toLocal(lng: number, lat: number, target = new THREE.Vector3()) {
    const coordinate = MercatorCoordinate.fromLngLat({ lng, lat });
    return target.set(
      (coordinate.x - this.origin.x) / this.meter,
      0,
      (coordinate.y - this.origin.y) / this.meter,
    );
  }

  // The projection goes straight from local metres to clip space, so the camera itself stays at the identity.
  updateCamera(camera: THREE.Camera, args: CustomRenderMethodInput): void {
    this.projection.fromArray(args.defaultProjectionData.mainMatrix);
    camera.projectionMatrix
      .copy(this.projection)
      .multiply(this.localToMercator);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}

export function mapRenderer(
  map: LibreMap,
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: map.getCanvas(),
    context: gl,
  });
  renderer.autoClear = false;
  return renderer;
}

export function renderInto(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  renderer.resetState();
  renderer.render(scene, camera);
  renderer.resetState();
}

export function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of materialsOf(object)) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
