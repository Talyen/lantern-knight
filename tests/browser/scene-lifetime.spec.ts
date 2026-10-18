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
        readiness.push({
          hidden: Boolean(root.querySelector<HTMLElement>('#lantern-readiness')!.hidden),
          text: root.querySelector('#lantern-state')!.textContent,
          charge: root.querySelector('.lantern-charge')!.getAttribute('aria-valuenow'),
        });
        return root.querySelector('#lantern-hint')!.textContent;
      },
      readiness: { hidden: boolean; text: string | null; charge: string | null }[] = [],
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
    session.step({ ...still, actions: ['lantern'] });
    states.casting = read();
    session.sim.hero.age = tuning.ability.windup;
    session.step(still);
    session.sim.hero.cooldown = 0;
    states.learned = read();
    session.restoreSave(session.captureSave());
    states.restored = read();
    session.sim.engaged = false;
    for (const enemy of session.sim.enemies) enemy.health = 0;
    read();
    session.sim.hero.cooldown = tuning.ability.cooldown / 2;
    read();
    ui.dispose();
    host.remove();
    return { states, readiness };
  });
  expect(result.states).toEqual({
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
  expect(result.readiness[0]).toEqual({ hidden: false, text: 'Ready', charge: '100' });
  for (const index of [1, 2, 3, 4]) expect(result.readiness[index]!.hidden).toBe(true);
  expect(result.readiness[9]).toEqual({ hidden: false, text: '4.0s', charge: '0' });
  expect(result.readiness.at(-2)).toEqual({ hidden: true, text: 'Ready', charge: '100' });
  expect(result.readiness.at(-1)).toEqual({ hidden: false, text: '2.0s', charge: '50' });
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
    let pauseHook: (paused: boolean) => void = () => {};
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
      session: { inventory: {}, equipment: {}, pack: [], discovered: new Set() },
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
        pauseHook(value);
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
    pauseHook = first.showPause;
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
    pauseHook = second.showPause;
    second.bind(app);
    second.update(app);
    secondRoot.querySelector<HTMLButtonElement>('#save')!.click();
    await pending[1];
    const freshTitle = secondRoot.querySelector('#room-title')!.textContent;
    second.status('Current mount', true);
    finish();
    await Promise.all(pending);
    const afterLateSave = secondRoot.querySelector('#status')!.textContent;
    secondRoot.querySelector<HTMLButtonElement>('#menu-start')!.click();
    app.canvas = secondRoot.querySelector('canvas');
    app.hooks = { status: second.status };
    app.sim.inCombat = true;
    secondRoot.querySelector<HTMLButtonElement>('#open-inventory')!.click();
    const deniedInventoryRestoredFocus = document.activeElement === app.canvas;
    app.sim.inCombat = false;
    const pausesBeforeRetiredInput = pauses;
    oldSave.disabled = false;
    oldSave.click();
    oldPause.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    const dialogs = secondRoot.querySelectorAll('dialog.adventure-panel[open]').length;
    second.dispose();
    const beforeRetiredKey = pauses - pausesBeforeRetiredInput;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    return {
      saves,
      deniedInventoryRestoredFocus,
      freshTitle,
      afterLateSave,
      dialogs,
      beforeRetiredKey,
      pauses: pauses - pausesBeforeRetiredInput,
      remainingPanels: host.querySelectorAll('.adventure-panel').length,
    };
  });
  expect(result).toEqual({
    saves: 2,
    deniedInventoryRestoredFocus: true,
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

test('preview failure closes both fixture owners even when application teardown throws', async ({
  page,
}) => {
  await page.goto('/__lantern_identity');
  const results = await page.evaluate(async () => {
    const scenePath = '/src/sandbox/scene.ts',
      effectsPath = '/src/sandbox/effects.ts',
      applicationPath = '/src/application.ts',
      workspacePath = '/src/sandbox/workspace.ts';
    const { mountScene } = await import(scenePath);
    const { mountEffects } = await import(effectsPath);
    const { Application } = await import(applicationPath);
    const { emptyWorkspace } = await import(workspacePath);
    document.body.innerHTML =
      '<nav aria-label="Developer tools"><button>Game</button></nav><dialog id="loading-screen"><video></video></dialog><div id="app"></div>';
    const navigation = document.querySelector<HTMLButtonElement>('nav button')!;
    let navigationClicks = 0;
    navigation.onclick = () => navigationClicks++;
    const nativeFetch = window.fetch,
      nativeBoot = Application.prototype.boot,
      nativeDispose = Application.prototype.dispose;
    window.fetch = (input, options) =>
      input === '/dev-effects/emitters.json'
        ? Promise.resolve(new Response('{}'))
        : nativeFetch(input, options);
    Application.prototype.boot = async () => {
      throw new Error('injected startup failure');
    };
    let releases = 0;
    Application.prototype.dispose = function () {
      nativeDispose.call(this);
      releases++;
      throw new Error('injected teardown failure');
    };
    const results = [];
    try {
      for (const effects of [false, true]) {
        const state = emptyWorkspace();
        state.ui.hidden = true;
        let writes = 0;
        const context = {
          fixture: effects ? 'effects-playground' : 'outdoor-fixture',
          ui: state.ui,
          changed: () => writes++,
          remember: () => writes++,
          select() {},
          previewAsset() {},
          resetScene() {},
          resetWorkspace() {},
        };
        const close = effects ? mountEffects(context) : mountScene(context, {});
        const inspection = effects ? window.effectsPlayground : window.foundation;
        // The controlled failures need no asset or renderer construction.
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(
              new Error(
                'Fixture failure did not settle: ' +
                  document.querySelector('#preview-error span')?.textContent,
              ),
            );
          }, 5000);
          const observer = new MutationObserver(() => {
            if (document.querySelector('#preview-error span')?.textContent?.includes('injected')) {
              observer.disconnect();
              window.clearTimeout(timeout);
              resolve();
            }
          });
          observer.observe(document.getElementById('app')!, { childList: true, subtree: true });
        });
        const before = writes;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        window.dispatchEvent(new Event('pagehide'));
        const rejected: string[] = [];
        const retiredCommands =
          'render' in inspection
            ? [() => inspection.render(), () => inspection.setBaseline(true)]
            : [() => inspection.mode('animation'), () => inspection.editPreview(() => {})];
        for (const command of retiredCommands) {
          try {
            command();
          } catch (error) {
            rejected.push((error as Error).name);
          }
        }
        close();
        close();
        results.push({
          message: document.querySelector('#preview-error span')!.textContent,
          retired: effects ? !window.effectsPlayground : !window.foundation,
          retainedReady: inspection.ready,
          rejected,
          writes: writes - before,
          hidden: state.ui.hidden,
          loading: document.querySelector<HTMLDialogElement>('#loading-screen')!.open,
        });
      }
      navigation.click();
      return { results, releases, navigationClicks, navigationDisabled: navigation.disabled };
    } finally {
      window.fetch = nativeFetch;
      Application.prototype.boot = nativeBoot;
      Application.prototype.dispose = nativeDispose;
    }
  });
  expect(results.releases, JSON.stringify(results)).toBe(2);
  expect(results.navigationClicks).toBe(1);
  expect(results.navigationDisabled).toBe(false);
  for (const result of results.results) {
    expect(result.message).toContain('injected startup failure');
    expect(result.message).toContain('injected teardown failure');
    expect(result).toMatchObject({
      retired: true,
      retainedReady: false,
      rejected: ['AbortError', 'AbortError'],
      writes: 0,
      hidden: true,
      loading: false,
    });
  }
});

test('preview shell remount isolates retired controls and preserves stage sizing', async ({
  page,
}) => {
  await page.goto('/__lantern_identity');
  const result = await page.evaluate(async () => {
    const shellPath = '/src/sandbox/shell.ts',
      workspacePath = '/src/sandbox/workspace.ts';
    const { mountShell } = await import(shellPath);
    const { emptyWorkspace } = await import(workspacePath);
    document.body.innerHTML = '<div id="app" style="height:500px"></div>';
    const state = emptyWorkspace();
    let pauses = 0,
      restarts = 0,
      selections = 0;
    const context = {
      fixture: 'outdoor-fixture',
      ui: state.ui,
      changed() {},
      remember() {},
      select: () => selections++,
      previewAsset() {},
      resetScene() {},
      resetWorkspace() {},
    };
    const controls = {
      capabilities: { animation: true, calibration: true, productionLighting: true },
      open() {},
      clearInput() {},
      togglePause: () => pauses++,
      restart: () => restarts++,
      resize() {},
      save() {},
      isPaused: () => false,
      isAnimation: () => false,
    };
    const first = mountShell(context, '');
    first.bind(controls);
    const restart = (first.root as HTMLElement).querySelector<HTMLButtonElement>('#reset')!,
      retry = (first.root as HTMLElement).querySelector<HTMLButtonElement>('#preview-retry')!;
    first.dispose();
    const second = mountShell(context, '');
    second.bind(controls);
    second.status('Current fixture');
    first.show('diagnostics');
    first.status('Late retired feedback');
    restart.disabled = false;
    restart.click();
    retry.click();
    (second.root as HTMLElement).querySelector<HTMLButtonElement>('#pause')!.click();
    const result = {
      pauses,
      restarts,
      selections,
      panel: state.ui.panel,
      status: second.root.querySelector('#status')!.textContent,
      height: second.root.getBoundingClientRect().height,
      canvasHeight: second.root.querySelector('canvas')!.getBoundingClientRect().height,
    };
    second.dispose();
    return result;
  });
  expect(result).toMatchObject({
    pauses: 1,
    restarts: 0,
    selections: 0,
    panel: null,
    status: 'Current fixture',
    height: 500,
  });
  expect(result.canvasHeight).toBeGreaterThan(100);
});
