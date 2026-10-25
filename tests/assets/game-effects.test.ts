import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { readLock } from '../../tools/assets/pack';
import { openRepositoryWorkspace } from '../../tools/assets/repository';
import { readAsset } from '../../tools/assets/io';
import {
  packedCombatEffects,
  packedCombatManifest,
  combatEffectCatalog,
} from '../../src/content/combat-feedback';
import { parseManifest } from '../../src/assets/schema';

test('every shipped packed effect frame reconstructs the native visible pixels and timing', async () => {
  const pin = await readLock();
  if (pin.schemaVersion !== 5)
    throw new Error('Game effect proof requires repository-owned native pages');
  const source = await openRepositoryWorkspace(pin, 'authoring', true);
  try {
    for (const id of packedCombatEffects) {
      const file = combatEffectCatalog[id]!;
      await source.ensurePublicFile(file);
      const native = parseManifest(
        JSON.parse(await fs.readFile(path.join(source.publicDirectory, file), 'utf8')),
      );
      const packedFile = packedCombatManifest(id);
      const packed = parseManifest(JSON.parse(await readAsset('public/' + packedFile, 'utf8')));
      assert.deepEqual(packed.asset, { ...native.asset, atlasSize: 1024 });
      assert.deepEqual(
        packed.frames.map((f) => f.id),
        native.frames.map((f) => f.id),
      );
      const pages = new Map<string, Buffer>();
      for (const page of packed.pages)
        pages.set(
          page.id,
          await sharp(
            await readAsset('public/' + path.posix.join(path.posix.dirname(packedFile), page.path)),
          )
            .ensureAlpha()
            .raw()
            .toBuffer(),
        );
      for (const [index, frame] of packed.frames.entries()) {
        const original = native.frames[index]!;
        assert.deepEqual(frame.registration, original.registration);
        assert.deepEqual(frame.attachments, original.attachments);
        assert.deepEqual(frame.visualOffsetPx, original.visualOffsetPx);
        const nativePage = native.pages.find((p) => p.id === original.page)!;
        const name = path.posix.join(path.posix.dirname(file), nativePage.path);
        await source.ensurePublicFile(name);
        const pixels = await sharp(await fs.readFile(path.join(source.publicDirectory, name)))
          .ensureAlpha()
          .raw()
          .toBuffer();
        const page = packed.pages.find((p) => p.id === frame.page)!;
        const packedPixels = pages.get(page.id)!;
        for (let y = 0; y < original.rect[3]; y++)
          for (let x = 0; x < original.rect[2]; x++) {
            const px = x + original.trim[0] - frame.trim[0],
              py = y + original.trim[1] - frame.trim[1];
            const a = ((original.rect[1] + y) * nativePage.width + original.rect[0] + x) * 4;
            const inside = px >= 0 && py >= 0 && px < frame.rect[2] && py < frame.rect[3];
            const b = ((frame.rect[1] + py) * page.width + frame.rect[0] + px) * 4;
            const alpha = inside ? packedPixels[b + 3] : 0;
            if (alpha !== pixels[a + 3])
              throw new Error('Packed alpha differs: ' + id + '/' + frame.id);
            if (alpha && !pixels.subarray(a, a + 4).equals(packedPixels.subarray(b, b + 4)))
              throw new Error('Packed visible color differs: ' + id + '/' + frame.id);
          }
      }
    }
  } finally {
    await source.release();
  }
});
