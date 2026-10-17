import {
  heightAt,
  heightBreakpoints,
  spawnActorId,
  type AreaDefinition,
  type Point,
} from '../content/world';
import { visibilityBreakpoints } from '../content/collision';
import type { ContentSnapshot } from '../content/snapshot';
import { tuning } from '../content/gameplay';
import { clearSegment } from './navigation';
import type { TraversalPolicy } from './navigation';
import type { Actor } from './actor';

type EnemyIntent =
  | { kind: 'home'; target: Point; cancelAttack: boolean }
  | { kind: 'pursuit'; attack: boolean; cancelAttack: boolean }
  | { kind: 'none'; cancelAttack: boolean };

// Awareness persists with area state; routes and action clocks do not. This owner
// chooses intent without starting actions, dealing damage or moving actors.
export class EncounterBehavior {
  private alerted = new Set<string>();
  private readonly homes;
  readonly #traversal: TraversalPolicy = Object.freeze({
    position: (point: Point) => !this.safePoint(point),
    segment: (start: Point, end: Point) => this.enemySegment(start, end),
  });
  get traversal() {
    return this.#traversal;
  }
  constructor(private readonly area: ContentSnapshot<AreaDefinition>) {
    this.homes = new Map(area.spawns.map((spawn) => [spawnActorId(area.id, spawn.id), spawn]));
  }
  reset() {
    this.alerted.clear();
  }
  captureAlerts() {
    return this.area.spawns
      .filter((s) => this.alerted.has(spawnActorId(this.area.id, s.id)))
      .map((s) => s.id);
  }
  restoreAlerts(ids: readonly string[]) {
    this.alerted = new Set(ids.map((id) => spawnActorId(this.area.id, id)));
  }
  private safeAt(p: Point, fire: NonNullable<AreaDefinition['campfires']>[number]) {
    return (
      Math.hypot(p.x - fire.x, p.z - fire.z) < fire.safeRadius &&
      Math.abs(heightAt(this.area, p.x, p.z) - heightAt(this.area, fire.x, fire.z)) <=
        tuning.maxCombatHeightDifference &&
      clearSegment(this.area, p, fire, 0.001)
    );
  }
  safePoint(p: Point) {
    return this.area.campfires?.some((fire) => this.safeAt(p, fire)) ?? false;
  }
  private enemySegment(start: Point, end: Point) {
    const dx = end.x - start.x,
      dz = end.z - start.z,
      length = Math.hypot(dx, dz);
    for (const fire of this.area.campfires ?? []) {
      const sx = start.x - fire.x,
        sz = start.z - fire.z;
      if (this.safeAt(start, fire)) {
        // Existing saves/editor placement can put an enemy inside sanctuary.
        // Permit an outward escape, but never motion deeper into it.
        if (sx * dx + sz * dz < -1e-8) return false;
        continue;
      }
      if (!length) continue;
      const projection = -(sx * dx + sz * dz) / (length * length),
        closest = Math.max(0, Math.min(1, projection)),
        at = (t: number) => ({ x: start.x + dx * t, z: start.z + dz * t }),
        nearest = at(closest);
      if (Math.hypot(nearest.x - fire.x, nearest.z - fire.z) >= fire.safeRadius) continue;
      if (this.safeAt(nearest, fire) || this.safeAt(end, fire)) return false;
      // Height and visibility can expose arbitrarily narrow sanctuary fragments.
      // Classify geometry-derived intervals, independent of movement step size.
      const axis = at(projection),
        distance = Math.hypot(axis.x - fire.x, axis.z - fire.z),
        half = Math.sqrt(Math.max(0, fire.safeRadius ** 2 - distance ** 2)) / length,
        from = Math.max(0, projection - half),
        to = Math.min(1, projection + half),
        height = heightAt(this.area, fire.x, fire.z),
        cuts = [
          ...new Set([
            from,
            to,
            ...heightBreakpoints(this.area, start, end, [
              height - tuning.maxCombatHeightDifference,
              height + tuning.maxCombatHeightDifference,
            ]),
            ...visibilityBreakpoints(this.area, fire, start, end, 0.001),
          ]),
        ]
          .filter((t) => t >= from && t <= to)
          .sort((a, b) => a - b);
      for (let i = 0; i < cuts.length; i++) {
        if (this.safeAt(at(cuts[i]!), fire)) return false;
        if (i && this.safeAt(at((cuts[i - 1]! + cuts[i]!) / 2), fire)) return false;
      }
    }
    return true;
  }
  inCombat(
    hero: ContentSnapshot<Actor>,
    actors: readonly ContentSnapshot<Actor>[],
    engaged: boolean,
  ) {
    return (
      hero.health <= 0 ||
      (!this.safePoint(hero) &&
        actors.some(
          (a) =>
            a.kind === 'enemy' &&
            a.health > 0 &&
            (this.alerted.has(a.id) || (!this.homes.get(a.id)?.awareness && engaged)),
        ))
    );
  }
  alert(actor: ContentSnapshot<Actor>) {
    this.alerted.add(actor.id);
    const group = this.homes.get(actor.id)?.awareness?.group;
    if (group)
      for (const [id, home] of this.homes)
        if (home.awareness?.group === group) this.alerted.add(id);
  }
  decide(
    actor: ContentSnapshot<Actor>,
    hero: ContentSnapshot<Actor>,
    engaged: boolean,
    preview: boolean,
  ): EnemyIntent {
    const home = this.homes.get(actor.id);
    let cancelAttack = false;
    if (home && !preview) {
      const safe = this.safePoint(hero);
      if (!home.awareness && safe) {
        this.alerted.delete(actor.id);
        return { kind: 'home', target: home, cancelAttack: true };
      }
      if (home.awareness) {
        if (safe || Math.hypot(hero.x - home.x, hero.z - home.z) > home.awareness.leash) {
          this.alerted.delete(actor.id);
          cancelAttack = true;
        } else if (
          Math.hypot(hero.x - actor.x, hero.z - actor.z) <= home.awareness.radius &&
          Math.abs(hero.y - actor.y) <= tuning.maxCombatHeightDifference &&
          clearSegment(this.area, actor, hero, 0.001)
        )
          this.alert(actor);
        if (!this.alerted.has(actor.id)) return { kind: 'home', target: home, cancelAttack };
      }
    }
    if ((engaged || preview || this.alerted.has(actor.id)) && hero.health > 0) {
      const contact =
        Math.abs(actor.y - hero.y) <= tuning.maxCombatHeightDifference &&
        clearSegment(this.area, actor, hero, 0.001);
      return {
        kind: 'pursuit',
        cancelAttack,
        attack:
          Math.hypot(hero.x - actor.x, hero.z - actor.z) <= actor.definition.melee.range && contact,
      };
    }
    return { kind: 'none', cancelAttack };
  }
}
