import { boundsCorners, clipPolygon, closestPointOnSegment, polygonArea } from '../content/polygon';
import { OrthographicCamera, Raycaster, Vector2, Vector3 } from 'three';
import { cameraContract as contract } from '../assets/camera-contract';
import {
  heightAt,
  heightBreakpoints,
  surfaceGradient,
  type AreaDefinition,
  type Point,
} from '../content/world';
const a = (contract.azimuthDeg * Math.PI) / 180,
  e = (contract.elevationDeg * Math.PI) / 180;
export const outward = new Vector3(
  Math.sin(a) * Math.cos(e),
  Math.sin(e),
  Math.cos(a) * Math.cos(e),
);
export const right = new Vector3(Math.cos(a), 0, -Math.sin(a));
export const up = new Vector3().crossVectors(outward, right);
export function makeCamera(aspect: number, target = new Vector3()) {
  const h = contract.verticalSpan / 2;
  const camera = new OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.1, 100);
  camera.position.copy(target).addScaledVector(outward, 30);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return camera;
}
export function resizeCamera(
  camera: OrthographicCamera,
  width: number,
  height: number,
  span = contract.verticalSpan,
) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) return;
  const half = span / 2;
  camera.left = (-half * width) / height;
  camera.right = (half * width) / height;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
}
/** Solve scene coverage and silhouette framing together. Coverage always wins. */
export function constrainCamera(
  camera: OrthographicCamera,
  target: Vector3,
  area: AreaDefinition,
  focus?: { position: Vector3; height: number },
) {
  const groundHeight = heightAt(area, target.x, target.z) - 0.01,
    boundary = area.sceneBoundary ?? area.playableBoundary ?? boundsCorners(area.bounds),
    project = (p: Vector3): Point => ({ x: p.dot(right), z: p.dot(up) }),
    floor = boundary.map((p) => project(new Vector3(p.x, groundHeight, p.z))),
    desired = project(target),
    halfWidth = (camera.right - camera.left) / 2,
    halfHeight = (camera.top - camera.bottom) / 2,
    foot = focus && project(focus.position),
    silhouette = (focus?.height ?? 0) * up.y,
    inset = (scale: number, frameHero: boolean) => {
      let polygon = floor;
      // A viewport fits only if all four corners remain on the painted floor.
      for (const x of [-halfWidth * scale, halfWidth * scale])
        for (const z of [-halfHeight * scale, halfHeight * scale])
          polygon = clipPolygon(
            polygon,
            floor.map((p) => ({ x: p.x - x, z: p.z - z })),
          );
      if (frameHero && foot) {
        const bounds = {
          minX: foot.x - halfWidth * scale + 0.75,
          maxX: foot.x + halfWidth * scale - 0.75,
          minZ: foot.z + silhouette - halfHeight * scale + Math.max(0.3, halfHeight * scale * 0.24),
          maxZ: foot.z + halfHeight * scale - 0.3,
        };
        if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) return [];
        polygon = clipPolygon(polygon, boundsCorners(bounds));
      }
      return polygon;
    };
  // The focus imposes a minimum viewport size. Its feasible scales form an
  // interval; find the largest one that also fits inside the scene.
  const minimum =
      Math.max(
        0.75 / halfWidth,
        (silhouette + 0.6) / (2 * halfHeight),
        (silhouette + 0.3) / (1.76 * halfHeight),
      ) *
      (1 + 1e-8),
    frameHero = !!focus && minimum <= 1 && inset(minimum, true).length > 0;
  let scale = 1,
    polygon = inset(scale, frameHero);
  if (!polygon.length) {
    let low = frameHero ? minimum : 0,
      high = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (inset(mid, frameHero).length) low = mid;
      else high = mid;
    }
    scale = low * (1 - 1e-8);
    polygon = inset(scale, frameHero);
  }
  camera.zoom = 1 / scale;
  camera.updateProjectionMatrix();
  const within =
    Math.abs(polygonArea(polygon)) > 1e-12 && clipPolygon([desired], polygon).length > 0;
  if (within) return;
  let closest = desired,
    distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p = closestPointOnSegment(desired, polygon[i]!, polygon[(i + 1) % polygon.length]!),
      d = Math.hypot(p.x - desired.x, p.z - desired.z);
    if (d < distance) {
      closest = p;
      distance = d;
    }
  }
  target.addScaledVector(right, closest.x - desired.x);
  target.addScaledVector(
    up.clone().addScaledVector(outward, -up.y / outward.y),
    closest.z - desired.z,
  );
}
export function drawingBufferSize(
  width: number,
  height: number,
  dpr: number,
  scale = contract.renderScale,
) {
  if (
    !Number.isFinite(width + height + dpr + scale) ||
    width <= 0 ||
    height <= 0 ||
    dpr <= 0 ||
    scale <= 0 ||
    scale > 1
  )
    throw new Error('invalid drawing-buffer dimensions');
  // Fill physical display pixels where possible, with a bounded 1440p budget.
  // Apply the user's quality reduction after choosing the full-resolution ratio.
  const pixelRatio = Math.min(
    dpr,
    contract.pixelRatioCap,
    contract.baseline.width / width,
    contract.baseline.height / height,
  );
  return {
    width: Math.max(1, Math.floor(width * pixelRatio * scale)),
    height: Math.max(1, Math.floor(height * pixelRatio * scale)),
    pixelRatio,
  };
}
function pointerRay(
  camera: OrthographicCamera,
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
) {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(clientX + clientY)) return null;
  const ray = new Raycaster();
  ray.setFromCamera(
    new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    ),
    camera,
  );
  return ray.ray;
}
export function groundPoint(
  camera: OrthographicCamera,
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
) {
  const ray = pointerRay(camera, clientX, clientY, rect);
  if (!ray || !ray.direction.y) return null;
  const t = -ray.origin.y / ray.direction.y;
  return t >= 0 ? ray.at(t, new Vector3()) : null;
}
export function walkablePoint(
  camera: OrthographicCamera,
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  area: AreaDefinition,
) {
  const ray = pointerRay(camera, clientX, clientY, rect);
  if (!ray) return null;
  const start = ray.at(camera.near, new Vector3()),
    end = ray.at(camera.far, new Vector3()),
    cuts = [0, ...heightBreakpoints(area, start, end, []), 1].sort((a, b) => a - b),
    delta = end.clone().sub(start);
  // Each interval is one flat tread or linear ramp. Intersect it exactly;
  // bisection across height jumps can invent a floor halfway up a riser.
  for (let i = 1; i < cuts.length; i++) {
    const low = cuts[i - 1]!,
      high = cuts[i]!;
    if (low === high) continue;
    const middle = start.clone().addScaledVector(delta, (low + high) / 2),
      gradient = surfaceGradient(area, middle.x, middle.z),
      slope = delta.y - gradient.x * delta.x - gradient.z * delta.z,
      t = (low + high) / 2 + (heightAt(area, middle.x, middle.z) - middle.y) / slope;
    if (t >= low && t <= high) return start.clone().addScaledVector(delta, t);
  }
  return null;
}
export function screenMovement(
  x: number,
  y: number,
  mode: 'screen-relative' | 'world' = 'screen-relative',
) {
  const length = Math.max(1, Math.hypot(x, y));
  return mode === 'world'
    ? { x: x / length, z: -y / length }
    : { x: (right.x * x - Math.sin(a) * y) / length, z: (right.z * x - Math.cos(a) * y) / length };
}
