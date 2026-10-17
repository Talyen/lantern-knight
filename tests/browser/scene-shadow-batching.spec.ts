import { test, expect } from './fixtures';

test('region batching preserves every native painted shadow pixel across lights and areas', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.route('**/batching-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/batching-proof.html');
  const proof = await page.evaluate(async () => {
    const source = '/tests/fixtures/shadow-batching.ts';
    return (await import(source)).shadowBatchingProof();
  });
  expect(proof.error).toBe(0);
  expect(proof.posePixels).toBeGreaterThan(50);
  expect(proof.poseDifferences).toBe(0);
  expect(proof.results).toHaveLength(4);
  for (const result of proof.results) {
    expect(result.differences, result.area).toBe(0);
    expect(result.lightDifferences, result.area).toBe(0);
    expect(result.after).toBeLessThanOrEqual(result.before);
  }
});
