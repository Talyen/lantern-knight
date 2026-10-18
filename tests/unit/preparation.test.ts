import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cachedPreparationStep } from '../../tools/assets/incremental';
import { forEachFile } from '../../tools/assets/file-batches';
import { createPreparationContext } from '../../tools/assets/context';
import {
  preparationSteps,
  preparationGraph,
  mergePreparationSelections,
  preparationLayerKey,
  preparationSelection,
  preparationStepKey,
  recipeInputs,
} from '../../tools/assets/recipe';

test('preparation planning resolves forward and shared dependencies and rejects ambiguous graphs', () => {
  const step = (file: string, ...dependsOn: string[]) => ({ file, freshness: false, dependsOn });
  const graph = preparationGraph([
    step('delivery', 'lighting', 'coverage'),
    step('lighting', 'pixels'),
    step('coverage', 'pixels'),
    step('pixels'),
    step('audio'),
  ]);
  assert.deepEqual(
    graph.steps.map((step) => step.file),
    ['pixels', 'lighting', 'coverage', 'delivery', 'audio'],
  );
  const selected = new Set<string>();
  graph.include('coverage', selected);
  graph.include('lighting', selected);
  assert.deepEqual([...selected], ['pixels', 'coverage', 'lighting']);
  selected.clear();
  graph.include('delivery', selected);
  assert.deepEqual([...selected], ['pixels', 'lighting', 'coverage', 'delivery']);
  assert.throws(() => graph.include('missing', selected), /Unknown preparation dependency/);
  assert.throws(() => preparationGraph([step('pixels'), step('pixels')]), /Duplicate preparation/);
  assert.throws(
    () => preparationGraph([step('delivery', 'missing')]),
    /Unknown preparation dependency/,
  );
  assert.throws(
    () => preparationGraph([step('delivery', 'lighting'), step('lighting', 'delivery')]),
    /Cyclic preparation dependency/,
  );
});

test('preparation reuse invalidates registration and lighting-owner changes without rebaking media', async () => {
  const inputs = await recipeInputs(),
    digests = new Map<string, string>();
  const step = (file: string) => preparationSteps.find((step) => step.file === file)!;
  for (const [file, input] of [
    ['assets/prepare/prepare-ink.ts', 'src/content/scenery-registration.ts'],
    ['assets/prepare/prepare-hero.ts', 'src/content/hero-actions.ts'],
    ['assets/prepare/prepare-lighting.ts', 'tools/lighting-bindings.ts'],
    ['assets/prepare/prepare-graveyard-coverage.ts', 'tools/assets/authoring-catalog.ts'],
    ['assets/prepare/prepare-library.ts', 'assets/library-sources.json'],
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
  for (const file of ['files', 'preparation-output', 'effect-preparation', 'pixels']) {
    const confined = { ...inputs, ['tools/assets/' + file + '.ts']: 'changed' };
    for (const operation of preparationSteps)
      assert.notEqual(
        preparationStepKey(operation, inputs, digests),
        preparationStepKey(operation, confined, digests),
        `${operation.file} must invalidate changed ${file}`,
      );
  }
  for (const helper of [
    'tools/assets/context.ts',
    'tools/assets/incremental.ts',
    'tools/assets/preparation.ts',
    'tools/assets/recipe.ts',
    'assets/sources.json',
    'src/assets/clips.ts',
  ])
    for (const operation of preparationSteps)
      assert.equal(
        preparationStepKey(operation, inputs, digests),
        preparationStepKey(
          operation,
          { ...inputs, [helper]: 'changed filesystem plumbing' },
          digests,
        ),
        `${operation.file} should retain its encoding cache when ${helper} changes`,
      );
});

test('full and scoped preparation run producers before consumers, including flat-stage lighting inputs', () => {
  for (const steps of [preparationSteps, preparationSelection(['ink-stage-earth'])]) {
    const completed = new Set<string>();
    for (const step of steps) {
      for (const dependency of step.dependsOn ?? [])
        if (steps.some((candidate) => candidate.file === dependency))
          assert.ok(completed.has(dependency), `${step.file} ran before ${dependency}`);
      completed.add(step.file);
    }
    assert.ok(completed.has('assets/prepare/prepare-flat-stage.ts'));
    assert.ok(completed.has('assets/prepare/prepare-lighting.ts'));
  }
});

test('incremental preparation reuses one validated step and rebuilds changed inputs or corrupt outputs', async (t) => {
  const root = await temporaryDirectory(t, 'prototype-step-');
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
});

test('preparation rejects changed written bytes before caching a producer', async (t) => {
  const root = await temporaryDirectory(t, 'preparation-write-proof-');
  const workspace = path.join(root, 'work');
  const context = await createPreparationContext({
    workspace,
    budget: 1024,
    sourceRoot: root,
    libraryRoot: root,
  });

  await context.writeAsset('metadata/library/receipt.json', '{"sources":[]}');
  assert.equal(await context.readAsset('metadata/library/receipt.json', 'utf8'), '{"sources":[]}');
  await assert.rejects(
    cachedPreparationStep({
      file: 'image-delivery.ts',
      workspace,
      cache: path.join(root, 'cache'),
      key: 'one',
      run: async (env) => {
        context.setReceipts({ outputLog: env.LANTERN_STEP_OUTPUT_LOG });
        await context.writeAsset('public/master.png', 'native pixels');
        await fs.writeFile(path.join(workspace, 'public/master.png'), 'corrupt pixels');
        await context.flushReceipts();
      },
      verifyOutputs: (hashes) => context.verifyOutputs(hashes),
      hashFiles: context.checksums,
    }),
    /Prepared output bytes differ/,
  );
  await assert.rejects(fs.access(path.join(root, 'cache/image-delivery/receipt.json')));
});

test('scoped refresh uses the base for unrelated producers and includes affected companions', () => {
  const files = preparationSelection(['library-sk01']).map((step) => step.file);
  assert.ok(files.includes('assets/prepare/prepare-library.ts'));
  assert.ok(files.includes('assets/prepare/prepare-graveyard-coverage.ts'));
  assert.ok(files.includes('assets/prepare/prepare-lighting.ts'));
  assert.ok(files.includes('assets/prepare/prepare-image-delivery.ts'));
  assert.equal(files.length, 4);
  assert.deepEqual(
    preparationSelection(['loading']).map((step) => step.file),
    ['assets/prepare/prepare-loading-media.ts', 'assets/prepare/prepare-image-delivery.ts'],
  );
});

test('delivery edits do not invalidate cached producer manifests, but changed native pages do', async (t) => {
  const root = await temporaryDirectory(t, 'producer-manifest-');
  const workspace = path.join(root, 'work');
  let runs = 0;
  const options = {
    file: 'library.ts',
    workspace,
    cache: path.join(root, 'steps'),
    key: 'native-v1',
    cachePublic: false,
    run: async (env: NodeJS.ProcessEnv) => {
      runs++;
      await fs.mkdir(path.join(workspace, 'public'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'public/master.png'), 'original pixels');
      await fs.writeFile(path.join(workspace, 'public/manifest.json'), '{"delivery":false}');
      await fs.writeFile(env.LANTERN_STEP_OUTPUT_LOG!, 'public/master.png\npublic/manifest.json\n');
    },
  };

  await cachedPreparationStep(options);
  await fs.writeFile(path.join(workspace, 'public/manifest.json.tmp'), '{"delivery":true}');
  await fs.rename(
    path.join(workspace, 'public/manifest.json.tmp'),
    path.join(workspace, 'public/manifest.json'),
  );
  assert.equal((await cachedPreparationStep(options)).reused, true);
  assert.equal(runs, 1);
  assert.equal(
    await fs.readFile(path.join(workspace, 'public/manifest.json'), 'utf8'),
    '{"delivery":false}',
  );
  await fs.writeFile(path.join(workspace, 'public/master.png'), 'changed pixels');
  assert.equal((await cachedPreparationStep(options)).reused, false);
  assert.equal(runs, 2);
});

test('a scoped refresh cannot certify unselected owners after source or recipe changes', () => {
  const previous = {
    recipeSha256: 'recipe',
    librarySha256: 'sources',
    selections: ['library-all'],
  };
  assert.deepEqual(mergePreparationSelections(previous, ['loading'], 'recipe', 'changed-sources'), [
    'loading',
  ]);
  assert.deepEqual(mergePreparationSelections(previous, ['loading'], 'changed-recipe', 'sources'), [
    'loading',
  ]);
  assert.deepEqual(mergePreparationSelections(previous, ['loading'], 'recipe', 'sources'), [
    'library-all',
    'loading',
  ]);
});

test('completing a scoped layer never targets the same leased snapshot', () => {
  const inputs = {
    baseSha256: 'pin',
    recipeSha256: 'recipe',
    selections: ['library-all'],
    librarySha256: 'sources',
    gpu: true,
  };
  const scoped = preparationLayerKey({ ...inputs, steps: preparationSelection(['library-all']) });
  const full = preparationLayerKey({ ...inputs, steps: preparationSelection([]) });
  assert.notEqual(full, scoped);
});

// Failure may not release a cache lease while another admitted file still mutates it.
test('bulk preparation drains failed batches before rejecting and admits no later batch', async () => {
  const admitted: number[] = [];
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let settled = false;
  const failure = new Error('failed file');
  const operation = forEachFile(
    Array.from({ length: 130 }, (_, i) => i),
    (file) => {
      admitted.push(file);
      if (file === 0) throw failure;
      if (file === 1) {
        started.resolve();
        return finish.promise;
      }
      return Promise.resolve();
    },
  );
  const checked = assert
    .rejects(operation, (error) => error === failure)
    .then(() => {
      settled = true;
    });
  await started.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(admitted.length, 64);
  finish.resolve();
  await checked;
  assert.equal(admitted.length, 64);
});
