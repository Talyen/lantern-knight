import type { ActorId, AreaId } from '../content/world';
export type EventBase = {
  readonly key: string;
  readonly tick: number;
  readonly generation: number;
  readonly actor: ActorId;
  readonly action: number;
  readonly area: AreaId;
  readonly position: readonly [number, number, number];
  readonly direction: number;
};
export type EventDetails =
  | { kind: 'damage'; target: ActorId; amount: number }
  | { kind: 'stagger'; target: ActorId; duration: number }
  | { kind: 'strike' | 'flare' | 'death' | 'room-clear' }
  | { kind: 'room-reset'; reason: 'death' | 'manual' }
  | {
      kind: 'transition-start' | 'area-transition' | 'transition-cancelled';
      destination: AreaId;
    };
export type GameplayEvent = Readonly<EventBase & EventDetails>;
export type AnimationEvent = Readonly<
  EventBase & {
    kind: 'animation-notify';
    notify: string;
    clip: string;
    instance: number;
    timeMs: number;
  }
>;
export type PresentationEvent = GameplayEvent | AnimationEvent;
export class EventHub {
  private consumers = new Map<
    symbol,
    {
      handler: (event: PresentationEvent, lifetime: AbortSignal) => void;
      lifetime: AbortController;
    }
  >();
  private generation = -1;
  private tick = -1;
  private tickKeys = new Set<string>();
  private animations = new Map<string, { instance: number; time: number; keys: Set<string> }>();
  readonly history: PresentationEvent[] = [];
  subscribe(handler: (event: PresentationEvent, lifetime: AbortSignal) => void) {
    const key = Symbol(),
      consumer = { handler, lifetime: new AbortController() };
    this.consumers.set(key, consumer);
    return () => {
      consumer.lifetime.abort();
      this.consumers.delete(key);
    };
  }
  setGeneration(generation: number) {
    if (generation === this.generation) return;
    this.generation = generation;
    for (const consumer of this.consumers.values()) {
      consumer.lifetime.abort();
      consumer.lifetime = new AbortController();
    }
    this.tick = -1;
    this.tickKeys.clear();
    this.animations.clear();
  }
  publish(events: readonly PresentationEvent[]) {
    for (const event of events) {
      if (event.generation !== this.generation) continue;
      if (event.kind === 'animation-notify') {
        let cursor = this.animations.get(event.actor);
        if (
          cursor &&
          (event.instance < cursor.instance ||
            (event.instance === cursor.instance && event.timeMs < cursor.time))
        )
          continue;
        if (!cursor || event.instance > cursor.instance || event.timeMs > cursor.time) {
          cursor = {
            instance: event.instance,
            time: event.timeMs,
            keys: new Set(),
          };
          this.animations.set(event.actor, cursor);
        }
        if (cursor.keys.has(event.key)) continue;
        cursor.keys.add(event.key);
      } else {
        if (event.tick < this.tick) continue;
        if (event.tick > this.tick) {
          this.tick = event.tick;
          this.tickKeys.clear();
        }
        if (this.tickKeys.has(event.key)) continue;
        this.tickKeys.add(event.key);
      }
      this.history.push(event);
      if (this.history.length > 100) this.history.shift();
      for (const consumer of this.consumers.values())
        consumer.handler(event, consumer.lifetime.signal);
    }
  }
  dispose() {
    for (const consumer of this.consumers.values()) consumer.lifetime.abort();
    this.consumers.clear();
    this.animations.clear();
    this.tickKeys.clear();
    this.history.length = 0;
  }
}
