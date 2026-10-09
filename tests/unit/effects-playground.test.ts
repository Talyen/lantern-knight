import { test } from 'node:test';
import assert from 'node:assert/strict';

import { launchEntry, checkpointDirectory } from '../../electron/launch';

test('effects launch is a developer-only Sandbox scene with isolated player checkpoints', () => {
  assert.equal(launchEntry(true, 'effects'), 'sandbox.html#effects-playground');
  assert.equal(launchEntry(false, 'effects'), 'index.html');
  assert.equal(
    checkpointDirectory('/profile', true, 'effects'),
    checkpointDirectory('/profile', true, 'sandbox'),
  );
  assert.notEqual(
    checkpointDirectory('/profile', true, 'effects'),
    checkpointDirectory('/profile', true, 'game'),
  );
});
