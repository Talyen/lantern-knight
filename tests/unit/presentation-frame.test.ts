import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Group,
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

test('shader preparation cannot resume borrowing scenery after presentation shutdown', async () => {
  const started = Promise.withResolvers<void>(),
    compilation = Promise.withResolvers<void>();
  const presentation: GamePresentation = Object.create(GamePresentation.prototype);
  let touchedScenery = false;
  Object.assign(presentation, {
    resources: new DisposalScope(),
    packs: new Map(),
    lookRenderer: { prepare: async () => {} },
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
    combatFeedback: { update: () => {}, flareLight: { position: new Vector3(), power: 0 } },
    renderFrame: () => {
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
    enemy.age = enemy.definition.melee.windup / 2;
    presentation.update(sim.view, 1, 0, options);
    const visual = presentation.actors.get(enemy.id)!;
    const quiet = visual.sprite.material.color.r;
    enemy.age = enemy.definition.melee.windup - 1;
    presentation.update(sim.view, 1, 0, options);
    assert.equal(visual.sprite.animator.frame, 'windup', heading);
    assert.ok(
      visual.sprite.material.color.r > quiet,
      'neutral armor still acknowledges the committed windup',
    );
    enemy.age++;
    presentation.update(sim.view, 1, 0, options);
    assert.equal(visual.sprite.animator.frame, 'contact', heading);
    enemy.age = enemy.definition.melee.total - 1;
    presentation.update(sim.view, 1, 0, options);
    assert.equal(visual.sprite.animator.frame, 'recovery', heading);
  }
  assert.deepEqual(
    warden.asset.clips.attack.d90!.durationsMs,
    durationsMs,
    'runtime mapping preserves the supplied timeline',
  );
});
