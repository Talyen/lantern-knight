// Convert a trimmed source rectangle into world bounds around its registered anchor.
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
