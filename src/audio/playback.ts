import { AudioBuffers, type AudioBufferLease } from './buffers';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';
import { audioManifestPath, parseAudioManifest, type AudioManifest } from '../assets/audio';
import {
  cueCooldown,
  defaultAudioSettings,
  type AudioCue,
  type AudioSettings,
} from '../content/audio';

import { AudioVoice } from './voice';
export type AudioDependencies = {
  request: typeof fetch;
  context: () => AudioContext;
  now: () => number;
  random: () => number;
  timer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
};
const defaults: AudioDependencies = {
  request: (...args) => fetch(...args),
  context: () => new AudioContext(),
  now: () => performance.now() / 1000,
  random: () => Math.random(),
  timer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (timer) => clearTimeout(timer),
};
// This owner only observes outcomes. Every async continuation rechecks its lifetime.
export class AudioPlayback {
  settings: AudioSettings = { ...defaultAudioSettings };
  private context?: AudioContext;
  private master?: GainNode;
  private effects?: GainNode;
  private ambience?: GainNode;
  private manifest?: AudioManifest;
  private initialization?: Promise<void>;
  private readonly buffers: AudioBuffers;
  private voices = new Set<AudioVoice>();
  private loops: AudioVoice[] = [];
  private retiring = new Set<AudioVoice>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastVariant = new Map<string, string>();
  private cooldown = new Map<string, number>();
  private lifetime = new AbortController();
  private epoch = 0;
  private sessionEpoch = 0;
  private ambienceRequest = 0;
  private destination: readonly AudioCue[] = [];
  private activeDestination = '';
  private frozen = true;
  private unlocked = false;
  private unlocking?: Promise<void>;
  private diagnostics = new Set<string>();
  private listener = { x: 0, z: 0 };
  private readonly deps: AudioDependencies;
  constructor(
    private report: (message: string) => void,
    deps: Partial<AudioDependencies> = {},
  ) {
    this.deps = { ...defaults, ...deps };
    this.buffers = new AudioBuffers(
      this.deps.request,
      (bytes) => {
        if (!this.context) throw new Error('audio closed');
        return this.context.decodeAudioData(bytes);
      },
      this.deps.now,
    );
  }
  private fail(error: unknown) {
    if (this.lifetime.signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    if (this.diagnostics.size >= 4 || this.diagnostics.has(message)) return;
    this.diagnostics.add(message);
    try {
      this.report('Audio unavailable: ' + message);
    } catch {
      /* diagnostics are observers */
    }
  }
  initialize() {
    if (this.lifetime.signal.aborted) return Promise.resolve();
    this.initialization ??= Promise.resolve()
      .then(async () => {
        this.lifetime.signal.throwIfAborted();
        this.prepareContext();
        const response = await this.deps.request('/' + audioManifestPath, {
          signal: this.lifetime.signal,
        });
        if (!response.ok) throw new Error('prepared audio manifest missing');
        const manifest = parseAudioManifest(await response.json());
        if (!this.lifetime.signal.aborted) this.manifest = manifest;
      })
      .catch((error: unknown) => {
        this.initialization = undefined;
        this.fail(error);
      });
    return this.initialization;
  }
  private prepareContext() {
    this.context ??= this.deps.context();
    if (!this.master) {
      const nodes: GainNode[] = [];
      try {
        const master = this.context.createGain();
        nodes.push(master);
        const effects = this.context.createGain();
        nodes.push(effects);
        const ambience = this.context.createGain();
        nodes.push(ambience);
        effects.connect(master);
        ambience.connect(master);
        master.connect(this.context.destination);
        this.master = master;
        this.effects = effects;
        this.ambience = ambience;
      } catch (error) {
        cleanupAfterFailure(error, () => cleanupAll(nodes.map((node) => () => node.disconnect())));
      }
      this.updateSettings(this.settings);
    }
  }
  unlock() {
    if (this.lifetime.signal.aborted) return Promise.resolve();
    if (this.unlocked && this.manifest)
      return this.context?.state === 'suspended'
        ? this.context.resume().catch((error: unknown) => this.fail(error))
        : Promise.resolve();
    this.unlocking ??= (async () => {
      // Install the in-flight handle before synchronous constructor failures can finish.
      await Promise.resolve();
      if (this.lifetime.signal.aborted) return;
      try {
        this.prepareContext();
        await this.context!.resume();
        if (this.lifetime.signal.aborted) return;
        this.unlocked = true;
        await this.initialize();
        if (this.lifetime.signal.aborted) return;
        void this.setAmbience(this.destination).catch(() => {});
        await this.preload();
      } catch (error) {
        this.fail(error);
      } finally {
        this.unlocking = undefined;
      }
    })();
    return this.unlocking;
  }
  updateSettings(settings: AudioSettings) {
    this.settings = { ...settings };
    if (this.master) this.master.gain.value = settings.muted ? 0 : settings.master;
    if (this.effects) this.effects.gain.value = settings.effects;
    if (this.ambience) this.ambience.gain.value = settings.ambience;
    if (settings.muted) {
      this.epoch++;
      this.sessionEpoch++;
      this.cooldown.clear();
      this.cleanupObserved([() => this.finishVoices(() => true), () => this.stopAmbience()]);
    } else if (this.unlocked) void this.setAmbience(this.destination).catch(() => {});
  }
  setWorldFrozen(frozen: boolean) {
    if (this.frozen === frozen) return;
    this.frozen = frozen;
    if (frozen) {
      this.epoch++;
      this.cleanupObserved([
        () => this.finishVoices((voice) => voice.world),
        () => this.stopAmbience(),
      ]);
    } else void this.setAmbience(this.destination).catch(() => {});
  }
  replaceSession() {
    this.epoch++;
    this.sessionEpoch++;
    this.cooldown.clear();
    this.destination = [];
    this.cleanupObserved([
      () => this.finishVoices((voice) => voice.world),
      () => this.stopAmbience(),
    ]);
  }
  setListener(x: number, z: number) {
    this.listener = { x, z };
  }
  private async preload() {
    for (const sample of this.manifest?.samples ?? []) {
      if (sample.loop || this.lifetime.signal.aborted || this.settings.muted) continue;
      try {
        const lease = await this.buffers.acquire(sample);
        lease.release();
      } catch (error) {
        this.fail(error);
      }
    }
  }
  private createVoice(
    lease: AudioBufferLease,
    world: boolean,
    critical: boolean,
    loop: boolean,
    level: number,
  ): AudioVoice {
    const context = this.context!,
      source = context.createBufferSource();
    let gain: GainNode;
    try {
      gain = context.createGain();
      source.buffer = lease.buffer;
      source.loop = loop;
      gain.gain.value = level;
      source.connect(gain);
      gain.connect(loop ? this.ambience! : this.effects!);
    } catch (error) {
      cleanupAfterFailure(error, () =>
        cleanupAll([() => source.disconnect(), () => gain?.disconnect()]),
      );
    }
    const voice = new AudioVoice(
      source,
      gain,
      world,
      critical,
      loop,
      lease,
      (retired) => {
        this.voices.delete(retired);
        this.retiring.delete(retired);
      },
      (error) => this.fail(error),
    );
    this.voices.add(voice);
    return voice;
  }
  private cleanupObserved(actions: Iterable<() => void>) {
    try {
      cleanupAll(actions);
    } catch (error) {
      this.fail(error);
    }
  }
  private finishVoices(predicate: (voice: AudioVoice) => boolean) {
    cleanupAll([...this.voices].filter(predicate).map((voice) => voice.finish));
  }
  get samples() {
    return this.manifest?.samples.map(({ id, cue }) => ({ id, cue })) ?? [];
  }
  async play(
    cue: AudioCue,
    options: {
      world?: boolean;
      critical?: boolean;
      x?: number;
      z?: number;
      key?: string;
      signal?: AbortSignal;
      sampleId?: string;
    } = {},
  ) {
    const world = options.world ?? true,
      epoch = this.epoch,
      sessionEpoch = this.sessionEpoch,
      requested = this.deps.now();
    const allowed = () =>
      !this.lifetime.signal.aborted &&
      !options.signal?.aborted &&
      sessionEpoch === this.sessionEpoch &&
      (!world || epoch === this.epoch) &&
      this.unlocked &&
      !this.settings.muted &&
      this.settings.master > 0 &&
      this.settings.effects > 0 &&
      (!world || !this.frozen);
    if (!allowed()) return;
    let voice: AudioVoice | undefined;
    let lease: AudioBufferLease | undefined;
    try {
      const variants =
        this.manifest?.samples.filter((s) =>
          options.sampleId ? s.id === options.sampleId : s.cue === cue && !s.loop,
        ) ?? [];
      const choices = variants.filter((s) => s.id !== this.lastVariant.get(cue));
      const pool = choices.length ? choices : variants;
      const sample = pool[Math.min(pool.length - 1, Math.floor(this.deps.random() * pool.length))];
      if (!sample) return;
      lease = await this.buffers.acquire(sample);
      if (!allowed() || this.deps.now() - requested > 0.25) return;
      const key = cue + ':' + (options.key ?? 'global');
      if ((this.cooldown.get(key) ?? -Infinity) > this.deps.now()) return;
      const distance =
        !world || options.x === undefined || options.z === undefined
          ? 0
          : Math.hypot(options.x - this.listener.x, options.z - this.listener.z);
      if (distance >= 16) return;
      const critical = options.critical ?? false;
      if (
        (!critical && [...this.voices].filter((v) => !v.loop && !v.critical).length >= 20) ||
        [...this.voices].filter((v) => !v.loop).length >= 24
      ) {
        if (!critical) return;
        const victim = [...this.voices].find((v) => !v.loop && !v.critical);
        if (!victim) return;
        victim.finish();
      }
      voice = this.createVoice(
        lease,
        world,
        critical,
        false,
        (cue.startsWith('step-') ? 10 ** (-8 / 20) : cue === 'cloth' ? 10 ** (-10 / 20) : 1) /
          (1 + distance * 0.25),
      );
      lease = undefined;
      voice.cancelWith(options.signal);
      voice.source.start();
      this.lastVariant.set(cue, sample.id);
      this.cooldown.set(key, this.deps.now() + cueCooldown(cue));
    } catch (error) {
      this.cleanupObserved([() => voice?.finish()]);
      this.fail(error);
    } finally {
      lease?.release();
    }
  }
  async setAmbience(destination: readonly AudioCue[]) {
    this.destination = destination.slice(0, 2);
    const key = this.destination.join('/'),
      request = ++this.ambienceRequest;
    if (
      !this.unlocked ||
      !this.manifest ||
      this.manifest.samples.length === 0 ||
      this.frozen ||
      this.settings.muted ||
      this.lifetime.signal.aborted
    )
      return;
    if (key === this.activeDestination) return;
    const created: AudioVoice[] = [];
    try {
      const samples = this.destination.map((cue) => {
        const sample = this.manifest!.samples.find((s) => s.cue === cue && s.loop);
        if (!sample) throw new Error('ambience missing: ' + cue);
        return sample;
      });
      // Pin each decoded layer while awaiting the next one.
      for (const sample of samples) {
        const lease = await this.buffers.acquire(sample);
        if (
          request !== this.ambienceRequest ||
          this.lifetime.signal.aborted ||
          this.frozen ||
          this.settings.muted
        ) {
          lease.release();
          return;
        }
        try {
          const voice = this.createVoice(lease, true, false, true, 0);
          created.push(voice);
          voice.source.loopStart = sample.loopStart;
          voice.source.loopEnd = Math.min(sample.loopEnd, lease.buffer.duration);
        } catch (error) {
          lease.release();
          throw error;
        }
      }
      for (const voice of created) voice.source.start();
      // Only the latest outgoing group keeps a fade; older retiring owners
      // cannot accumulate voices/timers during rapid successful transitions.
      for (const timer of this.timers) this.deps.clearTimer(timer);
      this.timers.clear();
      cleanupAll([...this.retiring].map((voice) => voice.finish));
      const outgoing = this.loops;
      this.loops = [...created];
      created.length = 0;
      this.activeDestination = key;
      const time = this.context!.currentTime;
      for (const voice of this.loops) {
        voice.gain.gain.setValueAtTime(0, time);
        voice.gain.gain.linearRampToValueAtTime(1, time + 1);
      }
      for (const voice of outgoing) {
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, time);
        voice.gain.gain.linearRampToValueAtTime(0, time + 1);
        this.retiring.add(voice);
      }
      const timer = this.deps.timer(() => {
        this.timers.delete(timer);
        this.cleanupObserved(outgoing.map((voice) => voice.finish));
      }, 1000);
      this.timers.add(timer);
    } catch (error) {
      this.fail(error);
    } finally {
      this.cleanupObserved(created.map((voice) => voice.finish));
    }
  }
  private stopAmbience() {
    this.ambienceRequest++;
    this.activeDestination = '';
    const timers = [...this.timers],
      voices = [...this.loops, ...this.retiring];
    this.timers.clear();
    this.loops = [];
    this.retiring.clear();
    cleanupAll([
      ...timers.map((timer) => () => this.deps.clearTimer(timer)),
      ...voices.map((voice) => voice.finish),
    ]);
  }
  get diagnosticsSnapshot() {
    return {
      unlocked: this.unlocked,
      voices: [...this.voices].filter((voice) => !voice.loop).length,
      loops: this.loops.length,
      decodedBytes: this.buffers.decodedBytes,
      destination: this.activeDestination,
      errors: this.diagnostics.size,
    };
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.epoch++;
    this.cooldown.clear();
    cleanupAll([
      () => this.finishVoices(() => true),
      () => this.stopAmbience(),
      () => this.buffers.dispose(),
      () => this.master?.disconnect(),
      () => this.effects?.disconnect(),
      () => this.ambience?.disconnect(),
      () => {
        if (this.context) void this.context.close().catch(() => {});
      },
    ]);
  }
}
