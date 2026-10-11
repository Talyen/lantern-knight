import * as T from 'three';
import type { Simulation } from '../core/simulation';
import type { WorldVisualDefinition } from '../content/world-visuals';
import { artworkFloorLayout } from '../content/floor-layout';
export class NavigationOverlay {
  readonly group = new T.Group();
  options = {
    blockers: true,
    masks: false,
    depth: false,
    cells: false,
    routes: true,
    footprints: true,
  };
  private tick = -1;
  update(sim: Simulation, visuals?: WorldVisualDefinition) {
    if (sim.tick - this.tick < 15 && this.tick >= 0) return;
    this.tick = sim.tick;
    this.clear();
    const lines = (points: readonly { x: number; z: number }[], color: number, closed = false) => {
      if (!points.length) return;
      const vertices = points.map((p) => new T.Vector3(p.x, 0.04, p.z));
      if (closed) vertices.push(vertices[0]!.clone());
      const geometry = new T.BufferGeometry().setFromPoints(vertices),
        material = new T.LineBasicMaterial({
          color,
          depthTest: false,
          transparent: true,
          opacity: 0.8,
        }),
        line = new T.Line(geometry, material);
      line.renderOrder = 1001;
      this.group.add(line);
    };
    if (this.options.blockers)
      for (const p of sim.areaDefinition.props) {
        if (p.blocking === false) continue;
        if (p.polygon) lines(p.polygon, 0xe79b70, true);
      }
    const ground = visuals?.groundInteraction,
      floor = visuals?.editorFloor;
    if (ground && floor) {
      const layout = artworkFloorLayout(floor.width, floor.depth);
      for (const region of ground.regions) {
        if (this.options.masks)
          for (const shape of region.mask ?? [])
            for (const ring of [shape.outer, ...shape.holes])
              lines(
                ring.map((p) => layout.world(p)),
                0x8c9fe0,
                true,
              );
        if (this.options.depth && region.depth) {
          const d = region.depth;
          lines(
            d.kind === 'boundary'
              ? d.points
              : [
                  { x: d.point.x - 0.1, z: d.point.z },
                  { x: d.point.x + 0.1, z: d.point.z },
                ],
            0x78d6bf,
          );
        }
      }
    }
    const debug = sim.navigationDebug(this.options.cells);
    if (this.options.routes)
      for (const route of debug.routes) {
        const actor = sim.actors.find((a) => a.id === route.id);
        if (actor) lines([actor, ...route.points], route.status === 'ready' ? 0x78d6bf : 0xe79b70);
      }
    if (this.options.cells) {
      const positions = debug.cells.flatMap((p) => [p.x, 0.025, p.z]),
        colors = debug.cells.flatMap((p) => (p.walkable ? [0.3, 0.8, 0.6] : [0.8, 0.3, 0.2]));
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      this.group.add(
        new T.Points(
          geometry,
          new T.PointsMaterial({
            size: 2,
            sizeAttenuation: false,
            vertexColors: true,
            depthTest: false,
          }),
        ),
      );
    }
    if (this.options.footprints)
      for (const actor of sim.actors)
        lines(
          Array.from({ length: 24 }, (_, i) => ({
            x: actor.x + Math.cos((i / 24) * Math.PI * 2) * Math.max(0.3, actor.definition.radius),
            z: actor.z + Math.sin((i / 24) * Math.PI * 2) * Math.max(0.3, actor.definition.radius),
          })),
          actor.kind === 'hero' ? 0xd1ba7c : 0xa77368,
          true,
        );
  }
  invalidate() {
    this.tick = -1;
  }
  private clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof T.Line || child instanceof T.Points) {
        child.geometry.dispose();
        (child.material as T.Material).dispose();
      }
    }
  }
  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
