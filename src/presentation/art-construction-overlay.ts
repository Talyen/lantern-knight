import { sceneFixtures } from '../content/scenery-presets';
import * as T from 'three';
import { worldVisuals } from '../content/world-art';
import { heightAt, type AreaDefinition } from '../content/world';
import { sceneArtFindings } from '../content/scene-art-validation';
import { coplanarMeshConflicts } from './mesh-plane-validation';
import { coplanarArtConflicts } from './carrier-validation';
import type { InkRoom } from './ink-room';
import type { PreparedRegistration } from '../assets/registration';
export class ArtConstructionOverlay {
  constructor(private coverage: PreparedRegistration['coverage']) {}
  readonly group = new T.Group();
  private owned: { dispose: () => void }[] = [];
  private generation = -1;
  findings: { a: string; b?: string; message: string }[] = [];
  update(area: AreaDefinition, room: InkRoom | undefined, generation: number, visible: boolean) {
    this.group.visible = visible;
    if (!visible || this.generation === generation) return;
    this.clear();
    this.generation = generation;
    const art = worldVisuals[area.id];
    if (!art) return;
    this.findings =
      area.id === 'court'
        ? [
            ...sceneArtFindings(art),
            ...coplanarMeshConflicts(room?.graveyard?.architecture.parts ?? []).map((v) => ({
              ...v,
              message: 'Opaque masonry surfaces share a depth plane',
            })),
            ...coplanarArtConflicts(room?.sprites ?? [], this.coverage.masks).map((v) => ({
              ...v,
              message: 'Opaque source coverage shares a depth plane',
            })),
          ]
        : [];
    const line = (points: T.Vector3[], color: number) => {
      const g = new T.BufferGeometry().setFromPoints(points),
        m = new T.LineBasicMaterial({ color, depthTest: false, depthWrite: false });
      const o = new T.Line(g, m);
      o.renderOrder = 1000;
      this.group.add(o);
      this.owned.push(g, m);
    };
    for (const p of area.props) {
      if (!p.size) continue;
      const angle = p.rotation ?? 0,
        c = Math.cos(angle),
        s = Math.sin(angle),
        points = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1],
        ].map(
          ([x, z]) =>
            new T.Vector3(
              p.x + ((x! * p.size![0]) / 2) * c - ((z! * p.size![1]) / 2) * s,
              heightAt(area, p.x, p.z) + 0.03,
              p.z + ((x! * p.size![0]) / 2) * s + ((z! * p.size![1]) / 2) * c,
            ),
        );
      line(points, this.findings.some((f) => f.a === p.id || f.b === p.id) ? 0xff7474 : 0x78d7be);
    }
    for (const w of art.walls) {
      line(
        [
          new T.Vector3(w.from.x, heightAt(area, w.from.x, w.from.z) + 0.04, w.from.z),
          new T.Vector3(w.to.x, heightAt(area, w.to.x, w.to.z) + 0.04, w.to.z),
        ],
        0xdcca91,
      );
    }
    for (const f of sceneFixtures(art)) {
      const p = art.props.find((p) => p.id === f.prop)!;
      const root = new T.Vector3(p.x, heightAt(area, p.x, p.z) + (p.y ?? 0), p.z),
        socket = root.clone().add(new T.Vector3(...f.socket));
      line([root, socket], 0xf5b466);
      const g = new T.SphereGeometry(0.045, 6, 4),
        m = new T.MeshBasicMaterial({ color: 0xf5b466, depthTest: false, depthWrite: false }),
        marker = new T.Mesh(g, m);
      marker.position.copy(socket);
      marker.renderOrder = 1000;
      this.group.add(marker);
      this.owned.push(g, m);
    }
  }
  clear() {
    this.group.clear();
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.generation = -1;
    this.findings = [];
  }
  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
