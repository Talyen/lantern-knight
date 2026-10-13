import { SceneAssets } from './assets/scene-assets';
import type { PreparedRegistration } from './assets/registration';
import { AssetRuntime, type PackLease, type PackBatch, type AssetPack } from './assets/loader';
import type { PresentationLifecycle } from './presentation/lifecycle';
import type { SceneContent } from './content/game-content';
import { GameSession } from './core/session';
import { FixedClock, type Command } from './core/simulation';
import { Persistence } from './persistence';
import { EventHub, type GameplayEvent } from './core/events';
import { Input } from './core/input';
import { ContentRegistry } from './content/world';
import { parseGame, type GameSave } from './core/save';
import type { Bridge } from './platform/bridge';
import { FrameScheduler } from './frame-scheduler';
import { SessionOperation, SessionOperationCancelled } from './session-operation';
import { readUntilAborted } from './abort';
export type ApplicationHooks = {
  status: (message: string, error?: boolean) => void;
  pause: (paused: boolean) => void;
  frame: () => void;
  loading?: (active: boolean) => void;
};
// Both launch experiences own exactly this session/loading/input/persistence lifecycle.
export class Application<P extends PresentationLifecycle = PresentationLifecycle> {
  session: GameSession;
  presentation!: P;
  input!: Input;
  runtime!: AssetRuntime;
  persistence: Persistence;
  readonly events: EventHub;
  clock = new FixedClock();
  private packViews = new Map<string, AssetPack>();
  private previewPack?: { id: string; pack: PackLease };
  private previewRequest = 0;
  get packs(): ReadonlyMap<string, AssetPack> {
    return this.packViews;
  }
  private syncPacks() {
    this.packViews.clear();
    for (const group of [this.roomAssets.packs, this.persistentLeases])
      for (const [id, pack] of group) this.packViews.set(id, pack);
    if (this.previewPack) this.packViews.set(this.previewPack.id, this.previewPack.pack);
  }
  private persistentLeases = new Map<string, PackLease>();
  private readonly roomAssets = new SceneAssets();
  private readonly abort = new AbortController();
  private sessionOperation?: SessionOperation;
  private last = 0;
  private frames: FrameScheduler | undefined;
  private disposed = false;
  private startup?: Promise<void>;
  // Once replacement starts committing, the renderer may be partially rebuilt.
  // Only a fully prepared replacement can accept this session for use again.
  private roomAccepted = true;
  get roomReady() {
    return this.roomAccepted;
  }
  private loading = new Set<symbol>();
  private pauseSequence = 0;
  private aim = { x: 0, z: 1 };
  private assetLoads = new Map<string, Promise<void>>();
  private assertActive() {
    if (this.disposed) throw new Error('application disposed');
  }
  ready = false;
  get busy() {
    return this.sessionOperation !== undefined;
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
  command: ((sim: GameSession['sim']) => Command) | undefined;
  afterFrame: (ms: number) => void = () => {};
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly registry: ContentRegistry,
    readonly catalog: Readonly<Record<string, string>>,
    readonly bridge: Bridge,
    readonly scenes: SceneContent,
    readonly createPresentation: (
      canvas: HTMLCanvasElement,
      packs: ReadonlyMap<string, AssetPack>,
      events: EventHub,
      area: import('./content/world').AreaDefinition,
      registration: PreparedRegistration,
      visuals: import('./content/world-visuals').WorldVisualDefinition | undefined,
    ) => P,
    readonly hooks: ApplicationHooks,
    readonly extraAssets: readonly string[] = [],
  ) {
    this.events = new EventHub((error, event) =>
      this.hooks.status(
        `Event feedback failed (${event.kind}): ${error instanceof Error ? error.message : String(error)}`,
        true,
      ),
    );
    this.session = new GameSession(registry);
    this.persistence = new Persistence(bridge);
  }
  get sim() {
    return this.session.sim;
  }
  private onResize = () => this.presentation?.resize(this.scale);
  private onBlur = () => {
    if (this.ready) this.pause(true);
  };
  private onVisibility = () => {
    if (document.hidden) this.onBlur();
    this.resetFrameClock();
  };
  private resetFrameClock = () => {
    this.clock.reset();
    this.last = performance.now();
  };
  async withLoading<T>(work: () => Promise<T>): Promise<T> {
    this.assertActive();
    const token = Symbol();
    this.loading.add(token);
    if (this.loading.size === 1) {
      this.clock.reset();
      this.input?.clear();
      this.hooks.loading?.(true);
    }
    try {
      return await work();
    } finally {
      this.loading.delete(token);
      if (!this.disposed && this.loading.size === 0) {
        try {
          // Submit the destination before revealing it, even in a paused/background window.
          if (this.ready && this.roomReady) this.presentation.update(this.sim.view, 1, 0, this.aim);
        } finally {
          this.resetFrameClock();
          this.input?.clear();
          this.hooks.loading?.(false);
        }
      }
    }
  }
  boot() {
    if (this.disposed) return Promise.reject(new Error('application disposed'));
    // Startup owns one resource graph for this application lifetime. All callers
    // join it; a failed graph is closed rather than reused by a later attempt.
    this.startup ??= Promise.resolve()
      .then(() => this.withLoading(() => this.bootApplication()))
      .catch((error) => {
        this.dispose();
        throw error;
      });
    return this.startup;
  }
  private async bootApplication() {
    this.assertActive();
    this.runtime = await AssetRuntime.open(this.catalog, this.canvas);
    if (this.disposed) this.runtime.dispose?.();
    this.assertActive();
    const initial = await this.runtime.loadPacks(
      [...this.scenes.initialAssets.filter((id) => id in this.catalog), ...this.extraAssets],
      this.abort.signal,
    );
    if (this.disposed) {
      initial.release();
      this.assertActive();
    }
    for (const [id, pack] of initial.packs) {
      this.persistentLeases.set(id, pack);
    }
    this.syncPacks();
    const room = await this.acquireArea(this.sim.area, this.abort.signal);
    if (this.disposed) {
      room.release();
      this.assertActive();
    }
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
    );
    this.presentation.generation = this.session.generation;
    this.events.setGeneration(this.session.generation);
    this.input = new Input(this.canvas, this.presentation.camera, () => this.pause(!this.paused));
    const settings = await readUntilAborted(this.bridge.loadSettings(), this.abort.signal).catch(
      (error: Error) => {
        this.assertActive();
        this.settingsError = error.message;
        return { status: 'empty' } as const;
      },
    );
    this.assertActive();
    if (settings.status === 'ok') {
      this.scale = settings.data.renderScale;
      this.presentation.verticalSpan = settings.data.verticalSpan;
      this.presentation.setDepthOfField(settings.data.depthOfField);
      this.presentation.setVisualEffects(settings.data.visualEffects);
    }
    this.assertActive();
    this.presentation.resize(this.scale);
    await this.presentation.loadAnimationFlow();
    this.assertActive();
    await this.presentation.warm();
    this.assertActive();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.ready = true;
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
  previewAsset(id: string, select: () => undefined) {
    return this.withLoading(async () => {
      const request = ++this.previewRequest;
      const pack = await this.runtime.loadPack(id, this.abort.signal);
      let installed = false;
      try {
        this.assertActive();
        if (request !== this.previewRequest) return false;
        this.presentation.warmPack(pack);
        const previous = this.previewPack;
        this.previewPack = { id, pack };
        this.syncPacks();
        try {
          select();
        } catch (error) {
          this.previewPack = previous;
          this.syncPacks();
          throw error;
        }
        installed = true;
        previous?.pack.release();
        return true;
      } finally {
        if (!installed) pack.release();
      }
    });
  }
  private async acquireArea(area: string, signal: AbortSignal) {
    const scene = this.scenes.area(area),
      held = await this.runtime.loadPacks(scene.assets, signal);
    try {
      this.scenes.validate(scene, held.packs);
      return held;
    } catch (error) {
      held.release();
      throw error;
    }
  }
  publish(events: readonly GameplayEvent[]) {
    this.events.setGeneration(this.session.generation);
    this.events.publish(events);
  }
  private async withSessionOperation<T>(work: (operation: SessionOperation) => Promise<T>) {
    this.assertActive();
    this.sessionOperation?.cancel('session operation superseded');
    const operation = new SessionOperation();
    this.sessionOperation = operation;
    return this.withLoading(async () => {
      try {
        const result = await work(operation);
        operation.check();
        return result;
      } catch (error) {
        operation.check();
        throw error;
      } finally {
        if (this.sessionOperation === operation) {
          this.sessionOperation = undefined;
          if (!this.disposed && !this.roomReady) this.pause(true);
        }
      }
    });
  }
  replaceArea(area: string, commit: () => readonly GameplayEvent[]) {
    return this.withSessionOperation((operation) => this.replaceRoom(area, commit, operation));
  }
  private async replaceRoom(
    area: string,
    commit: () => readonly GameplayEvent[],
    operation: SessionOperation,
  ) {
    operation.check();
    this.input.clear();
    let next: PackBatch | undefined;
    try {
      next = await this.acquireArea(area, operation.signal);
      operation.check();
      for (const pack of next.packs.values()) this.presentation.warmPack(pack);
      await this.presentation.prepareAssets(new Set([...this.packs.keys(), ...next.packs.keys()]));
      operation.check();
      this.roomAccepted = false;
      const changes = commit();
      this.events.setGeneration(this.session.generation);
      operation.check();
      const installing = next;
      next = undefined; // Installation transfers ownership even if rebuilding throws.
      this.roomAssets.install(installing, () => {
        this.syncPacks();
        this.presentation.resetRoom(
          this.sim.areaDefinition,
          this.scenes.area(this.sim.area).visuals,
        );
        this.presentation.generation = this.session.generation;
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
    this.paused = value;
    this.clock.reset();
    this.input?.clear();
    this.last = performance.now();
    this.hooks.pause(value);
  }
  safe(fn: () => Promise<unknown>) {
    void fn().catch((error) => {
      if (!(error instanceof SessionOperationCancelled))
        this.hooks.status(String(error.message ?? error), true);
    });
  }
  transition(id: string) {
    return this.withSessionOperation(async (operation) => {
      const plan = this.session.prepareTransition(id);
      const cancel = () => this.publish(this.session.cancelTransition(plan));
      operation.signal.addEventListener('abort', cancel, { once: true });
      try {
        this.publish(plan.events);
        operation.check();
        await this.replaceRoom(
          plan.destination,
          () => this.session.commitTransition(plan),
          operation,
        );
        operation.check();
        this.autosave();
      } catch (error) {
        this.publish(this.session.cancelTransition(plan));
        // An obsolete transition must not pause a newer session operation.
        if (!operation.signal.aborted) this.pause(true);
        throw error;
      } finally {
        operation.signal.removeEventListener('abort', cancel);
      }
    });
  }
  reset(reason: 'death' | 'manual' = 'manual') {
    return this.withSessionOperation(async (operation) => {
      const resume = this.resumeOnCompletion();
      await this.replaceRoom(this.sim.area, () => this.session.resetCurrentArea(reason), operation);
      operation.check();
      if (reason === 'death') this.autosave();
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
    const valid = parseGame(save, this.registry);
    await this.replaceRoom(valid.area, () => this.session.restoreSave(valid), operation);
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
      return true;
    });
  }
  newGame() {
    return this.withSessionOperation(async (operation) => {
      const resume = this.resumeOnCompletion();
      await this.replaceRoom(
        this.registry.definitions.initialArea,
        () => {
          this.session = new GameSession(
            this.registry,
            142,
            this.registry.definitions.initialArea,
            this.session.generation + 1,
          );
          return [];
        },
        operation,
      );
      operation.check();
      if (!this.readOnly) await this.persistence.save(this.session.captureSave());
      operation.check();
      resume();
    });
  }
  async saveSettings() {
    await this.bridge.saveSettings({
      version: 5,
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
    await this.persistence.save(this.session.captureSave());
    await this.saveSettings();
  }
  autosave() {
    if (!this.readOnly && this.roomReady)
      this.safe(() => this.persistence.save(this.session.captureSave()));
  }
  private loop = (now: number) => {
    if (this.disposed) return;
    const ms = Math.max(0, now - this.last);
    this.last = now;
    let alpha = 1;
    let aim = this.aim;
    const idle =
        this.frames?.idle ??
        (!this.bridge.automatedRun && (document.hidden || !document.hasFocus())),
      frozen = this.paused || !this.roomReady || this.busy || this.loading.size > 0 || idle;
    if (!frozen && this.simulationEnabled)
      alpha = this.clock.advance(ms, () => {
        const sim = this.sim;
        this.beforeStep(sim);
        const cmd =
          this.command?.(sim) ?? this.input.consume(sim.hero, sim.areaDefinition, sim.generation);
        aim = cmd.aim;
        this.aim = aim;
        const result = this.session.step(cmd);
        this.publish(result.events);
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
    if (this.roomReady) this.presentation.update(this.sim.view, alpha, frozen ? 0 : ms, aim);
    this.hooks.frame();
    this.afterFrame(ms);
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loading.clear();
    this.hooks.loading?.(false);
    this.ready = false;
    delete this.canvas.dataset.ready;
    this.abort.abort();
    this.sessionOperation?.cancel('application disposed');
    this.sessionOperation = undefined;
    this.frames?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input?.dispose();
    this.presentation?.dispose();
    this.previewPack?.pack.release();
    this.roomAssets.dispose();
    for (const p of this.persistentLeases.values()) p.release();
    this.packViews.clear();
    this.runtime?.dispose?.();
    this.events.dispose();
  }
}
