import * as T from 'three';

export function overlayLine(
  group: T.Group,
  points: T.Vector3[],
  color: number,
  renderOrder = 0,
  opacity?: number,
) {
  const line = new T.Line(
    new T.BufferGeometry().setFromPoints(points),
    new T.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: opacity !== undefined,
      opacity: opacity ?? 1,
    }),
  );
  line.renderOrder = renderOrder;
  group.add(line);
}

/** These groups own only their line/point geometry and materials. */
export function clearOverlay(group: T.Group) {
  for (const child of [...group.children]) {
    const drawing = child as T.Line | T.Points;
    drawing.geometry.dispose();
    (drawing.material as T.Material).dispose();
    group.remove(child);
  }
}
