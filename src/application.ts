import type { Lesson } from './core/onboarding';
import { AudioPlayback } from './audio/playback';
import { AudioFeedback } from './audio/feedback';
import { cleanupAll, cleanupAfterFailure } from './assets/cleanup';
import { nearbyInteraction } from './core/interaction';
import type { EquipmentSlot } from './content/items';
import { SceneAssets } from './assets/scene-assets';
import type { PreparedRegistration } from './assets/registration';
import { AssetRuntime, type PackLease, type PackBatch, type AssetPack } from './assets/loader';
import type { PresentationLifecycle } from './presentation/lifecycle';
import type { SceneContent } from './content/game-content';
import { GameSession, type RoomPlan } from './core/session';
import { FixedClock, type Command } from './core/simulation';
import { Persistence } from './persistence';
import { EventHub, type GameplayEvent } from './core/events';
import { Input } from './input';
import { parseGame, type GameSave } from './core/save';
import type { Bridge } from './platform/bridge';
import { FrameScheduler } from './frame-scheduler';
import { LoadingScopes } from './loading-scopes';
import {
  SessionOperations,
  SessionOperationCancelled,
  type SessionOperation,
} from './session-operation';
import { readUntilAborted } from './abort';
import { startupStage } from './assets/startup-timing';
export type ApplicationHooks = {
  status: (message: string, error?: boolean) => void;
  pause: (paused: boolean) => void;
  frame: () => void;
  loading?: (active: boolean) => void;
};
type ApplicationOptions = {
  seed?: number;
  extraAssets?: readonly string[];
  startup?: 'new' | 'checkpoint';
  assetProfile?: 'game' | 'authoring';
};
export type SessionReplacement =
  | { kind: 'new'; seed?: number; area?: string; prepare?: (sim: GameSession['sim']) => undefined }
  | { kind: 'save'; save: GameSave };
export type ApplicationCommand = Command | { reset: 'death' | 'manual' };
type SessionContent = { readonly session: GameSession; readonly scenes: SceneContent };
type RoomChange =
  | { kind: 'session'; next: SessionContent; events: readonly GameplayEvent[] }
  | { kind: 'area'; session: GameSession; plan: RoomPlan };
// Both launch experiences own exactly this session/loading/input/persistence lifecycle.
export class Application<P extends PresentationLifecycle = PresentationLifecycle> {
  private current: SessionContent;
  private readonly initialSeed: number;
  private readonly extraAssets: readonly string[];
  private readonly startupMode: 'new' | 'checkpoint';
  private readonly assetProfile: 'game' | 'authoring';
  get session() {
    return this.current.session.view;
  }
  get scenes() {
    return this.current.scenes;
  }
  get registry() {
    return this.scenes.registry;
  }
  presentation!: P;
  input!: Input;
  runtime!: AssetRuntime;
  persistence: Persistence;
  readonly events: EventHub;
  readonly audio: AudioPlayback;
  private readonly audioFeedback: AudioFeedback;
  clock = new FixedClock();
  private packViews = new Map<string, AssetPack>();
  private readonly previewAssets = new SceneAssets();
  private readonly previewOperations = new SessionOperations();
  get packs(): ReadonlyMap<string, AssetPack> {
    return this.packViews;
  }
  private syncPacks() {
    this.packViews.clear();
    for (const group of [this.roomAssets.packs, this.persistentLeases, this.previewAssets.packs])
      for (const [id, pack] of group) this.packViews.set(id, pack);
  }
  private persistentLeases = new Map<string, PackLease>();
  private readonly roomAssets = new SceneAssets();
  private readonly abort = new AbortController();
  private readonly sessionOperations = new SessionOperations();
  private last = 0;
  private frameEpoch = 0;
  private frames: FrameScheduler | undefined;
  private disposed = false;
  private startup?: Promise<void>;
  // Once replacement starts committing, the renderer may be partially rebuilt.
  // Only a fully prepared replacement can accept this session for use again.
  private roomAccepted = true;
  get roomReady() {
    return this.roomAccepted;
  }
  private readonly loading: LoadingScopes;
  private pauseSequence = 0;
  private aim = { x: 0, z: 1 };
  private assetLoads = new Map<string, Promise<void>>();
  private assertActive() {
    if (this.disposed) throw new Error('application disposed');
  }
  ready = false;
  get busy() {
    return this.sessionOperations.busy;
  }
  paused = false;
  readOnly = false;
  scale = 1;
  settingsError = '';
  private simulationEnabled = true;
  beforeStep: (sim: GameSession['sim']) => void = () => {};
  setSimulationEnabled(value: boolean) {
    if (value === this.simulationEnabled) return;
    this.simulationEnabled = value;
    this.resetFrameClock();
    this.input?.clear();
  }
  command: ((sim: GameSession['sim']) => ApplicationCommand) | undefined;
  afterFrame: (ms: number) => void = () => {};
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly catalog: Readonly<Record<string, string>>,
    readonly bridge: Bridge,
    scenes: SceneContent,
    readonly createPresentation: (
      canvas: HTMLCanvasElement,
      packs: ReadonlyMap<string, AssetPack>,
      events: EventHub,
      area: import('./content/world').AreaDefinition,
      registration: PreparedRegistration,
      visuals: import('./content/world-visuals').WorldVisualDefinition | undefined,
      imageRequest: typeof fetch,
    ) => P,
    readonly hooks: ApplicationHooks,
    options: ApplicationOptions = {},
  ) {
    this.loading = new LoadingScopes(
      () => {
        this.audio.setWorldFrozen(true);
        this.resetFrameClock();
        this.input?.clear();
        this.hooks.loading?.(true);
      },
      () => {
        if (this.disposed) return;
        cleanupAll([
          () => {
            // Submit the destination before revealing a paused/background window.
            if (this.ready && this.roomReady) this.presentation.update(this.sim, 1, 0, this.aim);
          },
          () => this.resetFrameClock(),
          () => this.input?.clear(),
          () => {
            if (!this.disposed && !this.loading.busy) this.hooks.loading?.(false);
          },
        ]);
      },
      (error) => this.hooks.status(`Loading feedback failed: ${String(error)}`, true),
    );
    this.events = new EventHub((error, event) =>
      this.hooks.status(
        `Event feedback failed (${event.kind}): ${error instanceof Error ? error.message : String(error)}`,
        true,
      ),
    );
    this.initialSeed = options.seed ?? 142;
    this.extraAssets = [...(options.extraAssets ?? [])];
    this.startupMode = options.startup ?? 'new';
    this.assetProfile = options.assetProfile ?? 'authoring';
    this.current = { session: new GameSession(scenes.registry, this.initialSeed), scenes };
    this.persistence = new Persistence(bridge);
    this.audio = new AudioPlayback((message) => this.hooks.status(message, true));
    this.audioFeedback = new AudioFeedback(this.audio);
    this.events.subscribe((event, signal) => this.audioFeedback.event(event, this.sim, signal));
  }
  get sim() {
    return this.current.session.sim.view;
  }
  // Developer overrides are synchronous and admitted only for an accepted,
  // storage-free room. Ordinary hosts borrow sim without command capabilities.
  editPreview(work: (sim: GameSession['sim']) => undefined) {
    this.assertActive();
    if (!this.readOnly) throw new Error('Preview edits require a read-only application');
    if (this.busy || this.loading.busy || !this.roomReady)
      throw new Error('Wait for the area to finish loading');
    work(this.current.session.sim);
  }
  private unlockAudio = () => {
    void this.audio.unlock().catch(() => {});
  };
  private onResize = () => this.presentation?.resize(this.scale);
  private onBlur = () => {
    if (this.ready) this.pause(true);
  };
  private onVisibility = () => {
    if (document.hidden) this.onBlur();
    this.resetFrameClock();
  };
  private resetFrameClock = () => {
    this.frameEpoch++;
    this.clock.reset();
    this.last = performance.now();
  };
  async withLoading<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertActive();
    return this.loading.run(work, signal);
  }
  boot() {
    if (this.disposed) return Promise.reject(new Error('application disposed'));
    // Startup owns one resource graph for this application lifetime. All callers
    // join it; a failed graph is closed rather than reused by a later attempt.
    this.startup ??= Promise.resolve()
      .then(() => this.withLoading(() => this.bootApplication()))
      .catch((error) => {
        cleanupAfterFailure(error, () => this.dispose());
      });
    return this.startup;
  }
  private async bootApplication() {
    this.assertActive();
    const settingsPromise = startupStage('settings', async () => {
      try {
        return await readUntilAborted(this.bridge.loadSettings(), this.abort.signal);
      } catch (error) {
        this.assertActive();
        this.settingsError = String((error as Error).message);
        return { status: 'empty' } as const;
      }
    });
    const checkpointPromise = startupStage('checkpoint', async () => {
      if (this.startupMode !== 'checkpoint') return;
      try {
        const result = await readUntilAborted(this.persistence.load(), this.abort.signal);
        this.assertActive();
        if (result.status === 'empty') return;
        const save = parseGame(result.data, this.registry);
        const session = new GameSession(
          this.registry,
          save.seed,
          save.area,
          this.session.generation,
        );
        const events = session.restoreSave(save);
        return { session, events };
      } catch (error) {
        this.assertActive();
        this.hooks.status(`Checkpoint unavailable: ${(error as Error).message}`, true);
      }
    });
    void settingsPromise.catch(() => {});
    void checkpointPromise.catch(() => {});
    void this.audio.initialize().catch(() => {});
    window.addEventListener('pointerdown', this.unlockAudio, { signal: this.abort.signal });
    window.addEventListener('keydown', this.unlockAudio, { signal: this.abort.signal });
    this.runtime = await startupStage('runtime', () =>
      AssetRuntime.open(this.catalog, this.canvas, 'delivery', this.assetProfile),
    );
    if (this.disposed) this.runtime.dispose?.();
    this.assertActive();
    const checkpoint = await checkpointPromise;
    this.assertActive();
    if (checkpoint) this.current = { session: checkpoint.session, scenes: this.scenes };
    const failure = new AbortController(),
      signal = AbortSignal.any([this.abort.signal, failure.signal]);
    const acquisitions = await startupStage('images', () =>
      Promise.allSettled([
        this.runtime.loadPacks(this.extraAssets, signal).catch((error) => {
          failure.abort(error);
          throw error;
        }),
        this.acquireArea(this.sim.area, signal).catch((error) => {
          failure.abort(error);
          throw error;
        }),
      ]),
    );
    if (failure.signal.aborted || this.disposed) {
      const error = failure.signal.aborted
        ? failure.signal.reason
        : new Error('application disposed');
      cleanupAfterFailure(error, () =>
        cleanupAll(
          acquisitions.flatMap((result) =>
            result.status === 'fulfilled' ? [() => result.value.release()] : [],
          ),
        ),
      );
    }
    const initial = (acquisitions[0] as PromiseFulfilledResult<PackBatch>).value;
    const room = (acquisitions[1] as PromiseFulfilledResult<PackBatch>).value;
    for (const [id, pack] of initial.packs) {
      this.persistentLeases.set(id, pack);
    }
    this.syncPacks();
    this.roomAssets.install(room, () => {
      this.syncPacks();
    });
    this.presentation = this.createPresentation(
      this.canvas,
      this.packs,
      this.events,
      this.sim.areaDefinition,
      this.runtime.registration,
      this.scenes.area(this.sim.area).visuals,
      this.runtime.imageRequest,
    );
    this.presentation.generation = this.current.session.generation;
    this.events.setGeneration(this.current.session.generation);
    this.input = new Input(this.canvas, this.presentation.camera, () => this.pause(!this.paused));
    const settings = await settingsPromise;
    this.assertActive();
    if (settings.status === 'ok') {
      this.audio.updateSettings(settings.data.audio);
      this.scale = settings.data.renderScale;
      this.presentation.verticalSpan = settings.data.verticalSpan;
      this.presentation.setDepthOfField(settings.data.depthOfField);
      this.presentation.setVisualEffects(settings.data.visualEffects);
    }
    this.assertActive();
    this.presentation.resize(this.scale);
    await startupStage('companions', () =>
      Promise.all([this.presentation.loadAnimationFlow(), this.presentation.prepareAssets()]),
    );
    this.assertActive();
    await startupStage('gpu', () => this.presentation.warm());
    this.assertActive();
    await startupStage('first-frame', async () =>
      this.presentation.update(this.sim, 1, 0, this.aim),
    );
    this.assertActive();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.ready = true;
    if (checkpoint) {
      this.input.resetAim();
      this.publish(checkpoint.events);
    }
    this.assertActive();
    this.canvas.dataset.ready = 'true';
    if (!this.bridge.automatedRun && (document.hidden || !document.hasFocus())) this.pause(true);
    this.frames = new FrameScheduler(this.loop, this.resetFrameClock, this.bridge.automatedRun);
  }
  retainAsset(id: string) {
    if (!this.disposed && this.persistentLeases.has(id)) return Promise.resolve();
    return this.withLoading(() => this.acquireAsset(id));
  }
  private async acquireAsset(id: string) {
    this.assertActive();
    if (this.persistentLeases.has(id)) return;
    const pending = this.assetLoads.get(id);
    if (pending) return pending;
    const load = (async () => {
      const pack = await this.runtime.loadPack(id, this.abort.signal);
      try {
        this.assertActive();
        this.presentation.warmPack(pack);
        this.assertActive();
      } catch (error) {
        pack.release();
        throw error;
      }
      this.persistentLeases.set(id, pack);
      this.syncPacks();
    })();
    this.assetLoads.set(id, load);
    try {
      await load;
    } finally {
      this.assetLoads.delete(id);
    }
  }
  async previewAsset(id: string, select: () => undefined) {
    this.assertActive();
    try {
      // Admit before loading feedback can synchronously submit a newer selection.
      return await this.previewOperations.run((operation) =>
        this.withLoading(async () => {
          operation.check();
          let pack: PackLease | undefined = await this.runtime.loadPack(id, operation.signal);
          try {
            operation.check();
            this.presentation.warmPack(pack);
            operation.check();
            const installed = pack;
            pack = undefined;
            // Selection can partially rebuild a renderer before failing. Retain
            // both batches until a successful successor or renderer shutdown.
            try {
              this.previewAssets.install(
                { packs: new Map([[id, installed]]), release: () => installed.release() },
                () => {
                  this.syncPacks();
                  select();
                  operation.check();
                },
              );
            } catch (error) {
              if (!this.disposed) this.syncPacks();
              throw error;
            }
            return true;
          } finally {
            pack?.release();
          }
        }, operation.signal),
      );
    } catch (error) {
      if (error instanceof SessionOperationCancelled && !this.disposed) return false;
      throw error;
    }
  }
  private async acquireArea(area: string, signal: AbortSignal, scenes = this.scenes) {
    const scene = scenes.area(area);
    if (scene.area !== scenes.registry.area(area))
      throw new Error('Scene geometry differs from its content registry');
    const held = await this.runtime.loadPacks([...scenes.initialAssets, ...scene.assets], signal);
    try {
      scenes.validate(scene, held.packs);
      return held;
    } catch (error) {
      held.release();
      throw error;
    }
  }
  publish(events: readonly GameplayEvent[]) {
    this.events.setGeneration(this.current.session.generation);
    this.events.publish(events);
  }
  private async withSessionOperation<T>(work: (operation: SessionOperation) => Promise<T>) {
    this.assertActive();
    if (this.startup && !this.ready) throw new Error('Wait for startup to finish loading');
    return this.sessionOperations.run((operation) =>
      this.withLoading(async () => {
        try {
          // Loading hooks can synchronously replace this intent before work starts.
          operation.check();
          return await work(operation);
        } finally {
          if (!operation.signal.aborted && !this.disposed && !this.roomReady) this.pause(true);
        }
      }, operation.signal),
    );
  }
  // Construct the candidate before acquisition. Callers never receive the session
  // owner, choose its generation or submit feedback for an uncommitted room.
  replaceSession(scenes: SceneContent, replacement: SessionReplacement = { kind: 'new' }) {
    return this.withSessionOperation(async (operation) => {
      if (!this.readOnly && scenes.registry !== this.registry)
        throw new Error('Changing content requires a read-only application');
      let session: GameSession;
      let events: readonly GameplayEvent[] = [];
      if (replacement.kind === 'save') {
        const save = parseGame(replacement.save, scenes.registry);
        session = new GameSession(scenes.registry, save.seed, save.area, this.session.generation);
        events = session.restoreSave(save);
      } else {
        session = new GameSession(
          scenes.registry,
          replacement.seed ?? this.initialSeed,
          replacement.area ?? scenes.registry.definitions.initialArea,
          this.session.generation + 1,
        );
        replacement.prepare?.(session.sim);
      }
      await this.replaceRoom({ kind: 'session', next: { session, scenes }, events }, operation);
    });
  }
  private async replaceRoom(change: RoomChange, operation: SessionOperation) {
    operation.check();
    const source = change.kind === 'session' ? change.next : this.current,
      area = change.kind === 'session' ? source.session.sim.area : change.plan.destination;
    this.input.clear();
    if (this.sim.areaDefinition.campfires?.length && !this.bridge.automatedRun) {
      await new Promise<void>((resolve) => setTimeout(resolve, 160));
      operation.check();
    }
    let next: PackBatch | undefined;
    try {
      next = await this.acquireArea(area, operation.signal, source.scenes);
      operation.check();
      for (const pack of next.packs.values()) this.presentation.warmPack(pack);
      await this.presentation.prepareAssets(new Set([...this.packs.keys(), ...next.packs.keys()]));
      operation.check();
      if (change.kind === 'session' && !this.readOnly && source.scenes.registry !== this.registry)
        throw new Error('Changing content requires a read-only application');
      if (change.kind === 'area') {
        if (change.session !== this.current.session) throw new Error('stale session');
        change.session.checkRoomPlan(change.plan);
      }
      this.roomAccepted = false;
      let changes: readonly GameplayEvent[];
      if (change.kind === 'session') {
        this.current = source;
        changes = change.events;
      } else changes = change.session.commitRoom(change.plan);
      this.audio.replaceSession();
      this.events.setGeneration(this.current.session.generation);
      operation.check();
      const installing = next;
      next = undefined; // Installation transfers ownership even if rebuilding throws.
      this.roomAssets.install(installing, () => {
        this.syncPacks();
        this.presentation.resetRoom(
          this.sim.areaDefinition,
          this.scenes.area(this.sim.area).visuals,
        );
        this.presentation.generation = this.current.session.generation;
      });
      operation.check();
      await this.presentation.prepareAssets();
      operation.check();
      this.roomAccepted = true;
      this.input.resetAim();
      this.publish(changes);
    } finally {
      next?.release();
    }
  }
  pause(value: boolean) {
    this.pauseSequence++;
    value = value || !this.roomReady;
    const changed = value !== this.paused;
    this.paused = value;
    this.audio.setWorldFrozen(value || this.loading.busy);
    if (changed)
      void this.audio.play(value ? 'ui-confirm' : 'ui-cancel', { world: false }).catch(() => {});
    this.resetFrameClock();
    this.input?.clear();
    this.hooks.pause(value);
  }
  safe(fn: () => Promise<unknown>) {
    void (async () => fn())().catch((error: unknown) => {
      if (!(error instanceof SessionOperationCancelled)) {
        void this.audio.play('ui-deny', { world: false }).catch(() => {});
        this.hooks.status(String((error as Error | null | undefined)?.message ?? error), true);
      }
    });
  }
  private async replacePlannedRoom(plan: RoomPlan, operation: SessionOperation) {
    const session = this.current.session;
    const cancel = () => this.publish(session.cancelRoom(plan));
    operation.signal.addEventListener('abort', cancel, { once: true });
    try {
      this.publish(plan.events);
      operation.check();
      await this.replaceRoom({ kind: 'area', session, plan }, operation);
      operation.check();
    } catch (error) {
      cancel();
      throw error;
    } finally {
      operation.signal.removeEventListener('abort', cancel);
    }
  }
  transition(id: string) {
    return this.withSessionOperation(async (operation) => {
      const plan = this.current.session.prepareTransition(id);
      try {
        await this.replacePlannedRoom(plan, operation);
        this.autosave();
      } catch (error) {
        if (!operation.signal.aborted) this.pause(true);
        throw error;
      }
    });
  }
  get interaction() {
    return nearbyInteraction(this.current.session.sim);
  }
  interact() {
    if (this.busy || !this.roomReady || this.paused) return;
    const target = this.interaction;
    if (!target) return;
    if (target.blocked) throw new Error(target.blocked);
    if (target.kind === 'drop') {
      if (this.current.session.sim.collectDrop(target.id)) {
        this.publish(this.current.session.sim.events);
        this.hooks.status(target.label);
        this.autosave();
      }
    } else if (target.kind === 'container') {
      if (this.current.session.sim.openContainer(target.id)) {
        this.publish(this.current.session.sim.events);
        this.autosave();
      }
    } else if (target.kind === 'campfire') {
      this.publish(this.current.session.discoverFire(this.sim.area + '/' + target.id));
      this.autosave();
      return this.sim.area + '/' + target.id;
    } else if (target.kind === 'exit') {
      this.safe(() => this.transition(target.id));
    }
  }
  changeInventory(action: 'equip' | 'unequip' | 'salvage', item?: string, slot?: EquipmentSlot) {
    if (this.busy || !this.roomReady) throw new Error('Wait for the area to finish loading');
    const events =
      action === 'equip'
        ? this.current.session.equip(item!, slot!)
        : action === 'unequip'
          ? this.current.session.unequip(slot!)
          : this.current.session.salvage(item);
    this.publish(events);
    this.autosave();
  }
  changeHints(action: 'dismiss' | 'replay', lesson?: Lesson) {
    this.assertActive();
    if (this.busy || !this.roomReady) return;
    if (action === 'replay') this.current.session.replayHints();
    else if (lesson) this.current.session.dismissLesson(lesson);
    this.autosave();
  }
  rest(key: string) {
    return this.withSessionOperation(async (operation) => {
      if (this.sim.inCombat) throw new Error('Finish combat before resting');
      await this.replacePlannedRoom(this.current.session.prepareRest(key), operation);
      this.autosave();
    });
  }
  travel(key: string) {
    return this.withSessionOperation(async (operation) => {
      await this.replacePlannedRoom(this.current.session.prepareFireTravel(key), operation);
      this.autosave();
    });
  }
  reset(reason: 'death' | 'manual' = 'manual') {
    return this.withSessionOperation(async (operation) => {
      const resume = this.resumeOnCompletion();
      await this.replacePlannedRoom(this.current.session.prepareReset(reason), operation);
      operation.check();
      // Adventure resets change persistent encounter progress as well as player health.
      if (
        reason === 'death' ||
        this.registry.definitions.areas.some((area) => area.campfires?.length)
      )
        this.autosave();
      resume();
    });
  }
  private resumeOnCompletion() {
    this.assertActive();
    const sequence = this.pauseSequence;
    return () => {
      if (!this.disposed && sequence === this.pauseSequence && !this.frames?.idle)
        this.pause(false);
    };
  }
  private async restoreState(save: GameSave, operation: SessionOperation) {
    operation.check();
    await this.replacePlannedRoom(this.current.session.prepareRestore(save), operation);
  }
  restore(save: GameSave) {
    return this.withSessionOperation(async (operation) => {
      const resume = this.resumeOnCompletion();
      await this.restoreState(save, operation);
      operation.check();
      resume();
    });
  }
  load() {
    return this.withSessionOperation(async (operation) => {
      const resume = this.resumeOnCompletion(),
        result = await operation.read(this.persistence.load());
      if (result.status === 'empty') return false;
      await this.restoreState(result.data, operation);
      operation.check();
      resume();
      void this.audio.play('success', { world: false }).catch(() => {});
      return true;
    });
  }
  newGame() {
    return this.withSessionOperation(async (operation) => {
      const resume = this.resumeOnCompletion();
      await this.replaceRoom(
        {
          kind: 'session',
          events: [],
          next: {
            session: new GameSession(
              this.registry,
              this.initialSeed,
              this.registry.definitions.initialArea,
              this.current.session.generation + 1,
            ),
            scenes: this.scenes,
          },
        },
        operation,
      );
      operation.check();
      if (!this.readOnly) await this.persistence.save(this.current.session.captureSave());
      operation.check();
      void this.audio.play('success', { world: false }).catch(() => {});
      resume();
    });
  }
  async saveSettings() {
    await this.bridge.saveSettings({
      version: 6,
      audio: this.audio.settings,
      renderScale: this.scale,
      showDebug: false,
      verticalSpan: this.presentation.verticalSpan,
      depthOfField: this.presentation.depthOfField,
      visualEffects: this.presentation.visualEffects,
    });
    this.settingsError = '';
  }
  async save() {
    if (this.readOnly) throw new Error('Sandbox sessions cannot write checkpoints');
    if (!this.roomReady)
      throw new Error('Room is not ready; reset or load a checkpoint to recover');
    await this.persistence.save(this.current.session.captureSave());
    await this.saveSettings();
    void this.audio.play('success', { world: false }).catch(() => {});
  }
  autosave() {
    if (!this.readOnly && this.roomReady)
      this.safe(() => this.persistence.save(this.current.session.captureSave()));
  }
  private get frameFrozen() {
    const idle =
      this.frames?.idle ?? (!this.bridge.automatedRun && (document.hidden || !document.hasFocus()));
    return this.paused || !this.roomReady || this.busy || this.loading.busy || idle;
  }
  private loop = (now: number) => {
    if (this.disposed) return;
    const ms = Math.max(0, now - this.last);
    this.last = now;
    let alpha = 1;
    let aim = this.aim;
    const epoch = this.frameEpoch;
    // Every external callback may revoke this frame, even if it immediately
    // resumes play. A reset starts a new clock admission on the next frame.
    const admitted = () =>
      !this.disposed && epoch === this.frameEpoch && !this.frameFrozen && this.simulationEnabled;
    this.audioFeedback.frame(this.sim, this.frameFrozen || !this.simulationEnabled);
    if (admitted())
      alpha = this.clock.advance(ms, () => {
        if (!admitted()) return false;
        const session = this.current.session,
          sim = session.sim;
        this.beforeStep(sim);
        if (!admitted() || session !== this.current.session) return false;
        const cmd =
          this.command?.(sim) ?? this.input.consume(sim.hero, sim.areaDefinition, sim.generation);
        if (!admitted() || session !== this.current.session) return false;
        if ('reset' in cmd) {
          this.safe(() => this.reset(cmd.reset));
          return false;
        }
        aim = cmd.aim;
        this.aim = aim;
        const result = this.current.session.step(cmd);
        this.publish(result.events);
        // Feedback can close the application or start a different room intent.
        // Do not capture, reset or transition a successor on behalf of this tick.
        if (this.disposed || session !== this.current.session || !this.roomReady) return false;
        if (
          result.onboardingChanged ||
          result.events.some(
            (e) =>
              e.kind === 'potion-used' ||
              e.kind === 'pickup' ||
              e.kind === 'object-claimed' ||
              (e.kind === 'death' && e.actor !== 'player'),
          )
        )
          this.autosave();
        if (!admitted()) return false;
        if (result.reset) {
          this.safe(() => this.reset(result.reset));
          return false;
        }
        if (result.transition && !this.command) {
          this.safe(() => this.transition(result.transition!));
          return false;
        }
        return true;
      });
    if (this.disposed) return;
    if (this.roomReady) {
      const frozen = this.frameFrozen || epoch !== this.frameEpoch;
      this.presentation.update(this.sim, frozen ? 1 : alpha, frozen ? 0 : ms, aim);
    }
    if (this.disposed) return;
    this.hooks.frame();
    if (!this.disposed) this.afterFrame(ms);
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Close admission and frame visibility before invoking host or renderer code.
    this.ready = false;
    this.roomAccepted = false;
    delete this.canvas.dataset.ready;
    const retained = [...this.persistentLeases.values()];
    this.persistentLeases.clear();
    this.loading.dispose();
    cleanupAll([
      () => this.sessionOperations.dispose(),
      () => this.previewOperations.dispose(),
      () => this.abort.abort(),
      () => this.frames?.dispose(),
      () => window.removeEventListener('resize', this.onResize),
      () => window.removeEventListener('blur', this.onBlur),
      () => document.removeEventListener('visibilitychange', this.onVisibility),
      () => this.hooks.loading?.(false),
      () => this.input?.dispose(),
      () => this.audio.dispose(),
      () => this.presentation?.dispose(),
      () => this.previewAssets.dispose(),
      () => this.roomAssets.dispose(),
      ...retained.map((pack) => () => pack.release()),
      () => this.packViews.clear(),
      () => this.runtime?.dispose?.(),
      () => this.events.dispose(),
    ]);
  }
}
