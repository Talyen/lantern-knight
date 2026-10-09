import type { Bounds } from '../content/world';
import { normalizeWeather, type WeatherState } from '../content/visual-effects';
export const RAIN_SLOTS = 32,
  RAIN_FALL = 0.52,
  RAIN_SPLASH = 1,
  RAIN_RIPPLE = 1.2;
const RAIN_PERIOD = 3;
function random(seed: number) {
  let v = seed | 0;
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}
export function sheltered(x: number, z: number, shelters: readonly Bounds[]) {
  return shelters.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}
export function rainPathSheltered(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  shelters: readonly Bounds[],
) {
  return shelters.some((b) => {
    let enter = 0,
      leave = 1;
    for (const [a, d, min, max] of [
      [fromX, toX - fromX, b.minX, b.maxX],
      [fromZ, toZ - fromZ, b.minZ, b.maxZ],
    ]) {
      if (Math.abs(d!) < 1e-8) {
        if (a! < min! || a! > max!) return false;
      } else {
        const t0 = (min! - a!) / d!,
          t1 = (max! - a!) / d!;
        enter = Math.max(enter, Math.min(t0, t1));
        leave = Math.min(leave, Math.max(t0, t1));
        if (enter > leave) return false;
      }
    }
    return true;
  });
}
/** One schedule owns both the falling streak and its ground reaction. */
export function rainEvent(
  time: number,
  slot: number,
  seed: number,
  bounds: Bounds,
  weather: WeatherState,
) {
  const phase = (slot / RAIN_SLOTS) * RAIN_PERIOD,
    cycle = Math.floor((time - phase) / RAIN_PERIOD),
    age = time - phase - cycle * RAIN_PERIOD,
    k = seed + slot * 211 + cycle * 7919;
  const x = bounds.minX + random(k + 1) * (bounds.maxX - bounds.minX),
    z = bounds.minZ + random(k + 2) * (bounds.maxZ - bounds.minZ),
    height = 1.4 + random(k + 3) * 1.1,
    w = normalizeWeather(weather);
  return {
    slot,
    cycle,
    x,
    z,
    age,
    height,
    impactTime: phase + cycle * RAIN_PERIOD + RAIN_FALL,
    splashAge: age - RAIN_FALL,
    active: cycle >= 0 && slot < Math.round(w.rain * RAIN_SLOTS),
    startX: x - w.wind.x * RAIN_FALL - 0.16,
    startZ: z - w.wind.z * RAIN_FALL - 0.05,
  };
}
/** Gusts affect new drops; an airborne drop retains its original trajectory. */
export class RainSchedule {
  private events = new Map<number, ReturnType<typeof rainEvent>>();
  constructor(private seed: number) {}
  reset() {
    this.events.clear();
  }
  sample(time: number, slot: number, bounds: Bounds, weather: WeatherState) {
    const next = rainEvent(time, slot, this.seed, bounds, weather),
      previous = this.events.get(slot);
    if (!previous || previous.cycle !== next.cycle) {
      this.events.set(slot, next);
      return next;
    }
    previous.age = next.age;
    previous.splashAge = next.splashAge;
    previous.active = next.active;
    return previous;
  }
}
