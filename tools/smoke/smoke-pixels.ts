import type { Page } from 'playwright';
import fs from 'node:fs/promises';
export async function comparePixels(
  page: Page,
  change: () => Promise<unknown>,
  options: { effects?: boolean; capture?: [string, string]; tolerance?: number } = {},
) {
  const sample = async (control: boolean) =>
    page.evaluate(
      async ({ control, effects, capture, tolerance }) => {
        if (effects) window.effectsPlayground.render();
        else await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const source = document.querySelector('canvas')!,
          copy = document.createElement('canvas');
        copy.width = source.width;
        copy.height = source.height;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(source, 0, 0);
        const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
        const state = window as unknown as { __lanternPixelControl?: Uint8ClampedArray };
        let changed = 0,
          maxDifference = 0;
        if (control) state.__lanternPixelControl = pixels;
        else {
          const before = state.__lanternPixelControl!;
          if (!before || before.length !== pixels.length)
            throw new Error('Comparison framebuffer changed dimensions');
          for (let i = 0; i < pixels.length; i++) {
            const difference = Math.abs(pixels[i]! - before[i]!);
            if (difference > tolerance) changed++;
            maxDifference = Math.max(maxDifference, difference);
          }
        }
        return {
          changed,
          maxDifference,
          png: capture ? copy.toDataURL('image/png').split(',')[1]! : undefined,
        };
      },
      {
        control,
        effects: options.effects ?? false,
        capture: !!options.capture,
        tolerance: options.tolerance ?? 2,
      },
    );
  try {
    const before = await sample(true);
    if (options.capture) await fs.writeFile(options.capture[0], Buffer.from(before.png!, 'base64'));
    await change();
    const result = await sample(false);
    if (options.capture) await fs.writeFile(options.capture[1], Buffer.from(result.png!, 'base64'));
    return { changed: result.changed, maxDifference: result.maxDifference };
  } finally {
    await page.evaluate(() => {
      delete (window as unknown as { __lanternPixelControl?: Uint8ClampedArray })
        .__lanternPixelControl;
    });
  }
}
