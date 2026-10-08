export function normalPixels(
  height: Uint8Array,
  width: number,
  heightCount: number,
  strength = 16,
) {
  if (height.length !== width * heightCount)
    throw new Error('normal height field dimensions differ');
  const out = new Uint8Array(width * heightCount * 4),
    at = (x: number, y: number) =>
      height[
        Math.max(0, Math.min(heightCount - 1, y)) * width + Math.max(0, Math.min(width - 1, x))
      ]! / 255;
  for (let y = 0; y < heightCount; y++)
    for (let x = 0; x < width; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength,
        ny = (at(x, y + 1) - at(x, y - 1)) * strength,
        nz = 1,
        length = Math.hypot(nx, ny, nz),
        i = (y * width + x) * 4;
      out[i] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(((nz / length) * 0.5 + 0.5) * 255);
      out[i + 3] = height[y * width + x]!;
    }
  return out;
}
