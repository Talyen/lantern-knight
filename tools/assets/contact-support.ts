import { createHash } from 'node:crypto';
import type { ManifestDraft } from '../../src/assets/schema';

type Patch = [number, number, number, number];
// Source pixels are read only during preparation. Registration, not a frame's
// lowest pixel, defines the support region; low weapons cannot drag it away.
export function contactSupport(
  pixels: Uint8Array,
  width: number,
  frame: ManifestDraft['frames'][number],
  asset: ManifestDraft['asset'],
): Patch[] {
  const {
      anchor: [ax, ay],
      density: d,
    } = frame.registration ?? asset,
    [tx, ty, w, h] = frame.trim,
    [px, py] = frame.rect,
    actor = asset.type === 'character',
    reach = actor ? asset.shadow.radius * d * 1.7 : w,
    left = Math.max(tx, Math.ceil(ax - reach)),
    right = Math.min(tx + w - 1, Math.floor(ax + reach)),
    top = Math.max(ty, Math.floor(ay - (actor ? asset.shadow.radius * d : h * 0.28))),
    bottom = Math.min(ty + h - 1, Math.ceil(ay + (actor ? asset.shadow.radius * d : h * 0.16))),
    step = Math.max(1, Math.ceil((right - left) / 128)),
    groups: { x: number; y: number }[][] = [];
  let group: { x: number; y: number }[] = [];
  for (let x = left; x <= right; x += step) {
    let y = bottom;
    for (; y >= top; y--) if (pixels[((py + y - ty) * width + px + x - tx) * 4 + 3]! >= 160) break;
    // A contour cut off by the support window is a body/weapon crossing the
    // window, not evidence that this surface rests on the ground.
    if (
      y === bottom &&
      bottom < ty + h - 1 &&
      pixels[((py + y + 1 - ty) * width + px + x - tx) * 4 + 3]! >= 160
    )
      y = top - 1;
    const previous = group.at(-1);
    if (y < top || (previous && Math.abs(y - previous.y) > d * 0.16)) {
      if (group.length) groups.push(group);
      group = [];
    }
    if (y >= top) group.push({ x, y });
  }
  if (group.length) groups.push(group);
  const supported = groups.filter((g) => g.length * step >= Math.max(4, d * 0.045));
  supported.sort((a, b) => b.length - a.length);
  const chosen = supported.slice(0, 2).sort((a, b) => a[0]!.x - b[0]!.x);
  // A broad continuous base gets two overlapping lobes. Narrow/ambiguous
  // supports use one or none, retaining the stable soft footprint at runtime.
  if (chosen.length === 1 && chosen[0]!.length * step > d * 0.3) {
    const all = chosen.pop()!,
      half = Math.floor(all.length / 2);
    chosen.push(all.slice(0, half), all.slice(half));
  }
  return chosen.map((g): Patch => {
    const x0 = g[0]!.x,
      x1 = g.at(-1)!.x,
      ys = g.map((p) => p.y).sort((a, b) => a - b),
      y = ys[Math.floor(ys.length / 2)]!,
      span = ys[Math.floor(ys.length * 0.9)]! - ys[Math.floor(ys.length * 0.1)]!;
    return [
      ((x0 + x1) / 2 - ax) / d,
      (ay - y) / d,
      Math.max(0.025, ((x1 - x0 + step) * 0.7) / d),
      Math.max(0.025, Math.min(0.09, (span * 0.35) / d + 0.025)),
    ].map((v) => Math.round(v * 10000) / 10000) as Patch;
  });
}

export function smoothContacts(manifest: ManifestDraft) {
  const frames = new Map(manifest.frames.map((f) => [f.id, f]));
  const original = new Map(manifest.frames.map((f) => [f.id, f.contact]));
  for (const directions of Object.values(manifest.asset.clips))
    for (const clip of Object.values(directions))
      for (let i = 0; i < clip.frames.length; i++) {
        if (clip.frames.length < 3) continue;
        const frame = frames.get(clip.frames[i]!)!,
          current = original.get(frame.id);
        if (!current?.length) continue;
        const neighbors = [-1, 0, 1].map((offset) => {
          const index = clip.loop
            ? (i + offset + clip.frames.length) % clip.frames.length
            : Math.max(0, Math.min(clip.frames.length - 1, i + offset));
          return original.get(clip.frames[index]!);
        });
        frame.contact = current.map(
          (patch, p) =>
            patch.map((value, axis) => {
              const values = neighbors.map((n) =>
                n?.length === current.length ? n[p]![axis]! : value,
              );
              values.sort((a, b) => a - b);
              // Large pose changes retain their own registration; only remove small
              // contour noise. No clip names, headings or animation-specific rules.
              return Math.abs(values[1]! - value) < 0.04 ? values[1]! : value;
            }) as Patch,
        );
      }
}

// The same identity protects independent placement measurements and permits
// support reuse only when pixels, registration and clip neighborhoods agree.
export function contactIdentity(manifest: ManifestDraft) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        manifest.asset,
        manifest.frames.map(({ contact: _contact, ...frame }) => frame),
        manifest.pages,
      ]),
    )
    .digest('hex');
}
