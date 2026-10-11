import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { runProcess } from '../run-process';
import type { Manifest } from '../../src/assets/schema';
import type { PreparationContext } from './context';

export const imageHash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
type Delivery = NonNullable<Manifest['pages'][number]['delivery']>[number];
// Format selection concerns the cooked representation, never library eligibility.
export function useGpuCompression(transparent: boolean, width: number, height: number) {
  const blockDimension = (n: number) => n === 1 || n === 2 || n % 4 === 0;
  return !transparent && blockDimension(width) && blockDimension(height);
}
function blockGpuBytes(width: number, height: number, mipmaps: boolean) {
  let total = 0;
  do {
    total += Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
    if (!mipmaps || (width === 1 && height === 1)) break;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  } while (width > 0 && height > 0);
  return total;
}
const recipeSettings = {
  version: 3,
  preview: 512,
  pngCompression: 6,
  resolutions: [2048, 4096, 'native'],
  codec: 'KTX-Software-4.4.2/UASTC',
  uastcQuality: 1,
  zstdLevel: 6,
  origin: 'bottom-left',
  transparency: 'lossless',
  alphaMipmaps: false,
};
// Derived data keys track the encoding recipe, rather than unrelated helper edits.
const recipeFor = (gpu: boolean, rgb = false, legacy = false) =>
  'image-delivery-v3-' +
  imageHash(
    JSON.stringify({
      ...recipeSettings,
      ...(legacy ? { uastcQuality: 2 } : {}),
      gpu,
      ...(!gpu ? { uastcQuality: 2 } : {}),
      ...(gpu && legacy ? { maxRgbRmse: 3 } : {}),
      ...(gpu && rgb ? { inputFormat: 'R8G8B8_SRGB' } : {}),
    }),
  ).slice(0, 16);
const fallbackTool = path.join(os.homedir(), '.local/share/lantern-tools/ktx-4.4.2/bin/ktx');
type Receipt = {
  recipe: string;
  sourceHash: string;
  preview: Delivery;
  delivery: Delivery[];
  files: Record<string, string>;
  rejected: number;
  decisions: {
    width: number;
    height: number;
    reason: string;
    quality?: Delivery['quality'];
  }[];
};
const deliveryRoot = (
  page: Manifest['pages'][number],
  standalone: boolean,
  gpu: boolean,
  rgb = false,
  legacy = false,
) =>
  `generated/delivery/${page.hash}-${standalone ? 'painting' : 'atlas'}-${page.mipmaps ? 'mips' : 'linear'}-${recipeFor(gpu, rgb, legacy).slice(-16)}`;
export async function restoreImageDelivery(
  context: PreparationContext,
  page: Manifest['pages'][number],
  standalone: boolean,
  check = false,
): Promise<Receipt | undefined> {
  let failure: unknown;
  for (const [gpu, rgb, legacy] of [
    [true, false, true],
    [true, true, true],
    [true, false, false],
    [true, true, false],
    [false, false, false],
  ] as const) {
    try {
      const file = 'public/' + deliveryRoot(page, standalone, gpu, rgb, legacy) + '/receipt.json';
      const bytes = await context.readAsset(file);
      const receipt = JSON.parse(bytes.toString()) as Receipt;
      if (
        receipt.recipe !== recipeFor(gpu, rgb, legacy) ||
        receipt.sourceHash !== page.hash ||
        !receipt.delivery.some(
          (v) => v.encoding === 'png' && v.width === page.width && v.height === page.height,
        )
      )
        throw new Error('Delivery recipe or dimensions differ');
      if (
        context.environment.LANTERN_IMAGE_GPU === '1' &&
        !gpu &&
        !receipt.decisions.every((d) => d.reason === 'lossless-alpha')
      )
        continue;
      for (const [name, hash] of Object.entries(receipt.files)) {
        if (
          (await context.verifiedHash('public/' + name)) !== hash &&
          imageHash(await context.readAsset('public/' + name)) !== hash
        )
          throw new Error('Delivery bytes differ');
        await context.record('public/' + name, hash);
      }
      await context.record(file, imageHash(bytes));
      return receipt;
    } catch (error) {
      failure = error;
    }
  }
  if (check) throw failure ?? new Error('Prepared delivery is missing');
}
export async function prepareImageDelivery(
  context: PreparationContext,
  source: Buffer,
  page: Manifest['pages'][number],
  standalone: boolean,
  check: boolean,
) {
  const cookGpu = context.environment.LANTERN_IMAGE_GPU === '1';
  const metadata = await sharp(source).metadata();
  if (metadata.width !== page.width || metadata.height !== page.height)
    throw new Error('Source image dimensions differ from its manifest');
  const rgb = !metadata.hasAlpha;
  const recipe = recipeFor(cookGpu, rgb);
  const mode = standalone ? 'painting' : 'atlas';
  const rootFor = (gpu: boolean) =>
    `generated/delivery/${page.hash}-${mode}-${page.mipmaps ? 'mips' : 'linear'}-${recipeFor(gpu, rgb).slice(-16)}`;
  const root = rootFor(cookGpu);
  const receiptFile = `public/${root}/receipt.json`;
  const restored = await restoreImageDelivery(context, page, standalone, check);
  if (restored) return restored;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-image-delivery-'));
  const files: Record<string, string> = {};
  const store = async (file: string, bytes: Buffer) => {
    await context.writeAsset('public/' + file, bytes);
    files[file] = imageHash(bytes);
  };
  const pngVariant = async (
    width: number,
    height: number,
    name: string,
    buffer: Buffer,
    mipmaps: boolean,
  ): Promise<Delivery> => {
    const file = `${root}/${name}.png`;
    await store(file, buffer);
    return {
      path: file,
      hash: imageHash(buffer),
      width,
      height,
      bytes: buffer.length,
      gpuBytes: Math.ceil(width * height * 4 * (mipmaps ? 4 / 3 : 1)),
      encoding: 'png',
      mipmaps,
    };
  };
  let rejected = 0;
  const decisions: Receipt['decisions'] = [];
  try {
    const disk = await fs.statfs(temporary);
    if (disk.bavail * disk.bsize < page.width * page.height * 16 + source.length * 2)
      throw new Error('Insufficient temporary disk space for full-fidelity image encoding');
    const transparent = metadata.hasAlpha
      ? (await sharp(source).extractChannel('alpha').raw().toBuffer()).some((v) => v !== 255)
      : false;
    const previewBytes = await sharp(source)
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .png({ compressionLevel: recipeSettings.pngCompression })
      .toBuffer();
    const pm = await sharp(previewBytes).metadata();
    const preview = await pngVariant(pm.width!, pm.height!, 'preview', previewBytes, false);
    const sizes = standalone
      ? [
          ...new Set(
            [2048, 4096, Math.max(page.width, page.height)].filter(
              (n) => n <= Math.max(page.width, page.height),
            ),
          ),
        ]
      : [Math.max(page.width, page.height)];
    const delivery: Delivery[] = [];
    for (const size of sizes) {
      const scale = Math.min(1, size / Math.max(page.width, page.height));
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
      const divisor = gcd(page.width, page.height),
        unitWidth = page.width / divisor,
        unitHeight = page.height / divisor;
      const factor = Math.floor(size / Math.max(unitWidth, unitHeight) / 4) * 4;
      const width =
        scale < 1 && factor > 0 ? unitWidth * factor : Math.max(1, Math.round(page.width * scale));
      const height =
        scale < 1 && factor > 0
          ? unitHeight * factor
          : Math.max(1, Math.round(page.height * scale));
      const mipmaps = page.mipmaps || (standalone && !transparent);
      const png =
        scale === 1
          ? source
          : await sharp(source)
              .ensureAlpha()
              .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
              .png({ compressionLevel: recipeSettings.pngCompression })
              .toBuffer();
      delivery.push(await pngVariant(width, height, String(size), png, mipmaps));
      // The renderer requests native detail. Reduced PNGs already cover devices
      // with smaller texture limits; do not encode unused GPU tiers on every edit.
      if (cookGpu && scale < 1) {
        decisions.push({ width, height, reason: 'lossless-resolution-variant' });
        continue;
      }
      if (!cookGpu || !useGpuCompression(transparent, width, height)) {
        decisions.push({
          width,
          height,
          reason: transparent
            ? 'lossless-alpha'
            : !cookGpu
              ? 'lossless-preparation'
              : 'lossless-block-dimensions',
        });
        continue;
      }
      const input = path.join(temporary, 'input.png'),
        encoded = path.join(temporary, 'image.ktx2');
      await fs.writeFile(input, png);
      const tool =
        context.environment.LANTERN_KTX ??
        (await fs.access(fallbackTool).then(
          () => fallbackTool,
          () => 'ktx',
        ));
      let log = '';
      const run = async (args: string[]) => {
        try {
          await runProcess(tool, args, {
            cwd: temporary,
            env: context.environment,
            timeoutMs: 5 * 60_000,
            output: (b) => {
              log = (log + b.toString()).slice(-3000);
            },
          });
        } catch (error) {
          throw new Error(
            'Khronos KTX encoder failed. Install KTX-Software 4.4.2 or set LANTERN_KTX. ' + log,
            { cause: error },
          );
        }
      };
      await run([
        'create',
        '--format',
        rgb ? 'R8G8B8_SRGB' : 'R8G8B8A8_SRGB',
        '--assign-tf',
        'srgb',
        '--encode',
        'uastc',
        '--uastc-quality',
        String(recipeSettings.uastcQuality),
        '--threads',
        '2',
        '--zstd',
        String(recipeSettings.zstdLevel),
        '--convert-texcoord-origin',
        'bottom-left',
        '--testrun',
        ...(mipmaps ? ['--generate-mipmap'] : []),
        input,
        encoded,
      ]);
      const bytes = await fs.readFile(encoded);
      if (
        bytes.length < 80 ||
        !bytes.subarray(0, 12).equals(Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex')) ||
        bytes.readUInt32LE(20) !== width ||
        bytes.readUInt32LE(24) !== height
      )
        throw new Error('Encoder produced an invalid image container');
      if (bytes.length < png.length || blockGpuBytes(width, height, mipmaps) < width * height * 2) {
        const file = `${root}/${size}.ktx2`;
        await store(file, bytes);
        delivery.push({
          path: file,
          hash: imageHash(bytes),
          width,
          height,
          bytes: bytes.length,
          gpuBytes: blockGpuBytes(width, height, mipmaps),
          encoding: 'ktx2-uastc',
          mipmaps,
        });
        decisions.push({ width, height, reason: 'gpu-high-quality' });
      } else {
        rejected++;
        decisions.push({
          width,
          height,
          reason: 'no-size-or-memory-benefit',
        });
      }
    }
    const receipt: Receipt = {
      recipe,
      sourceHash: page.hash,
      preview,
      delivery,
      files,
      rejected,
      decisions,
    };
    await context.writeAsset(receiptFile, JSON.stringify(receipt) + '\n');
    return receipt;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
