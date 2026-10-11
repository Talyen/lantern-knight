import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { source } from '../definition';
import { parseManifest, type Manifest } from '../../../src/assets/schema';
import { hash } from '../../compiler';

import { projectRoot } from '../paths';

import type { PreparationContext } from '../context';
export async function prepare(context: PreparationContext, check = false) {
  const { readLibrarySource, stagingFile, runProcess, readAsset } = context;

  type Input = {
    group: string;
    member: string;
    sha256?: string;
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
  await fs.mkdir(path.dirname(planFile), { recursive: true });
  await runProcess(
    'python3',
    ['-B', path.join(projectRoot, 'tools/assets/library_import.py'), '--output', planFile],
    { cwd: projectRoot, timeoutMs: 120000 },
  );
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
            const original = await readLibrarySource(
                input.member,
                input.group,
                input.indexPath
                  ? { root: context.sourceRoot, indexPath: input.indexPath }
                  : undefined,
              ),
              originalHash = hash(original);
            // Some supplied manifests hash decoded RGBA, others encoded PNG bytes.
            if (
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
          if (input.sha256 && input.sha256 !== cached.hash && input.sha256 !== cached.acceptedHash)
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
    const bytes = await readLibrarySource(source.member, source.group);
    const extension = path.extname(source.member).toLowerCase();
    const file = `generated/library/media/${source.sha256}${extension}`;
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
