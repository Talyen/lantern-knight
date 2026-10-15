import { test, expect } from './fixtures';

test('lantern cue appears for a reachable threat and clears with play and session state', async ({
  page,
}) => {
  await page.goto('/__lantern_identity');
  const result = await page.evaluate(async () => {
    const uiPath = '/src/game-ui.ts',
      sessionPath = '/src/core/session.ts',
      contentPath = '/tests/fixtures/content.ts',
      gameplayPath = '/src/content/gameplay.ts';
    const { createGameUI, gameUI } = await import(uiPath);
    const { GameSession } = await import(sessionPath);
    const { content } = await import(contentPath);
    const { tuning } = await import(gameplayPath);
    const session = new GameSession(content);
    Object.assign(session.sim.hero, { x: 0, z: 0 });
    Object.assign(session.sim.enemies[0], { x: 2, z: 0 });
    session.sim.engaged = true;
    const app: any = {
      paused: false,
      busy: false,
      roomReady: true,
      persistence: { error: '' },
      settingsError: '',
      session,
      get sim() {
        return session.sim.view;
      },
    };
    const host = document.createElement('div');
    host.innerHTML = gameUI;
    document.body.append(host);
    const root = host.firstElementChild as HTMLElement,
      ui = createGameUI(root),
      read = () => {
        ui.update(app);
        return root.querySelector('#lantern-hint')!.textContent;
      },
      states: Record<string, string | null> = {};
    states.nearby = read();
    for (const property of ['paused', 'busy'] as const) {
      app[property] = true;
      states[property] = read();
      app[property] = false;
    }
    app.roomReady = false;
    states.transition = read();
    app.roomReady = true;
    session.sim.hero.health = 0;
    states.dead = read();
    session.sim.hero.health = tuning.heroMaxHealth;
    session.sim.enemies[0].x = tuning.ability.range + 0.01;
    states.distant = read();
    session.sim.enemies[0].x = 2;
    session.sim.enemies[0].y = tuning.maxCombatHeightDifference + 0.01;
    states.otherHeight = read();
    session.sim.enemies[0].y = 0;
    session.dismissLesson('lantern');
    states.dismissed = read();
    session.replayHints();
    states.replayed = read();
    const still = { move: { x: 0, z: 0 }, aim: { x: 2, z: 0 } };
    session.step({ ...still, ability: true });
    states.casting = read();
    session.sim.hero.age = tuning.ability.windup;
    session.step(still);
    session.sim.hero.cooldown = 0;
    states.learned = read();
    session.restoreSave(session.captureSave());
    states.restored = read();
    ui.dispose();
    host.remove();
    return states;
  });
  expect(result).toEqual({
    nearby: 'RMB · Repel with lantern',
    paused: '',
    busy: '',
    transition: '',
    dead: '',
    distant: '',
    otherHeight: '',
    dismissed: '',
    replayed: 'RMB · Repel with lantern',
    casting: '',
    learned: '',
    restored: '',
  });
});

test('Game UI lifetime isolates remounts, pending saves and retired input', async ({ page }) => {
  await page.goto('/__lantern_identity');
  const result = await page.evaluate(async () => {
    const uiPath = '/src/game-ui.ts',
      eventsPath = '/src/core/events.ts';
    const { createGameUI, gameUI } = await import(uiPath);
    const { EventHub } = await import(eventsPath);
    const hub = new EventHub();
    hub.setGeneration(1);
    let saves = 0,
      pauses = 0,
      finish!: () => void;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending: Promise<unknown>[] = [];
    const app: any = {
      paused: false,
      busy: false,
      roomReady: true,
      scale: 1,
      presentation: { depthOfField: 1, visualEffects: {}, verticalSpan: 11 },
      audio: {
        settings: { muted: false, master: 1, effects: 1, ambience: 1 },
        play: async () => {},
      },
      events: hub,
      persistence: { error: '' },
      settingsError: '',
      session: { inventory: {}, equipment: {}, discovered: new Set() },
      sim: {
        area: 'room',
        drops: [],
        areaDefinition: { name: 'Room', exits: [] },
        hero: { health: 100 },
        maxHealth: 100,
        inCombat: false,
      },
      pause(value: boolean) {
        pauses++;
        app.paused = value;
      },
      safe(action: () => Promise<unknown>) {
        pending.push(action());
      },
      save() {
        saves++;
        return saves === 1 ? delayed : Promise.resolve();
      },
      saveSettings: async () => {},
    };
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = gameUI;
    const firstRoot = host.firstElementChild as HTMLElement;
    const first = createGameUI(firstRoot);
    first.bind(app);
    first.update(app);
    const oldSave = firstRoot.querySelector<HTMLButtonElement>('#save')!;
    const oldPause = firstRoot.querySelector<HTMLButtonElement>('#pause')!;
    oldSave.click();
    first.dispose();
    first.dispose();
    host.innerHTML = gameUI;
    const secondRoot = host.firstElementChild as HTMLElement;
    const second = createGameUI(secondRoot);
    second.bind(app);
    second.update(app);
    secondRoot.querySelector<HTMLButtonElement>('#save')!.click();
    await pending[1];
    const freshTitle = secondRoot.querySelector('#room-title')!.textContent;
    second.status('Current mount', true);
    finish();
    await Promise.all(pending);
    const afterLateSave = secondRoot.querySelector('#status')!.textContent;
    oldSave.disabled = false;
    oldSave.click();
    oldPause.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    const dialogs = secondRoot.querySelectorAll('dialog.adventure-panel[open]').length;
    second.dispose();
    const beforeRetiredKey = pauses;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    return {
      saves,
      freshTitle,
      afterLateSave,
      dialogs,
      beforeRetiredKey,
      pauses,
      remainingPanels: host.querySelectorAll('.adventure-panel').length,
    };
  });
  expect(result).toEqual({
    saves: 2,
    freshTitle: 'Room',
    afterLateSave: 'Current mount',
    dialogs: 1,
    beforeRetiredKey: 1,
    pauses: 1,
    remainingPanels: 0,
  });
});

test('renderer construction lifetime closes WebGL after early and late startup failure', async ({
  page,
}) => {
  await page.goto('/__lantern_identity');
  const results = await page.evaluate(async () => {
    const scenePath = '/src/presentation/game-scene.ts',
      threePath = '/node_modules/three/build/three.module.js',
      eventsPath = '/src/core/events.ts';
    const { GamePresentation } = await import(scenePath);
    const { Texture } = await import(threePath);
    const { EventHub } = await import(eventsPath);
    const results: { error: string; removedContextListener: boolean }[] = [];
    for (const early of [true, false]) {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const removed: string[] = [];
      const remove = canvas.removeEventListener.bind(canvas);
      canvas.removeEventListener = ((type: string, ...args: any[]) => {
        removed.push(type);
        (remove as any)(type, ...args);
      }) as typeof canvas.removeEventListener;
      const texture = new Texture({ width: early ? 1e9 : 1, height: 1 });
      const packs = new Map([['ink-hero-current', { textures: new Map([['page', texture]]) }]]);
      class BrokenRoom extends GamePresentation {
        constructor(...args: any[]) {
          super(...args);
        }
        buildRoom() {
          throw new Error('room construction failed');
        }
      }
      try {
        new BrokenRoom(canvas, packs, new EventHub(), { id: 'room' }, {});
      } catch (error) {
        results.push({
          error: (error as Error).message,
          removedContextListener: removed.includes('webglcontextlost'),
        });
      } finally {
        texture.dispose();
        canvas.remove();
      }
    }
    // Preparation must recover from a transient manifest failure, and a failing
    // postprocessing destructor must not strand the companion owner.
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const texture = new Texture({ width: 1, height: 1 });
    const packs = new Map([['ink-hero-current', { textures: new Map([['page', texture]]) }]]);
    class EmptyRoom extends GamePresentation {
      constructor(...args: any[]) {
        super(...args);
      }
      buildRoom() {}
    }
    const presentation = new EmptyRoom(
      canvas,
      packs,
      new EventHub(),
      { id: 'room' },
      {},
      undefined,
      (...args: Parameters<typeof fetch>) => window.fetch(...args),
    );
    const request = window.fetch;
    let requests = 0,
      companionsClosed = false;
    window.fetch = async () =>
      ++requests === 1
        ? new Response('', { status: 503 })
        : new Response(JSON.stringify({ recipe: 'alpha-volume-v1', entries: {} }));
    try {
      try {
        await presentation.prepareAssets();
      } catch {
        /* transient failure */
      }
      await presentation.prepareAssets();
      if (!presentation.lookRenderer.ready || requests !== 2)
        throw new Error('preparation did not retry');
    } finally {
      window.fetch = request;
    }
    const normals = presentation.lookRenderer.lighting.normals;
    const closeNormals = normals.dispose.bind(normals);
    normals.dispose = () => {
      closeNormals();
      companionsClosed = true;
    };
    const composer = presentation.lookRenderer.composer;
    const closeComposer = composer.dispose.bind(composer);
    composer.dispose = () => {
      closeComposer();
      throw new Error('postprocessing destructor');
    };
    try {
      presentation.dispose();
    } catch {
      /* deliberate destructor failure */
    }
    presentation.dispose();
    texture.dispose();
    canvas.remove();
    if (!companionsClosed) throw new Error('postprocessing failure stranded companions');
    return results;
  });
  expect(results).toEqual([
    {
      error: 'GPU maximum texture size below compiled atlas dimensions',
      removedContextListener: true,
    },
    { error: 'room construction failed', removedContextListener: true },
  ]);
});
