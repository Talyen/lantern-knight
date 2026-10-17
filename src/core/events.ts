import type { ActorId, AreaId } from '../content/world';
export type DamageType = 'physical' | 'burn';
export type DamagePhase = 'direct' | 'over-time';
type EventBase = {
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
  | { kind: 'object-claimed'; object: string }
  | { kind: 'potion-used' | 'dodge' | 'rested' }
  | { kind: 'campfire-discovered'; fire: string }
  | {
      kind: 'inventory-changed';
      operation: 'equip' | 'unequip' | 'salvage' | 'upgrade' | 'move' | 'organize';
    }
  | { kind: 'action-unavailable'; reason: string }
  | { kind: 'pickup'; pickup: string; amount: number }
  | { kind: 'damage'; target: ActorId; amount: number; damageType: DamageType; phase: DamagePhase }
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
type Consumer = {
  handler: (event: PresentationEvent, lifetime: AbortSignal) => unknown;
  lifetime: AbortController;
};
// Feedback observes committed outcomes. Its callbacks cannot own gameplay progress.
export class EventHub {
  private consumers = new Set<Consumer>();
  private generation = -1;
  private epoch = 0;
  private tick = -1;
  private tickKeys = new Set<string>();
  private animations = new Map<string, { instance: number; time: number; keys: Set<string> }>();
  private queue: PresentationEvent[] = [];
  private dispatching = false;
  private changingGeneration = 0;
  private disposed = false;
  private readonly acceptedHistory: PresentationEvent[] = [];
  get history(): readonly PresentationEvent[] {
    return Object.freeze([...this.acceptedHistory]);
  }
  constructor(
    private readonly report: (error: unknown, event: PresentationEvent) => void = (error) =>
      console.error('Event feedback failed', error),
  ) {}
  subscribe(handler: Consumer['handler']) {
    if (this.disposed) throw new Error('event hub disposed');
    const consumer = { handler, lifetime: new AbortController() };
    this.consumers.add(consumer);
    return () => {
      this.consumers.delete(consumer);
      consumer.lifetime.abort();
    };
  }
  setGeneration(generation: number) {
    if (this.disposed || generation === this.generation) return;
    this.changingGeneration++;
    try {
      this.generation = generation;
      this.epoch++;
      this.tick = -1;
      this.tickKeys.clear();
      this.animations.clear();
      this.queue.length = 0;
      // Replace every lifetime before abort callbacks can re-enter the hub.
      const previous = [...this.consumers].map((consumer) => {
        const lifetime = consumer.lifetime;
        consumer.lifetime = new AbortController();
        return lifetime;
      });
      for (const lifetime of previous) lifetime.abort();
    } finally {
      this.changingGeneration--;
      this.drain();
    }
  }
  private accept(event: PresentationEvent) {
    if (event.generation !== this.generation) return false;
    if (event.kind === 'animation-notify') {
      let cursor = this.animations.get(event.actor);
      if (
        cursor &&
        (event.instance < cursor.instance ||
          (event.instance === cursor.instance && event.timeMs < cursor.time))
      )
        return false;
      if (!cursor || event.instance > cursor.instance || event.timeMs > cursor.time) {
        cursor = { instance: event.instance, time: event.timeMs, keys: new Set() };
        this.animations.set(event.actor, cursor);
      }
      if (cursor.keys.has(event.key)) return false;
      cursor.keys.add(event.key);
    } else {
      if (event.tick < this.tick) return false;
      if (event.tick > this.tick) {
        this.tick = event.tick;
        this.tickKeys.clear();
      }
      if (this.tickKeys.has(event.key)) return false;
      this.tickKeys.add(event.key);
    }
    return true;
  }
  publish(events: readonly PresentationEvent[]) {
    if (this.disposed) return;
    // Capture the complete batch before any observer can re-enter publication.
    this.queue.push(
      ...events.map((event) =>
        Object.freeze({
          ...event,
          position: Object.freeze([...event.position]) as EventBase['position'],
        }),
      ),
    );
    this.drain();
  }
  private fail(
    consumer: Consumer,
    lifetime: AbortController,
    event: PresentationEvent,
    error: unknown,
  ) {
    // A late rejection belongs to its old lifetime, not the replacement session.
    if (lifetime.signal.aborted || !this.consumers.has(consumer)) return;
    this.consumers.delete(consumer);
    lifetime.abort();
    try {
      this.report(error, event);
    } catch {
      // Diagnostics are also observers and cannot interrupt event delivery.
    }
  }
  private drain() {
    if (this.dispatching || this.changingGeneration || this.disposed) return;
    this.dispatching = true;
    try {
      let event: PresentationEvent | undefined;
      while (!this.disposed && (event = this.queue.shift())) {
        if (!this.accept(event)) continue;
        this.acceptedHistory.push(event);
        if (this.acceptedHistory.length > 100) this.acceptedHistory.shift();
        const epoch = this.epoch;
        // New subscribers start with the next event; removal takes effect immediately.
        for (const consumer of [...this.consumers]) {
          if (this.disposed || epoch !== this.epoch) break;
          if (!this.consumers.has(consumer)) continue;
          const lifetime = consumer.lifetime,
            delivered = event;
          try {
            const result = consumer.handler(delivered, lifetime.signal);
            if (
              result !== null &&
              (typeof result === 'object' || typeof result === 'function') &&
              'then' in result
            )
              void Promise.resolve(result).catch((error: unknown) =>
                this.fail(consumer, lifetime, delivered, error),
              );
          } catch (error) {
            this.fail(consumer, lifetime, delivered, error);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    const consumers = [...this.consumers];
    this.consumers.clear();
    this.animations.clear();
    this.tickKeys.clear();
    this.acceptedHistory.length = 0;
    for (const consumer of consumers) consumer.lifetime.abort();
  }
}
