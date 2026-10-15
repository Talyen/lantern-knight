import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { loadCheckpoint } from '../fixtures/input';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import type { GameSave } from '../../src/core/save';
import { Navigation, effectiveRadius } from '../../src/core/navigation';

for (const choice of ['sword', 'lantern'] as const) {
  test(`${choice} courtyard upgrade confirms once and survives continue and death recovery`, async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const area = content.area('ruined-forge');
    const bench = area.interactables!.find((o) => o.kind === 'workbench')!;
    const cache = area.interactables!.find((o) => o.kind === 'container')!;
    expect(new Navigation(area).route(area.entries[0]!, bench, effectiveRadius(0.25)).status).toBe(
      'ready',
    );
    const s = new GameSession(content, 142, area.id);
    const fire = area.campfires![0]!;
    Object.assign(s.sim.hero, { x: fire.x, z: fire.z });
    s.discoverFire(area.id + '/' + fire.id);
    for (const enemy of s.sim.enemies) enemy.health = 0;
    Object.assign(s.sim.hero, { x: bench.x, z: bench.z });
    const seed = s.captureSave();
    seed.areas[area.id]!.cleared = true;
    const capture = async (name: string) => {
      const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
      if (!directory) return;
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `upgrade-${choice}-${name}.png`) });
    };
    const ready = async () => {
      await page.waitForFunction(
        () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
        undefined,
        { timeout: 180_000 },
      );
      await expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
    };
    await page.goto('/index.html?automated');
    await ready();
    await page.locator('#menu-start').click();
    await page.locator('#pause').click();
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    const key = await page.evaluate(() =>
      Object.keys(localStorage).find((k) => k.endsWith('-game'))!,
    );
    const stored = (): Promise<GameSave> =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
    const restore = async (save: GameSave) => {
      await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
        key,
        save,
      });
      await loadCheckpoint(page);
      await ready();
    };
    await restore(seed);
    await expect(page.locator('#interaction-hint')).toHaveText('E · Improve sword or lantern');
    await capture('courtyard');
    await page.keyboard.press('e');
    const panel = page.getByRole('dialog', { name: 'Forge workbench', exact: true });
    const sword = panel.getByRole('button', { name: 'Temper Sword', exact: true });
    const lantern = panel.getByRole('button', { name: 'Rekindle Lantern', exact: true });
    await expect(sword).toBeDisabled();
    await expect(lantern).toBeDisabled();
    await expect(panel).toContainText('Requires 20 Gold, 4 Iron and 1 Workshop Temper');
    await page.keyboard.press('Escape');
    await page.locator('#pause').click();
    Object.assign(seed.player, { x: cache.x, z: cache.z });
    await restore(seed);
    await page.keyboard.press('e');
    for (const label of ['Collect Gold ×20', 'Collect Iron ×6', 'Collect Workshop Temper'])
      await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('#pause').click();
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    const supplied = await stored();
    Object.assign(supplied.player, { x: bench.x, z: bench.z });
    await restore(supplied);
    await page.keyboard.press('e');
    await expect(sword).toBeEnabled();
    await expect(lantern).toBeEnabled();
    await expect(panel).toContainText('Sword damage 26 → 52');
    await expect(panel).toContainText('Lantern hit 16 → 32 · Burn 4 → 8 per tick (3 ticks)');
    await capture('choices');
    if (choice === 'sword') {
      await page.setViewportSize({ width: 640, height: 800 });
      await expect(panel).toBeVisible();
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await capture('narrow-choices');
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await (choice === 'sword' ? sword : lantern).click();
    await expect(panel.getByRole('button', { name: 'Confirm upgrade', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Back to choices', exact: true }).click();
    expect((await stored()).adventure).toEqual(supplied.adventure);
    await (choice === 'sword' ? sword : lantern).click();
    await capture('confirm');
    if (choice === 'sword') {
      await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!;
        const original = descriptor.value as (this: Storage, key: string, value: string) => void;
        Storage.prototype.setItem = function (key, value) {
          if (key.endsWith('-game')) throw new Error('Storage full');
          original.call(this, key, value);
        };
        Object.assign(window, {
          restoreUpgradeStorage: () => {
            Object.defineProperty(Storage.prototype, 'setItem', descriptor);
          },
        });
      });
      await panel.getByRole('button', { name: 'Confirm upgrade', exact: true }).click();
      await expect(panel).toContainText('Storage full');
      expect((await stored()).adventure).toEqual(supplied.adventure);
      await page.evaluate(() =>
        (window as unknown as { restoreUpgradeStorage(): void }).restoreUpgradeStorage(),
      );
    }
    await panel.getByRole('button', { name: 'Confirm upgrade', exact: true }).focus();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(panel).toContainText('Your permanent kit is strengthened');
    const purchased = await stored();
    expect(purchased.adventure!.forgeUpgrade).toBe(choice);
    expect(purchased.adventure!.inventory.gold).toBe(0);
    expect(purchased.adventure!.inventory.iron).toBe(2);
    expect(purchased.adventure!.inventory['workshop-temper']).toBe(0);
    await expect(sword).toHaveCount(0);
    await expect(lantern).toHaveCount(0);
    await capture('complete');
    await page.keyboard.press('Escape');
    await page.reload();
    await ready();
    await expect(page.locator('#menu-start')).toHaveAccessibleName('Continue journey');
    await page.locator('#menu-start').click();
    await page.keyboard.press('i');
    await expect(page.locator('.adventure-panel')).toContainText(
      choice === 'sword' ? 'Edge 200% · Ember 100%' : 'Edge 100% · Ember 200%',
    );
    await page.keyboard.press('Escape');
    const dead = await stored();
    dead.player.health = 0;
    await page.locator('#pause').click();
    await restore(dead);
    await expect(page.locator('#hp')).toHaveText('100 / 100', { timeout: 60_000 });
    await ready();
    await page.keyboard.press('i');
    await expect(page.locator('.adventure-panel')).toContainText(
      choice === 'sword' ? 'Edge 200% · Ember 100%' : 'Edge 100% · Ember 200%',
    );
    await page.keyboard.press('Escape');
    const recovered = await stored();
    expect(recovered.adventure!.forgeUpgrade).toBe(choice);
    expect(recovered.adventure!.inventory).toEqual(purchased.adventure!.inventory);
    expect(recovered.areas[area.id]!.claimedObjects).toContain(cache.id);
    expect(
      recovered.areas[area.id]!.drops!.some((d) =>
        d.rewards.some((r) => r.item === 'workshop-temper'),
      ),
    ).toBe(false);

    // Replay one live courtyard opponent with the persisted kit. The checkpoint
    // isolates combat from route timing; attack input and damage stay real.
    const guard = area.spawns.find((spawn) => spawn.awareness?.group === 'courtyard')!;
    const rematch = new GameSession(content, 142, area.id).captureSave();
    rematch.adventure = recovered.adventure;
    rematch.areas[area.id]!.claimedObjects = recovered.areas[area.id]!.claimedObjects;
    for (const [id, actor] of Object.entries(rematch.areas[area.id]!.actors))
      if (id !== guard.id) actor.health = 0;
    const opponent = rematch.areas[area.id]!.actors[guard.id]!;
    const approach = new Navigation(area).route(fire, opponent, effectiveRadius(0.25));
    expect(approach.status).toBe('ready');
    const beforeGuard = approach.points[approach.points.length - 2] ?? fire;
    const distance = Math.hypot(beforeGuard.x - opponent.x, beforeGuard.z - opponent.z);
    Object.assign(rematch.player, {
      x: opponent.x + ((beforeGuard.x - opponent.x) / distance) * 1.1,
      z: opponent.z + ((beforeGuard.z - opponent.z) / distance) * 1.1,
    });
    await page.locator('#pause').click();
    await restore(rematch);
    const canvas = page.locator('canvas');
    const bounds = (await canvas.boundingBox())!;
    await canvas.focus();
    // The guard is ahead of the approach, above and to the right on screen.
    await page.mouse.click(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.2, {
      button: choice === 'sword' ? 'left' : 'right',
    });
    await expect(page.locator('.ground-loot-label').filter({ hasText: 'Gold ×4' })).toBeVisible({
      timeout: 30_000,
    });
    await capture('payoff');
    await page.locator('#pause').click();
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    const won = await stored();
    expect(won.areas[area.id]!.actors[guard.id]!.health).toBe(0);
    expect(won.adventure!.forgeUpgrade).toBe(choice);
  });
}
