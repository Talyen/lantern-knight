import { audioTools, verifyAudioSources } from './audio';
import { createPreparationContext, preparationOptions } from './context';
import { preparationOperations } from './operations';
import path from 'node:path';
import fs from 'node:fs';
import { runProcess } from '../run-process';
import { projectRoot } from './paths';
import { cachedPreparationStep } from './incremental';
import { preparationStepKey, recipeInputs, type preparationSteps } from './recipe';
import { sourceSnapshot } from './discovery';
import { diskBytes } from './cache';
import { forEachFile } from './file-batches';

export async function growthReservation(held: {
  root: string;
  reserve: (bytes: number) => Promise<void>;
  reserveUpTo?: (bytes: number, preferred: number) => Promise<number>;
}) {
  const initial = await diskBytes(held.root);
  let credit = 0;
  return async (bytes: number) => {
    if (bytes <= credit) return;
    const next = Math.max(256 * 1024 ** 2, bytes * 2);
    if (held.reserveUpTo) {
      credit = (await held.reserveUpTo(initial + bytes, initial + next)) - initial;
    } else {
      await held.reserve(initial + bytes);
      credit = bytes;
    }
  };
}

// Full packs and local overlays execute and validate exactly the same steps.
export async function prepareSteps(options: {
  steps: typeof preparationSteps;
  workspace: string;
  cache: string;
  env: NodeJS.ProcessEnv;
  afterStep?: (result: { reused: boolean }) => Promise<void>;
  knownContent?: Record<string, string>;
  reserveGrowth?: (bytes: number) => Promise<void>;
}) {
  const inputs = await recipeInputs(),
    digests = new Map<string, string>(),
    files: Record<string, string> = {};
  const context = await createPreparationContext({
    ...preparationOptions(options.workspace, options.env),
    knownContent: options.knownContent,
    reserveGrowth: options.reserveGrowth,
  });
  const sourceVerified = await sourceSnapshot(options.env);
  // Unselected dependencies are supplied by the verified base layer.
  for (const operation of (await import('./recipe')).preparationSteps) {
    try {
      const receipt = JSON.parse(
        await fs.promises.readFile(
          path.join(options.cache, operation.file.replace(/\.[^.]+$/, ''), 'receipt.json'),
          'utf8',
        ),
      );
      digests.set(operation.file, receipt.digest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const operation of options.steps) {
    const started = performance.now();
    const invoke = async (args: string[], extra: NodeJS.ProcessEnv = {}) => {
      let log = '';
      const python = operation.file.endsWith('.py');
      try {
        if (!python) {
          const prepare = preparationOperations[operation.file];
          if (!prepare) throw new Error('Unknown preparation operation: ' + operation.file);
          context.setReceipts({
            outputLog: extra.LANTERN_STEP_OUTPUT_LOG,
            inputLog: extra.LANTERN_STEP_INPUT_LOG,
          });
          await prepare(context, args.includes('--check'));
          await context.flushReceipts();
          return;
        }

        if (!args.includes('--check'))
          for (const file of ['staging/animation/flow.json', 'staging/animation/flow.png'])
            await fs.promises.rm(path.join(options.workspace, file), { force: true });
        await runProcess(
          python
            ? fs.existsSync(path.join(projectRoot, '.venv'))
              ? path.join(
                  projectRoot,
                  '.venv',
                  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
                )
              : 'python3'
            : process.execPath,
          [
            ...(python ? ['-B'] : ['--import', 'tsx']),
            path.join(projectRoot, 'tools', operation.file),
            ...args,
          ],
          {
            cwd: projectRoot,
            env: {
              ...options.env,
              LANTERN_ASSET_WORKSPACE: options.workspace,
              LANTERN_PREPARING: '1',
              ...extra,
            },
            timeoutMs: 5 * 60_000,
            output: (chunk) => {
              log = (log + chunk.toString()).slice(-12000);
            },
          },
        );
      } catch (error) {
        throw new Error(
          operation.file + ': ' + log.split('\n').filter(Boolean).slice(-8).join('\n'),
          { cause: error },
        );
      }
    };
    if (operation.file.endsWith('prepare-audio.ts'))
      await verifyAudioSources(context.libraryRoot, options.env);
    const result = await cachedPreparationStep({
      file: operation.file,
      workspace: options.workspace,
      cache: options.cache,
      key: preparationStepKey(
        operation,
        inputs,
        digests,
        operation.file.endsWith('prepare-audio.ts')
          ? (await audioTools(options.env)).fingerprint
          : operation.file.endsWith('prepare-library.ts')
            ? options.env.LANTERN_LIBRARY_SHA256
            : operation.file.endsWith('prepare-image-delivery.ts')
              ? (options.env.LANTERN_IMAGE_GPU ?? '0')
              : undefined,
      ),
      run: (env) => invoke([], env),
      validate: operation.freshness ? () => invoke(['--check']) : undefined,
      verifyOutputs: (hashes) => context.verifyOutputs(hashes),
      hashFiles: context.checksums,
      sourceVerified,
      cachePublic: ![
        'prepare-library.ts',
        'prepare-lighting.ts',
        'prepare-graveyard-coverage.ts',
        'prepare-image-delivery.ts',
      ].some((name) => operation.file.endsWith(name)),
      sourceLocation: options.env.LANTERN_LIBRARY_INDEX
        ? { root: context.sourceRoot, indexPath: options.env.LANTERN_LIBRARY_INDEX, strict: true }
        : undefined,
    });
    if (result.reused || operation.file.endsWith('.py'))
      await context.adopt(result.files, result.hashes);
    else
      await forEachFile(result.files, (file) =>
        context.recordContentHash(file, result.hashes[file]!),
      );
    digests.set(operation.file, result.digest);
    for (const name of result.files) {
      files[name] = result.hashes[name]!;
    }
    await options.afterStep?.({ reused: result.reused });
    console.log(
      operation.file +
        (result.reused ? ': reused verified outputs' : ': prepared and source-verified') +
        ` (${((performance.now() - started) / 1000).toFixed(2)}s).`,
    );
  }
  return { digests, files, checksums: context.checksums };
}
export async function prepareProof(workspace: string, env: NodeJS.ProcessEnv) {
  const context = await createPreparationContext(preparationOptions(workspace, env));
  const prepare = preparationOperations['assets/prepare/prepare-ground-proof.ts']!;
  await prepare(context, false);
  await prepare(context, true);
}
