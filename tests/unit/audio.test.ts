import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyAudioSources } from '../../tools/assets/audio';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AudioPlayback } from '../../src/audio/playback';
import { AudioBuffers } from '../../src/audio/buffers';
import { AudioFeedback } from '../../src/audio/feedback';
import { parseAudioManifest, type AudioManifest } from '../../src/assets/audio';
import { defaultAudioSettings, areaAudio, cueCooldown } from '../../src/content/audio';
import { parseSettings } from '../../src/platform/settings';
import { defaultVisualEffects } from '../../src/content/visual-effects';
import { reviewFilename } from '../../tools/assets/audio-review';
import type { PresentationEvent } from '../../src/core/events';
import { GameSession } from '../../src/core/session';
import { content } from '../fixtures/content';

const bytes = new Uint8Array([1, 2, 3]);
const hash = createHash('sha256').update(bytes).digest('hex');
const sample = (id: string, cue = 'sword', loop = false) => ({
  id,
  cue,
  hash,
  path: `audio/${hash}.${loop ? 'ogg' : 'wav'}`,
  bytes: 3,
  duration: 0.5,
  sampleRate: 44100 as const,
  channels: 1 as const,
  loop,
  loopStart: 0,
  loopEnd: 0.5,
});
function fixture(
  samples = [sample('sword-1'), sample('forest-1', 'forest', true)],
  payloads = new Map<string, Uint8Array<ArrayBuffer>>(),
) {
  const sources: {
    buffer: AudioBuffer | undefined;
    started: boolean;
    stopped: boolean;
    onended: (() => void) | null;
    fail: boolean;
    start: () => void;
    stop: () => void;
  }[] = [];
  let now = 0;
  const counts = { closed: 0, requests: 0, contexts: 0, resumes: 0 };
  const reports: string[] = [];
  const timers = new Set<() => void>();
  let pending: (() => Promise<Response>) | undefined;
  const gain = () => ({
    gain: {
      value: 1,
      linearRampToValueAtTime() {},
      cancelScheduledValues() {},
      setValueAtTime() {},
    },
    connect() {},
    disconnect() {},
  });
  const context = {
    destination: {},
    currentTime: 0,
    resume: async () => {
      counts.resumes++;
    },
    close: async () => {
      counts.closed++;
    },
    decodeAudioData: async (
      data: ArrayBuffer,
    ): Promise<{
      length: number;
      numberOfChannels: number;
      duration: number;
      marker?: number;
    }> => ({
      length: 22050,
      numberOfChannels: 1,
      duration: 0.5,
      marker: new Uint8Array(data)[0],
    }),
    createGain: gain,
    createBufferSource: () => {
      const source = {
        buffer: undefined as AudioBuffer | undefined,
        loop: false,
        loopStart: 0,
        loopEnd: 0.5,
        started: false,
        stopped: false,
        onended: null as (() => void) | null,
        fail: false,
        connect() {},
        disconnect() {},
        start() {
          if (this.fail) throw new Error('start failure');
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const playback = new AudioPlayback((message) => reports.push(message), {
    context: () => {
      counts.contexts++;
      return context as unknown as AudioContext;
    },
    now: () => now,
    random: () => 0,
    request: async (url) => {
      counts.requests++;
      if ((url instanceof Request ? url.url : url.toString()).endsWith('manifest.json'))
        return Response.json({ schemaVersion: 1, samples });
      return pending
        ? pending()
        : new Response(payloads.get(url instanceof Request ? url.url : url.toString()) ?? bytes);
    },
    timer: (callback) => {
      timers.add(callback);
      return callback as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => {
      timers.delete(timer as unknown as () => void);
    },
  });
  return {
    playback,
    counts,
    sources,
    reports,
    timers,
    context,
    set now(value: number) {
      now = value;
    },
    set pending(value: (() => Promise<Response>) | undefined) {
      pending = value;
    },
  };
}
async function ready(f: ReturnType<typeof fixture>, preload = true) {
  const settings = f.playback.settings;
  if (!preload) f.playback.updateSettings({ ...settings, effects: 0 });
  await f.playback.unlock();
  if (!preload) f.playback.updateSettings(settings);
  f.playback.setWorldFrozen(false);
}

for (const suspended of [false, true])
  test(`shutdown settles ${suspended ? 'repeated' : 'initial'} audio unlock while native resume remains pending`, async (t) => {
    const f = fixture();
    t.after(() => f.playback.dispose());
    if (suspended) {
      await ready(f);
      Object.assign(f.context, { state: 'suspended' });
    }
    const requests = f.counts.requests;
    const resume = Promise.withResolvers<void>();
    f.context.resume = () => resume.promise;
    const unlocking = f.playback.unlock();
    let settled = false;
    const completion = unlocking.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.playback.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      settled,
      true,
      'Closed audio cannot leave its unlock callers waiting on native work',
    );
    resume.reject(new Error('Late native failure'));
    await completion;
    assert.equal(f.counts.requests, requests, 'Late resume cannot initialize a closed owner');
  });

test('session replacement cancels pending ambience and closes the previous room loops', async () => {
  const f = fixture([sample('forest-1', 'forest', true)]);
  await ready(f);
  const { promise: response, resolve } = Promise.withResolvers<Response>();
  const { promise: requested, resolve: started } = Promise.withResolvers<void>();
  f.pending = () => {
    started();
    return response;
  };
  const pending = f.playback.setAmbience(['forest']);
  await requested;
  f.playback.replaceSession();
  resolve(new Response(bytes));
  await pending;
  assert.equal(f.sources.length, 0);
  f.pending = undefined;
  await f.playback.setAmbience(['forest']);
  f.playback.replaceSession();
  assert.equal(f.sources[0]!.stopped, true);
  assert.equal(f.playback.diagnosticsSnapshot.loops, 0);
  f.playback.dispose();
});
test('audio shutdown releases peer voices, ambience and context after a disconnect failure', async () => {
  const f = fixture();
  await ready(f);
  await f.playback.play('sword', { key: 'one' });
  await f.playback.play('sword', { key: 'two' });
  await f.playback.setAmbience(['forest']);
  Object.assign(f.sources[0]!, {
    disconnect() {
      throw new Error('disconnect failed');
    },
  });
  assert.throws(() => f.playback.dispose(), /disconnect failed/);
  assert.ok(f.sources.every((s) => s.stopped));
  assert.equal(f.counts.closed, 1);
  assert.equal(f.playback.diagnosticsSnapshot.decodedBytes, 0);
  assert.equal(f.timers.size, 0);
  f.playback.dispose();
});
test('a failed audio graph setup can recover on the next gesture', async () => {
  const f = fixture();
  const gain = f.context.createGain;
  let calls = 0,
    connections = 0;
  f.context.createGain = () => {
    if (++calls === 2) throw new Error('gain failed');
    const node = gain();
    node.connect = () => {
      connections++;
    };
    return node;
  };
  await f.playback.unlock();
  await ready(f);
  assert.equal(connections, 3);
  await f.playback.play('sword');
  assert.equal(f.sources[0]!.started, true);
  f.playback.dispose();
});
test('a transient manifest failure retries on a later gesture', async () => {
  const f = fixture();
  let requests = 0;
  const playback = new AudioPlayback(() => {}, {
    context: () => f.context as unknown as AudioContext,
    request: async (url) => {
      if (!(url instanceof Request ? url.url : url.toString()).endsWith('manifest.json'))
        return new Response(bytes);
      if (++requests === 1) throw new Error('offline');
      return Response.json({ schemaVersion: 1, samples: [sample('sword-1')] });
    },
  });
  await playback.unlock();
  assert.equal(playback.samples.length, 0);
  await playback.unlock();
  assert.equal(playback.samples.length, 1);
  playback.setWorldFrozen(false);
  await playback.play('sword');
  assert.equal(f.sources[0]!.started, true);
  playback.dispose();
});
test('incoming ambience anchors its fade at the current audio time', async () => {
  const f = fixture();
  await ready(f);
  f.context.currentTime = 100;
  const gain = f.context.createGain;
  const anchors: number[][] = [];
  f.context.createGain = () => {
    const node = gain();
    Object.assign(node.gain, {
      setValueAtTime(value: number, time: number) {
        anchors.push([value, time]);
      },
    });
    return node;
  };
  await f.playback.setAmbience(['forest']);
  assert.deepEqual(anchors, [[0, 100]]);
  f.playback.dispose();
});

test('audio manifests reject duplicate IDs, unsafe paths and out-of-range loop points', () => {
  const manifest: AudioManifest = { schemaVersion: 1, samples: [sample('sword-1')] };
  assert.equal(parseAudioManifest(manifest).samples.length, 1);
  assert.throws(() =>
    parseAudioManifest({ ...manifest, samples: [sample('same'), sample('same')] }),
  );
  assert.throws(() =>
    parseAudioManifest({
      ...manifest,
      samples: [{ ...sample('bad'), path: '../Sounds/file.wav' }],
    }),
  );
  assert.throws(() =>
    parseAudioManifest({ ...manifest, samples: [{ ...sample('bad'), loopEnd: 2 }] }),
  );
});
test('first gesture unlocks once, mute and disposal release live sounds', async () => {
  const f = fixture();
  await f.playback.play('sword');
  assert.equal(f.sources.length, 0);
  await ready(f);
  await f.playback.play('sword');
  assert.equal(f.playback.diagnosticsSnapshot.voices, 1);
  f.playback.updateSettings({ ...defaultAudioSettings, effects: 0 });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  await f.playback.play('sword');
  assert.equal(f.sources.length, 1);
  f.playback.updateSettings(defaultAudioSettings);
  await f.playback.play('sword');
  assert.equal(f.playback.diagnosticsSnapshot.voices, 1, 'silent cues cannot consume cooldown');
  f.playback.updateSettings({ ...defaultAudioSettings, muted: true });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  await f.playback.play('sword');
  assert.equal(f.sources.length, 2);
  f.playback.dispose();
  f.playback.dispose();
  assert.equal(f.counts.closed, 1);
});
test('cooldowns begin on playback and ended voices release their resources', async () => {
  const f = fixture();
  await ready(f);
  await f.playback.play('sword');
  await f.playback.play('sword');
  assert.equal(f.sources.length, 1);
  f.sources[0]!.onended?.();
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  f.now = 1;
  await f.playback.play('sword');
  assert.equal(f.sources.length, 2);
  f.playback.dispose();
});
test('inaudible, cooling and saturated cues do not acquire decoded buffers', async (t) => {
  const f = fixture();
  try {
    await ready(f);
    const acquire = t.mock.method(AudioBuffers.prototype, 'acquire');
    await f.playback.play('sword', { x: 16, z: 0 });
    assert.equal(acquire.mock.callCount(), 0);
    await f.playback.play('sword');
    await f.playback.play('sword');
    assert.equal(acquire.mock.callCount(), 1);
    for (let i = 1; i < 20; i++) await f.playback.play('sword', { key: String(i) });
    assert.equal(f.playback.diagnosticsSnapshot.voices, 20);
    await f.playback.play('sword', { key: 'over-budget' });
    assert.equal(acquire.mock.callCount(), 20);
  } finally {
    f.playback.dispose();
  }
});
test('pause stops world sounds but menu feedback remains available', async () => {
  const f = fixture([sample('sword-1'), sample('ui-1', 'ui-confirm')]);
  await ready(f);
  await f.playback.play('sword');
  f.playback.setWorldFrozen(true);
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  await f.playback.play('sword');
  await f.playback.play('ui-confirm', { world: false });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 1);
  f.playback.dispose();
});
test('source failures are non-fatal, bounded and release playback reservations', async () => {
  const f = fixture();
  f.context.decodeAudioData = async () => ({
    length: 10 * 1024 ** 2,
    numberOfChannels: 1,
    duration: 0.5,
  });
  await ready(f);
  const original = f.context.createBufferSource;
  f.context.createBufferSource = () => {
    const source = original();
    source.fail = true;
    return source;
  };
  await f.playback.play('sword');
  await f.playback.play('sword');
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  assert.equal(f.reports.length, 1);
  assert.equal(
    f.playback.diagnosticsSnapshot.decodedBytes,
    0,
    'failed voices release their leases',
  );
  f.context.createBufferSource = original;
  await f.playback.play('sword');
  assert.equal(f.playback.diagnosticsSnapshot.voices, 1);
  f.playback.dispose();
});
test('voice budget reserves four slots for player-critical feedback', async () => {
  const f = fixture();
  await ready(f);
  for (let i = 0; i < 30; i++) await f.playback.play('sword', { key: String(i) });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 20);
  for (let i = 0; i < 4; i++) await f.playback.play('sword', { key: 'hero' + i, critical: true });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 24);
  await f.playback.play('sword', { key: 'hero-extra', critical: true });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 24);
  assert.equal(f.sources[0]!.stopped, true);
  f.playback.dispose();
});
test(
  'pending playback cancels before transport settles and expired cues never start',
  { timeout: 2000 },
  async () => {
    for (const action of [
      'replace',
      'expire',
      'mute',
      'effects-off',
      'dispose',
      'abort',
      'freeze',
    ]) {
      const f = fixture([sample('late-1', 'sword')]);
      await ready(f, false);
      const { promise: response, resolve } = Promise.withResolvers<Response>();
      const requested = Promise.withResolvers<void>();
      f.pending = () => {
        requested.resolve();
        return response;
      };
      const controller = new AbortController();
      const pending = f.playback.play('sword', { signal: controller.signal });
      await requested.promise;
      if (action === 'replace') f.playback.replaceSession();
      if (action === 'expire') f.now = 1;
      if (action === 'mute') f.playback.updateSettings({ ...defaultAudioSettings, muted: true });
      if (action === 'effects-off')
        f.playback.updateSettings({ ...defaultAudioSettings, effects: 0 });
      if (action === 'dispose') f.playback.dispose();
      if (action === 'abort') controller.abort();
      if (action === 'freeze') f.playback.setWorldFrozen(true);
      if (action !== 'expire') await pending;
      resolve(new Response(bytes));
      await pending;
      assert.equal(f.sources.length, 0, action);
      assert.equal(f.reports.length, 0, 'Expected cancellation stays out of diagnostics');
      f.playback.dispose();
    }
  },
);
test('stale ambience loads cannot start and a failed destination retains outgoing audio', async () => {
  const f = fixture([
    sample('forest-1', 'forest', true),
    {
      ...sample('wind-1', 'wind', true),
      hash: 'a'.repeat(64),
      path: 'audio/' + 'a'.repeat(64) + '.ogg',
    },
  ]);
  await ready(f);
  const { promise: response, resolve } = Promise.withResolvers<Response>();
  const requested = Promise.withResolvers<void>();
  f.pending = () => {
    requested.resolve();
    return response;
  };
  const stale = f.playback.setAmbience(['forest']);
  await requested.promise;
  await f.playback.setAmbience([]);
  resolve(new Response(bytes));
  await stale;
  assert.equal(f.sources.length, 0);
  f.pending = undefined;
  await f.playback.setAmbience(['forest']);
  assert.equal(f.playback.diagnosticsSnapshot.loops, 1);
  await f.playback.setAmbience(['wind']);
  assert.equal(f.playback.diagnosticsSnapshot.destination, 'forest');
  assert.equal(f.sources[0]!.stopped, false);
  f.playback.dispose();
  assert.equal(f.timers.size, 0);
});
test('legacy visual settings migrate without losing their values', () => {
  const legacy = {
    version: 5,
    renderScale: 0.75,
    showDebug: true,
    verticalSpan: 13,
    depthOfField: 0.25,
    visualEffects: defaultVisualEffects(),
  };
  const migrated = parseSettings(legacy);
  assert.equal(migrated.version, 7);
  assert.equal(migrated.renderScale, 0.75);
  assert.equal(migrated.depthOfField, 0.25);
  assert.deepEqual(migrated.audio, defaultAudioSettings);
  assert.throws(() => parseSettings({ ...migrated, audio: { ...migrated.audio, master: 2 } }));
});
test('filename review distinguishes modern recordings, natural candidates, deferred music and metadata', () => {
  assert.equal(
    reviewFilename('world/jeep_grand_cherokee_exterior_passby.wav').disposition,
    'unsuitable',
  );
  assert.equal(reviewFilename('world/forest_birds_wind.flac').disposition, 'alternate');
  assert.equal(reviewFilename('Game Sources/Music/Menu 1.mp3').disposition, 'future-use');
  assert.equal(reviewFilename('misc/test.wav.meta').disposition, 'non-audio');
});
test('movement foley requires traveled distance, not idle animation or frozen frames', () => {
  const session = new GameSession(content),
    calls: string[] = [];
  const feedback = new AudioFeedback({
    setListener() {},
    setWorldFrozen() {},
    setAmbience: async () => {},
    play: async (cue: string) => {
      calls.push(cue);
    },
  } as unknown as AudioPlayback);
  const hero = { ...session.sim.hero, definition: session.sim.enemies[0]!.definition };
  const sim = { ...session.sim.view, hero, actors: [hero], enemies: [] };
  feedback.frame(sim, false);
  hero.state = 'walk';
  feedback.frame(sim, false);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 7; i++) {
    hero.x += 0.1;
    feedback.frame(sim, false);
  }
  assert.ok(calls.includes('step-stone'));
  const before = calls.length;
  hero.x += 0.7;
  feedback.frame(sim, true);
  assert.equal(calls.length, before);
  hero.definition = { ...hero.definition, visual: 'candlebone-oracle' };
  hero.x += 0.7;
  feedback.frame(sim, false);
  assert.equal(calls.length, before, 'hovering Oracle has no ground footsteps');
});

test('unmarked kits accumulate short strides across frames; teleports reset the stride', () => {
  const session = new GameSession(content),
    calls: string[] = [];
  const feedback = new AudioFeedback({
    setListener() {},
    setWorldFrozen() {},
    setAmbience: async () => {},
    play: async (cue: string) => {
      calls.push(cue);
    },
  } as unknown as AudioPlayback);
  const hero = { ...session.sim.hero, definition: session.sim.enemies[0]!.definition };
  const sim = { ...session.sim.view, hero, actors: [hero], enemies: [] };
  feedback.frame(sim, false);
  hero.state = 'walk';
  for (let i = 0; i < 10; i++) {
    hero.x += 0.07;
    feedback.frame(sim, false);
  }
  assert.ok(calls.includes('step-stone'), 'ten short strides must total one footstep');
  const steps = calls.length;
  hero.x += 5;
  feedback.frame(sim, false);
  assert.equal(calls.length, steps, 'a teleport is not a stride');
  hero.x += 0.07;
  feedback.frame(sim, false);
  assert.equal(calls.length, steps, 'the teleport cleared the accumulated stride');
});

test('audio authoring verifies source hashes and rejects changed or escaped sources', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-audio-sources-');
  await fs.mkdir(path.join(root, 'Sounds'));
  await fs.writeFile(path.join(root, 'Sounds/source.flac'), bytes);
  const selected = [{ source: 'source.flac', sha256: hash }];
  await verifyAudioSources(root, {}, selected);
  await fs.writeFile(path.join(root, 'Sounds/source.flac'), 'changed');
  await assert.rejects(verifyAudioSources(root, {}, selected), /Audio source changed/);
  await assert.rejects(
    verifyAudioSources(root, {}, [{ source: '../outside.wav', sha256: hash }]),
    /relative|Invalid|Unsafe|safe/i,
  );
});

test('an aborted waiter cannot consume cooldown or stop a newer waiter sharing its load', async () => {
  const f = fixture([sample('late-1')]);
  await ready(f, false);
  const { promise: response, resolve } = Promise.withResolvers<Response>();
  const { promise: requested, resolve: started } = Promise.withResolvers<void>();
  f.pending = () => {
    started();
    return response;
  };
  const controller = new AbortController();
  const old = f.playback.play('sword', { signal: controller.signal });
  const next = f.playback.play('sword');
  await requested;
  controller.abort();
  resolve(new Response(bytes));
  await Promise.all([old, next]);
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0]!.started, true);
  assert.equal(f.sources[0]!.stopped, false);
  f.playback.dispose();
});

test('feedback requires accepted outcomes and distinguishes damage, rest and cancellation', () => {
  const session = new GameSession(content),
    calls: string[] = [];
  const feedback = new AudioFeedback({
    play: async (cue: string) => {
      calls.push(cue);
    },
  } as unknown as AudioPlayback);
  const base = {
    key: 'event',
    tick: 0,
    generation: session.generation,
    actor: session.sim.hero.id,
    action: 0,
    area: session.sim.area,
    position: [0, 0, 0] as const,
    direction: 0,
  };
  const signal = new AbortController().signal;
  const event = (details: object) =>
    feedback.event({ ...base, ...details } as PresentationEvent, session.sim.view, signal);
  event({ kind: 'damage', target: session.sim.hero.id, amount: 0 });
  event({
    kind: 'damage',
    target: session.sim.enemies[0]!.id,
    amount: 4,
    damageType: 'burn',
    phase: 'over-time',
  });
  event({ kind: 'transition-cancelled', destination: session.sim.area });
  assert.deepEqual(calls, []);
  event({ kind: 'damage', target: session.sim.hero.id, amount: 1 });
  event({ kind: 'rested' });
  event({ kind: 'room-reset', reason: 'manual' });
  assert.deepEqual(calls, ['hurt', 'heal', 'ui-confirm']);
  event({ kind: 'strike', actor: session.sim.enemies[0]!.id });
  assert.equal(calls.at(-1), 'dodge');
  event({ kind: 'strike' });
  assert.equal(calls.at(-1), 'sword');
});

test('a new gesture resumes a context suspended by the host without replacing its owner', async () => {
  const f = fixture();
  await ready(f);
  let resumed = 0;
  Object.assign(f.context, { state: 'suspended' });
  f.context.resume = async () => {
    resumed++;
  };
  await f.playback.unlock();
  assert.equal(resumed, 1);
  f.playback.dispose();
  assert.equal(f.counts.closed, 1);
});

test('menu feedback is non-spatial even after travel changes world coordinates', async () => {
  const f = fixture();
  await ready(f);
  await f.playback.play('sword', { world: false, x: 100, z: 100 });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 1);
  f.playback.dispose();
});
test('rapid ambience changes retain only one outgoing fade and timer', async () => {
  const f = fixture([sample('forest-1', 'forest', true), sample('wind-1', 'wind', true)]);
  await ready(f);
  await f.playback.setAmbience(['forest']);
  assert.equal(f.timers.size, 0, 'the first group has no outgoing fade to retire');
  await f.playback.setAmbience(['wind']);
  assert.equal(f.sources[0]!.stopped, false);
  await f.playback.setAmbience(['forest']);
  assert.equal(f.sources[0]!.stopped, true);
  assert.equal(f.sources[1]!.stopped, false);
  assert.equal(f.timers.size, 1);
  f.playback.dispose();
});

test('opening a paused menu preserves its accepted feedback while cancelling pending world cues', async () => {
  for (const world of [true, false]) {
    const f = fixture();
    await ready(f);
    const pending = f.playback.play('sword', { world });
    f.playback.setWorldFrozen(true);
    await pending;
    assert.equal(f.playback.diagnosticsSnapshot.voices, world ? 0 : 1);
    f.playback.dispose();
  }
});

test('disposal before a queued unlock does not create an audio context', async () => {
  let contexts = 0;
  const playback = new AudioPlayback(() => {}, {
    context: () => {
      contexts++;
      throw new Error('Context created after disposal');
    },
  });
  const pending = playback.unlock();
  playback.dispose();
  await pending;
  assert.equal(contexts, 0);
});

test('a silent legacy manifest does not report missing ambience', async () => {
  const f = fixture([]);
  await ready(f);
  await f.playback.setAmbience(['forest']);
  assert.deepEqual(f.reports, []);
  assert.equal(f.sources.length, 0);
  f.playback.dispose();
});

test('preload cannot evict a decoded buffer borrowed by pending playback', async () => {
  const f = fixture([sample('sword-1')]);
  const decodedBytes = 40 * 1024 ** 2;
  const { promise: decoded, resolve: decode } = Promise.withResolvers<void>();
  const { promise: decoding, resolve: started } = Promise.withResolvers<void>();
  let decodes = 0;
  f.context.decodeAudioData = async () => {
    decodes++;
    started();
    await decoded;
    return { length: decodedBytes / 4, numberOfChannels: 1, duration: 0.5 };
  };
  const unlocking = f.playback.unlock();
  await decoding;
  f.playback.setWorldFrozen(false);
  const playing = f.playback.play('sword');
  decode();
  await Promise.all([unlocking, playing]);
  assert.equal(f.sources.length, 1);
  assert.equal(f.playback.diagnosticsSnapshot.decodedBytes, decodedBytes);
  await f.playback.play('sword', { key: 'second' });
  assert.equal(decodes, 1, 'a live buffer must remain shared');
  assert.equal(f.sources.length, 2);
  f.sources[0]!.onended?.();
  assert.equal(f.playback.diagnosticsSnapshot.decodedBytes, decodedBytes);
  f.sources[1]!.onended?.();
  assert.equal(f.playback.diagnosticsSnapshot.decodedBytes, 0);
  f.playback.dispose();
});

test('closing the buffer owner rejects shared late decodes and further admission', async () => {
  const { promise: decoded, resolve: complete } = Promise.withResolvers<AudioBuffer>();
  const { promise: decoding, resolve: started } = Promise.withResolvers<void>();
  let requestSignal: AbortSignal | undefined;
  const buffers = new AudioBuffers(
    async (_url, options) => {
      requestSignal = options?.signal ?? undefined;
      return new Response(bytes);
    },
    () => {
      started();
      return decoded;
    },
  );
  const selected = parseAudioManifest({ schemaVersion: 1, samples: [sample('sword-1')] })
    .samples[0]!;
  const first = buffers.acquire(selected);
  const second = buffers.acquire(selected);
  await decoding;
  buffers.dispose();
  assert.equal(requestSignal?.aborted, true);
  await assert.rejects(first, /abort/i);
  await assert.rejects(second, /abort/i);
  complete({ length: 22050, numberOfChannels: 1 } as AudioBuffer);
  await assert.rejects(buffers.acquire(selected), /abort/i);
  assert.equal(buffers.decodedBytes, 0);
});

test('audio claims cancel independently and the last cancellation permits recovery before native decode settles', async () => {
  const started = Promise.withResolvers<void>();
  const late = Promise.withResolvers<AudioBuffer>();
  const signals: AbortSignal[] = [];
  let decodes = 0;
  const buffers = new AudioBuffers(
    async (_url, options) => {
      signals.push(options!.signal!);
      return new Response(bytes);
    },
    async () => {
      if (++decodes === 1) {
        started.resolve();
        return late.promise;
      }
      return { length: 20, numberOfChannels: 1 } as AudioBuffer;
    },
  );
  const selected = parseAudioManifest({ schemaVersion: 1, samples: [sample('sword-1')] })
    .samples[0]!;
  const a = new AbortController(),
    b = new AbortController();
  const first = buffers.acquire(selected, a.signal),
    second = buffers.acquire(selected, b.signal);
  await started.promise;
  a.abort();
  await assert.rejects(first, /abort/i);
  assert.equal(signals[0]!.aborted, false, 'The surviving borrower keeps shared work alive');
  b.abort();
  const recovery = buffers.acquire(selected);
  await assert.rejects(second, /abort/i);
  assert.equal(signals[0]!.aborted, true);
  const recovered = await recovery;
  assert.equal(signals.length, 2);
  late.resolve({ length: 1000, numberOfChannels: 1 } as AudioBuffer);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    buffers.decodedBytes,
    80,
    'Late native work cannot overwrite the recovered cache entry',
  );
  recovered.release();
  buffers.dispose();
});

test('audio admission bounds transport and native decodes across queued cancellation and retry', async () => {
  const payloads = Array.from({ length: 10 }, (_, i) => new Uint8Array([i])),
    samples = payloads.map((payload, i) => {
      const hash = createHash('sha256').update(payload).digest('hex');
      return { ...sample('burst-' + i), hash, path: `audio/${hash}.wav`, bytes: 1 };
    }),
    native = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>(),
    signals: AbortSignal[] = [];
  let decodes = 0;
  const buffers = new AudioBuffers(
    async (url, options) => {
      signals.push(options!.signal!);
      const file = url instanceof Request ? url.url : url.toString();
      const index = samples.findIndex((s) => '/' + s.path === file);
      return new Response(payloads[index]!);
    },
    async () => {
      decodes++;
      if (decodes === 2) started.resolve();
      await native.promise;
      return { length: 20, numberOfChannels: 1 } as AudioBuffer;
    },
  );
  const controllers = samples.map(() => new AbortController()),
    claims = samples.map((sample, i) => buffers.acquire(sample, controllers[i]!.signal)),
    shared = buffers.acquire(samples[1]!),
    settling = Promise.allSettled([...claims, shared]);
  let retry: ReturnType<AudioBuffers['acquire']> | undefined;
  try {
    await started.promise;
    assert.equal(signals.length, 2, 'Voice limits must also bound work before voice construction');
    assert.equal(decodes, 2);
    controllers[2]!.abort();
    await assert.rejects(claims[2]!, /abort/i);
    controllers[0]!.abort();
    await assert.rejects(claims[0]!, /abort/i);
    retry = buffers.acquire(samples[0]!);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signals.length, 2, 'Cancelled native decodes retain their admission slots');
    assert.equal(signals[0]!.aborted, true);
    controllers[1]!.abort();
    await assert.rejects(claims[1]!, /abort/i);
    assert.equal(signals[1]!.aborted, false, 'A shared borrower keeps its acquisition alive');
    native.resolve();
    const results = await settling;
    const recovered = await retry;
    assert.equal(signals.length, 10, 'A cancelled queued sample never reaches transport');
    for (const result of results) if (result.status === 'fulfilled') result.value.release();
    recovered.release();
  } finally {
    buffers.dispose();
    native.resolve();
    await settling;
    await retry?.catch(() => {});
  }
});

test('voice cancellation releases its listener as well as its decoded lease', async () => {
  const f = fixture();
  await ready(f);
  const controller = new AbortController();
  let listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => {
    listeners++;
    add(...args);
  };
  controller.signal.removeEventListener = (
    ...args: Parameters<AbortSignal['removeEventListener']>
  ) => {
    listeners--;
    remove(...args);
  };
  await f.playback.play('sword', { signal: controller.signal });
  controller.abort();
  assert.equal(listeners, 0);
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  f.playback.dispose();
});

test('pause releases world siblings and reports cleanup failure without interrupting gameplay', async () => {
  const f = fixture();
  await ready(f);
  await f.playback.play('sword');
  f.now = 1;
  await f.playback.play('sword');
  Object.assign(f.sources[0]!, {
    disconnect: () => {
      throw new Error('disconnect failure');
    },
  });
  assert.doesNotThrow(() => f.playback.setWorldFrozen(true));
  assert.equal(
    f.sources.every((source) => source.stopped),
    true,
  );
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  assert.equal(f.reports.length, 1);
  f.playback.dispose();
});

test('startup prepares the shared audio graph without activating playback', async () => {
  const f = fixture();
  const first = f.playback.initialize();
  assert.equal(f.playback.initialize(), first);
  await first;
  assert.equal(f.counts.contexts, 1);
  assert.equal(f.counts.resumes, 0);
  assert.equal(f.playback.diagnosticsSnapshot.unlocked, false);
  assert.equal(f.sources.length, 0);
  await f.playback.unlock();
  assert.equal(f.counts.contexts, 1, 'first input reuses the prepared context');
  assert.equal(f.counts.resumes, 1);
  f.playback.dispose();
  assert.equal(f.counts.closed, 1);
});

test('disposal before queued initialization prevents audio allocation', async () => {
  const f = fixture();
  const pending = f.playback.initialize();
  f.playback.dispose();
  await pending;
  assert.equal(f.counts.contexts, 0);
  assert.equal(f.counts.requests, 0);
  assert.equal(f.reports.length, 0);
});

test('known areas share authored audio while unknown fixtures fall back to quiet stone', () => {
  assert.deepEqual(areaAudio('abandoned-orchard'), { surface: 'grass', ambience: [] });
  assert.deepEqual(areaAudio('outdoor-fixture'), { surface: 'grass', ambience: [] });
  assert.deepEqual(areaAudio('interior-fixture'), { surface: 'stone', ambience: [] });
  for (const id of ['unknown-constructor-area', 'constructor', 'toString', '__proto__'])
    assert.deepEqual(areaAudio(id), { surface: 'stone', ambience: [] });
});

test('cue cooldowns are finite for named, stepped, prototype and default cues', () => {
  assert.equal(cueCooldown('ui-deny'), 0.5);
  assert.equal(cueCooldown('impact'), 0.06);
  assert.equal(cueCooldown('bone'), 0.06);
  assert.equal(cueCooldown('step-grass'), 0.12);
  assert.equal(cueCooldown('sword'), 0.04);
  for (const cue of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
    assert.equal(cueCooldown(cue as never), 0.04, `${cue} must use the default cooldown`);
});

test('loot and health pickups play distinct feedback cues', () => {
  const s = new GameSession(content),
    calls: string[] = [];
  const feedback = new AudioFeedback({
    play: async (cue: string) => {
      calls.push(cue);
    },
  } as unknown as AudioPlayback);
  const signal = new AbortController().signal,
    base = {
      key: 'pickup',
      tick: 1,
      generation: s.generation,
      actor: s.sim.hero.id,
      action: 0,
      area: s.sim.area,
      position: [0, 0, 0] as const,
      direction: 0,
      amount: 20,
    };
  feedback.event({ ...base, kind: 'pickup', item: 'gold' }, s.sim.view, signal);
  feedback.event({ ...base, kind: 'pickup', item: 'iron' }, s.sim.view, signal);
  feedback.event({ ...base, kind: 'health-pickup' }, s.sim.view, signal);
  assert.deepEqual(calls, ['coin', 'pickup', 'heal']);
});

test('concurrent sounds choose different delivered variants in playback order', async () => {
  const payloads = [new Uint8Array([1]), new Uint8Array([2])];
  const samples = payloads.map((payload, index) => {
    const hash = createHash('sha256').update(payload).digest('hex');
    return { ...sample('variant-' + index), hash, path: `audio/${hash}.wav`, bytes: 1 };
  });
  const f = fixture(samples, new Map(samples.map((s, i) => ['/' + s.path, payloads[i]!])));
  try {
    await ready(f);
    await Promise.all(['first', 'second', 'third'].map((key) => f.playback.play('sword', { key })));
    const played = f.sources
      .filter((s) => s.started)
      .map((s) => (s.buffer as unknown as { marker: number }).marker);
    assert.deepEqual(played, [1, 2, 1]);
  } finally {
    f.playback.dispose();
  }
});

test('silent audio channels acquire no buffers and ambience resumes when audible again', async (t) => {
  for (const channel of ['master', 'ambience'] as const) {
    const f = fixture([sample('forest-1', 'forest', true)]);
    await ready(f);
    const acquire = t.mock.method(AudioBuffers.prototype, 'acquire');
    f.playback.updateSettings({ ...defaultAudioSettings, [channel]: 0 });
    await f.playback.setAmbience(['forest']);
    assert.equal(acquire.mock.callCount(), 0, channel);
    f.playback.updateSettings(defaultAudioSettings);
    await f.playback.setAmbience(['forest']);
    assert.equal(f.playback.diagnosticsSnapshot.loops, 1);
    f.playback.updateSettings({ ...defaultAudioSettings, [channel]: 0 });
    assert.equal(f.playback.diagnosticsSnapshot.loops, 0);
    f.playback.dispose();
    acquire.mock.restore();
  }
});

test('silent effects do not preload samples on unlock', async () => {
  const f = fixture();
  f.playback.updateSettings({ ...defaultAudioSettings, effects: 0 });
  await ready(f);
  assert.equal(f.counts.requests, 1, 'only the manifest is needed');
  f.playback.dispose();
});

test('repeating a pending ambience destination preserves its acquisition', async () => {
  const f = fixture([sample('forest-1', 'forest', true)]);
  await ready(f);
  const requested = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  f.pending = () => {
    requested.resolve();
    return response.promise;
  };
  const first = f.playback.setAmbience(['forest']);
  await requested.promise;
  const second = f.playback.setAmbience(['forest']);
  response.resolve(new Response(bytes));
  await Promise.all([first, second]);
  assert.equal(f.counts.requests, 2, 'one manifest and one sample transport');
  assert.equal(f.sources.length, 1);
  f.playback.dispose();
});

test(
  'muting cancels an in-flight effects preload without waiting for transport',
  { timeout: 2000 },
  async () => {
    const f = fixture([sample('sword-1')]);
    const requested = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    f.pending = () => {
      requested.resolve();
      return response.promise;
    };
    const unlocking = f.playback.unlock();
    await requested.promise;
    f.playback.updateSettings({ ...defaultAudioSettings, muted: true });
    try {
      await unlocking;
      assert.equal(f.playback.diagnosticsSnapshot.decodedBytes, 0);
      assert.deepEqual(f.reports, []);
    } finally {
      response.resolve(new Response(bytes));
      f.playback.dispose();
    }
  },
);

test(
  'audio initialization settles on shutdown during manifest transport or body reads',
  { timeout: 2000 },
  async () => {
    for (const phase of ['transport', 'body']) {
      const f = fixture([]),
        requested = Promise.withResolvers<void>(),
        late = Promise.withResolvers<void>();
      const wait = () => {
        requested.resolve();
        return late.promise;
      };
      const playback = new AudioPlayback(() => assert.fail('shutdown must be quiet'), {
        context: () => f.context as unknown as AudioContext,
        request: async () => {
          if (phase === 'transport') await wait();
          return {
            ok: true,
            json: async () => {
              if (phase === 'body') await wait();
              return { schemaVersion: 1, samples: [] };
            },
          } as Response;
        },
      });
      const pending = playback.initialize();
      await requested.promise;
      playback.dispose();
      try {
        await pending;
      } finally {
        late.reject(new Error('late manifest failure'));
      }
      assert.deepEqual(playback.samples, []);
      assert.equal(f.counts.closed, 1);
    }
  },
);
