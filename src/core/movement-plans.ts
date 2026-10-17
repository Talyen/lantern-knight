import {
  Navigation,
  effectiveRadius,
  clearSegment,
  type RouteResult,
  type TraversalPolicy,
} from './navigation';
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
    // A larger enemy may not fit at the hero's feet. Find a reachable melee
    // position with clear contact rather than treating the hero as unreachable.
    const distance = a.definition.melee.range * 0.8;
    const candidates = Array.from({ length: 16 }, (_, i) => ({
      x: target.x + Math.cos((i * Math.PI) / 8) * distance,
      z: target.z + Math.sin((i * Math.PI) / 8) * distance,
    })).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
    for (const point of candidates) {
      if (
        Math.abs(heightAt(this.area, point.x, point.z) - heightAt(this.area, target.x, target.z)) >
          tuning.maxCombatHeightDifference ||
        !clearSegment(this.area, point, target, 0.001)
      )
        continue;
      const route = this.navigator(a).route(a, point, radius);
      if (route.status === 'ready') return route;
    }
    return direct;
  }
  private plan(a: Actor, target: Point, kind: 'manual' | 'home' | 'pursuit', tick: number) {
    return {
      target: { x: target.x, z: target.z },
      origin: { x: a.x, z: a.z },
      route:
        kind === 'manual'
          ? this.navigator(a).route(a, target, effectiveRadius(a.definition.radius))
          : this.pursuitRoute(a, target, kind),
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
    const navigation = this.navigator(a);
    let plan = this.plans.get(a.id);
    // An intent change invalidates automatic routes immediately. Moving pursuit
    // targets still replan on the normal cadence; manual commands retain priority.
    if (plan && plan.kind !== 'manual' && plan.kind !== kind) {
      this.plans.delete(a.id);
      plan = undefined;
    }
    if (!plan && !target) return false;
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
            Math.hypot(a.x - goal.x, a.z - goal.z) > 1e-6);
    if (!plan || targetChanged || displaced) {
      plan = this.plan(a, goal, plan?.kind ?? kind, tick);
      this.plans.set(a.id, plan);
    }
    if (plan.route.status === 'unreachable') {
      a.state = 'idle';
      return false;
    }
    const step = a.definition.speed / 60;
    while (
      plan.route.points.length &&
      Math.hypot(plan.route.points[0]!.x - a.x, plan.route.points[0]!.z - a.z) < 1e-6
    )
      plan.route.points.shift();
    const p = plan.route.points[0];
    if (!p) {
      if (plan.kind === 'manual') this.plans.delete(a.id);
      a.yaw = a.aim;
      a.state = 'idle';
      return false;
    }
    const dx = p.x - a.x,
      dz = p.z - a.z,
      d = Math.hypot(dx, dz);
    a.yaw = Math.atan2(dx, dz);
    a.state = 'walk';
    move(a, (dx / d) * Math.min(step, d), (dz / d) * Math.min(step, d));
    return true;
  }
}
