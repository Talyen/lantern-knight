import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import sharp from 'sharp';
import { openWorkspace } from '../assets/workspace';
import { parseManifest } from '../../src/assets/schema';
import { itemArt, itemArtCrops, forgeArtwork, forgeAnvilArtwork } from '../../src/content/item-art';
import { runCli } from '../cli';

// A portable design artifact, built from the accepted pin. No source-library access,
// renderer, player settings or checkpoint writes are needed to compare layouts.
runCli(import.meta.url, async (args) => {
  const { values } = parseArgs({ args, options: { output: { type: 'string' } } });
  const output = values.output;
  if (!output || !path.isAbsolute(output)) throw new Error('Use --output /absolute/new/directory');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, output);
  if (!relative.startsWith('..' + path.sep) && relative !== '..')
    throw new Error('Design artifacts must remain outside the repository');
  await fs.mkdir(output); // Never replace an earlier review or another task's files.
  const workspace = await openWorkspace('pinned', 'authoring', true);
  try {
    await fs.mkdir(path.join(output, 'art'));
    const art = { ...itemArt, forge: forgeArtwork, anvil: forgeAnvilArtwork };
    const manifests = new Map<string, ReturnType<typeof parseManifest>>();
    for (const [name, id] of Object.entries(art)) {
      const file = `generated/library/${id}/manifest.json`;
      let manifest = manifests.get(id);
      if (!manifest) {
        await workspace.ensurePublicFile?.(file);
        manifest = parseManifest(
          JSON.parse(await fs.readFile(path.join(workspace.publicDirectory, file), 'utf8')),
        );
        if (manifest.asset.id !== id) throw new Error('Artwork identity differs: ' + id);
        manifests.set(id, manifest);
      }
      const frame = manifest.frames[0]!;
      const page = manifest.pages.find((p) => p.id === frame.page)!;
      const delivered = page.delivery?.find(
        (p) => p.encoding === 'png' && p.width === page.width && p.height === page.height,
      );
      const image = delivered?.path ?? path.posix.join(path.posix.dirname(file), page.path);
      await workspace.ensurePublicFile?.(image);
      const crop = itemArtCrops[name] ?? [0, 0, 1, 1];
      const [x, y, width, height] = frame.rect;
      const cutout = await sharp(path.join(workspace.publicDirectory, image))
        .extract({
          left: x + Math.round(crop[0]! * width),
          top: y + Math.round(crop[1]! * height),
          width: Math.round(crop[2]! * width),
          height: Math.round(crop[3]! * height),
        })
        .png()
        .toBuffer();
      await sharp(
        name === 'sword'
          ? await sharp(cutout).rotate(-45, { background: '#00000000' }).png().toBuffer()
          : cutout,
      )
        .trim({ threshold: 12 })
        .png()
        .toFile(path.join(output, 'art', `${name}.png`));
    }
    const here = fileURLToPath(new URL('.', import.meta.url));
    await build({
      entryPoints: [path.join(here, 'main.ts')],
      outfile: path.join(output, 'study.js'),
      bundle: true,
      format: 'iife',
      target: 'es2022',
      minify: false,
    });
    await fs.copyFile(path.join(here, 'index.html'), path.join(output, 'index.html'));
    await fs.copyFile(path.join(here, 'style.css'), path.join(output, 'style.css'));
    await fs.writeFile(
      path.join(output, 'provenance.json'),
      JSON.stringify(
        {
          assetPin: workspace.identity,
          recipe: workspace.recipe,
          assets: art,
          purpose: 'UI design study; disposable inventory state, no player storage',
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`UI study: ${path.join(output, 'index.html')}`);
  } finally {
    await workspace.release();
  }
});
