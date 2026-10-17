import * as T from 'three';
import type { AssetPack } from '../assets/loader';
import { resolveClip } from '../assets/schema';
import { frameAt, clipDuration } from '../core/animation';
import { Navigation, effectiveRadius, clearSegment } from '../core/navigation';
import type { SimulationView } from '../core/simulation-view';
import { heightAt, spawnActorId, type Point } from '../content/world';
import {
  guidingWindAssets,
  guidingWindTiming as timing,
  type WindTreatment,
} from '../content/guiding-wind';
import { ActorSprite, setCutoutOpacity } from './sprite';

// A suggestion through scenery, never movement input or a required route.
export function windDestination(sim: SimulationView): Point | undefined {
  if (sim.hero.health <= 0 || sim.inCombat) return;
  const homeward =
    sim.area === 'desecrated-chapel'
      ? 'ruined-forge'
      : sim.area === 'ruined-forge'
        ? 'forest-gathering-clearing'
        : sim.area === 'forest-gathering-clearing'
          ? 'abandoned-orchard'
          : undefined;
  if (sim.inventory['vigil-amulet'] && (homeward || sim.area === 'abandoned-orchard')) {
    // Collected chapel spoils mark the return journey even when optional caches
    // were bypassed. Finish loose container rewards, then follow matching paths.
    return (
      sim.drops.find(
        (drop) =>
          !drop.enemy &&
          sim.areaDefinition.interactables?.some(
            (object) => object.kind === 'container' && object.id === drop.source,
          ),
      ) ??
      sim.areaDefinition.exits.find((exit) => exit.destination === homeward)?.marker ??
      sim.areaDefinition.campfires?.[0]
    );
  }
  if (sim.area === 'abandoned-orchard') {
    const press = sim.areaDefinition.interactables?.find((o) => o.id === 'guarded-chest');
    const departure = sim.areaDefinition.exits.find((e) => e.id === 'depart')?.marker;
    if (press) {
      // Accepted world state owns progress, including reload and campfire resets.
      // These are suggestions: walking past the camp never sends the player back.
      if (sim.claimedObjects.has(press.id))
        return sim.drops.find((d) => d.source === press.id) ?? departure;
      const camp = sim.areaDefinition.interactables?.find((o) => o.id === 'southern-cache');
      const firstHome = sim.areaDefinition.spawns.find((s) => s.id === 'first');
      const distance = (p: Point) => Math.hypot(p.x - sim.hero.x, p.z - sim.hero.z);
      if (
        camp &&
        distance(camp) < 7 &&
        distance(camp) < distance(press) &&
        (!firstHome || distance(camp) < distance(firstHome))
      ) {
        if (!sim.claimedObjects.has(camp.id)) return camp;
        const drop = sim.drops.find((d) => d.source === camp.id);
        if (drop) return drop;
      }
      const first = sim.enemies.find(
        (a) => a.id === spawnActorId(sim.area, 'first') && a.health > 0,
      );
      if (first && distance(first) < distance(press)) return first;
      return press;
    }
    const supplies = sim.areaDefinition.interactables
      ?.filter((o) => o.kind === 'breakable' && !sim.claimedObjects.has(o.id))
      .sort(
        (a, b) =>
          Math.hypot(a.x - sim.hero.x, a.z - sim.hero.z) -
          Math.hypot(b.x - sim.hero.x, b.z - sim.hero.z),
      )[0];
    if (supplies && Math.hypot(supplies.x - sim.hero.x, supplies.z - sim.hero.z) < 5)
      return supplies;
    return departure;
  }
  if (sim.area === 'desecrated-chapel') {
    const reliquary = sim.areaDefinition.interactables?.find((o) => o.kind === 'container');
    return reliquary && !sim.claimedObjects.has(reliquary.id)
      ? reliquary
      : (sim.drops.find((d) => d.source === reliquary?.id) ?? sim.areaDefinition.campfires?.[0]);
  }
  if (sim.area === 'forest-gathering-clearing' || sim.area === 'ruined-forge') {
    const chest = sim.areaDefinition.interactables?.find((o) => o.kind === 'container');
    if (chest && !sim.claimedObjects.has(chest.id)) return chest;
    const drop = sim.drops.find((d) => d.source === chest?.id);
    if (drop) return drop;
    if (sim.area === 'ruined-forge' && !sim.forgeUpgrade)
      return (
        sim.areaDefinition.interactables?.find((o) => o.kind === 'workbench') ??
        sim.areaDefinition.campfires?.[0]
      );
    return (
      sim.areaDefinition.exits.find(
        (e) =>
          e.destination === (sim.area === 'ruined-forge' ? 'desecrated-chapel' : 'ruined-forge'),
      )?.marker ?? sim.areaDefinition.campfires?.[0]
    );
  }
}

function routePoint(route: readonly Point[], distance: number): Point {
  let p = route[0]!;
  for (let i = 1; i < route.length; i++) {
    const next = route[i]!;
    const length = Math.hypot(next.x - p.x, next.z - p.z);
    if (distance <= length && length > 0) {
      const t = Math.max(0, distance / length);
      return { x: p.x + (next.x - p.x) * t, z: p.z + (next.z - p.z) * t };
    }
    distance -= length;
    p = next;
  }
  return p;
}

type Stream = { route: Point[]; fade: number; sprites: ActorSprite[] };
export class GuidingWind {
  readonly group = new T.Group();
  treatment: WindTreatment = 'combined';
  readonly breeze = { x: 0, z: 0, strength: 0 };
  private time = 0;
  private generation = -1;
  private navigation?: Navigation;
  private streams: Stream[] = [];
  private source?: Point;
  private destination?: Point;
  private nextPlan = 0;
  private current = 0;
  constructor(
    packs: ReadonlyMap<string, AssetPack>,
    private camera: T.OrthographicCamera,
  ) {
    this.group.name = 'guiding-wind';
    for (let batch = 0; batch < 2; batch++) {
      const stream: Stream = { route: [], fade: 0, sprites: [] };
      for (let i = 0; i < 12; i++) {
        const leaves = i % 3 === 2;
        const pack = packs.get(guidingWindAssets[leaves ? 1 : 0]);
        if (!pack) continue;
        const sprite = new ActorSprite(
          `guiding-${batch}-${i}`,
          pack.manifest,
          pack.textures,
          resolveClip(pack.manifest, leaves ? 'animation' : 'autumn_leaf_gust', 'd45'),
        );
        sprite.mesh.userData.decorative = true;
        sprite.mesh.userData.leafVariation = leaves;
        stream.sprites.push(sprite);
        this.group.add(sprite.mesh);
      }
      this.streams.push(stream);
    }
  }
  update(sim: SimulationView, ms: number, enabled: boolean, reduced = false) {
    if (this.generation !== sim.generation) {
      this.generation = sim.generation;
      this.navigation = new Navigation(sim.areaDefinition);
      this.time = 0;
      this.nextPlan = 0;
      this.source = this.destination = undefined;
      for (const stream of this.streams) {
        stream.route = [];
        stream.fade = 0;
      }
    }
    const dt = Math.max(0, ms) / 1000;
    this.time += dt;
    const target = enabled ? windDestination(sim) : undefined;
    const active = target && Math.hypot(target.x - sim.hero.x, target.z - sim.hero.z) > 2;
    if (
      active &&
      this.time >= this.nextPlan &&
      (!this.source ||
        !this.destination ||
        Math.hypot(this.source.x - sim.hero.x, this.source.z - sim.hero.z) > 1 ||
        Math.hypot(this.destination.x - target.x, this.destination.z - target.z) > 0.5)
    ) {
      const route = this.navigation!.route(
        sim.hero,
        target,
        effectiveRadius(sim.hero.definition.radius),
      );
      this.nextPlan = this.time + 0.5;
      this.source = { x: sim.hero.x, z: sim.hero.z };
      this.destination = { ...target };
      this.current = 1 - this.current;
      const stream = this.streams[this.current]!;
      stream.route = route.status === 'ready' ? [this.source, ...route.points] : [];
      stream.fade = 0;
    }
    const age = this.time % timing.period;
    const envelope = active
      ? Math.min(1, age / 0.8, Math.max(0, (timing.duration - age) / 1.2))
      : 0;
    this.breeze.x = this.breeze.z = this.breeze.strength = 0;
    for (const [batch, stream] of this.streams.entries()) {
      stream.fade = Math.max(
        0,
        Math.min(1, stream.fade + (batch === this.current ? 1 : -1) * dt * 3),
      );
      const route = stream.route;
      let length = 0;
      for (let i = 1; i < route.length; i++)
        length += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.z - route[i - 1]!.z);
      const reach = Math.min(timing.reach, length);
      if (batch === this.current && route.length > 1) {
        const near = routePoint(route, 1),
          origin = route[0]!;
        const length = Math.hypot(near.x - origin.x, near.z - origin.z) || 1;
        this.breeze.x = (near.x - origin.x) / length;
        this.breeze.z = (near.z - origin.z) / length;
        this.breeze.strength = envelope * stream.fade;
      }
      for (const [i, sprite] of stream.sprites.entries()) {
        const leaves = !!sprite.mesh.userData.leafVariation;
        const selected = this.treatment === 'combined' || (this.treatment === 'leaves') === leaves;
        sprite.mesh.visible =
          selected &&
          envelope > 0 &&
          stream.fade > 0 &&
          route.length > 1 &&
          reach >= 0.5 &&
          (!reduced || i % 4 === 0);
        if (!sprite.mesh.visible) continue;
        const travel = (this.time * (reduced ? 1.4 : 5.4) + i * 0.91) % reach;
        const before = routePoint(route, travel - 0.35);
        const after = routePoint(route, travel + 0.35);
        const center = routePoint(route, travel);
        // Average neighboring samples to round corners only where floor clearance permits.
        const smooth = { x: (before.x + after.x) / 2, z: (before.z + after.z) / 2 };
        const p = clearSegment(sim.areaDefinition, center, smooth, 0.08) ? smooth : center;
        const span = Math.hypot(after.x - before.x, after.z - before.z) || 1;
        const direction = { x: (after.x - before.x) / span, z: (after.z - before.z) / span };
        const spread = Math.sin(i * 2.4 + this.time * 0.8) * 0.65;
        const offset = { x: p.x - direction.z * spread, z: p.z + direction.x * spread };
        const { x, z } = clearSegment(sim.areaDefinition, p, offset, 0.08) ? offset : p;
        const opacity =
          envelope *
          stream.fade *
          Math.min(1, travel / 0.6, (reach - travel) / 1.2) *
          (reduced ? 0.22 : 0.48);
        setCutoutOpacity(sprite.material, opacity);
        sprite.show(
          frameAt(
            sprite.animator.clip,
            (this.time * 1000 + i * 313) % clipDuration(sprite.animator.clip),
          ),
          new T.Vector3(
            x,
            heightAt(sim.areaDefinition, x, z) + 0.25 + 0.15 * Math.sin(i + this.time),
            z,
          ),
          this.camera,
        );
        sprite.mesh.scale.setScalar(leaves ? 0.4 : 0.85);
      }
    }
  }
  dispose() {
    for (const stream of this.streams) for (const sprite of stream.sprites) sprite.dispose();
    this.streams = [];
    this.group.clear();
  }
}
