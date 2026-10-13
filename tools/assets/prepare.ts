import { writeJson } from '../json-file';
import { preparationSteps } from './recipe';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetCache, diskBytes } from './cache';
import { cameraCalibration as calibrationFixture } from '../../src/assets/camera-calibration';
import { stagePayload } from './payload';
import { recipeHash, recipeInputs } from './pack';
import { makeArchive, inventoryCandidate } from './archive';
import { preparePreviewAssets, prototypeAssets } from './preview';
import { linkTree } from './incremental';
import { verifiedOutput } from '../verified-files';
import { prepareSteps, prepareProof, growthReservation } from './preparation';
async function prepareProofAssets(
  cache = new AssetCache(),
  proof = false,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const BUDGET = Number(environment.LANTERN_PREPARE_BUDGET ?? cache.limit);
  const held = await cache.lease('preparation', 0, true),
    workspace = path.join(held.root, 'work');
  const env = {
    ...environment,
    LANTERN_ASSET_WORKSPACE: workspace,
    LANTERN_PREPARING: '1',
    LANTERN_PREPARE_BUDGET: String(BUDGET - 16 * 1024 * 1024),
  };
  try {
    await fs.rm(path.join(held.root, 'lantern-assets.tar.gz'), { force: true });
    await fs.rm(path.join(held.root, 'bundles'), { recursive: true, force: true });
    await fs.rm(path.join(held.root, 'prepared.json'), { force: true });
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(path.join(workspace, 'public'), { recursive: true });
    await writeJson(path.join(workspace, 'public/build-mode.json'), {
      allowDevelopmentContent: true,
    });
    await fs.mkdir(path.join(workspace, 'public/generated'), {
      recursive: true,
    });
    await writeJson(
      path.join(workspace, 'public/generated/calibration.json'),
      calibrationFixture(),
    );
    const startRecipe = await recipeHash();
    await prepareSteps({
      steps: preparationSteps,
      workspace,
      cache: path.join(held.root, 'steps'),
      env,
      reserveGrowth: await growthReservation(held),
    });
    if ((await diskBytes(held.root)) > BUDGET)
      throw new Error('Asset preparation exceeded its reservation');
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
    await writeJson(path.join(payload, 'metadata/preparation-inputs.json'), await recipeInputs());
    // Generation has a smaller working budget. Delivery also needs room for
    // compressed bytes; reserve that peak through the same configurable cache owner.
    await held.reserve((await diskBytes(held.root)) + (await diskBytes(payload)) + 64 * 1024 ** 2);
    const archive = path.join(held.root, 'lantern-assets.tar.gz'),
      lock = await makeArchive(payload, archive, startRecipe);
    await writeJson(path.join(held.root, 'prepared.json'), lock);
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

export type PreparedAssets = {
  held: Awaited<ReturnType<AssetCache['lease']>>;
  payload: string;
  archive?: string;
  lock: import('./pack').AssetLock;
};
export async function prepareAssets(
  cache = new AssetCache(),
  proof = false,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PreparedAssets> {
  if (proof) return prepareProofAssets(cache, true, environment);
  // The same complete, source-verified layer serves review and publication.
  await preparePreviewAssets([], cache, environment);
  const base = await prototypeAssets(cache);
  let held: Awaited<ReturnType<AssetCache['lease']>> | undefined;
  try {
    held = await cache.lease('preparation', 0, true);
    const payload = path.join(held.root, 'work/payload');
    if (!('complete' in base.lock) || !base.lock.complete)
      throw new Error('Publication requires complete local preparation');
    await fs.rm(path.join(held.root, 'work'), { recursive: true, force: true });
    await fs.rm(path.join(held.root, 'lantern-assets.tar.gz'), { force: true });
    await linkTree(base.held.root, payload);
    const lock = await inventoryCandidate(payload, base.lock.recipeSha256);
    await writeJson(path.join(held.root, 'prepared.json'), lock);
    await held.reserve(await diskBytes(held.root));
    await verifiedOutput(
      payload,
      [...Object.keys(base.lock.files), 'pack.json'],
      async () => {},
      '.verified-pack.json',
    );
    console.log(
      'Prepared publication inventory from the verified local layer; no image encoding or monolithic compression.',
    );
    return { held, payload, lock };
  } catch (error) {
    await held?.release();
    throw error;
  } finally {
    await base.held.release();
  }
}
