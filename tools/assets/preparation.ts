import path from 'node:path';
import fs from 'node:fs';
import { runProcess } from '../run-process';
import { projectRoot } from './paths';
import { cachedPreparationStep } from './incremental';
import { preparationStepKey, recipeInputs, type preparationSteps } from './recipe';
import { shaFile } from './sources';

// Full packs and local overlays execute and validate exactly the same steps.
export async function prepareSteps(options: {
  steps: typeof preparationSteps;
  workspace: string;
  cache: string;
  env: NodeJS.ProcessEnv;
  afterStep?: () => Promise<void>;
}) {
  const inputs = await recipeInputs(),
    digests = new Map<string, string>(),
    files: Record<string, string> = {};
  for (const operation of options.steps) {
    const invoke = async (args: string[], extra: NodeJS.ProcessEnv = {}) => {
      let log = '';
      const python = operation.file.endsWith('.py');
      try {
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
    const result = await cachedPreparationStep({
      file: operation.file,
      workspace: options.workspace,
      cache: options.cache,
      key: preparationStepKey(operation, inputs, digests),
      run: (env) => invoke([], env),
      validate: operation.freshness ? () => invoke(['--check']) : undefined,
    });
    digests.set(operation.file, result.digest);
    for (const name of result.files)
      files[name] = await shaFile(path.join(options.workspace, name));
    await options.afterStep?.();
    console.log(
      operation.file +
        (result.reused ? ': reused verified outputs.' : ': prepared and source-verified.'),
    );
  }
  return { digests, files };
}
export async function prepareProof(workspace: string, env: NodeJS.ProcessEnv) {
  for (const args of [[], ['--check']])
    await runProcess(
      process.execPath,
      ['--import', 'tsx', 'tools/prepare-ground-proof.ts', ...args],
      {
        cwd: projectRoot,
        env: { ...env, LANTERN_ASSET_WORKSPACE: workspace, LANTERN_PREPARING: '1' },
        timeoutMs: 5 * 60_000,
      },
    );
}
