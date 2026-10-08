import sharp, { type OverlayOptions } from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readAuthoringCatalog } from './assets/authoring-catalog';
import { readAsset } from './assets/io';
import { parseManifest } from '../src/assets/schema';
// Bounded review sheets of prepared pixels, not replacement source artwork.
export async function captureLibraryReview(destination: string) {
  const entries = Object.entries(await readAuthoringCatalog()).filter(([id]) =>
    id.startsWith('library-'),
  );
  for (let start = 0; start < entries.length; start += 64) {
    const tiles: OverlayOptions[] = [];
    for (let offset = 0; offset < Math.min(64, entries.length - start); offset++) {
      const [id, file] = entries[start + offset]!,
        m = parseManifest(JSON.parse(await readAsset('public/' + file, 'utf8'))),
        clip = Object.values(Object.values(m.asset.clips)[0]!)[0]!,
        frame = m.frames.find((f) => f.id === clip.frames[Math.floor(clip.frames.length / 2)])!,
        page = m.pages.find((p) => p.id === frame.page)!,
        [left, top, width, height] = frame.rect,
        image = await sharp(
          await readAsset(path.posix.join('public', path.posix.dirname(file), page.path)),
        )
          .extract({ left, top, width, height })
          .resize(120, 90, { fit: 'contain', background: { r: 25, g: 30, b: 37, alpha: 1 } })
          .png()
          .toBuffer(),
        label = (m.asset.label ?? id).slice(0, 23).replace(/[<>&"']/g, '');
      tiles.push({
        input: image,
        left: (offset % 8) * 128 + 4,
        top: Math.floor(offset / 8) * 112 + 2,
      });
      tiles.push({
        input: Buffer.from(
          `<svg width="128" height="18"><text x="4" y="12" font-size="9" fill="white">${label}</text></svg>`,
        ),
        left: (offset % 8) * 128,
        top: Math.floor(offset / 8) * 112 + 94,
      });
    }
    await sharp({
      create: {
        width: 1024,
        height: 896,
        channels: 4,
        background: { r: 25, g: 30, b: 37, alpha: 1 },
      },
    })
      .composite(tiles)
      .png()
      .toFile(path.join(destination, `library-${String(start / 64 + 1).padStart(2, '0')}.png`));
  }
  await fs.writeFile(
    path.join(destination, 'library-index.json'),
    JSON.stringify(entries.map(([id]) => id)) + '\n',
  );
}
