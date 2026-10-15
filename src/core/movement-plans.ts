import { Navigation, effectiveRadius, clearSegment, type RouteResult } from './navigation';
import type { Point, AreaDefinition } from '../content/world';
import type { ContentSnapshot } from '../content/snapshot';
import type { Actor } from './actor';

// One room owns one planner. Routes are transient and never part of checkpoints.
export class MovementPlans {
  constructor(private readonly area: ContentSnapshot<AreaDefinition>) {}
  private navigation?: Navigation;
  private plans = new Map<
    string,
    { target: Point; route: RouteResult; nextPlan: number; kind: 'manual' | 'home' | 'pursuit' }
  >();
  setManual(actor: Actor, target: Point | null, tick: number) {
    if (!target) {
      this.plans.delete(actor.id);
      return;
    }
    if (!Number.isFinite(target.x) || !Number.isFinite(target.z))
      throw new Error('Movement destination must be finite');
    this.plans.set(actor.id, {
      kind: 'manual',
      target: { ...target },
      route: this.navigator.route(actor, target, effectiveRadius(actor.definition.radius)),
      nextPlan: tick + 15,
    });
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
  private get navigator() {
    return (this.navigation ??= new Navigation(this.area));
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
      cells: includeCells && this.navigation ? this.navigation.debugCells(radius) : [],
    };
  }
  private pursuitRoute(a: Actor, target: Point, kind: 'home' | 'pursuit'): RouteResult {
    const radius = effectiveRadius(a.definition.radius);
    const direct = this.navigator.route(a, target, radius);
    if (direct.status === 'ready' || kind !== 'pursuit') return direct;
    // A larger enemy may not fit at the hero's feet. Find a reachable melee
    // position with clear contact rather than treating the hero as unreachable.
    const distance = a.definition.melee.range * 0.8;
    const candidates = Array.from({ length: 16 }, (_, i) => ({
      x: target.x + Math.cos((i * Math.PI) / 8) * distance,
      z: target.z + Math.sin((i * Math.PI) / 8) * distance,
    })).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
    for (const point of candidates) {
      if (!clearSegment(this.area, point, target, 0.001)) continue;
      const route = this.navigator.route(a, point, radius);
      if (route.status === 'ready') return route;
    }
    return direct;
  }
  follow(
    a: Actor,
    tick: number,
    move: (actor: Actor, x: number, z: number) => void,
    intent?: { kind: 'home' | 'pursuit'; target: Point },
  ) {
    const target = intent?.target;
    const kind = intent?.kind ?? 'home';
    void this.navigator;
    let plan = this.plans.get(a.id);
    // An intent change invalidates automatic routes immediately. Moving pursuit
    // targets still replan on the normal cadence; manual commands retain priority.
    if (plan && plan.kind !== 'manual' && plan.kind !== kind) {
      this.plans.delete(a.id);
      plan = undefined;
    }
    if (!plan) {
      if (!target) return false;
      plan = {
        target: { ...target },
        route: this.pursuitRoute(a, target, kind),
        nextPlan: tick + 15,
        kind,
      };
      this.plans.set(a.id, plan);
    }
    if (target && plan.kind !== 'manual' && tick >= plan.nextPlan) {
      plan.target = { ...target };
      plan.route = this.pursuitRoute(a, target, kind);
      plan.nextPlan = tick + 15;
    }
    const waypoint = plan.route.points[0];
    if (waypoint && !clearSegment(this.area, a, waypoint, effectiveRadius(a.definition.radius))) {
      // Collisions and dashes can displace an actor from its planned route.
      plan.route =
        plan.kind === 'manual'
          ? this.navigator.route(a, plan.target, effectiveRadius(a.definition.radius))
          : this.pursuitRoute(a, target ?? plan.target, kind);
      plan.nextPlan = tick + 15;
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
