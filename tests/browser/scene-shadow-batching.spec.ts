import { pixelTest as test, expect } from './fixtures';
import { content } from '../../src/content/game-content';
import type { shadowBatchingProof } from '../fixtures/shadow-batching';

test('combat programs prime without changing pixels and survive later effect disposal', async ({
  page,
}) => {
  await page.route('**/combat-preparation-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/combat-preparation-proof.html');
  const proof = await page.evaluate(async () => {
    const source = '/tests/fixtures/shadow-batching.ts';
    return (await import(source)).combatPreparationProof();
  });
  expect(proof.differences).toBe(0);
  expect(proof.effectPixels).toBeGreaterThan(50);
  expect(proof.visibleAfterPrime).toBe(false);
  expect(proof.extraMeshesAfterPrime).toBe(0);
  expect(proof.error).toBe(0);
  for (const programs of proof.programs) expect(programs).toEqual(proof.programs[0]);
  expect(proof.reset.differences).toBe(0);
  expect(proof.reset.rearmed && proof.reset.hidden).toBe(true);
  expect(proof.reset.effectPixels).toBeGreaterThan(50);
  for (const programs of proof.reset.programs) expect(programs).toEqual(proof.reset.programs[0]);
});

test('region batching preserves every native painted shadow pixel across lights and areas', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.route('**/batching-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/batching-proof.html');
  const proof: Awaited<ReturnType<typeof shadowBatchingProof>> = await page.evaluate(async () => {
    const source = '/tests/fixtures/shadow-batching.ts';
    return (await import(source)).shadowBatchingProof();
  });
  expect(proof.error).toBe(0);
  expect(proof.posePixels).toBeGreaterThan(50);
  expect(proof.poseDifferences).toBe(0);
  expect(proof.results.map((result) => result.area)).toEqual(
    content.definitions.areas.map((area) => area.id),
  );
  for (const result of proof.results) {
    expect(result.differences, result.area).toBe(0);
    expect(result.lightDifferences, result.area).toBe(0);
    expect(result.after).toBeLessThanOrEqual(result.before);
  }
});
