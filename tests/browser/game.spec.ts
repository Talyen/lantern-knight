import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadCheckpoint } from '../fixtures/input';
import { test, expect } from './fixtures';
test('game input, pause focus and current checkpoint reload', async ({ page }) => {
  // Startup, checkpoint loads and death recovery are distinct room operations.
  test.setTimeout(300_000);
  await page.goto('/index.html');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  expect(await page.evaluate(() => 'foundation' in window)).toBe(false);
  await expect(page.locator('#opening-hint, .actions, .controls-hint, #objective')).toHaveCount(0);
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY) {
    await mkdir(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, 'orchard-opening.png'),
    });
  }
  await page.locator('#pause').click();
  await expect(page.locator('#resume')).toBeFocused();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.endsWith('-game')),
  );
  expect(keys.length).toBe(1);
  const initial = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), keys[0]!);
  expect(initial.area).toBe('abandoned-orchard');
  expect(Object.values(initial.areas[initial.area].actors).every((a: any) => a.health > 0)).toBe(
    true,
  );
  expect(initial.wins).toBe(0);
  await page.getByText('Controls & help', { exact: true }).click();
  await expect(page.locator('.controls-help')).toContainText('RMB · Lantern burst');
  await page.locator('#resume').click();
  await expect(page.locator('.game-stage canvas')).toBeFocused();
  const inputErrors: string[] = [];
  page.on('pageerror', (error) => inputErrors.push(error.message));
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!;
    const button = document.createElement('button');
    const child = document.createElement('span');
    child.tabIndex = 0;
    button.append(child);
    document.body.append(button);
    try {
      child.focus();
      child.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyW' }));
      for (let i = 0; i < 10; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      child.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
      canvas.focus();
      for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            code: 'KeyW',
            [modifier]: true,
          }),
        );
        for (const button of [0, 2])
          canvas.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              button,
              clientX: 200,
              clientY: 200,
              [modifier]: true,
            }),
          );
        for (let i = 0; i < 3; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        canvas.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' }));
    } finally {
      button.remove();
    }
  });
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const afterControls = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    keys[0]!,
  );
  expect(afterControls.player).toEqual(initial.player);
  expect(inputErrors).toEqual([]);
  await page.locator('#resume').click();
  await expect(page.locator('canvas')).toBeFocused();
  await page.keyboard.down('KeyW');
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.keyboard.up('KeyW');
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const moved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), keys[0]!);
  expect(
    Math.hypot(moved.player.x - initial.player.x, moved.player.z - initial.player.z),
  ).toBeGreaterThan(0.03);
  await loadCheckpoint(page);
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('canvas')).toBeFocused();
  // A restored dead player immediately requests recovery through the real renderer.
  await page.evaluate(
    ({ key, save }) => {
      save.player.health = 0;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key: keys[0]!, save: moved },
  );
  await page.locator('#pause').click();
  await loadCheckpoint(page);
  // The previous HUD may already show full health while load/recovery is pending.
  // Observe its committed checkpoint using the same budget as room acceptance.
  await expect
    .poll(
      () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).player.health, keys[0]!),
      { timeout: 60_000 },
    )
    .toBe(100);
  await expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
  await expect(page.locator('#hp')).toHaveText('100 / 100');
  await page.locator('#pause').click();
  await page.locator('#new-game').click();
  await expect(page.locator('#cancel-new')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-confirm')).not.toBeVisible();
  await expect(page.locator('#modal')).toBeVisible();
});

test('orchard loot, equipment, campfire rest and destination travel survive reload', async ({
  page,
}) => {
  // This full journey includes several renderer replacements and a final reload.
  test.setTimeout(300_000);
  const waitForRoom = () =>
    expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
  // Targeted checkpoint setup exercises the actual renderer and UI without replaying combat in every browser run.
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180000 },
  );
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const { content } = await import('../../src/content/game-content');
  const orchard = content.area('abandoned-orchard');
  const chest = orchard.interactables!.find((o) => o.kind === 'container')!;
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find((k) => k.endsWith('-game'))!,
  );
  await page.evaluate(
    ({ key, chest }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = chest.x;
      save.player.z = chest.z;
      save.player.health = 60;
      for (const a of Object.values(save.areas[save.area].actors) as { health: number }[])
        a.health = 0;
      save.areas[save.area].cleared = true;
      save.adventure.inventory['damaged-axe'] = 1;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, chest: { x: chest.x, z: chest.z } },
  );
  await loadCheckpoint(page);
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('#interaction-hint')).toHaveText('E · Open');
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY) {
    await page.screenshot({
      path: path.join(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, 'orchard-storehouse.png'),
    });
  }
  await page.keyboard.press('e');
  await expect(page.locator('#interaction-hint')).toHaveText('E · Take');
  await page.getByRole('button', { name: 'Collect Orchard Ring', exact: true }).click();
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await page.keyboard.press('i');
  const panel = page.locator('.adventure-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Equip · Ring 1', exact: true }).click();
  await expect(panel).toContainText('60 / 110 health');
  const salvage = panel.getByRole('button', { name: 'Salvage stack' });
  await salvage.focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(panel).toContainText('Body · Leather / Cloth: Leather Armor');
  await expect(panel).toContainText('Iron ×2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('q');
  await expect(page.locator('#hp')).toHaveText('100 / 110');
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const fire = orchard.campfires![0]!;
  await page.evaluate(
    ({ key, fire }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = fire.x + 0.8;
      save.player.z = fire.z;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, fire: { x: fire.x, z: fire.z } },
  );
  await loadCheckpoint(page);
  await waitForRoom();
  await expect(page.locator('#interaction-hint')).toHaveText('E · Rest');
  await page.keyboard.press('e');
  await expect(panel).toContainText('Orchard Campfire');
  await panel.getByRole('button', { name: 'Rest', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Rested · health restored', { timeout: 60_000 });
  await expect(page.locator('#hp')).toHaveText('110 / 110');
  await waitForRoom();
  await page.keyboard.press('Escape');
  // Unlock departure through a valid cleared encounter checkpoint; use the real departure interaction.
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const exit = orchard.exits[0]!;
  await page.evaluate(
    ({ key, marker }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = marker.x;
      save.player.z = marker.z;
      for (const a of Object.values(save.areas[save.area].actors) as { health: number }[])
        a.health = 0;
      save.areas[save.area].cleared = true;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, marker: exit.marker },
  );
  await loadCheckpoint(page);
  await waitForRoom();
  await expect(page.locator('#interaction-hint')).toHaveText('E · Path');
  await page.keyboard.press('e');
  await waitForRoom();
  await expect(page.locator('#room-title')).toHaveText('Forest Gathering Clearing');
  await page.keyboard.press('e');
  await expect(panel).toContainText('Clearing Campfire');
  await panel.getByRole('button', { name: 'Abandoned Orchard · Orchard Campfire' }).click();
  await waitForRoom();
  await expect(page.locator('#room-title')).toHaveText('Abandoned Orchard');
  await panel
    .getByRole('button', { name: 'Forest Gathering Clearing · Clearing Campfire' })
    .click();
  await waitForRoom();
  await expect(page.locator('#room-title')).toHaveText('Forest Gathering Clearing');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180000 },
  );
  await expect(page.locator('#hp')).toHaveText('110 / 110');
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY) {
    await page.screenshot({
      path: path.join(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, 'clearing-camp.png'),
    });
  }
});

test('Game UI lifetime isolates remounts, pending saves and retired input', async ({ page }) => {
  test.skip(
    process.env.LANTERN_TEST_BUILT === 'true',
    'Imports the development module to exercise mounting',
  );
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
  test.skip(
    process.env.LANTERN_TEST_BUILT === 'true',
    'Imports the renderer to inject construction failures',
  );
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
