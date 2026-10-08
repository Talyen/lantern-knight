import { preparationSteps } from './recipe';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../run-process';
import { AssetCache, diskBytes } from './cache';
import { projectRoot } from './paths';
import { cameraCalibration as calibrationFixture } from '../../src/assets/camera-calibration';
import { stagePayload } from './payload';
import { makeArchive, recipeHash, recipeInputs } from './pack';
const BUDGET = 2 * 1024 ** 3;
export async function prepareAssets(cache = new AssetCache(), proof = false) {
  const held = await cache.lease('preparation', BUDGET, true),
    workspace = path.join(held.root, 'work');
  const env = {
    ...process.env,
    LANTERN_ASSET_WORKSPACE: workspace,
    LANTERN_PREPARING: '1',
    LANTERN_PREPARE_BUDGET: String(BUDGET - 16 * 1024 * 1024),
  };
  try {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(path.join(workspace, 'public'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, 'public/build-mode.json'),
      JSON.stringify({ allowDevelopmentContent: true }),
    );
    await fs.mkdir(path.join(workspace, 'public/generated'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspace, 'public/generated/calibration.json'),
      JSON.stringify(calibrationFixture()),
    );
    const startRecipe = await recipeHash();
    async function step(file: string, args: string[] = [], python = false) {
      let log = '';
      const started = performance.now();
      try {
        await runProcess(
          python ? 'python3' : process.execPath,
          [...(python ? ['-B'] : ['--import', 'tsx']), path.join(projectRoot, file), ...args],
          {
            cwd: projectRoot,
            env,
            timeoutMs: 5 * 60 * 1000,
            output: (chunk) => {
              log = (log + chunk.toString()).slice(-1024 * 1024);
            },
          },
        );
      } catch (error) {
        await fs.writeFile(path.join(held.root, 'failure.log'), log);
        throw new Error(`${file} failed: ${log.split('\n').filter(Boolean).slice(-8).join('\n')}`, {
          cause: error,
        });
      }
      console.log(
        `${file}${args.includes('--check') ? ' freshness' : ''}: ${Math.round(performance.now() - started)}ms.`,
      );
      if ((await diskBytes(held.root)) > BUDGET)
        throw new Error('Asset preparation exceeded its reservation');
    }
    for (const operation of preparationSteps)
      await step('tools/' + operation.file, [], operation.file.endsWith('.py'));
    if (proof) {
      await step('tools/prepare-ground-proof.ts');
      await step('tools/prepare-ground-proof.ts', ['--check']);
    }
    const payload = path.join(workspace, 'payload');
    await stagePayload(path.join(workspace, 'public'), path.join(workspace, 'staging'), payload);
    await fs.copyFile(
      path.join(payload, 'public/registration.json'),
      path.join(workspace, 'public/registration.json'),
    );
    // Source fidelity belongs here; ordinary CI only validates prepared data.
    await step('tools/check-source-assets.ts');
    for (const operation of preparationSteps.filter((s) => s.freshness))
      await step('tools/' + operation.file, ['--check'], operation.file.endsWith('.py'));
    if ((await recipeHash()) !== startRecipe)
      throw new Error('Asset recipes changed during preparation; retry');
    await fs.writeFile(
      path.join(payload, 'metadata/preparation-inputs.json'),
      JSON.stringify(await recipeInputs()),
    );
    const archive = path.join(held.root, 'lantern-assets.tar.gz'),
      lock = await makeArchive(payload, archive, startRecipe);
    if ((await diskBytes(held.root)) > BUDGET)
      throw new Error('Prepared asset archive exceeded its reservation');
    await fs.writeFile(path.join(held.root, 'prepared.json'), JSON.stringify(lock));
    console.log(
      `Prepared shared asset pack: ${(lock.bytes / 1024 ** 2).toFixed(1)} MiB; sources verified.`,
    );
    return { held, payload, archive, lock };
  } catch (error) {
    await held.release();
    throw error;
  }
}
