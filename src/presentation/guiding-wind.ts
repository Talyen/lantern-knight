import * as T from 'three';
import type { AssetPack } from '../assets/loader';
import { resolveClip } from '../assets/schema';
import { frameAt, clipDuration } from '../core/animation';
import { Navigation, effectiveRadius } from '../core/navigation';
import type { SimulationView } from '../core/simulation-view';
import { heightAt, type Point } from '../content/world';
import { ActorSprite, setCutoutOpacity } from './sprite';

// A suggestion through scenery, never movement input or a required route.
export function windDestination(sim: SimulationView): Point | undefined {
  if (sim.hero.health <= 0 || sim.inCombat) return;
  if (sim.area === 'abandoned-orchard') {
    const supplies = sim.areaDefinition.interactables
      ?.filter((o) => o.kind === 'breakable' && !sim.claimedObjects.has(o.id))
      .sort(
        (a, b) =>
          Math.hypot(a.x - sim.hero.x, a.z - sim.hero.z) -
          Math.hypot(b.x - sim.hero.x, b.z - sim.hero.z),
      )[0];
    if (supplies && Math.hypot(supplies.x - sim.hero.x, supplies.z - sim.hero.z) < 5)
      return supplies;
    return sim.areaDefinition.exits.find((e) => e.id === 'depart')?.marker;
  }
  if (sim.area === 'forest-gathering-clearing') {
    const chest = sim.areaDefinition.interactables?.find((o) => o.kind === 'container');
    if (chest && !sim.claimedObjects.has(chest.id)) return chest;
    return sim.drops.find((d) => d.source === chest?.id) ?? sim.areaDefinition.campfires?.[0];
  }
}

export class GuidingWind {
  readonly group = new T.Group();
  private leaves: ActorSprite[] = [];
  private time = 0;
  private cycle = -1;
  private generation = -1;
  private route: Point[] = [];
  private navigation?: Navigation;
  constructor(
    packs: ReadonlyMap<string, AssetPack>,
    private camera: T.OrthographicCamera,
  ) {
    const pack = packs.get('library-tumbling_leaf');
    this.group.name = 'guiding-wind';
    if (!pack) return;
    for (let i = 0; i < 9; i++) {
      const leaf = new ActorSprite(
        `guiding-leaf-${i}`,
        pack.manifest,
        pack.textures,
        resolveClip(pack.manifest, 'tumbling_leaf', 'd45'),
      );
      leaf.mesh.userData.decorative = true;
      this.leaves.push(leaf);
      this.group.add(leaf.mesh);
    }
  }
  update(sim: SimulationView, ms: number, enabled: boolean) {
    if (this.generation !== sim.generation) {
      this.generation = sim.generation;
      this.navigation = new Navigation(sim.areaDefinition);
      this.time = 0;
      this.cycle = -1;
      this.route = [];
    }
    this.time += Math.max(0, ms) / 1000;
    const candidate = enabled ? windDestination(sim) : undefined;
    const target =
      candidate && Math.hypot(candidate.x - sim.hero.x, candidate.z - sim.hero.z) > 2
        ? candidate
        : undefined;
    const cycle = Math.floor(this.time / 9);
    if (cycle !== this.cycle) {
      this.cycle = cycle;
      const route =
        target &&
        this.navigation!.route(sim.hero, target, effectiveRadius(sim.hero.definition.radius));
      this.route =
        route?.status === 'ready' ? [{ x: sim.hero.x, z: sim.hero.z }, ...route.points] : [];
    }
    this.group.visible = !!target && this.route.length > 1 && this.time % 9 < 3.4;
    if (!this.group.visible) return;
    for (const [i, leaf] of this.leaves.entries()) {
      const age = (this.time % 9) - i * 0.09;
      const fade = Math.min(1, Math.max(0, age * 3), Math.max(0, (3.4 - age) * 2));
      let distance = 0.4 + Math.max(0, age) * 1.5;
      let p = this.route[0]!,
        direction = { x: 0, z: 0 };
      for (const next of this.route.slice(1)) {
        const length = Math.hypot(next.x - p.x, next.z - p.z);
        direction = { x: (next.x - p.x) / (length || 1), z: (next.z - p.z) / (length || 1) };
        if (distance <= length) {
          p = { x: p.x + direction.x * distance, z: p.z + direction.z * distance };
          break;
        }
        distance -= length;
        p = next;
      }
      const spread = Math.sin(i * 2.4 + age * 1.8) * 0.35;
      const x = p.x - direction.z * spread,
        z = p.z + direction.x * spread;
      setCutoutOpacity(leaf.material, fade * 0.55);
      leaf.show(
        frameAt(
          leaf.animator.clip,
          (age * 1000 + i * 113 + clipDuration(leaf.animator.clip)) %
            clipDuration(leaf.animator.clip),
        ),
        new T.Vector3(
          x,
          heightAt(sim.areaDefinition, x, z) + 0.1 + Math.sin(i + age * 3) * 0.08,
          z,
        ),
        this.camera,
      );
      leaf.mesh.scale.setScalar(0.75);
    }
  }
  dispose() {
    for (const leaf of this.leaves) leaf.dispose();
    this.leaves = [];
    this.group.clear();
  }
}
