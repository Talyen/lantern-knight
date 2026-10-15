import type { GroundInteraction } from '../../src/content/ground-interaction';
export function rectangle(x0 = 0, y0 = 0, x1 = 1, y1 = 1, reverse = false): [number, number][] {
  const points: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return reverse ? [points[0]!, ...points.slice(1).reverse()] : points;
}
export function groundFixture(
  regions: GroundInteraction['regions'],
  fields: Partial<Omit<GroundInteraction, 'regions'>> = {},
): GroundInteraction {
  return {
    asset: 'fixture',
    frame: 'fixture',
    hash: 'a'.repeat(64),
    dimensions: [64, 64],
    destinations: [],
    ...fields,
    regions,
  };
}
