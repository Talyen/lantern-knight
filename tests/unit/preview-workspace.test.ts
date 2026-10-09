import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStore, emptyWorkspace, readWorkspace } from '../../src/sandbox/workspace';
import { playgroundDefaults } from '../../src/content/effects-playground';

test('workspace retains independent experiments and reset survives storage failure', () => {
  let stored: string | null = null;
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  const store = createWorkspaceStore(storage);
  const settings = playgroundDefaults();
  settings.effects.rain = false;
  settings.baseline = true;
  settings.outline.opacity = 0.4;
  store.state.scenes['effects-playground'] = {
    kind: 'effects',
    settings,
    scale: 0.75,
    freeze: true,
    hero: { x: 0, z: 3, yaw: 0.8 },
  };
  store.state.selected = 'interior-fixture';
  store.state.ui.sections['effects-outline'] = true;
  store.save();
  const restored = createWorkspaceStore(storage);
  assert.equal(restored.state.selected, 'interior-fixture');
  assert.deepEqual(
    restored.state.scenes['effects-playground'],
    store.state.scenes['effects-playground'],
  );
  assert.equal(restored.state.ui.sections['effects-outline'], true);
  restored.reset();
  assert.deepEqual(createWorkspaceStore(storage).state, emptyWorkspace());
  const broken = createWorkspaceStore({
    getItem: () => {
      throw Error('unavailable');
    },
    setItem: () => {
      throw Error('quota');
    },
  });
  broken.state.ui.hud = true;
  broken.save();
  assert.equal(broken.state.ui.hud, true);
  broken.reset();
  assert.deepEqual(broken.state, emptyWorkspace());
});

test('invalid workspace data falls back without applying corrupt settings', () => {
  const state = emptyWorkspace();
  for (const raw of [
    '{',
    'null',
    JSON.stringify({ ...state, version: 1 }),
    JSON.stringify({ ...state, selected: 'removed' }),
    JSON.stringify({
      ...state,
      scenes: {
        'effects-playground': {
          kind: 'effects',
          settings: {
            ...playgroundDefaults(),
            outline: { thickness: 1, opacity: 1, color: '#ffffff' },
          },
          hero: { x: 0, z: 0, yaw: 0 },
          scale: 1,
          freeze: false,
        },
      },
    }),
  ])
    assert.deepEqual(readWorkspace(raw), state);
});
