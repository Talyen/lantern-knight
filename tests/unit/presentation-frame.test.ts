import { HEADINGS } from '../../src/content/headings';
import { heroTravelClip } from '../../src/content/hero-locomotion';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Group,
  BufferGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  OrthographicCamera,
  CanvasTexture,
  Vector3,
} from 'three';
import { GamePresentation } from '../../src/presentation/game-scene';
import { ActorPresentation } from '../../src/presentation/actor-presentation';
import { DisposalScope } from '../../src/assets/cleanup';
import type { PreparedRegistration } from '../../src/assets/registration';
import { EventHub } from '../../src/core/events';
import { Simulation } from '../../src/core/simulation';
import { defaultVisualEffects } from '../../src/content/visual-effects';
import { content } from '../fixtures/content';
import { manifestFixture } from '../fixtures/manifest';
import { mockGlobals } from '../fixtures/globals';
import { ContentRegistry, type ContentDefinitions } from '../../src/content/world';
import { actors as actorDefinitions } from '../../src/content/actors';
import { ActorSprite } from '../../src/presentation/sprite';
import { SceneLightingRenderer } from '../../src/presentation/scene-lighting-renderer';
import { CombatFeedback } from '../../src/presentation/combat-feedback';
import {
  combatFeedback as feedbackSettings,
  combatEffectAssets,
} from '../../src/content/combat-feedback';
import { lanePoint, ribLaneAttack } from '../../src/content/rib-lane';
import { cameraContract } from '../../src/assets/camera-contract';
import { makeCamera } from '../../src/presentation/camera';

test('room-specific rib representatives retire before their pack is released', () => {
  const texture = new CanvasTexture({} as HTMLCanvasElement),
    manifest = manifestFixture();
  const packs = new Map<
    string,
    { manifest: typeof manifest; textures: Map<string, CanvasTexture> }
  >(
    [...combatEffectAssets, feedbackSettings.ribLane.asset].map((asset) => [
      asset,
      { manifest, textures: new Map([['atlas-0', texture]]) },
    ]),
  );
  const feedback = new CombatFeedback(packs, new OrthographicCamera(), new EventHub());
  try {
    feedback.prepare();
    assert.equal(feedback.group.children.length, combatEffectAssets.length + 1);
    let disposed = 0;
    (feedback.group.children.at(-1) as Mesh).geometry.addEventListener('dispose', () => disposed++);
    packs.delete(feedbackSettings.ribLane.asset);
    feedback.reset();
    assert.equal(disposed, 1);
    assert.equal(feedback.group.children.length, combatEffectAssets.length);
    feedback.prepare();
    assert.equal(feedback.group.children.length, combatEffectAssets.length);
  } finally {
    feedback.dispose();
    texture.dispose();
  }
});

test('rib artwork endpoints match the locked ground footprint and retire on cancellation', () => {
  const texture = new CanvasTexture({} as HTMLCanvasElement);
  const manifest = manifestFixture(feedbackSettings.ribLane.asset);
  Object.assign(manifest.asset, {
    canvas: [512, 384],
    density: 256,
    anchor: [256, 192],
    projection: 'projected-world',
  });
  manifest.frames = [{ ...manifest.frames[0]!, rect: [0, 0, 512, 384], trim: [0, 0, 512, 384] }];
  Object.assign(manifest.pages[0]!, { width: 512, height: 384 });
  manifest.asset.clips.show = {
    d45: {
      frames: [manifest.frames[0]!.id],
      durationsMs: [1880],
      loop: false,
      notifies: [],
      markers: [{ id: 'contact', atMs: 1020 }],
    },
  };
  const feedback = new CombatFeedback(
    new Map([
      [feedbackSettings.ribLane.asset, { manifest, textures: new Map([['atlas-0', texture]]) }],
    ]),
    makeCamera(1),
    new EventHub(),
  );
  const sim = new Simulation(content);
  const lane = {
    id: 'locked',
    source: sim.enemies[0]!.id,
    x: 0,
    y: 0,
    z: 0,
    age: 45,
    length: 4,
    width: 0.8,
    windup: ribLaneAttack.windup,
    total: ribLaneAttack.total,
  };
  try {
    for (let frame = 0; frame < 2; frame++) {
      feedback.update({ ...sim.view, ribLanes: [lane] });
      const mesh = feedback.group.children.find((c) => c.name === 'combat-rib-lane')!;
      mesh.updateMatrixWorld(true);
      const point = (x: number, y: number) => {
        const u = (x - 256) / 256,
          v = (192 - y) / 256;
        return new Vector3(
          u,
          v,
          -v / Math.tan((cameraContract.elevationDeg * Math.PI) / 180),
        ).applyMatrix4(mesh.matrixWorld);
      };
      assert.ok(point(0.49 * 512, 0.57 * 384).distanceTo(new Vector3(0, 0.025, 0)) < 1e-6);
      for (const [x, y, along] of [
        [0.18, 0.72, -2],
        [0.8, 0.42, 2],
      ]) {
        const expected = lanePoint(lane, along!, 0);
        assert.ok(
          point(x! * 512, y! * 384).distanceTo(new Vector3(expected.x, 0.025, expected.z)) < 1e-6,
        );
      }
    }
    const mesh = feedback.group.children[0] as Mesh;
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => disposed++);
    feedback.update(sim.view);
    assert.equal(feedback.group.children.length, 0);
    assert.equal(disposed, 1);
  } finally {
    feedback.dispose();
    texture.dispose();
  }
});

test('combat shader representatives prime offscreen in the beauty pass and survive resets until disposal', () => {
  const texture = new CanvasTexture({} as HTMLCanvasElement),
    manifest = manifestFixture();
  manifest.asset.type = 'effect';
  const packs = new Map(
    combatEffectAssets.map((asset) => [
      asset,
      { manifest, textures: new Map([['atlas-0', texture]]) },
    ]),
  );
  const camera = new OrthographicCamera();
  const feedback = new CombatFeedback(packs, camera, new EventHub());
  feedback.prepare();
  const representatives = [...feedback.group.children];
  assert.equal(representatives.length, combatEffectAssets.length);
  assert.ok(
    representatives.every(
      (mesh) => mesh.visible && mesh.position.distanceTo(camera.position) > camera.far,
    ),
  );
  for (const mesh of representatives) {
    const last = (mesh.children.at(-1) ?? mesh) as Mesh,
      beauty = last.material as Material,
      depth = new Material();
    last.material = depth;
    const args = [{}, {}, {}, {}, depth] as unknown as Parameters<typeof last.onAfterRender>;
    last.onAfterRender(...args);
    assert.equal(mesh.visible, true, 'A focus/depth override cannot finish beauty preparation');
    last.material = beauty;
    args[4] = beauty;
    last.onAfterRender(...args);
    assert.equal(mesh.visible, false);
    depth.dispose();
  }
  feedback.prepare();
  feedback.reset();
  assert.deepEqual(feedback.group.children, representatives);
  assert.ok(
    representatives.every((mesh) => mesh.visible),
    'Room replacement rearms shader preparation',
  );
  let retired = 0;
  for (const mesh of representatives)
    (mesh as Mesh<BufferGeometry, Material>).material.addEventListener('dispose', () => retired++);
  feedback.dispose();
  assert.throws(() => feedback.prepare(), /disposed/);
  assert.equal(retired, representatives.length);
  assert.equal(feedback.group.children.length, 0);
  texture.dispose();
});

test('companion GPU uploads finish before readiness and stop borrowing after cancellation or disposal', async () => {
  const textures = [{}, {}],
    uploaded: unknown[] = [];
  const renderer: SceneLightingRenderer = Object.create(SceneLightingRenderer.prototype);
  const abort = new AbortController();
  Object.assign(renderer, {
    ready: false,
    disposed: false,
    resources: {
      renderer: {
        initTexture: (texture: unknown) => {
          uploaded.push(texture);
        },
      },
      packs: new Map(),
    },
    lighting: {
      normals: { load: async () => {}, textures: new Map(textures.map((t, i) => [String(i), t])) },
    },
  });
  await renderer.prepare(undefined, abort.signal);
  assert.deepEqual([...uploaded], textures);
  assert.equal(renderer.ready, true);
  uploaded.length = 0;
  Object.assign(renderer, { ready: false });
  abort.abort(new Error('superseded room'));
  await assert.rejects(renderer.prepare(undefined, abort.signal), /superseded room/);
  assert.equal(uploaded.length, 0);
  const callback = Reflect.get(renderer, 'resources').renderer;
  callback.initTexture = (texture: unknown) => {
    uploaded.push(texture);
    Reflect.set(renderer, 'disposed', true);
  };
  await assert.rejects(renderer.prepare(), /disposed/);
  assert.deepEqual(uploaded, [textures[0]]);
  assert.equal(renderer.ready, false);
});

test('first blended character pose reuses the shader declared before initial room rendering', () => {
  const manifest = manifestFixture(),
    texture = new CanvasTexture({} as HTMLCanvasElement);
  const sprite = new ActorSprite(
    'hero',
    manifest,
    new Map([['atlas-0', texture]]),
    manifest.asset.clips.idle!.d45!,
  );
  const camera = new OrthographicCamera(),
    foot = new Vector3(),
    frame = manifest.frames[0]!;
  sprite.show(frame.id, foot, camera);
  const before = [sprite.material, ...(sprite.edgeMaterial ? [sprite.edgeMaterial] : [])].map(
    (m) => [m.customProgramCacheKey(), m.version],
  );
  sprite.show(frame.id, foot, camera, {
    from: frame.id,
    to: frame.id,
    mix: 0.5,
    motion: false,
    guarded: true,
  });
  assert.deepEqual(
    [sprite.material, ...(sprite.edgeMaterial ? [sprite.edgeMaterial] : [])].map((m) => [
      m.customProgramCacheKey(),
      m.version,
    ]),
    before,
  );
  sprite.dispose();
  texture.dispose();
});

test('failed actor attachment destroys staged resources and leaves no live visual behind', (t) => {
  const sim = new Simulation(content),
    room = new Group(),
    texture = new CanvasTexture({} as HTMLCanvasElement),
    manifest = manifestFixture();
  const presentation = new ActorPresentation(
    room,
    new Map([['ink-hero-current', { manifest, textures: new Map([['atlas-0', texture]]) }]]),
    new OrthographicCamera(),
    texture,
    {} as PreparedRegistration,
  );
  const destroyed = new Set<object>();
  for (const prototype of [BufferGeometry.prototype, Material.prototype]) {
    const dispose = prototype.dispose;
    t.mock.method(prototype, 'dispose', function (this: BufferGeometry | Material) {
      destroyed.add(this);
      dispose.call(this);
    });
  }
  const add = room.add.bind(room);
  room.add = function (...objects) {
    add(...objects);
    throw new Error('attachment observer failed');
  };
  try {
    assert.throws(() => presentation.createVisual(sim.hero, sim.generation), /attachment observer/);
    presentation.dispose();
    assert.equal(presentation.actors.size, 0);
    assert.equal(room.children.length, 0);
    assert.equal(destroyed.size, 6, 'all staged sprite, shadow and ring allocations were released');
  } finally {
    presentation.dispose();
    texture.dispose();
  }
});

test('shader preparation cannot resume borrowing scenery after presentation shutdown', async () => {
  const started = Promise.withResolvers<void>(),
    compilation = Promise.withResolvers<void>();
  const presentation: GamePresentation = Object.create(GamePresentation.prototype);
  let touchedScenery = false;
  Object.assign(presentation, {
    resources: new DisposalScope(),
    packs: new Map(),
    lookRenderer: { prepare: async () => {} },
    combatFeedback: { prepare: () => {} },
    scene: new Group(),
    camera: new OrthographicCamera(),
    flare: new Mesh(new PlaneGeometry(), new MeshBasicMaterial()),
    renderer: {
      compileAsync: () => {
        started.resolve();
        return compilation.promise;
      },
    },
    roomPresentation: {
      surround: {
        update: () => {
          touchedScenery = true;
        },
      },
    },
    visualEffects: {},
  });
  const warming = presentation.warm();
  await started.promise;
  presentation.dispose();
  compilation.resolve();
  await assert.rejects(warming, /presentation disposed/);
  assert.equal(touchedScenery, false);
  assert.equal(
    presentation.scene.children.length,
    0,
    'Cancelled preparation retires its borrowed flare primer',
  );
});

test('animation observers can shut down presentation only after the complete frame finishes borrowing resources', (t) => {
  mockGlobals(t, { window: { matchMedia: () => ({ matches: false }) } });
  const sim = new Simulation(content),
    hub = new EventHub(),
    room = new Group(),
    texture = new CanvasTexture({} as HTMLCanvasElement);
  const camera = new OrthographicCamera(),
    registration = {} as PreparedRegistration;
  const manifest = manifestFixture();
  for (const clip of Object.values(manifest.asset.clips.idle!))
    clip!.notifies = [{ id: 'frame', kind: 'footstep', atMs: 0 }];
  const enemy = manifestFixture('library-sk01');
  const packs = new Map([
    ['ink-hero-current', { manifest, textures: new Map([['atlas-0', texture]]) }],
    ['library-sk01', { manifest: enemy, textures: new Map([['atlas-0', texture]]) }],
  ]);
  const actors = new ActorPresentation(room, packs, camera, texture, registration);
  const resources = new DisposalScope();
  resources.own(actors);
  const calls: string[] = [];
  let closed = false;
  resources.defer(() => {
    closed = true;
    calls.push('dispose');
  });
  const marker = () => new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
  const aim = marker(),
    flare = marker();
  t.after(() => {
    resources.dispose();
    hub.dispose();
    texture.dispose();
    for (const mesh of [aim, flare]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
  const presentation: GamePresentation = Object.create(GamePresentation.prototype);
  Object.assign(presentation, {
    resources,
    actorPresentation: actors,
    events: hub,
    generation: sim.generation,
    renderer: { setClearColor: () => {} },
    camera,
    aim,
    flare,
    debug: false,
    background: 'dark',
    light: { position: new Vector3() },
    flareLight: { position: new Vector3() },
    walkTiming: 'weighted',
    animationTreatment: 'original',
    visualEffects: defaultVisualEffects(),
    updateCamera: () => {},
    roomPresentation: { room },
    guidingWind: { update: () => {} },
    sceneEffects: { update: () => {} },
    combatFeedback: {
      update: () => {},
      cameraKick: new Vector3(0.04, 0.02, 0),
      flareLight: { position: new Vector3(), power: 0 },
    },
    renderFrame: () => {
      assert.deepEqual(camera.position.toArray(), [0.04, 0.02, 0]);
      assert.equal(
        closed,
        false,
        'Rendering must finish before a feedback observer disposes its resources',
      );
      assert.equal(
        actors.actors.size,
        sim.actors.length,
        'Every actor is prepared before notification',
      );
      calls.push('render');
    },
  });
  hub.setGeneration(sim.generation);
  hub.subscribe(() => {
    assert.deepEqual(camera.position.toArray(), [0, 0, 0], 'Observers borrow the unshifted camera');
    calls.push('notify');
    presentation.dispose();
    hub.dispose();
  });
  presentation.update(sim.view, 1, 16, sim.hero);
  assert.deepEqual(calls, ['render', 'notify', 'dispose']);
  presentation.update(sim.view, 1, 16, sim.hero);
  assert.deepEqual(
    calls,
    ['render', 'notify', 'dispose'],
    'Closed presentations cannot render again',
  );
});

test('the armored warden holds its hammer windup until the damage tick in every supplied facing', (t) => {
  mockGlobals(t, { window: { matchMedia: () => ({ matches: false }) } });
  const definitions = structuredClone(content.definitions) as ContentDefinitions;
  definitions.actors = definitions.actors.map((actor) =>
    actor.id === 'skeleton'
      ? {
          ...actorDefinitions.find((definition) => definition.id === 'chapel-warden')!,
          id: actor.id,
        }
      : actor,
  );
  const sim = new Simulation(new ContentRegistry(definitions)),
    enemy = sim.enemies[0]!,
    manifest = manifestFixture(),
    warden = manifestFixture('library-sk02'),
    texture = new CanvasTexture({} as HTMLCanvasElement),
    camera = new OrthographicCamera();
  warden.frames = ['windup', 'contact', 'recovery'].map((id) => ({ ...warden.frames[0]!, id }));
  for (const clips of Object.values(warden.asset.clips))
    for (const clip of Object.values(clips)) if (clip) clip.frames = ['windup'];
  const headings = ['d00', 'd90', 'd180', 'd270'] as const;
  const frames = ['windup', 'windup', 'windup', 'contact', 'recovery', 'recovery'],
    durationsMs = [100, 200, 100, 150, 150, 200];
  warden.asset.clips.attack = Object.fromEntries(
    headings.map((heading) => [heading, { frames, durationsMs, loop: false, notifies: [] }]),
  );
  const presentation = new ActorPresentation(
    new Group(),
    new Map([
      ['ink-hero-current', { manifest, textures: new Map([['atlas-0', texture]]) }],
      ['library-sk02', { manifest: warden, textures: new Map([['atlas-0', texture]]) }],
    ]),
    camera,
    texture,
    {} as PreparedRegistration,
  );
  const options = {
    walkTiming: 'supplied' as const,
    stabilized: false,
    rigidSword: false,
    animationTreatment: 'original' as const,
    debug: false,
  };
  t.after(() => {
    presentation.dispose();
    texture.dispose();
  });
  for (const [index, heading] of headings.entries()) {
    enemy.state = 'attack';
    enemy.action++;
    enemy.yaw = (index * Math.PI) / 2;
    enemy.actionHeading = heading;
    enemy.age = enemy.definition.attack.windup / 2;
    presentation.update(sim.view, 1, 0, options);
    const visual = presentation.actors.get(enemy.id)!;
    const quiet = visual.sprite.material.color.r;
    enemy.age = enemy.definition.attack.windup - 1;
    presentation.update(sim.view, 1, 0, options);
    assert.equal(visual.sprite.animator.frame, 'windup', heading);
    assert.ok(
      visual.sprite.material.color.r > quiet,
      'neutral armor still acknowledges the committed windup',
    );
    enemy.age++;
    presentation.update(sim.view, 1, 0, options);
    assert.equal(visual.sprite.animator.frame, 'contact', heading);
    enemy.age = enemy.definition.attack.total - 1;
    presentation.update(sim.view, 1, 0, options);
    assert.equal(visual.sprite.animator.frame, 'recovery', heading);
  }
  assert.deepEqual(
    warden.asset.clips.attack.d90!.durationsMs,
    durationsMs,
    'runtime mapping preserves the supplied timeline',
  );
});

function actorFixture(t: import('node:test').TestContext, zeroWindup = false) {
  const definitions = structuredClone(content.definitions) as ContentDefinitions;
  if (zeroWindup) definitions.actors[0]!.attack.windup = 0;
  definitions.actors = [
    ...definitions.actors,
    { ...actorDefinitions.find((a) => a.id === 'chapel-warden')! },
  ];
  const sim = new Simulation(new ContentRegistry(definitions));
  const room = new Group(),
    texture = new CanvasTexture({} as HTMLCanvasElement);
  const packs = new Map(
    ['ink-hero-current', 'library-sk01', 'library-sk02'].map((id) => {
      const manifest = manifestFixture(id);
      if (id === 'ink-hero-current')
        for (const travel of HEADINGS)
          manifest.asset.clips[heroTravelClip(travel)] = structuredClone(
            manifest.asset.clips.walk!,
          );
      manifest.asset.clips.move = structuredClone(manifest.asset.clips.walk!);
      manifest.asset.clips.attack = structuredClone(manifest.asset.clips.attack_sword_01!);
      for (const clip of Object.values(manifest.asset.clips.attack))
        clip!.notifies = [{ id: 'hit', kind: 'whoosh', atMs: 50 }];
      return [id, { manifest, textures: new Map([['atlas-0', texture]]) }] as const;
    }),
  );
  const presentation = new ActorPresentation(room, packs, new OrthographicCamera(), texture, {
    animation: { clips: {} },
  } as PreparedRegistration);
  t.after(() => {
    presentation.dispose();
    texture.dispose();
  });
  const update = () =>
    presentation.update(sim.view, 1, 0, {
      walkTiming: 'supplied',
      stabilized: false,
      rigidSword: false,
      animationTreatment: 'original',
      debug: false,
    });
  return { sim, presentation, room, update };
}

test('removed actors release their sprites, shadows and rings on the next frame', (t) => {
  const { sim, presentation, room, update } = actorFixture(t);
  update();
  sim.actors = [sim.hero];
  update();
  assert.equal(presentation.actors.size, 1);
  assert.equal(room.children.length, 3);
});

test('replacing an actor definition at the same identity rebuilds its visual and body ring', (t) => {
  const { sim, presentation, update } = actorFixture(t);
  update();
  const old = presentation.actors.get(sim.enemies[0]!.id)!;
  sim.actors[1] = sim.create(sim.enemies[0]!.id, 'enemy', 1, 0, 'chapel-warden');
  update();
  const next = presentation.actors.get(sim.enemies[0]!.id)!;
  assert.notEqual(next, old);
  assert.equal(next.sprite.manifest.asset.id, 'library-sk02');
  assert.equal(old.sprite.mesh.parent, null);
});

test('accepted zero-windup enemy attacks render a finite contact pose at action entry', (t) => {
  const { sim, presentation, update } = actorFixture(t, true);
  sim.start(sim.enemies[0]!, 'attack');
  update();
  assert.ok(presentation.actors.get(sim.enemies[0]!.id)!.sprite.animator.time > 0);
});

test('Burn cannot weaken an enemy attack warning and returns after the windup', (t) => {
  const { sim, presentation, update } = actorFixture(t);
  for (const definition of ['skeleton', 'chapel-warden']) {
    const enemy = sim.create(sim.enemies[0]!.id, 'enemy', 1, 0, definition);
    sim.actors[1] = enemy;
    enemy.state = 'attack';
    enemy.age = enemy.definition.attack.windup - 1;
    update();
    const ring = presentation.actors.get(enemy.id)!.ring;
    const material = ring.material as MeshBasicMaterial;
    const warning = { color: material.color.getHex(), opacity: material.opacity };
    for (const nextTick of [40, 1]) {
      enemy.burn = { remaining: 150, nextTick };
      update();
      assert.equal(material.color.getHex(), warning.color, definition);
      assert.equal(material.opacity, warning.opacity, definition);
      assert.equal(ring.visible, true);
    }
    enemy.age = enemy.definition.attack.windup;
    update();
    assert.equal(ring.visible, true, 'Burn remains visible during the swing');
    assert.notEqual(material.color.getHex(), warning.color);
    enemy.burn = undefined;
    update();
    assert.equal(ring.visible, false, 'the windup accent ends at impact once Burn is gone');
  }
});

test('hero walk animation follows actual travel speed for analog movement', (t) => {
  const { sim, presentation, update } = actorFixture(t);
  sim.hero.state = 'walk';
  sim.hero.px = sim.hero.x;
  sim.hero.pz = sim.hero.z - 0.01;
  presentation.update(sim.view, 1, 20, {
    walkTiming: 'supplied',
    stabilized: false,
    rigidSword: false,
    animationTreatment: 'original',
    debug: false,
  });
  assert.ok(Math.abs(presentation.actors.get(sim.hero.id)!.sprite.animator.time - 4) < 1e-8);
  update();
});

test('hero facing and travel select distinct clips without restarting the locomotion phase', (t) => {
  const { sim, presentation, update } = actorFixture(t);
  sim.actors = [sim.hero];
  Object.assign(sim.hero, { state: 'walk', yaw: Math.PI / 2, travelYaw: Math.PI });
  update();
  const v = presentation.actors.get(sim.hero.id)!;
  assert.match(v.tag, /travel_d180:d90/);
  v.sprite.animator.seek(137);
  sim.hero.travelYaw = -Math.PI / 2;
  update();
  assert.match(v.tag, /travel_d270:d90/);
  assert.equal(v.sprite.animator.time, 137);
  sim.hero.yaw = 0;
  update();
  assert.match(v.tag, /travel_d270:d00/);
  assert.equal(v.sprite.animator.time, 137);
  sim.hero.state = 'idle';
  update();
  assert.match(v.tag, /idle:d00/);
  assert.equal(v.sprite.animator.time, 0);
});

test('enemy travel-direction changes retain the existing movement animation phase', (t) => {
  const { sim, presentation, update } = actorFixture(t);
  const enemy = sim.enemies[0]!;
  enemy.state = 'walk';
  update();
  const v = presentation.actors.get(enemy.id)!;
  v.sprite.animator.seek(137);
  enemy.yaw = Math.PI;
  update();
  assert.equal(v.sprite.animator.time, 137);
});

function impactFixture(t: import('node:test').TestContext, reducedMotion = false) {
  mockGlobals(t, { window: { matchMedia: () => ({ matches: reducedMotion }) } });
  const fixture = actorFixture(t),
    hub = new EventHub(),
    texture = new CanvasTexture({} as HTMLCanvasElement),
    packs = new Map(
      combatEffectAssets.map((asset) => {
        const manifest = manifestFixture(asset);
        manifest.asset.type = 'effect';
        const clip = manifest.asset.clips.idle!.d45!;
        manifest.asset.clips[feedbackSettings.contact.clip] = { d45: clip };
        for (const heading of HEADINGS)
          manifest.asset.clips[`sword_finisher_03__d${heading.slice(1).padStart(3, '0')}`] = {
            d45: clip,
          };
        return [asset, { manifest, textures: new Map([['atlas-0', texture]]) }] as const;
      }),
    ),
    feedback = new CombatFeedback(packs, new OrthographicCamera(), hub);
  hub.setGeneration(fixture.sim.generation);
  t.after(() => {
    feedback.dispose();
    hub.dispose();
    texture.dispose();
  });
  const render = () => {
    fixture.update();
    feedback.update(fixture.sim.view, 1, undefined, fixture.presentation.actors);
  };
  return { ...fixture, hub, feedback, render };
}

test('direct hits react on either side without moving combat bodies, settle, and do not replay for Burn', (t) => {
  const { sim, hub, feedback, presentation, render } = impactFixture(t);
  const enemy = sim.enemies[0]!;
  Object.assign(sim.hero, { x: 0, px: 0, z: 0, pz: 0 });
  Object.assign(enemy, { x: 1, px: 1, z: 0, pz: 0 });
  for (const [source, target] of [
    [sim.hero, enemy],
    [enemy, sim.hero],
  ] as const) {
    sim.tick += 20;
    const event = sim.emit(source, {
      kind: 'damage',
      target: target.id,
      amount: 8,
      damageType: 'physical',
      phase: 'direct',
    });
    assert.equal(event.kind, 'damage');
    if (event.kind !== 'damage') throw new Error('Expected damage event');
    hub.publish([event]);
    const body = { x: target.x, z: target.z, health: target.health, age: target.age };
    render();
    const sprite = presentation.actors.get(target.id)!.sprite;
    assert.notEqual(sprite.mesh.position.x, target.x);
    assert.ok(feedback.cameraKick.length() > 0);
    assert.ok(feedback.group.children.some((mesh) => mesh.name === 'combat-contact'));
    assert.deepEqual({ x: target.x, z: target.z, health: target.health, age: target.age }, body);
    const offset = sprite.mesh.position.x;
    render();
    assert.equal(
      sprite.mesh.position.x,
      offset,
      'repainting a paused tick cannot accumulate recoil',
    );
    sim.tick += 20;
    render();
    assert.equal(sprite.mesh.position.x, target.x);
    assert.equal(feedback.cameraKick.length(), 0);
    assert.equal(feedback.group.children.length, 0);
    hub.publish([
      {
        ...event,
        key: event.key + ':burn',
        tick: sim.tick,
        damageType: 'burn',
        phase: 'over-time',
      },
    ]);
    render();
    assert.equal(feedback.group.children.length, 0);
    assert.equal(feedback.cameraKick.length(), 0);
  }
});

test('enemy misses have a swing but no hit reaction, and reset discards queued and active feedback', (t) => {
  const { sim, hub, feedback, render } = impactFixture(t);
  const enemy = sim.enemies[0]!;
  hub.publish([sim.emit(enemy, { kind: 'strike' })]);
  render();
  assert.deepEqual(
    feedback.group.children.map((mesh) => mesh.name),
    ['combat-enemy-swing'],
  );
  assert.equal(feedback.cameraKick.length(), 0);
  hub.publish([
    sim.emit(enemy, {
      kind: 'damage',
      target: sim.hero.id,
      amount: 8,
      damageType: 'physical',
      phase: 'direct',
    }),
  ]);
  feedback.reset();
  render();
  assert.equal(feedback.group.children.length, 0);
  assert.equal(feedback.cameraKick.length(), 0);
  hub.publish([sim.emit(enemy, { kind: 'strike' })]);
  feedback.dispose();
  render();
  assert.equal(feedback.group.children.length, 0);
});

test('reduced motion keeps contact feedback while suppressing camera impulses', (t) => {
  const { sim, hub, feedback, render } = impactFixture(t, true);
  hub.publish([
    sim.emit(sim.enemies[0]!, {
      kind: 'damage',
      target: sim.hero.id,
      amount: 8,
      damageType: 'physical',
      phase: 'direct',
    }),
  ]);
  render();
  assert.ok(feedback.group.children.some((mesh) => mesh.name === 'combat-contact'));
  assert.equal(feedback.cameraKick.length(), 0);
});

test('the contact drawing holds for two ticks and stale actor identities cannot retain an impulse', (t) => {
  const { sim, hub, feedback, presentation, render } = impactFixture(t);
  render();
  const enemy = sim.enemies[0]!,
    sprite = presentation.actors.get(enemy.id)!.sprite;
  const first = sprite.animator.frame;
  sprite.frameIndex.set('after-contact', { ...sprite.frameIndex.get(first)!, id: 'after-contact' });
  Object.assign(sprite.animator.clip, { frames: [first, 'after-contact'], durationsMs: [16, 184] });
  sprite.animator.seek(0);
  hub.publish([
    sim.emit(sim.hero, {
      kind: 'damage',
      target: enemy.id,
      amount: 8,
      damageType: 'physical',
      phase: 'direct',
    }),
  ]);
  render();
  assert.equal(sprite.lastFrame, first);
  sim.tick++;
  sprite.animator.seek(50);
  render();
  assert.equal(sprite.lastFrame, first, 'hold the supplied drawing while the simulation continues');
  sim.tick += 2;
  render();
  assert.equal(sprite.lastFrame, 'after-contact');
  const replacement = sim.create(enemy.id, 'enemy', enemy.x, enemy.z, enemy.definition.id);
  sim.actors[1] = replacement;
  render();
  assert.equal(feedback.cameraKick.length(), 0);
  assert.equal(presentation.actors.get(enemy.id)!.sprite.mesh.position.x, replacement.x);
});

test('Flare impact weight is independent of the previous sword attack', (t) => {
  const { sim, hub, feedback, render } = impactFixture(t);
  const strengths: number[] = [];
  for (const attackKind of ['sweep', 'lunge'] as const) {
    sim.tick += 20;
    sim.hero.attackKind = attackKind;
    hub.publish([
      sim.emit(sim.hero, {
        kind: 'damage',
        target: sim.enemies[0]!.id,
        amount: 16,
        damageType: 'burn',
        phase: 'direct',
      }),
    ]);
    render();
    strengths.push(feedback.cameraKick.length());
  }
  assert.ok(strengths[0]! > 0);
  assert.equal(strengths[0], strengths[1]);
});
