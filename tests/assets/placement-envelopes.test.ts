import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import { readAsset } from '../../tools/assets/io';
import { readAuthoringCatalog } from '../../tools/assets/authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
import { placementRegistration } from '../../src/content/placement-registration';

test('placement measurements contain every supplied alpha edge in every reserved drawing', async () => {
  const catalog = await readAuthoringCatalog();
  for (const [id, registration] of Object.entries(placementRegistration)) {
    const file = catalog[id]!;
    const manifest = parseManifest(JSON.parse(await readAsset('public/' + file, 'utf8')));
    assert.equal(
      registration.hash,
      manifest.placementHash ?? manifest.hash,
      'Review placement measurements after replacing ' + id,
    );
    const pages = new Map<string, { data: Buffer; info: { width: number } }>();
    for (const [name, bounds] of Object.entries(registration.clips)) {
      const frames = new Set(
        Object.values(manifest.asset.clips[name] ?? {}).flatMap((c) => c?.frames ?? []),
      );
      assert.ok(frames.size, id + '/' + name);
      for (const f of manifest.frames.filter((f) => frames.has(f.id))) {
        if (!pages.has(f.page)) {
          const page = manifest.pages.find((p) => p.id === f.page)!;
          const bytes = await readAsset(
            'public/' + path.posix.join(path.posix.dirname(file), page.path),
          );
          pages.set(
            f.page,
            await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
          );
        }
        const { data, info } = pages.get(f.page)!;
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity;
        for (let y = 0; y < f.rect[3]; y++)
          for (let x = 0; x < f.rect[2]; x++) {
            if (data[((y + f.rect[1]) * info.width + x + f.rect[0]) * 4 + 3]) {
              left = Math.min(left, x);
              right = Math.max(right, x + 1);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y + 1);
            }
          }
        if (!Number.isFinite(left)) continue;
        const r = f.registration ?? manifest.asset,
          [ox, oy] = f.visualOffsetPx ?? [0, 0];
        const label = id + '/' + name + '/' + f.id;
        assert.ok(
          bounds.left <= (f.trim[0] + left - r.anchor[0] + ox) / r.density,
          label + ' left',
        );
        assert.ok(
          bounds.right >= (f.trim[0] + right - r.anchor[0] + ox) / r.density,
          label + ' right',
        );
        assert.ok(bounds.top >= (r.anchor[1] - f.trim[1] - top - oy) / r.density, label + ' top');
        assert.ok(
          bounds.bottom <= (r.anchor[1] - f.trim[1] - bottom - oy) / r.density,
          label + ' bottom',
        );
      }
    }
  }
});
