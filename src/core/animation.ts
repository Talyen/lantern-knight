import type { Clip } from '../assets/schema';
export function clipDuration(clip: Clip) {
  return clip.durationsMs.reduce((a, b) => a + b, 0);
}
export function clipTime(clip: Clip, timeMs: number) {
  const duration = clipDuration(clip),
    time = Math.max(0, timeMs);
  if (!clip.loop) return Math.min(time, duration - 0.0001);
  const wrapped = time % duration;
  return duration - wrapped < 1e-7 ? 0 : wrapped;
}
export function frameAt(clip: Clip, timeMs: number) {
  const t = clipTime(clip, timeMs);
  // Tick-authored fractions can accumulate just above their exact 60 Hz boundary.
  let end = 0;
  for (let i = 0; i < clip.frames.length; i++) {
    end += clip.durationsMs[i]!;
    if (t < end - 1e-7) return clip.frames[i]!;
  }
  return clip.frames.at(-1)!;
}
export class Animator {
  time = 0;
  instance = 0;
  private notifiedThrough = -Number.EPSILON;
  private orderedNotifies: Clip['notifies'];
  constructor(
    public actor: string,
    public clip: Clip,
  ) {
    this.orderedNotifies = [...clip.notifies].sort((a, b) => a.atMs - b.atMs);
  }
  start(clip: Clip) {
    this.clip = clip;
    this.orderedNotifies = [...clip.notifies].sort((a, b) => a.atMs - b.atMs);
    this.time = 0;
    this.notifiedThrough = -Number.EPSILON;
    this.instance++;
  }
  seek(time: number) {
    this.time = Math.max(0, time);
    this.notifiedThrough = Math.max(this.notifiedThrough, this.time);
  } // silent; rewinding cannot replay already crossed notifies
  advance(ms: number) {
    const from =
        this.notifiedThrough < 0 ? this.notifiedThrough : Math.max(this.time, this.notifiedThrough),
      to = this.time + Math.max(0, ms),
      duration = clipDuration(this.clip),
      events: { key: string; kind: string; timeMs: number; instance: number }[] = [];
    const first = Math.floor(Math.max(0, from) / duration),
      last = this.clip.loop ? Math.floor(to / duration) : 0;
    for (let loop = this.clip.loop ? first : 0; loop <= last; loop++)
      for (const event of this.orderedNotifies) {
        const at = loop * duration + event.atMs;
        if (at > from && at <= to)
          events.push({
            key: `${this.actor}:${this.instance}:${loop}:${event.id}`,
            kind: event.kind,
            timeMs: at,
            instance: this.instance,
          });
      }
    this.time = to;
    this.notifiedThrough = Math.max(this.notifiedThrough, to);
    return events;
  }
  get frame() {
    return frameAt(this.clip, this.time);
  }
}
