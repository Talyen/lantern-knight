import { preparationSteps } from './recipe';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetCache, diskBytes } from './cache';
import { cameraCalibration as calibrationFixture } from '../../src/assets/camera-calibration';
import { stagePayload } from './payload';
import { makeArchive, recipeHash, recipeInputs } from './pack';
import { prepareSteps, prepareProof } from './preparation';
const BUDGET = 2.5 * 1024 ** 3;
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
    await fs.rm(path.join(held.root, 'lantern-assets.tar.gz'), { force: true });
    await fs.rm(path.join(held.root, 'prepared.json'), { force: true });
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
    await prepareSteps({
      steps: preparationSteps,
      workspace,
      cache: path.join(held.root, 'steps'),
      env,
      afterStep: async () => {
        if ((await diskBytes(held.root)) > BUDGET)
          throw new Error('Asset preparation exceeded its reservation');
      },
    });
    if (proof) await prepareProof(workspace, env);
    const payload = path.join(workspace, 'payload');
    await stagePayload(path.join(workspace, 'public'), path.join(workspace, 'staging'), payload);
    await fs.copyFile(
      path.join(payload, 'public/registration.json'),
      path.join(workspace, 'public/registration.json'),
    );
    // Source fidelity belongs here; ordinary CI only validates prepared data.
    // New steps have already run their own fidelity/freshness check once; cached
    // steps retain matching tool/input/output hashes and verify selected source bytes.
    if ((await recipeHash()) !== startRecipe)
      throw new Error('Asset recipes changed during preparation; retry');
    if (!proof) {
      // Source fidelity and freshness are complete; consumers use payload only.
      await fs.rm(path.join(workspace, 'staging'), { recursive: true, force: true });
      await fs.rm(path.join(workspace, 'public'), { recursive: true, force: true });
    }
    await fs.writeFile(
      path.join(payload, 'metadata/preparation-inputs.json'),
      JSON.stringify(await recipeInputs()),
    );
    const archive = path.join(held.root, 'lantern-assets.tar.gz'),
      lock = await makeArchive(payload, archive, startRecipe);
    if ((await diskBytes(held.root)) > BUDGET)
      throw new Error('Prepared asset archive exceeded its reservation');
    await fs.writeFile(path.join(held.root, 'prepared.json'), JSON.stringify(lock));
    await held.reserve(await diskBytes(held.root));
    console.log(
      `Prepared shared asset pack: ${(lock.bytes / 1024 ** 2).toFixed(1)} MiB; sources verified.`,
    );
    return { held, payload, archive, lock };
  } catch (error) {
    await held.release();
    throw error;
  }
}
