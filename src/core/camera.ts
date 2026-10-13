import { cameraCalibration, HEADINGS } from '../assets/camera-calibration';
import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { cameraContract as contract } from '../assets/camera-contract';
import { heightAt, type AreaDefinition, type Point } from '../content/world';
export { contract };
export { HEADINGS };
export type Heading = (typeof HEADINGS)[number];
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
/** Fit the ground-plane viewport inside the convex movement boundary. */
export function constrainCamera(camera: OrthographicCamera, target: Vector3, area: AreaDefinition) {
  const boundary = area.playableBoundary;
  if (
    !boundary ||
    (boundary.length === 4 &&
      boundary.every((a, i) => {
        const b = boundary[(i + 1) % 4]!,
          c = boundary[(i + 2) % 4]!;
        return Math.abs((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) < 1e-8;
      }))
  ) {
    constrainRectangularCamera(camera, target, area);
    return;
  }
  const corners = boundary,
    halfWidth = (camera.right - camera.left) / 2,
    halfHeight = (camera.top - camera.bottom) / 2,
    groundUp = up.clone().addScaledVector(outward, -up.y / outward.y),
    edges = corners.map((a, i) => {
      const next = corners[(i + 1) % corners.length]!,
        length = Math.hypot(next.x - a.x, next.z - a.z),
        x = (a.z - next.z) / length,
        z = (next.x - a.x) / length;
      return {
        x,
        z,
        d: x * a.x + z * a.z,
        extent:
          Math.abs(right.x * x + right.z * z) * halfWidth +
          Math.abs(groundUp.x * x + groundUp.z * z) * halfHeight,
      };
    }),
    // Clip possible viewport centers against each edge inset by the viewport's
    // projected extent. This also handles triangles and nonrectangular quads.
    inset = (scale: number) => {
      let polygon: readonly Point[] = corners;
      for (const edge of edges) {
        const clipped: Point[] = [],
          distance = (p: Point) => edge.x * p.x + edge.z * p.z - edge.d - edge.extent * scale;
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i]!,
            next = polygon[(i + 1) % polygon.length]!,
            da = distance(a),
            db = distance(next);
          if (da >= 0) clipped.push(a);
          if (da >= 0 !== db >= 0) {
            const t = da / (da - db);
            clipped.push({ x: a.x + (next.x - a.x) * t, z: a.z + (next.z - a.z) * t });
          }
        }
        polygon = clipped;
      }
      return polygon;
    };
  let scale = 1;
  if (!inset(scale).length) {
    let low = 0,
      high = 1;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      if (inset(mid).length) low = mid;
      else high = mid;
    }
    scale = low * (1 - 1e-10);
  }
  camera.zoom = 1 / scale;
  camera.updateProjectionMatrix();
  // The rendered floor sits 1 cm below the logical walking surface.
  const groundHeight = heightAt(area, target.x, target.z) - 0.01,
    offset = (target.y - groundHeight) / outward.y,
    center = { x: target.x - outward.x * offset, z: target.z - outward.z * offset };
  if (edges.every((e) => e.x * center.x + e.z * center.z >= e.d + e.extent * scale)) return;
  const polygon = inset(scale);
  let closest = center,
    distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      next = polygon[(i + 1) % polygon.length]!,
      dx = next.x - a.x,
      dz = next.z - a.z,
      lengthSquared = dx * dx + dz * dz,
      t = lengthSquared
        ? Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.z - a.z) * dz) / lengthSquared))
        : 0,
      p = { x: a.x + dx * t, z: a.z + dz * t },
      d = Math.hypot(p.x - center.x, p.z - center.z);
    if (d < distance) {
      closest = p;
      distance = d;
    }
  }
  target.x = closest.x + outward.x * offset;
  target.z = closest.z + outward.z * offset;
}
function constrainRectangularCamera(
  camera: OrthographicCamera,
  target: Vector3,
  area: AreaDefinition,
) {
  const b = area.bounds,
    corners = area.playableBoundary ?? [
      { x: b.minX, z: b.minZ },
      { x: b.maxX, z: b.minZ },
      { x: b.maxX, z: b.maxZ },
      { x: b.minX, z: b.maxZ },
    ],
    origin = corners[0]!,
    edge = corners[1]!,
    opposite = corners[3]!,
    width = Math.hypot(edge.x - origin.x, edge.z - origin.z),
    depth = Math.hypot(opposite.x - origin.x, opposite.z - origin.z),
    u = { x: (edge.x - origin.x) / width, z: (edge.z - origin.z) / width },
    v = { x: (opposite.x - origin.x) / depth, z: (opposite.z - origin.z) / depth },
    halfWidth = (camera.right - camera.left) / 2,
    halfHeight = (camera.top - camera.bottom) / 2,
    // Project screen up onto the ground along the viewing ray.
    groundUp = up.clone().addScaledVector(outward, -up.y / outward.y),
    extent = (axis: { x: number; z: number }) =>
      Math.abs(right.x * axis.x + right.z * axis.z) * halfWidth +
      Math.abs(groundUp.x * axis.x + groundUp.z * axis.z) * halfHeight,
    spanU = extent(u),
    spanV = extent(v),
    scale = Math.min(1, width / (2 * spanU), depth / (2 * spanV));
  camera.zoom = 1 / scale;
  camera.updateProjectionMatrix();
  // The rendered floor sits 1 cm below the logical walking surface.
  const groundHeight = heightAt(area, target.x, target.z) - 0.01,
    offset = (target.y - groundHeight) / outward.y,
    x = target.x - outward.x * offset - origin.x,
    z = target.z - outward.z * offset - origin.z,
    clamp = (value: number, span: number, size: number) =>
      Math.max(span * scale, Math.min(size - span * scale, value)),
    alongU = clamp(x * u.x + z * u.z, spanU, width),
    alongV = clamp(x * v.x + z * v.z, spanV, depth);
  target.x = origin.x + alongU * u.x + alongV * v.x + outward.x * offset;
  target.z = origin.z + alongU * u.z + alongV * v.z + outward.z * offset;
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
export function groundPoint(
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
  return ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
}
export function walkablePoint(
  camera: OrthographicCamera,
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  area: AreaDefinition,
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
  let low = 0,
    high = 100;
  const distance = (t: number) => {
    const x = ray.ray.origin.x + ray.ray.direction.x * t,
      z = ray.ray.origin.z + ray.ray.direction.z * t,
      y = ray.ray.origin.y + ray.ray.direction.y * t;
    return y - heightAt(area, x, z);
  };
  if (distance(low) < 0 || distance(high) > 0) return null;
  for (let i = 0; i < 36; i++) {
    const mid = (low + high) / 2;
    if (distance(mid) > 0) low = mid;
    else high = mid;
  }
  return ray.ray.at((low + high) / 2, new Vector3());
}
export function selectDirection(yaw: number, previous?: Heading, hysteresis = 0.045): Heading {
  if (!Number.isFinite(yaw)) throw new Error('direction yaw must be finite');
  const tau = Math.PI * 2,
    step = tau / 8,
    angle = ((yaw % tau) + tau) % tau;
  if (previous) {
    const p = HEADINGS.indexOf(previous) * step;
    const delta = Math.abs(Math.atan2(Math.sin(angle - p), Math.cos(angle - p)));
    if (delta < step / 2 + hysteresis) return previous;
  }
  return HEADINGS[Math.floor(angle / step + 0.5 + 1e-12) % 8]!; // ties go toward increasing heading
}
export function screenMovement(
  x: number,
  y: number,
  mode: 'screen-relative' | 'world' = 'screen-relative',
) {
  const v =
    mode === 'world'
      ? new Vector3(x, 0, -y)
      : right
          .clone()
          .multiplyScalar(x)
          .add(new Vector3(-Math.sin(a), 0, -Math.cos(a)).multiplyScalar(y));
  if (v.lengthSq() > 1) v.normalize();
  return { x: v.x, z: v.z };
}
export function trimmedBounds(
  canvas: { density: number; anchor: readonly number[] },
  trim: readonly number[],
) {
  const [x, y, w, h] = trim as [number, number, number, number],
    [ax, ay] = canvas.anchor as [number, number];
  return {
    left: (x - ax) / canvas.density,
    right: (x + w - ax) / canvas.density,
    top: (ay - y) / canvas.density,
    bottom: (ay - y - h) / canvas.density,
  };
}
export function calibrationFixture() {
  return cameraCalibration(contract);
}

export const AUTHORED_HEADINGS = ['d00', 'd90', 'd180', 'd270'] as const;
export type AuthoredHeading = (typeof AUTHORED_HEADINGS)[number];
export function selectAuthoredDirection(yaw: number, previous?: Heading): AuthoredHeading {
  if (!Number.isFinite(yaw)) throw new Error('direction yaw must be finite');
  const step = Math.PI / 2,
    angle = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (previous && AUTHORED_HEADINGS.some((h) => h === previous)) {
    const p = (HEADINGS.indexOf(previous) * Math.PI) / 4;
    if (Math.abs(Math.atan2(Math.sin(angle - p), Math.cos(angle - p))) < step / 2 + 0.045)
      return previous as AuthoredHeading;
  }
  return AUTHORED_HEADINGS[Math.floor(angle / step + 0.5 + 1e-12) % 4]!;
}
