import { Navigation, type RouteResult, type TraversalPolicy } from './navigation';
import { effectiveRadius, clearSegment } from '../content/collision';
import { heightAt, type Point, type AreaDefinition } from '../content/world';
import { tuning } from '../content/gameplay';
import type { ContentSnapshot } from '../content/snapshot';
import type { Actor } from './actor';

// One room owns one planner. Routes are transient and never part of checkpoints.
export class MovementPlans {
  readonly #enemyTraversal: TraversalPolicy | undefined;
  constructor(
    private readonly area: ContentSnapshot<AreaDefinition>,
    enemyTraversal?: TraversalPolicy,
  ) {
    this.#enemyTraversal = enemyTraversal;
  }
  private navigation = new Map<Actor['kind'], Navigation>();
  private plans = new Map<
    string,
    {
      target: Point;
      origin: Point;
      destination: Point;
      route: RouteResult;
      nextPlan: number;
      kind: 'manual' | 'home' | 'pursuit';
    }
  >();
  setManual(actor: Actor, target: Point | null, tick: number) {
    if (!target) {
      this.plans.delete(actor.id);
      return;
    }
    if (!Number.isFinite(target.x) || !Number.isFinite(target.z))
      throw new Error('Movement destination must be finite');
    this.plans.set(actor.id, this.plan(actor, target, 'manual', tick));
  }
  clear() {
    this.plans.clear();
  }
  has(id: string) {
    return this.plans.has(id);
  }
  manual(id: string) {
    return this.plans.get(id)?.kind === 'manual';
  }
  cancel(id: string) {
    this.plans.delete(id);
  }
  private navigator(actor: Actor) {
    let navigation = this.navigation.get(actor.kind);
    if (!navigation) {
      navigation = new Navigation(
        this.area,
        actor.kind === 'enemy' ? this.#enemyTraversal : undefined,
      );
      this.navigation.set(actor.kind, navigation);
    }
    return navigation;
  }
  debug(radius: number, includeCells = true) {
    // Diagnostics must not initialize the gameplay navigator or clear movement targets.
    return {
      routes: [...this.plans].map(([id, p]) => ({
        id,
        target: { ...p.target },
        status: p.route.status,
        points: p.route.points.map((v) => ({ ...v })),
      })),
      // The overlay describes hero clearance; enemy-only restrictions have their
      // own cache and must not publish contradictory cells at the same position.
      cells: includeCells ? (this.navigation.get('hero')?.debugCells(radius) ?? []) : [],
    };
  }
  private pursuitRoute(a: Actor, target: Point, kind: 'home' | 'pursuit'): RouteResult {
    const radius = effectiveRadius(a.definition.radius);
    const direct = this.navigator(a).route(a, target, radius);
    if (direct.status === 'ready' || kind !== 'pursuit') return direct;
    // A larger enemy may not fit at the hero's feet. Find the nearest reachable
    // attack position with clear contact rather than reporting unreachable.
    const distance = a.definition.attack.range * 0.8;
    const targetHeight = heightAt(this.area, target.x, target.z);
    let best: RouteResult | undefined;
    let bestDistanceSquared = Infinity;
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8;
      const point = {
        x: target.x + Math.cos(angle) * distance,
        z: target.z + Math.sin(angle) * distance,
      };
      const dx = point.x - a.x,
        dz = point.z - a.z,
        distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= bestDistanceSquared) continue;
      if (
        Math.abs(heightAt(this.area, point.x, point.z) - targetHeight) >
          tuning.maxCombatHeightDifference ||
        !clearSegment(this.area, point, target, 0.001)
      )
        continue;
      const route = this.navigator(a).route(a, point, radius);
      if (route.status !== 'ready') continue;
      best = route;
      bestDistanceSquared = distanceSquared;
    }
    return best ?? direct;
  }
  private plan(a: Actor, target: Point, kind: 'manual' | 'home' | 'pursuit', tick: number) {
    const route =
      kind === 'manual'
        ? this.navigator(a).route(a, target, effectiveRadius(a.definition.radius))
        : this.pursuitRoute(a, target, kind);
    return {
      target: { x: target.x, z: target.z },
      origin: { x: a.x, z: a.z },
      destination: route.points.at(-1) ?? { x: target.x, z: target.z },
      route,
      nextPlan: tick + 15,
      kind,
    };
  }
  follow(
    a: Actor,
    tick: number,
    move: (actor: Actor, x: number, z: number) => void,
    intent?: { kind: 'home' | 'pursuit'; target: Point },
  ) {
    const target = intent?.target;
    const kind = intent?.kind ?? 'home';
    let plan = this.plans.get(a.id);
    // An intent change invalidates automatic routes immediately. Moving pursuit
    // targets still replan on the normal cadence; manual commands retain priority.
    if (plan && plan.kind !== 'manual' && plan.kind !== kind) {
      this.plans.delete(a.id);
      plan = undefined;
    }
    if (!plan && !target) return false;
    const navigation = this.navigator(a);
    const goal = plan?.kind === 'manual' ? plan.target : (target ?? plan!.target);
    const waypoint = plan?.route.points[0];
    // Static geometry cannot make the same failed request succeed. Retry when
    // displaced, when the next segment is obstructed, or when pursuit changes.
    const targetChanged =
      plan &&
      plan.kind !== 'manual' &&
      tick >= plan.nextPlan &&
      (goal.x !== plan.target.x || goal.z !== plan.target.z);
    const displaced =
      plan &&
      (plan.route.status === 'unreachable'
        ? tick >= plan.nextPlan && (a.x !== plan.origin.x || a.z !== plan.origin.z)
        : waypoint
          ? !navigation.clear(a, waypoint, effectiveRadius(a.definition.radius))
          : plan.kind !== 'manual' &&
            tick >= plan.nextPlan &&
            Math.hypot(a.x - plan.destination.x, a.z - plan.destination.z) > 1e-6);
    if (!plan || targetChanged || displaced) {
      plan = this.plan(a, goal, plan?.kind ?? kind, tick);
      this.plans.set(a.id, plan);
    }
    const startX = a.x,
      startZ = a.z;
    let remaining = a.definition.speed / 60;
    while (plan.route.points.length) {
      const p = plan.route.points[0]!,
        dx = p.x - a.x,
        dz = p.z - a.z,
        distance = Math.hypot(dx, dz);
      if (distance < 1e-6) {
        plan.route.points.shift();
        continue;
      }
      if (remaining < 1e-6) break;
      const step = Math.min(remaining, distance);
      a.travelYaw = Math.atan2(dx, dz);
      a.yaw = a.travelYaw;
      move(a, (dx / distance) * step, (dz / distance) * step);
      remaining -= step;
      // Spend the rest on the next segment only after actually reaching this
      // corner. Collision or room policy can still stop the requested movement.
      if (Math.hypot(a.x - p.x, a.z - p.z) >= 1e-6) break;
    }
    if (!plan.route.points.length && plan.kind === 'manual' && plan.route.status === 'ready')
      this.plans.delete(a.id);
    const moved = Math.hypot(a.x - startX, a.z - startZ) > 1e-6;
    a.state = moved ? 'walk' : 'idle';
    if (!moved && a.kind !== 'hero') a.yaw = a.aim;
    return moved;
  }
}
