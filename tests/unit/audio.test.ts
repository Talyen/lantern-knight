import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyAudioSources } from '../../tools/assets/audio';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AudioPlayback } from '../../src/audio/playback';
import { AudioFeedback } from '../../src/audio/feedback';
import { parseAudioManifest, type AudioManifest } from '../../src/assets/audio';
import { defaultAudioSettings } from '../../src/content/audio';
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
function fixture(samples = [sample('sword-1'), sample('forest-1', 'forest', true)]) {
  const sources: {
    started: boolean;
    stopped: boolean;
    onended: (() => void) | null;
    fail: boolean;
    start: () => void;
    stop: () => void;
  }[] = [];
  let now = 0,
    closed = 0,
    requests = 0;
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
    resume: async () => {},
    close: async () => {
      closed++;
    },
    decodeAudioData: async () => ({ length: 22050, numberOfChannels: 1, duration: 0.5 }),
    createGain: gain,
    createBufferSource: () => {
      const source = {
        buffer: undefined,
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
    context: () => context as unknown as AudioContext,
    now: () => now,
    random: () => 0,
    request: async (url) => {
      requests++;
      if ((url instanceof Request ? url.url : url.toString()).endsWith('manifest.json'))
        return Response.json({ schemaVersion: 1, samples });
      return pending ? pending() : new Response(bytes);
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
    sources,
    reports,
    timers,
    context,
    get closed() {
      return closed;
    },
    get requests() {
      return requests;
    },
    set now(value: number) {
      now = value;
    },
    set pending(value: (() => Promise<Response>) | undefined) {
      pending = value;
    },
  };
}
async function ready(f: ReturnType<typeof fixture>) {
  await f.playback.unlock();
  f.playback.setWorldFrozen(false);
}

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
  f.playback.updateSettings({ ...defaultAudioSettings, muted: true });
  assert.equal(f.playback.diagnosticsSnapshot.voices, 0);
  await f.playback.play('sword');
  assert.equal(f.sources.length, 1);
  f.playback.dispose();
  f.playback.dispose();
  assert.equal(f.closed, 1);
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
test('pending playback is discarded after generation replacement or its deadline', async () => {
  for (const action of ['replace', 'expire', 'mute', 'dispose', 'abort']) {
    const f = fixture([sample('forest-1', 'forest', true)]);
    await ready(f);
    // Add a one-shot after preload so its fetch can be controlled.
    const manifest = (f.playback as unknown as { manifest: AudioManifest }).manifest;
    manifest.samples.push(sample('late-1', 'sword'));
    let resolve!: (response: Response) => void;
    f.pending = () =>
      new Promise<Response>((done) => {
        resolve = done;
      });
    const controller = new AbortController();
    const pending = f.playback.play('sword', { signal: controller.signal });
    await Promise.resolve();
    if (action === 'replace') f.playback.replaceSession();
    if (action === 'expire') f.now = 1;
    if (action === 'mute') f.playback.updateSettings({ ...defaultAudioSettings, muted: true });
    if (action === 'dispose') f.playback.dispose();
    if (action === 'abort') controller.abort();
    resolve(new Response(bytes));
    await pending;
    assert.equal(f.sources.length, 0, action);
    f.playback.dispose();
  }
});
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
  let resolve!: (response: Response) => void;
  f.pending = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  const stale = f.playback.setAmbience(['forest']);
  await Promise.resolve();
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
  assert.equal(migrated.version, 6);
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
  feedback.frame(session.sim.view, false);
  session.sim.hero.state = 'walk';
  feedback.frame(session.sim.view, false);
  assert.equal(calls.length, 0);
  session.sim.hero.x += 0.7;
  feedback.frame(session.sim.view, false);
  assert.ok(calls.includes('step-stone'));
  const before = calls.length;
  session.sim.hero.x += 0.7;
  feedback.frame(session.sim.view, true);
  assert.equal(calls.length, before);
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
  const f = fixture([sample('forest-1', 'forest', true)]);
  await ready(f);
  (f.playback as unknown as { manifest: AudioManifest }).manifest.samples.push(sample('late-1'));
  let resolve!: (response: Response) => void;
  f.pending = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  const controller = new AbortController();
  const old = f.playback.play('sword', { signal: controller.signal });
  const next = f.playback.play('sword');
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
  event({ kind: 'transition-cancelled', destination: session.sim.area });
  assert.deepEqual(calls, []);
  event({ kind: 'damage', target: session.sim.hero.id, amount: 1 });
  event({ kind: 'rested' });
  event({ kind: 'room-reset', reason: 'manual' });
  assert.deepEqual(calls, ['hurt', 'heal', 'ui-confirm']);
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
  assert.equal(f.closed, 1);
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
  await f.playback.setAmbience(['wind']);
  assert.equal(f.sources[0]!.stopped, false);
  await f.playback.setAmbience(['forest']);
  assert.equal(f.sources[0]!.stopped, true);
  assert.equal(f.sources[1]!.stopped, false);
  assert.equal(f.timers.size, 1);
  f.playback.dispose();
});
