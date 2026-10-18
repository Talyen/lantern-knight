import assert from 'node:assert/strict';
import type { Page } from 'playwright';

export async function collectVisibleLoot(page: Page) {
  const first = page.getByRole('button', { name: /^Collect / }).first();
  await first.waitFor({ state: 'visible' });
  let collected = 0;
  while (await first.isVisible()) {
    const id = await first.getAttribute('data-drop');
    assert.ok(id, 'Loot label has no drop identity');
    await first.focus();
    // Successful collection detaches the focused label. A locator-bound press
    // can retry against that retired node after its keydown already succeeded.
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (id) =>
        ![...document.querySelectorAll<HTMLElement>('[data-drop]')].some(
          (e) => e.dataset.drop === id,
        ),
      id,
    );
    collected++;
  }
  return collected;
}
