import path from 'node:path';
import sharp from 'sharp';
import {
  packedCombatEffects,
  packedCombatManifest,
  combatEffectCatalog,
} from '../../../src/content/combat-feedback';
import { parseManifest, type Source } from '../../../src/assets/schema';
import { hash } from '../../compiler';
import { preparationOutput } from '../preparation-output';
import type { PreparationContext } from '../context';

type Receipt = {
  asset: string;
  group: string;
  member: string;
  sha256: string;
  outputHash: string;
  file: string;
};
export async function prepare(context: PreparationContext, check = false) {
  const output = preparationOutput(context, check);
  let receiptBytes: Buffer;
  try {
    receiptBytes = await context.readAsset('staging/library/receipt.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    receiptBytes = await context.readAsset('metadata/library/receipt.json');
  }
  const receipts: Receipt[] = JSON.parse(receiptBytes.toString()).sources;
  const proof: Record<string, unknown> = {};
  for (const id of packedCombatEffects) {
    const nativeFile = combatEffectCatalog[id]!;
    const nativeBytes = await context.readAsset('public/' + nativeFile);
    const native = parseManifest(JSON.parse(nativeBytes.toString()));
    if (native.asset.id !== id || native.asset.type !== 'effect')
      throw new Error('Game packing requires the bound native effect');
    const source: Source = {
      schemaVersion: 2,
      preserveTransparentRgb: true,
      asset: { ...native.asset, atlasSize: 1024 },
      frames: [],
    };
    const verified = new Map<string, Buffer>();
    const sourceProof: Record<string, string> = {};
    for (const page of native.pages) {
      const file = path.posix.join(path.posix.dirname(nativeFile), page.path);
      const bytes = await context.readAsset('public/' + file);
      if (hash(bytes) !== page.hash) throw new Error('Native effect page differs: ' + id);
      const receipt = receipts.find(
        (r) => r.asset === id && r.outputHash === page.hash && r.file === file,
      );
      if (!receipt) throw new Error('Native effect has no source receipt: ' + id);
      const original = await context.readLibrarySource(receipt.member, receipt.group);
      if (hash(original) !== receipt.sha256)
        throw new Error('Original effect drawing differs: ' + receipt.member);
      sourceProof[`${receipt.group}/${receipt.member}`] = receipt.sha256;
      verified.set(page.id, bytes);
    }
    for (const frame of native.frames) {
      const registration = frame.registration ?? native.asset;
      const [x, y, width, height] = frame.rect;
      const [left, top, trimWidth, trimHeight] = frame.trim;
      if (
        trimWidth !== width ||
        trimHeight !== height ||
        left + width > registration.canvas[0] ||
        top + height > registration.canvas[1]
      )
        throw new Error('Effect source registration cannot be reconstructed: ' + frame.id);
      const file = `game-effects/${id}/${frame.id}.png`;
      const bytes = await sharp(verified.get(frame.page)!)
        .extract({ left: x, top: y, width, height })
        .ensureAlpha()
        .extend({
          left,
          top,
          right: registration.canvas[0] - left - width,
          bottom: registration.canvas[1] - top - height,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await output.write('staging/' + file, bytes);
      source.frames.push({
        id: frame.id,
        path: file,
        origin: frame.origin,
        attachments: frame.attachments,
        ...(frame.registration ? { registration: frame.registration } : {}),
        ...(frame.visualOffsetPx ? { visualOffsetPx: frame.visualOffsetPx } : {}),
      });
    }
    const sourceFile = `game-effects/${id}.json`;
    await output.write('staging/' + sourceFile, JSON.stringify(source, null, 2) + '\n');
    const manifest = await output.compile(
      sourceFile,
      'public/' + path.posix.dirname(packedCombatManifest(id)),
    );
    const nativeRgba = native.pages.reduce((sum, page) => sum + page.rgbaBytes, 0);
    const packedRgba = manifest.pages.reduce((sum, page) => sum + page.rgbaBytes, 0);
    proof[id] = {
      nativeManifestHash: hash(nativeBytes),
      sources: sourceProof,
      nativeRgba,
      packedRgba,
      frames: native.frames.length,
    };
    console.log(
      `Packed ${id}: ${native.frames.length} drawings; ${(nativeRgba / 1024 ** 2).toFixed(1)} -> ${(packedRgba / 1024 ** 2).toFixed(1)} MiB RGBA.`,
    );
  }
  await output.write(
    'staging/game-effects/receipt.json',
    JSON.stringify({ recipe: 'lossless-game-effects-v1', assets: proof }, null, 2) + '\n',
  );
}
