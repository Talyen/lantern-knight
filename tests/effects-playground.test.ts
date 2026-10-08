import { test } from 'node:test';
import assert from 'node:assert/strict';

import { launchEntry, checkpointDirectory } from '../electron/launch';

test('effects launch is developer-only and uses an isolated checkpoint directory', () => {
  assert.equal(launchEntry(true, 'effects'), 'effects.html');
  assert.equal(launchEntry(false, 'effects'), 'index.html');
  assert.notEqual(
    checkpointDirectory('/profile', true, 'effects'),
    checkpointDirectory('/profile', true, 'sandbox'),
  );
  assert.notEqual(
    checkpointDirectory('/profile', true, 'effects'),
    checkpointDirectory('/profile', true, 'game'),
  );
});
