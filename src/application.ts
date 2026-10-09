import type { PreparedRegistration } from './assets/registration';
import { AssetRuntime, type PackLease } from './assets/loader';
import type { PresentationLifecycle } from './presentation/lifecycle';
import type { SceneContent } from './content/game-content';
import { GameSession } from './core/session';
import { FixedClock, type Command } from './core/simulation';
import { Persistence } from './core/persistence';
import { EventHub, type GameplayEvent } from './core/events';
import { Input } from './core/input';
import { ContentRegistry } from './content/world';
import { parseGame, type GameSave, type Bridge } from './core/save';
import { FrameScheduler } from './frame-scheduler';
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
  events = new EventHub();
  clock = new FixedClock();
  packs = new Map<string, PackLease>();
  persistentLeases = new Map<string, PackLease>();
  private roomLeases = new Map<string, PackLease>();
  private abort = new AbortController();
  private request = 0;
  private last = 0;
  private frames: FrameScheduler | undefined;
  private disposed = false;
  private loading = new Set<symbol>();
  private pauseSequence = 0;
  private aim = { x: 0, z: 1 };
  private assetLoads = new Map<string, Promise<void>>();
  private assertActive() {
    if (this.disposed) throw new Error('application disposed');
  }
  ready = false;
  busy = false;
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
      packs: Map<string, PackLease>,
      events: EventHub,
      area: import('./content/world').AreaDefinition,
      registration: PreparedRegistration,
      visuals: import('./content/world-art').WorldVisualDefinition | undefined,
    ) => P,
    readonly hooks: ApplicationHooks,
    readonly extraAssets: readonly string[] = [],
  ) {
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
          if (this.ready) this.presentation.update(this.sim, 1, 0, this.aim);
        } finally {
          this.resetFrameClock();
          this.input?.clear();
          this.hooks.loading?.(false);
        }
      }
    }
  }
  boot() {
    return this.withLoading(() => this.bootApplication());
  }
  private async bootApplication() {
    this.assertActive();
    this.runtime = await AssetRuntime.open(this.catalog);
    this.assertActive();
    for (const id of [
      ...new Set([
        ...this.scenes.initialAssets.filter((id) => id in this.catalog),
        ...this.extraAssets,
      ]),
    ]) {
      const pack = await this.runtime.loadPack(id, this.abort.signal);
      if (this.disposed) {
        pack.release();
        this.assertActive();
      }
      this.persistentLeases.set(id, pack);
      this.packs.set(id, pack);
    }
    this.roomLeases = await this.acquireArea(this.sim.area, this.abort.signal);
    for (const [id, p] of this.roomLeases) this.packs.set(id, p);
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
    const settings = await this.bridge.loadSettings();
    this.assertActive();
    if (settings.status === 'ok' || settings.status === 'recovered') {
      this.scale = settings.data.renderScale;
      this.presentation.verticalSpan = settings.data.verticalSpan;
      this.presentation.setDepthOfField(settings.data.depthOfField);
      this.presentation.setVisualEffects(settings.data.visualEffects);
    } else if (settings.status === 'unreadable') this.settingsError = settings.message;
    await this.persistence.inspect();
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
  loadAsset(id: string) {
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
      this.packs.set(id, pack);
    })();
    this.assetLoads.set(id, load);
    try {
      await load;
    } finally {
      this.assetLoads.delete(id);
    }
  }
  private async acquireArea(area: string, signal: AbortSignal) {
    const scene = this.scenes.area(area),
      ids = scene.assets;
    const results = await Promise.allSettled(ids.map((id) => this.runtime.loadPack(id, signal))),
      leases = new Map<string, PackLease>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') leases.set(ids[i]!, r.value);
    });
    try {
      const failure = results.find((r) => r.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (signal.aborted) throw new Error('load cancelled');
      this.scenes.validate(scene, leases);
      return leases;
    } catch (error) {
      for (const p of leases.values()) p.release();
      throw error;
    }
  }
  publish(events: readonly GameplayEvent[]) {
    this.events.setGeneration(this.session.generation);
    this.events.publish(events);
  }
  replaceArea(area: string, commit: () => readonly GameplayEvent[]) {
    return this.withLoading(() => this.replaceRoom(area, commit));
  }
  private async replaceRoom(area: string, commit: () => readonly GameplayEvent[]) {
    this.assertActive();
    const request = ++this.request;
    this.abort.abort();
    const controller = new AbortController();
    this.abort = controller;
    this.busy = true;
    this.clock.reset();
    this.input.clear();
    let next: Map<string, PackLease> | undefined;
    try {
      next = await this.acquireArea(area, controller.signal);
      if (this.disposed || request !== this.request) throw new Error('load cancelled');
      for (const pack of next.values()) this.presentation.warmPack(pack);
      await this.presentation.prepareAssets(new Set([...this.packs.keys(), ...next.keys()]));
      if (this.disposed || request !== this.request) throw new Error('load cancelled');
      const changes = commit(),
        old = this.roomLeases;
      this.roomLeases = next;
      for (const [id, p] of next) this.packs.set(id, p);
      for (const [id, p] of this.persistentLeases) this.packs.set(id, p);
      this.presentation.resetRoom(this.sim.areaDefinition, this.scenes.area(this.sim.area).visuals);
      this.presentation.generation = this.session.generation;
      for (const [id, p] of old) {
        p.release();
        if (!next.has(id) && !this.persistentLeases.has(id)) this.packs.delete(id);
      }
      next = undefined;
      await this.presentation.prepareAssets();
      this.input.resetAim();
      this.publish(changes);
    } finally {
      if (next) for (const p of next.values()) p.release();
      if (request === this.request) this.busy = false;
    }
  }
  pause(value: boolean) {
    this.pauseSequence++;
    this.paused = value;
    this.clock.reset();
    this.input?.clear();
    this.last = performance.now();
    this.hooks.pause(value);
  }
  safe(fn: () => Promise<unknown>) {
    void fn().catch((error) => this.hooks.status(String(error.message ?? error), true));
  }
  async transition(id: string) {
    const plan = this.session.prepareTransition(id);
    this.publish(plan.events);
    try {
      await this.replaceArea(plan.destination, () => this.session.commitTransition(plan));
      this.autosave();
    } catch (error) {
      this.publish(this.session.cancelTransition(plan));
      this.pause(true);
      throw error;
    }
  }
  reset() {
    return this.withLoading(() => this.resetEncounter());
  }
  private async resetEncounter() {
    const resume = this.resumeOnCompletion();
    await this.replaceArea(this.sim.area, () => this.session.resetCurrentArea());
    resume();
  }
  private resumeOnCompletion() {
    this.assertActive();
    const sequence = this.pauseSequence;
    return () => {
      if (!this.disposed && sequence === this.pauseSequence && !this.frames?.idle)
        this.pause(false);
    };
  }
  private async restoreState(save: GameSave) {
    const valid = parseGame(save, this.registry);
    await this.replaceArea(valid.area, () => this.session.restoreSave(valid));
    this.persistence.loaded();
  }
  restore(save: GameSave) {
    return this.withLoading(() => this.restoreCheckpoint(save));
  }
  private async restoreCheckpoint(save: GameSave) {
    const resume = this.resumeOnCompletion();
    await this.restoreState(save);
    resume();
  }
  load() {
    return this.withLoading(() => this.loadCheckpoint());
  }
  private async loadCheckpoint() {
    const resume = this.resumeOnCompletion(),
      result = await this.persistence.load();
    if (result.status === 'unreadable') throw new Error(result.message);
    if (result.status === 'empty') return false;
    await this.restoreState(result.data);
    resume();
    return true;
  }
  newGame() {
    return this.withLoading(() => this.startNewGame());
  }
  private async startNewGame() {
    const resume = this.resumeOnCompletion();
    await this.replaceArea(this.registry.definitions.initialArea, () => {
      this.session = new GameSession(
        this.registry,
        142,
        this.registry.definitions.initialArea,
        this.session.generation + 1,
      );
      return [];
    });
    this.persistence.confirmNew();
    if (!this.readOnly) await this.persistence.save(this.session.captureSave());
    resume();
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
    await this.persistence.save(this.session.captureSave());
    await this.saveSettings();
  }
  autosave() {
    if (!this.readOnly) this.safe(() => this.persistence.save(this.session.captureSave(), true));
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
      frozen = this.paused || this.busy || this.loading.size > 0 || idle;
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
          this.input.resetAim();
          this.autosave();
          return false;
        }
        if (result.transition && !this.command) {
          this.safe(() => this.transition(result.transition!));
          return false;
        }
        return true;
      });
    this.presentation.update(this.sim, alpha, frozen ? 0 : ms, aim);
    this.hooks.frame();
    this.afterFrame(ms);
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loading.clear();
    this.hooks.loading?.(false);
    this.ready = false;
    this.abort.abort();
    this.frames?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input?.dispose();
    this.presentation?.dispose();
    for (const p of this.roomLeases.values()) p.release();
    for (const p of this.persistentLeases.values()) p.release();
    this.events.dispose();
  }
}
