import { readRegistration } from './assets/data';
import { readAsset } from './assets/io';
import assert from 'node:assert/strict';
import { parseManifest } from '../src/assets/schema';
import { assetCatalog, gameAssetCatalog } from '../src/content/visuals';
import { worldVisuals } from '../src/content/world-art';
import { content } from '../src/content/game-content';
import { contract } from '../src/core/camera';
const height = 2160,
  minimumSpan = contract.framingRange[0]!,
  minimumHeadroom = 1;
const previousMinimumSpan = 11,
  previousHeadroom = 1.25;
const placements = Object.values(worldVisuals).flatMap((v) => v.props);
const derivatives = [
  ...JSON.parse(await readAsset('staging/ink/derivatives.json', 'utf8')).frames,
  ...JSON.parse(await readAsset('staging/ink/graveyard-art-receipt.json', 'utf8')).frames,
  ...JSON.parse(await readAsset('staging/ink/tended-art-receipt.json', 'utf8')).frames,
] as {
  pack: string;
  id: string;
  uniformScale: number;
  source: string;
  minimumSourceDensity?: number;
}[];
const largestPropScale = Math.max(
  1,
  ...placements.filter((p) => p.asset === 'ink-scenery').map((p) => p.scale ?? 1),
);
const largestCueScale = Math.max(
  1,
  ...[...content.actors.values()].filter((a) => a.kind === 'enemy').map((a) => a.melee.range / 2),
);
const cases = Object.keys(assetCatalog)
  .filter((id) => id.startsWith('ink-'))
  .map((id) => ({
    id,
    scale:
      id === 'ink-scenery'
        ? largestPropScale
        : id === 'ink-cues'
          ? largestCueScale
          : Math.max(1, ...placements.filter((p) => p.asset === id).map((p) => p.scale ?? 1)),
  }));
const rows = [];
const runtimePages = new Map<string, { rgbaBytes: number; mipmaps: boolean }>();
for (const { id, scale } of cases) {
  const m = parseManifest(JSON.parse(await readAsset(`public/${assetCatalog[id]}`, 'utf8')));
  for (const page of m.pages) {
    const key = `${page.hash}:${page.width}x${page.height}`;
    if (id in gameAssetCatalog) runtimePages.set(key, page);
  }
  const density = Math.min(...m.frames.map((f) => (f.registration ?? m.asset).density));
  const headroom = density / ((height / minimumSpan) * scale);
  const sourceHeadroom = Math.min(
    ...m.frames.map((frame) => {
      const d = derivatives.find((d) => d.pack === id && d.id === frame.id),
        instanceScale =
          id === 'ink-scenery'
            ? Math.max(1, ...placements.filter((p) => p.clip === frame.id).map((p) => p.scale ?? 1))
            : scale;
      const density = (frame.registration ?? m.asset).density;
      return (
        Math.min(
          d?.minimumSourceDensity ?? Infinity,
          density,
          d && !d.source.endsWith('.svg') ? density / d.uniformScale : density,
        ) /
        ((height / minimumSpan) * instanceScale)
      );
    }),
  );
  const requiredHeadroom =
    id === 'ink-hero-current' ? 216.3 / (height / minimumSpan) : minimumHeadroom;
  assert.ok(
    sourceHeadroom + 1e-10 >= requiredHeadroom,
    `${id}: native source has only ${sourceHeadroom.toFixed(3)}x sampling headroom`,
  );
  assert.ok(
    headroom + 1e-10 >= requiredHeadroom,
    `${id} would undersample/upscale at span ${minimumSpan}: ${headroom.toFixed(3)}x; increase source resolution`,
  );
  if (id !== 'ink-hero-current')
    assert.ok(
      (sourceHeadroom * previousMinimumSpan) / minimumSpan >= previousHeadroom,
      `${id}: existing 11 m source headroom regressed`,
    );
  assert.equal(m.asset.colorSpace, 'srgb');
  assert.equal(m.asset.alpha, 'straight');
  assert.ok(
    m.pages.every((p) => p.mipmaps === (m.asset.sampling === 'terrain-mipmapped')),
    'sampling declarations and runtime pages must agree',
  );
  rows.push({
    id,
    minimumSourcePixelsPerOutputPixel: sourceHeadroom,
    baseRgbaBytes: m.pages.reduce(
      (n, p) => n + Math.ceil(p.rgbaBytes * (p.mipmaps ? 4 / 3 : 1)),
      0,
    ),
  });
}
const flow = readRegistration().animation,
  motionFieldBytes = flow.width * flow.height * 4;
const cryptSurfaceCloneBytes = Math.ceil(
  (rows.find((r) => r.id === 'ink-masonry')!.baseRgbaBytes * 4) / 3,
);
const runtimeCatalogTextureBytes =
  cryptSurfaceCloneBytes +
  motionFieldBytes +
  [...runtimePages.values()].reduce(
    (n, p) => n + Math.ceil(p.rgbaBytes * (p.mipmaps ? 4 / 3 : 1)),
    0,
  );
assert.ok(
  runtimeCatalogTextureBytes <= contract.budgets.sceneTextureMiB * 1024 * 1024,
  'active game catalog including motion fields exceeds the provisional scene texture budget',
);
console.log(
  `PASS: ${rows.length} Ink packs retain verified native sampling at 3840x2160/span${minimumSpan}. Hero TEST minimum ${rows.find((r) => r.id === 'ink-hero-current')!.minimumSourcePixelsPerOutputPixel.toFixed(3)}x (1x from span ${(height / 216.3).toFixed(2)}); existing packs retain their prior headroom. Active textures ${(runtimeCatalogTextureBytes / 1024 ** 2).toFixed(1)} MiB.`,
);
