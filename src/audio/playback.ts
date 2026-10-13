import {
  audioManifestPath,
  parseAudioManifest,
  type AudioManifest,
  type AudioSample,
} from '../assets/audio';
import {
  cueCooldown,
  defaultAudioSettings,
  type AudioCue,
  type AudioSettings,
} from '../content/audio';

type BufferEntry = { buffer: AudioBuffer; bytes: number; refs: number; used: number };
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  entry: BufferEntry;
  world: boolean;
  critical: boolean;
  finish: () => void;
};
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
  private buffers = new Map<string, BufferEntry>();
  private loading = new Map<string, Promise<BufferEntry>>();
  private voices = new Set<Voice>();
  private loops: Voice[] = [];
  private retiring = new Set<Voice>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastVariant = new Map<string, string>();
  private cooldown = new Map<string, number>();
  private lifetime = new AbortController();
  private epoch = 0;
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
    this.initialization ??= (async () => {
      const response = await this.deps.request('/' + audioManifestPath, {
        signal: this.lifetime.signal,
      });
      if (!response.ok) throw new Error('prepared audio manifest missing');
      const manifest = parseAudioManifest(await response.json());
      if (!this.lifetime.signal.aborted) this.manifest = manifest;
    })().catch((error: unknown) => this.fail(error));
    return this.initialization;
  }
  unlock() {
    if (this.lifetime.signal.aborted) return Promise.resolve();
    if (this.unlocked)
      return this.context?.state === 'suspended'
        ? this.context.resume().catch((error: unknown) => this.fail(error))
        : Promise.resolve();
    this.unlocking ??= (async () => {
      // Install the in-flight handle before synchronous constructor failures can finish.
      await Promise.resolve();
      try {
        this.context ??= this.deps.context();
        if (!this.master) {
          this.master = this.context.createGain();
          this.effects = this.context.createGain();
          this.ambience = this.context.createGain();
          this.effects.connect(this.master);
          this.ambience.connect(this.master);
          this.master.connect(this.context.destination);
          this.updateSettings(this.settings);
        }
        await this.context.resume();
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
      this.cooldown.clear();
      for (const voice of [...this.voices]) voice.finish();
      this.stopAmbience();
    } else if (this.unlocked) void this.setAmbience(this.destination).catch(() => {});
  }
  setWorldFrozen(frozen: boolean) {
    if (this.frozen === frozen) return;
    this.frozen = frozen;
    if (frozen) {
      this.epoch++;
      for (const voice of [...this.voices]) if (voice.world) voice.finish();
      this.stopAmbience();
    } else void this.setAmbience(this.destination).catch(() => {});
  }
  replaceSession() {
    this.epoch++;
    this.cooldown.clear();
    for (const voice of [...this.voices]) if (voice.world) voice.finish();
  }
  setListener(x: number, z: number) {
    this.listener = { x, z };
  }
  private evict() {
    let bytes = [...this.buffers.values()].reduce((n, entry) => n + entry.bytes, 0);
    for (const [key, entry] of [...this.buffers].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes <= 32 * 1024 ** 2) break;
      if (entry.refs) continue;
      this.buffers.delete(key);
      bytes -= entry.bytes;
    }
  }
  private async load(sample: AudioSample): Promise<BufferEntry> {
    const cached = this.buffers.get(sample.hash);
    if (cached) {
      cached.used = this.deps.now();
      return cached;
    }
    let pending = this.loading.get(sample.hash);
    if (!pending) {
      pending = (async () => {
        const response = await this.deps.request('/' + sample.path, {
          signal: this.lifetime.signal,
        });
        if (!response.ok) throw new Error('sample missing: ' + sample.id);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = [...new Uint8Array(digest)]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        if (hash !== sample.hash || bytes.byteLength !== sample.bytes)
          throw new Error('sample integrity: ' + sample.id);
        if (this.lifetime.signal.aborted || !this.context) throw new Error('audio closed');
        const buffer = await this.context.decodeAudioData(bytes);
        if (this.lifetime.signal.aborted) throw new Error('audio closed');
        const entry = {
          buffer,
          bytes: buffer.length * buffer.numberOfChannels * 4,
          refs: 0,
          used: this.deps.now(),
        };
        this.buffers.set(sample.hash, entry);
        return entry;
      })().finally(() => this.loading.delete(sample.hash));
      this.loading.set(sample.hash, pending);
    }
    return pending;
  }
  private async preload() {
    for (const sample of this.manifest?.samples ?? []) {
      if (sample.loop || this.lifetime.signal.aborted || this.settings.muted) continue;
      try {
        await this.load(sample);
        this.evict();
      } catch (error) {
        this.fail(error);
      }
    }
  }
  private createVoice(
    entry: BufferEntry,
    world: boolean,
    critical: boolean,
    loop: boolean,
    level: number,
  ): Voice {
    const context = this.context!,
      source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = entry.buffer;
    source.loop = loop;
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(loop ? this.ambience! : this.effects!);
    entry.refs++;
    let finished = false;
    const voice: Voice = {
      source,
      gain,
      entry,
      world,
      critical,
      finish: () => {
        if (finished) return;
        finished = true;
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* already ended or never started */
        }
        source.disconnect();
        gain.disconnect();
        entry.refs--;
        this.voices.delete(voice);
        this.retiring.delete(voice);
        this.evict();
      },
    };
    source.onended = voice.finish;
    return voice;
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
      requested = this.deps.now();
    const allowed = () =>
      !this.lifetime.signal.aborted &&
      !options.signal?.aborted &&
      epoch === this.epoch &&
      this.unlocked &&
      !this.settings.muted &&
      this.settings.master > 0 &&
      this.settings.effects > 0 &&
      (!world || !this.frozen);
    if (!allowed()) return;
    let voice: Voice | undefined;
    try {
      const variants =
        this.manifest?.samples.filter((s) =>
          options.sampleId ? s.id === options.sampleId : s.cue === cue && !s.loop,
        ) ?? [];
      const choices = variants.filter((s) => s.id !== this.lastVariant.get(cue));
      const pool = choices.length ? choices : variants;
      const sample = pool[Math.min(pool.length - 1, Math.floor(this.deps.random() * pool.length))];
      if (!sample) return;
      const entry = await this.load(sample);
      if (!allowed() || this.deps.now() - requested > 0.25) {
        this.evict();
        return;
      }
      const key = cue + ':' + (options.key ?? 'global');
      if ((this.cooldown.get(key) ?? -Infinity) > this.deps.now()) return;
      const distance =
        options.x === undefined || options.z === undefined
          ? 0
          : Math.hypot(options.x - this.listener.x, options.z - this.listener.z);
      if (distance >= 16) return;
      const critical = options.critical ?? false;
      if (
        (!critical && [...this.voices].filter((v) => !v.critical).length >= 20) ||
        this.voices.size >= 24
      ) {
        if (!critical) return;
        const victim = [...this.voices].find((v) => !v.critical);
        if (!victim) return;
        victim.finish();
      }
      voice = this.createVoice(entry, world, critical, false, 1 / (1 + distance * 0.25));
      this.voices.add(voice);
      options.signal?.addEventListener('abort', voice.finish, { once: true });
      const finish = voice.finish;
      voice.finish = () => {
        options.signal?.removeEventListener('abort', finish);
        finish();
      };
      voice.source.onended = voice.finish;
      voice.source.start();
      this.lastVariant.set(cue, sample.id);
      this.cooldown.set(key, this.deps.now() + cueCooldown(cue));
    } catch (error) {
      voice?.finish();
      this.fail(error);
    } finally {
      this.evict();
    }
  }
  async setAmbience(destination: readonly AudioCue[]) {
    this.destination = destination.slice(0, 2);
    const key = this.destination.join('/'),
      request = ++this.ambienceRequest;
    if (
      !this.unlocked ||
      !this.manifest ||
      this.frozen ||
      this.settings.muted ||
      this.lifetime.signal.aborted
    )
      return;
    if (key === this.activeDestination) return;
    const created: Voice[] = [];
    try {
      const samples = this.destination.map((cue) => {
        const sample = this.manifest!.samples.find((s) => s.cue === cue && s.loop);
        if (!sample) throw new Error('ambience missing: ' + cue);
        return sample;
      });
      // Pin each decoded layer while awaiting the next one.
      for (const sample of samples) {
        const entry = await this.load(sample);
        if (
          request !== this.ambienceRequest ||
          this.lifetime.signal.aborted ||
          this.frozen ||
          this.settings.muted
        )
          return;
        const voice = this.createVoice(entry, true, false, true, 0);
        voice.source.loopStart = sample.loopStart;
        voice.source.loopEnd = Math.min(sample.loopEnd, entry.buffer.duration);
        created.push(voice);
      }
      for (const voice of created) voice.source.start();
      const outgoing = this.loops;
      this.loops = [...created];
      created.length = 0;
      this.activeDestination = key;
      const time = this.context!.currentTime;
      for (const voice of this.loops) voice.gain.gain.linearRampToValueAtTime(1, time + 1);
      for (const voice of outgoing) {
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, time);
        voice.gain.gain.linearRampToValueAtTime(0, time + 1);
        this.retiring.add(voice);
      }
      const timer = this.deps.timer(() => {
        this.timers.delete(timer);
        for (const voice of outgoing) voice.finish();
      }, 1000);
      this.timers.add(timer);
    } catch (error) {
      this.fail(error);
    } finally {
      for (const voice of created) voice.finish();
      this.evict();
    }
  }
  private stopAmbience() {
    this.ambienceRequest++;
    this.activeDestination = '';
    for (const timer of this.timers) this.deps.clearTimer(timer);
    this.timers.clear();
    for (const voice of [...this.loops, ...this.retiring]) voice.finish();
    this.loops = [];
    this.retiring.clear();
  }
  get diagnosticsSnapshot() {
    return {
      unlocked: this.unlocked,
      voices: this.voices.size,
      loops: this.loops.length,
      decodedBytes: [...this.buffers.values()].reduce((n, e) => n + e.bytes, 0),
      destination: this.activeDestination,
      errors: this.diagnostics.size,
    };
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.epoch++;
    for (const voice of [...this.voices]) voice.finish();
    this.stopAmbience();
    this.buffers.clear();
    this.cooldown.clear();
    this.loading.clear();
    this.master?.disconnect();
    this.effects?.disconnect();
    this.ambience?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
  }
}
