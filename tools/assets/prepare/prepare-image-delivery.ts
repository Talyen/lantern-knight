import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readAuthoringCatalog } from '../authoring-catalog';
import { playgroundCatalog } from '../../../src/content/effects-playground-assets';
import { parseManifest, type ManifestDraft } from '../../../src/assets/schema';
import { imageHash, prepareImageDelivery, restoreImageDelivery } from '../image-delivery';
import type { PreparationContext } from '../context';

export async function prepare(context: PreparationContext, check = false) {
  const catalog = {
    ...(await readAuthoringCatalog(context.publicDirectory)),
    ...playgroundCatalog,
  };
  const cached = new Map<string, Awaited<ReturnType<typeof prepareImageDelivery>>>();
  const index: Record<string, ManifestDraft> = {};
  let processed = 0,
    compressed = 0,
    reused = 0,
    encoded = 0,
    rejected = 0,
    sourceBytes = 0,
    deliveryBytes = 0,
    losslessAlpha = 0,
    losslessDimensions = 0;
  const write = async (file: string, data: Buffer | string) => {
    if (check) {
      if (!Buffer.from(data).equals(await context.readAsset(file)))
        throw new Error('Stale delivery output: ' + file);
    } else await context.writeAsset(file, data);
  };
  type Job = {
    sourceFile: string;
    page: ManifestDraft['pages'][number];
    standalone: boolean;
    pages: ManifestDraft['pages'][number][];
  };
  const jobs = new Map<string, Job>();
  for (const [id, file] of Object.entries(catalog)) {
    const manifest = parseManifest(JSON.parse(await context.readAsset('public/' + file, 'utf8')));
    index[id] = manifest;
    for (const page of manifest.pages) {
      const frames = manifest.frames.filter((f) => f.page === page.id);
      const standalone =
        manifest.frames.length === 1 &&
        frames.length === 1 &&
        frames[0]!.rect.every((n, i) => n === [0, 0, page.width, page.height][i]);
      const key = page.hash + ':' + standalone + ':' + page.mipmaps;
      const prior = jobs.get(key);
      if (prior) prior.pages.push(page);
      else
        jobs.set(key, {
          sourceFile: 'public/' + path.posix.join(path.posix.dirname(file), page.path),
          page,
          standalone,
          pages: [page],
        });
      processed++;
    }
  }
  const queue = [...jobs.entries()];
  const workers = Number(
    context.environment.LANTERN_IMAGE_WORKERS ??
      Math.max(1, Math.min(2, Math.floor(os.availableParallelism() / 4))),
  );
  if (!Number.isSafeInteger(workers) || workers < 1)
    throw new Error('LANTERN_IMAGE_WORKERS must be a positive integer');
  // Measured encoder footprint is about 37 bytes/pixel; allow headroom and
  // never run more than two background jobs on the default path.
  const memoryBudget = Math.floor(os.totalmem() / 8);
  let memoryUsed = 0;
  const waiting: { bytes: number; ready: () => void }[] = [];
  const drain = () => {
    while (waiting.length && memoryUsed + waiting[0]!.bytes <= memoryBudget) {
      const next = waiting.shift()!;
      memoryUsed += next.bytes;
      next.ready();
    }
  };
  const cook = async <T>(page: ManifestDraft['pages'][number], action: () => Promise<T>) => {
    const bytes = Math.min(memoryBudget, page.width * page.height * 40);
    await new Promise<void>((ready) => {
      waiting.push({ bytes, ready });
      drain();
    });
    try {
      return await action();
    } finally {
      memoryUsed -= bytes;
      drain();
    }
  };
  let next = 0,
    completed = 0,
    failure: unknown;
  console.log(
    `Preparing image delivery for ${queue.length} unique pages with ${Math.min(workers, queue.length)} workers.`,
  );
  await Promise.all(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      while (!failure) {
        const job = queue[next++];
        if (!job) break;
        const [key, { sourceFile, page, standalone, pages }] = job;
        try {
          const known = await context.verifiedHash(sourceFile);
          let receipt =
            known === page.hash
              ? await restoreImageDelivery(context, page, standalone, check)
              : undefined;
          if (receipt) reused++;
          if (!receipt) {
            encoded++;
            receipt = await cook(page, async () => {
              const source = await context.readAsset(sourceFile);
              if (imageHash(source) !== page.hash)
                throw new Error('Source page changed before encoding: ' + sourceFile);
              return prepareImageDelivery(context, source, page, standalone, check);
            });
          }
          cached.set(key, receipt);
          compressed += receipt.delivery.filter((v) => v.encoding === 'ktx2-uastc').length;
          rejected += receipt.rejected;
          losslessAlpha += receipt.decisions.filter((d) => d.reason === 'lossless-alpha').length;
          losslessDimensions += receipt.decisions.filter(
            (d) => d.reason === 'lossless-block-dimensions',
          ).length;
          sourceBytes += page.bytes;
          const native = receipt.delivery.filter(
            (v) => v.width === page.width && v.height === page.height,
          );
          deliveryBytes += Math.min(...native.map((v) => v.bytes));
          for (const p of pages) {
            p.preview = receipt.preview;
            p.delivery = receipt.delivery;
          }
          if (++completed % 1000 === 0)
            console.log(
              `Image delivery: ${completed}/${queue.length} unique pages; ${compressed} compressed candidates accepted, ${losslessAlpha} lossless alpha variants; ${rejected} GPU candidates fall back.`,
            );
        } catch (error) {
          failure = error;
        }
      }
    }),
  );
  // Settle in-flight encodes before releasing the candidate's cache lease.
  if (failure) throw failure;
  for (const [id, file] of Object.entries(catalog)) {
    const manifest = index[id]!;
    manifest.hash = imageHash(JSON.stringify([manifest.asset, manifest.frames, manifest.pages]));
    parseManifest(manifest);
    await write('public/' + file, JSON.stringify(manifest) + '\n');
  }
  for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    const source = fileURLToPath(
      new URL('../libs/basis/' + name, import.meta.resolve('three/addons/loaders/KTX2Loader.js')),
    );
    await write('public/decoders/' + name, await fs.readFile(source));
  }
  const flags = JSON.parse(await context.readAsset('public/build-mode.json', 'utf8'));
  await write('public/build-mode.json', JSON.stringify({ ...flags, libraryInventory: true }));
  await write('public/generated/library/index.json', JSON.stringify(index) + '\n');
  const inventory = JSON.parse(
    await context.readAsset('public/generated/library/inventory.json', 'utf8'),
  ) as {
    images: { sha256: string; assets: string[] }[];
    media: { file: string; sha256: string }[];
  };
  for (const image of inventory.images)
    if (!image.assets.length || image.assets.some((id) => !index[id]))
      throw new Error('Source image has no prepared catalog binding: ' + image.sha256);
  for (const media of inventory.media)
    if (
      (await context.verifiedHash('public/' + media.file)) !== media.sha256 &&
      imageHash(await context.readAsset('public/' + media.file)) !== media.sha256
    )
      throw new Error('Prepared native media differs: ' + media.file);
  const report = {
    schemaVersion: 1,
    pages: processed,
    uniquePages: cached.size,
    compressed,
    rejected,
    sourceBytes,
    deliveryBytes,
    losslessAlpha,
    losslessDimensions,
  };
  await write('public/generated/library/delivery-report.json', JSON.stringify(report) + '\n');
  console.log(
    `${check ? 'Verified' : 'Prepared'} image delivery: ${processed} pages; ${reused} reused, ${encoded} encoded; ${compressed} compressed variants; PNG masters retained.`,
  );
}
