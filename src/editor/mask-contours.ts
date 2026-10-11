import type { MaskShape } from '../content/ground-interaction';
type UV = [number, number];
const signedArea = (p: UV[]) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length]!;
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
function simplify(points: UV[], tolerance = 0.45): UV[] {
  if (points.length < 4) return points;
  const end = points.at(-1)!,
    start = points[0]!,
    dx = end[0] - start[0],
    dy = end[1] - start[1],
    length = dx * dx + dy * dy;
  let greatest = 0,
    index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!,
      t = length
        ? Math.max(0, Math.min(1, ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / length))
        : 0,
      d = Math.hypot(p[0] - start[0] - t * dx, p[1] - start[1] - t * dy);
    if (d > greatest) {
      greatest = d;
      index = i;
    }
  }
  return greatest > tolerance
    ? [
        ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(index), tolerance),
      ]
    : [start, end];
}
function inside(p: UV, ring: UV[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
/** Trace pixel boundaries, including islands/holes, then encode within half a source pixel. */
export function traceMask(alpha: Uint8ClampedArray, width: number, height: number): MaskShape[] {
  const stride = width + 1,
    edges = new Map<number, number[]>();
  const add = (x: number, y: number, xx: number, yy: number) => {
    const id = y * stride + x,
      next = yy * stride + xx,
      list = edges.get(id);
    if (list) list.push(next);
    else edges.set(id, [next]);
  };
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && alpha[(y * width + x) * 4 + 3]! >= 128;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (filled(x, y)) {
        if (!filled(x, y - 1)) add(x, y, x + 1, y);
        if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!filled(x - 1, y)) add(x, y + 1, x, y);
      }
  const rings: UV[][] = [];
  while (edges.size) {
    const start = edges.keys().next().value!,
      ring: UV[] = [];
    let current = start,
      previous = start - stride;
    do {
      ring.push([current % stride, Math.floor(current / stride)]);
      const options = edges.get(current);
      if (!options?.length) throw new Error('Mask contour is open');
      let index = 0;
      if (options.length > 1) {
        const dx = (current % stride) - (previous % stride),
          dy = Math.floor(current / stride) - Math.floor(previous / stride);
        let best = -Infinity;
        options.forEach((next, i) => {
          const nx = (next % stride) - (current % stride),
            ny = Math.floor(next / stride) - Math.floor(current / stride),
            turn = dx * ny - dy * nx;
          if (turn > best) {
            best = turn;
            index = i;
          }
        });
      }
      const next = options.splice(index, 1)[0]!;
      if (!options.length) edges.delete(current);
      previous = current;
      current = next;
    } while (current !== start);
    if (ring.length >= 3) {
      let far = 1;
      for (let i = 2; i < ring.length; i++)
        if (
          Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]) >
          Math.hypot(ring[far]![0] - ring[0]![0], ring[far]![1] - ring[0]![1])
        )
          far = i;
      const cleaned = [
        ...simplify(ring.slice(0, far + 1)).slice(0, -1),
        ...simplify([...ring.slice(far), ring[0]!]).slice(0, -1),
      ];
      if (cleaned.length >= 3) rings.push(cleaned.map(([x, y]) => [x / width, y / height]));
    }
  }
  const shapes = rings
    .filter((r) => signedArea(r) > 0)
    .map((outer) => ({ outer, holes: [] as UV[][] }));
  for (const hole of rings.filter((r) => signedArea(r) < 0)) {
    const owner = shapes
      .filter((s) => inside(hole[0]!, s.outer))
      .sort((a, b) => signedArea(a.outer) - signedArea(b.outer))[0];
    if (owner) owner.holes.push(hole);
  }
  return shapes;
}
export function brushMask(
  mask: MaskShape[],
  dimensions: readonly [number, number],
  points: UV[],
  radius: number,
  erase: boolean,
) {
  const [w, h] = dimensions,
    canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  for (const shape of mask) {
    ctx.beginPath();
    for (const ring of [shape.outer, ...shape.holes]) {
      ring.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x * w, y * h);
        else ctx.lineTo(x * w, y * h);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x * w, y * h);
    else ctx.lineTo(x * w, y * h);
  });
  ctx.stroke();
  for (const [x, y] of [points[0]!, points.at(-1)!]) {
    ctx.beginPath();
    ctx.arc(x * w, y * h, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const result = traceMask(ctx.getImageData(0, 0, w, h).data, w, h);
  canvas.width = canvas.height = 1;
  return result;
}
