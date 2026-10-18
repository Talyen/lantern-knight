import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { activateWithKeyboard, test, expect } from './fixtures';
import { loadCheckpoint, saveCheckpoint } from '../fixtures/input';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import type { GameSave } from '../../src/core/save';

test.use({ actionTimeout: 30_000, screenshot: 'only-on-failure' });

for (const choice of ['neither', 'sword', 'lantern', 'both'] as const) {
  const ranks =
    choice === 'neither' ? {} : choice === 'both' ? { sword: 1, lantern: 1 } : { [choice]: 1 };
  test(`${choice} kit reaches the chapel and retains its vigil reward through retry and return`, async ({
    page,
  }) => {
    // Campfire, retry, return and reload each prepare a complete room renderer.
    test.setTimeout(600_000);
    const forge = content.area('ruined-forge');
    const chapel = content.area('desecrated-chapel');
    const forward = forge.exits.find((e) => e.destination === chapel.id)!;
    const retreat = chapel.exits.find((e) => e.destination === forge.id)!;
    const entry = forge.entries.find((e) => e.id === retreat.entry)!;
    expect(Math.hypot(entry.x - forward.marker.x, entry.z - forward.marker.z)).toBeGreaterThan(1.6);
    const fire = chapel.campfires![0]!;
    const cache = chapel.interactables!.find((o) => o.kind === 'container')!;
    const session = new GameSession(content, 142, forge.id);
    Object.assign(session.sim.hero, forward.marker);
    session.sim.enemies.forEach((a) => (a.health = 0));
    const seed = session.captureSave();
    seed.adventure!.upgrades = ranks;
    seed.adventure!.inventory['cinder-signet'] = 1;
    seed.adventure!.equipment.ring2 = 'cinder-signet';
    delete seed.adventure!.pack;
    seed.areas[forge.id]!.cleared = true;
    const ready = async () => {
      await page.waitForFunction(
        () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
        undefined,
        { timeout: 180_000 },
      );
      await expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
    };
    const capture = async (name: string) => {
      const directory = process.env.LANTERN_CHAPEL_CAPTURE_DIRECTORY;
      if (!directory) return;
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `${choice}-${name}.png`) });
    };
    await page.goto('/index.html?automated');
    await ready();
    await page.locator('#menu-start').click();
    await page.locator('#pause').click();
    await saveCheckpoint(page);
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
    const checkpoint = async () => {
      await page.locator('#pause').click();
      await saveCheckpoint(page);
      return stored();
    };
    await restore(seed);
    await expect(page.locator('#interaction-hint')).toHaveText('E · Travel to Desecrated Chapel');
    await page.keyboard.press('e');
    await expect(page.locator('#room-title')).toHaveText(chapel.name, { timeout: 60_000 });
    await ready();
    await capture('threshold');
    await expect(page.locator('#interaction-hint')).toHaveText('E · Rest');
    await page.keyboard.press('e');
    await page.getByRole('button', { name: 'Rest', exact: true }).click();
    await expect(page.locator('.adventure-panel')).toContainText(
      'Health restored. Your journey continues from this campfire.',
      { timeout: 60_000 },
    );
    await page.keyboard.press('Escape');
    const arrived = await checkpoint();
    expect(arrived.adventure!.upgrades).toEqual(ranks);
    expect(arrived.player.x).toBeCloseTo(chapel.entries.find((e) => e.id === 'fire-' + fire.id)!.x);
    expect(arrived.adventure!.discovered).toContain(chapel.id + '/' + fire.id);
    const gathering = structuredClone(arrived);
    Object.assign(gathering.player, { x: -7, z: 5.2 });
    await restore(gathering);
    const vigil = chapel.spawns.filter((spawn) => spawn.awareness?.group === 'vigil');
    const farAttendant = vigil.find((spawn) => spawn.id === 'east-attendant')!;
    // Software rendering can advance fewer simulation ticks in four seconds.
    // Observe pursuit through real checkpoint controls until it has progressed.
    await expect(async () => {
      const alarm = await checkpoint();
      try {
        for (const member of vigil) expect(alarm.areas[chapel.id]!.alerted).toContain(member.id);
        const responding = alarm.areas[chapel.id]!.actors[farAttendant.id]!;
        expect(
          Math.hypot(responding.x - farAttendant.x, responding.z - farAttendant.z),
        ).toBeGreaterThan(1);
      } finally {
        await page.locator('#resume').click();
      }
    }).toPass({ timeout: 60_000, intervals: [1000] });
    await capture('vigil');
    await page.locator('#pause').click();

    // Reward ownership uses the same real UI after an independently seeded victory.
    const victory = structuredClone(arrived);
    for (const actor of Object.values(victory.areas[chapel.id]!.actors)) actor.health = 0;
    victory.areas[chapel.id]!.cleared = true;
    Object.assign(victory.player, { x: cache.x, z: cache.z });
    await restore(victory);
    await page.keyboard.press('e');
    await page.getByRole('button', { name: 'Collect Vigil Amulet', exact: true }).click();
    await page.locator('#open-inventory').click();
    await activateWithKeyboard(page.locator('.inventory-row').filter({ hasText: 'Vigil Amulet' }));
    await activateWithKeyboard(page.getByRole('button', { name: 'Equip', exact: true }));
    await expect(page.locator('#hp')).toHaveText('100 / 115');
    await capture('vigil-amulet');
    await page.keyboard.press('Escape');
    const rewarded = await checkpoint();
    await page.reload();
    await ready();
    await page.locator('#menu-start').click();
    await expect(page.locator('#hp')).toHaveText('100 / 115');
    const continued = await checkpoint();
    expect(continued.adventure!.equipment.amulet).toBe('vigil-amulet');
    expect(continued.adventure!.equipment.ring2).toBe('cinder-signet');
    expect(continued.adventure!.upgrades).toEqual(ranks);
    const dead = structuredClone(rewarded);
    dead.player.health = 0;
    await restore(dead);
    await expect(page.locator('#hp')).toHaveText('115 / 115', { timeout: 60_000 });
    await ready();
    const recovered = await checkpoint();
    expect(recovered.adventure!.inventory['vigil-amulet']).toBe(1);
    expect(recovered.areas[chapel.id]!.claimedObjects).toContain(cache.id);
    expect(Object.values(recovered.areas[chapel.id]!.actors).every((a) => a.health > 0)).toBe(true);
    expect(
      recovered.areas[chapel.id]!.drops!.some((d) =>
        d.rewards.some((r) => r.item === 'vigil-amulet'),
      ),
    ).toBe(false);
    Object.assign(recovered.player, retreat.marker);
    await restore(recovered);
    await expect(page.locator('#interaction-hint')).toHaveText(
      'E · Travel to Ruined Craftsman Forge',
    );
    await page.keyboard.press('e');
    await expect(page.locator('#room-title')).toHaveText(forge.name, { timeout: 60_000 });
    await ready();
    await expect(page.locator('#interaction-hint')).not.toHaveText(
      'E · Travel to Desecrated Chapel',
    );
    await expect(page.locator('#lantern-readiness')).toBeHidden();
    await expect(page.locator('#lantern-state')).toHaveText('Ready');
    await capture('forge-return');
    const returned = await checkpoint();
    expect(returned.player.x).toBeCloseTo(entry.x);
    expect(returned.player.z).toBeCloseTo(entry.z);
  });
}
