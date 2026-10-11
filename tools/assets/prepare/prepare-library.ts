import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { source } from '../definition';
import { parseManifest, type Manifest } from '../../../src/assets/schema';
import { hash } from '../../compiler';

import { projectRoot } from '../paths';

import type { PreparationContext } from '../context';
import { runProcess } from '../../run-process';
export async function prepare(context: PreparationContext, check = false) {
  const { readLibrarySource, stagingFile, readAsset } = context;

  type Input = {
    group: string;
    member: string;
    sha256?: string;
    sourceSha256?: string;
    canvas: [number, number];
    anchor: [number, number];
    density: number;
    indexPath?: string;
    rect?: [number, number, number, number];
    trim?: [number, number, number, number];
    visualOffsetPx?: [number, number];
  };
  type LibraryAsset = {
    id: string;
    label: string;
    type: Manifest['asset']['type'];
    projection: Manifest['asset']['projection'];
    placement: Manifest['asset']['placement'];
    category: Manifest['asset']['category'];
    layer?: Manifest['asset']['layer'];
    imageRole?: Manifest['asset']['imageRole'];
    mirroring?: boolean;
    limitations: string[];
    clips: Record<
      string,
      Partial<
        Record<
          'd00' | 'd45' | 'd90' | 'd135' | 'd180' | 'd225' | 'd270' | 'd315',
          {
            frames: Input[];
            durationsMs: number[];
            loop: boolean;
            endBehavior: 'hide' | 'hold';
            markers: { id: string; atMs: number }[];
          }
        >
      >
    >;
  };

  const planFile = stagingFile('library/plan.json');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-library-plan-'));
  try {
    await runProcess(
      'python3',
      [
        '-B',
        path.join(projectRoot, 'tools/assets/library_import.py'),
        '--output',
        path.join(temporary, 'plan.json'),
      ],
      { cwd: projectRoot, env: context.environment, timeoutMs: 120000 },
    );
    await context.writeAsset(planFile, await fs.readFile(path.join(temporary, 'plan.json')));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  const plan = JSON.parse(await fs.readFile(planFile, 'utf8')) as {
    assets: LibraryAsset[];
    dispositions: unknown[];
    inventory?: {
      files: { assets: string[] }[];
      images: { sha256: string; assets: string[] }[];
      [key: string]: unknown;
    };
    media?: { group: string; member: string; sha256: string; path: string }[];
  };
  const write = check ? undefined : context.writeAsset;
  const catalog: Record<string, string> = {};
  const receipts: {
    asset: string;
    group: string;
    member: string;
    sha256: string;
    outputHash: string;
    file: string;
  }[] = [];
  let previous: typeof receipts = [];
  try {
    previous = JSON.parse(await readAsset('metadata/library/receipt.json', 'utf8')).sources;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const priorSources = new Map(previous.map((r) => [`${r.asset}/${r.group}/${r.member}`, r]));
  const priorImages = new Map(previous.map((r) => [`${r.asset}/${r.sha256}`, r]));
  let clips = 0,
    drawings = 0;
  async function output(file: string, bytes: Buffer | string) {
    if (check) {
      if (!Buffer.from(bytes).equals(await readAsset(file)))
        throw new Error('Stale prepared library file: ' + file);
    } else {
      await write!(file, bytes);
    }
  }
  for (const item of plan.assets) {
    let priorManifest: Manifest | undefined;
    try {
      priorManifest = parseManifest(
        JSON.parse(await readAsset(`public/generated/library/${item.id}/manifest.json`, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const first = Object.values(item.clips).flatMap((d) => Object.values(d))[0]!.frames[0]!;
    const definition = source(item.id, item.type, first.canvas, first.anchor, first.density);
    Object.assign(definition.asset, {
      viewMode: Object.values(item.clips).every((d) => Object.keys(d).every((h) => h === 'd45'))
        ? 'fixed-authored'
        : 'supplied',
      label: item.label,
      category: item.category,
      placement: item.placement,
      projection: item.projection,
      mirroring: item.mirroring,
      layer: item.layer,
      imageRole: item.imageRole,
      renderStyle: item.imageRole ? 'source' : definition.asset.renderStyle,
      limitations: item.limitations,
      recipe: 'library-native-v2',
      provenance: {
        creator: 'Lantern artwork authors',
        license:
          'Owner-supplied project artwork; source licenses and provenance remain in the Asset Library.',
        source: 'Asset Library / Lantern Knight',
      },
    });
    definition.asset.allowEmptyFrames = item.type === 'effect';
    definition.asset.renderCategory =
      item.type === 'effect' || (item.imageRole && item.type === 'prop')
        ? 'translucent'
        : item.type === 'material'
          ? 'opaque'
          : 'cutout';
    const frames: Manifest['frames'] = [],
      pages: Manifest['pages'] = [];
    const pageMap = new Map<string, Manifest['pages'][number]>(),
      frameMap = new Map<string, string>();
    const root = `public/generated/library/${item.id}`;
    const inputCache = new Map<
      string,
      { hash: string; acceptedHash: string; outputHash: string; page: Manifest['pages'][number] }
    >();
    for (const [name, directions] of Object.entries(item.clips)) {
      definition.asset.clips[name] = {};
      for (const [heading, clip] of Object.entries(directions)) {
        const ids: string[] = [];
        for (const input of clip.frames) {
          const key = `${input.group}/${input.member}`;
          let cached = inputCache.get(key);
          if (!cached) {
            const prior =
              priorSources.get(`${item.id}/${key}`) ??
              priorImages.get(`${item.id}/${input.sourceSha256}`);
            const oldPage = priorManifest?.pages.find((p) => p.hash === prior?.outputHash);
            let reusable = false;
            if (prior && oldPage && input.sourceSha256 === prior.sha256) {
              const file = 'public/' + prior.file;
              const known = await context.verifiedHash(file);
              const actual =
                known ??
                (
                  await context
                    .checksums([file])
                    .catch((error: NodeJS.ErrnoException): Record<string, string> => {
                      if (error.code === 'ENOENT') return {};
                      throw error;
                    })
                )[file];
              reusable = actual === prior.outputHash;
              if (reusable && !known) await context.recordContentHash(file, prior.outputHash);
            }
            if (prior && oldPage && reusable) {
              const page = pageMap.get(oldPage.hash) ?? { ...oldPage };
              if (!pageMap.has(page.hash)) {
                pages.push(page);
                pageMap.set(page.hash, page);
              }
              cached = {
                hash: prior.sha256,
                acceptedHash: input.sha256 ?? prior.sha256,
                outputHash: prior.outputHash,
                page,
              };
              inputCache.set(key, cached);
              receipts.push({ ...prior, group: input.group, member: input.member });
              await context.record('public/' + prior.file, prior.outputHash);
            }
          }
          if (!cached) {
            const original = await readLibrarySource(
                input.member,
                input.group,
                input.indexPath
                  ? { root: context.sourceRoot, indexPath: input.indexPath }
                  : undefined,
              ),
              originalHash = hash(original);
            // Some supplied manifests hash decoded RGBA, others encoded PNG bytes.
            if (input.sourceSha256 && originalHash !== input.sourceSha256)
              throw new Error('Library source changed after discovery: ' + key);
            if (
              !input.sourceSha256 &&
              input.sha256 &&
              originalHash !== input.sha256 &&
              hash(await sharp(original).ensureAlpha().raw().toBuffer()) !== input.sha256
            )
              throw new Error('Library source differs: ' + key);
            let metadata = await sharp(original).metadata();
            if (
              !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
              !metadata.width ||
              !metadata.height
            )
              throw new Error('Unsupported native library page: ' + key);
            // Compatible RGB and RGBA PNGs remain byte-identical to their sources.
            const bytes =
              metadata.format === 'png' &&
              metadata.depth === 'uchar' &&
              !metadata.icc &&
              (!metadata.orientation || metadata.orientation === 1)
                ? original
                : await sharp(original)
                    .autoOrient()
                    .toColourspace('srgb')
                    .ensureAlpha()
                    .png()
                    .toBuffer();
            metadata = await sharp(bytes).metadata();
            const outputHash = hash(bytes);
            let page = pageMap.get(outputHash);
            if (!page) {
              page = {
                id: 'page-' + outputHash.slice(0, 20),
                path: 'pages/' + outputHash + '.png',
                hash: outputHash,
                width: metadata.width,
                height: metadata.height,
                bytes: bytes.length,
                rgbaBytes: metadata.width * metadata.height * 4,
                extrusion: 0,
                gutter: 0,
                mipmaps: false,
              };
              pageMap.set(outputHash, page);
              pages.push(page);
              await output(`${root}/${page.path}`, bytes);
            }
            cached = {
              hash: originalHash,
              acceptedHash: input.sha256 ?? originalHash,
              outputHash,
              page,
            };
            inputCache.set(key, cached);
            receipts.push({
              asset: item.id,
              group: input.group,
              member: input.member,
              sha256: originalHash,
              outputHash,
              file: `${root.slice(7)}/${page.path}`,
            });
          }
          if (
            input.sourceSha256
              ? input.sourceSha256 !== cached.hash
              : input.sha256 && input.sha256 !== cached.hash && input.sha256 !== cached.acceptedHash
          )
            throw new Error('Conflicting delivered frame identity: ' + key);
          const registration = {
            canvas: input.canvas,
            anchor: input.anchor,
            density: input.density,
          };
          const rect =
            input.rect ??
            ([0, 0, cached.page.width, cached.page.height] as [number, number, number, number]);
          const trim = input.trim ?? ([0, 0, ...input.canvas] as [number, number, number, number]);
          const frameKey = JSON.stringify([
            cached.outputHash,
            registration,
            rect,
            trim,
            input.visualOffsetPx,
          ]);
          let id = frameMap.get(frameKey);
          if (!id) {
            id = 'frame-' + hash(frameKey).slice(0, 24);
            frameMap.set(frameKey, id);
            frames.push({
              id,
              source: `library/${item.id}/${id}.png`,
              origin: 'imported-study',
              attachments: {},
              registration,
              ...(input.visualOffsetPx ? { visualOffsetPx: input.visualOffsetPx } : {}),
              page: cached.page.id,
              rect,
              trim,
              rotated: false,
            });
          }
          ids.push(id);
        }
        definition.asset.clips[name]![heading as 'd45'] = { ...clip, frames: ids, notifies: [] };
        clips++;
      }
    }
    const m: Manifest = {
      schemaVersion: 2,
      contractId: definition.asset.contractId,
      bakeVersion: definition.asset.bakeVersion,
      hash: hash(JSON.stringify([definition.asset, frames, pages])),
      toolVersion: 'library-native-v2',
      asset: definition.asset,
      frames,
      pages,
      bundles: {
        boot: { required: [], optional: [], dependencies: [] },
        hero: { required: [], optional: [], dependencies: [] },
        room: { required: pages.map((p) => p.id), optional: [], dependencies: [] },
      },
    };
    parseManifest(m);
    await output(`${root}/manifest.json`, JSON.stringify(m) + '\n');
    catalog[item.id] = root.slice(7) + '/manifest.json';
    drawings += frames.length;
  }
  await output('public/generated/library/catalog.json', JSON.stringify(catalog) + '\n');
  const media = [];
  for (const source of plan.media ?? []) {
    const extension = path.extname(source.member).toLowerCase();
    const file = `generated/library/media/${source.sha256}${extension}`;
    if ((await context.verifiedHash('public/' + file)) === source.sha256) {
      await context.record('public/' + file, source.sha256);
      const bytes = (await fs.stat(context.path('public/' + file))).size;
      media.push({ ...source, file, bytes });
      continue;
    }
    const bytes = await readLibrarySource(source.member, source.group);
    await output('public/' + file, bytes);
    media.push({ ...source, file, bytes: bytes.length });
  }
  if (plan.inventory) {
    await output(
      'public/generated/library/inventory.json',
      JSON.stringify({ ...plan.inventory, media }) + '\n',
    );
  }
  await output(
    'staging/library/receipt.json',
    JSON.stringify({
      schemaVersion: 1,
      assets: Object.keys(catalog).length,
      clips,
      drawings,
      skipped: [],
      sources: receipts,
      dispositions: plan.dispositions,
    }) + '\n',
  );
  console.log(
    `${check ? 'Verified' : 'Prepared'} ${Object.keys(catalog).length} library assets, ${clips} clip/facing bindings, ${drawings} registered drawings.`,
  );
}
