import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cachedPreparationStep } from '../../tools/assets/incremental';
import {
  preparationSteps,
  preparationSelection,
  preparationStepKey,
  recipeInputs,
} from '../../tools/assets/recipe';
test('preparation reuse invalidates registration, source-index and lighting-owner changes without rebaking media', async () => {
  const inputs = await recipeInputs(),
    digests = new Map<string, string>();
  const step = (file: string) => preparationSteps.find((step) => step.file === file)!;
  for (const [file, input] of [
    ['assets/prepare/prepare-ink.ts', 'src/content/scenery-registration.ts'],
    ['assets/prepare/prepare-hero.ts', 'src/content/hero-actions.ts'],
    ['assets/prepare/prepare-lighting.ts', 'tools/lighting-bindings.ts'],
    ['assets/prepare/prepare-graveyard-coverage.ts', 'tools/assets/authoring-catalog.ts'],
    ['assets/prepare/prepare-surface-relief.ts', 'src/content/asset-catalog.ts'],
    ['assets/prepare/prepare-library.ts', 'assets/library-sources.json'],
    ['assets/prepare/prepare-ink.ts', 'assets/sources.json'],
  ]) {
    const changed = { ...inputs, [input!]: 'changed' };
    assert.notEqual(
      preparationStepKey(step(file!), inputs, digests),
      preparationStepKey(step(file!), changed, digests),
      input,
    );
    assert.equal(
      preparationStepKey(step('assets/prepare/prepare-loading-media.ts'), inputs, digests),
      preparationStepKey(step('assets/prepare/prepare-loading-media.ts'), changed, digests),
    );
  }
});

test('full and scoped preparation run producers before consumers, including flat-stage relief inputs', () => {
  for (const steps of [preparationSteps, preparationSelection(['surface-relief'])]) {
    const completed = new Set<string>();
    for (const step of steps) {
      for (const dependency of step.dependsOn ?? [])
        assert.ok(completed.has(dependency), `${step.file} ran before ${dependency}`);
      completed.add(step.file);
    }
    assert.ok(completed.has('assets/prepare/prepare-flat-stage.ts'));
    assert.ok(completed.has('assets/prepare/prepare-surface-relief.ts'));
  }
});

test('incremental preparation reuses one validated step and rebuilds changed inputs or corrupt outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-step-'));
  const workspace = path.join(root, 'work'),
    cache = path.join(root, 'steps');
  await fs.mkdir(workspace);
  let runs = 0,
    checks = 0;
  const run = async (env: NodeJS.ProcessEnv) => {
    runs++;
    await fs.mkdir(path.join(workspace, 'public/media'), { recursive: true });
    await fs.rm(path.join(workspace, 'public/media/sample.mp4'), { force: true });
    await fs.writeFile(path.join(workspace, 'public/media/sample.mp4'), 'native source ' + runs);
    await fs.writeFile(env.LANTERN_STEP_OUTPUT_LOG!, 'public/media/sample.mp4\n');
  };
  try {
    const options = {
      file: 'assets/prepare/prepare-sample.ts',
      workspace,
      cache,
      key: 'one',
      run,
      validate: async () => {
        checks++;
      },
    };
    assert.equal((await cachedPreparationStep(options)).reused, false);
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(workspace);
    assert.equal((await cachedPreparationStep(options)).reused, true);
    assert.equal(runs, 1);
    assert.equal(checks, 1);
    assert.equal((await cachedPreparationStep({ ...options, key: 'two' })).reused, false);
    await fs.writeFile(
      path.join(cache, 'assets/prepare/prepare-sample/files/public/media/sample.mp4'),
      'corrupt',
    );
    assert.equal((await cachedPreparationStep({ ...options, key: 'two' })).reused, false);
    assert.equal(runs, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
