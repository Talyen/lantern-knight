import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCommandLane } from '../../tools/command-lane';
test('GPU admission waits without starting work and releases after failure/cancellation', async () => {
  const first = await acquireCommandLane({ port: 0 });
  try {
    await assert.rejects(
      acquireCommandLane({ port: first.port, waitMs: 20, report: () => {} }),
      /occupied/,
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(acquireCommandLane({ port: first.port, signal: cancelled.signal }));
  } finally {
    await first.release();
  }
  const next = await acquireCommandLane({ port: first.port });
  await next.release();
  await next.release();
});
