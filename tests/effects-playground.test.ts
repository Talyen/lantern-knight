import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeEffect,
  effectLabels,
  effectsArea,
  effectsDefinitions,
  playgroundDefaults,
} from '../src/content/effects-playground';
import { ContentRegistry } from '../src/content/world';
import { launchEntry, checkpointDirectory } from '../electron/launch';

test('playground comparisons preserve the selected effect set and use an independent scene', () => {
  const settings = playgroundDefaults();
  settings.effects.rain = false;
  const selected = { ...settings.effects };
  settings.baseline = true;
  for (const key of Object.keys(effectLabels) as (keyof typeof effectLabels)[])
    assert.equal(activeEffect(settings, key), false);
  settings.baseline = false;
  assert.deepEqual(settings.effects, selected);
  assert.equal(activeEffect(settings, 'rain'), false);
  assert.equal(activeEffect(settings, 'bloom'), true);
  const registry = new ContentRegistry(effectsDefinitions);
  assert.equal(registry.areas.size, 1);
  assert.deepEqual(registry.area(effectsArea.id), effectsArea);
  assert.deepEqual(effectsArea.exits, []);
});
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
