export function alphaBounds(data: Uint8Array, width: number, height: number, threshold = 0) {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]! > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  return maxX < 0 ? undefined : { minX, minY, maxX, maxY };
}

export function remapAlpha(data: Uint8Array, floor: number, span: number) {
  for (let i = 3; i < data.length; i += 4) {
    const t = Math.max(0, Math.min(1, (data[i]! / 255 - floor) / span));
    data[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
}
