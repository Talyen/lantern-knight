import type { PreparationContext } from '../context';
import { effectPreparation } from '../effect-preparation';
export async function prepare(context: PreparationContext, check = false) {
  const { exactSource } = context;
  const { source, frames, finish } = effectPreparation(context, check, 'visual-effects');
  const root = 'references/art/ink-collection-01';
  for (const [id, clipId] of [
    ['smoke', 'quiet_smoke'],
    ['embers', 'rising_motes'],
    ['splash', 'droplet_splash'],
    ['ripple', 'pond_ripple'],
  ] as const) {
    const data = JSON.parse((await exactSource('ambient_pack_v1/manifest.json', root)).toString()),
      clip = data.clips.find((c: { id: string }) => c.id === clipId);
    await frames(
      source(`fx-${id}`, 'effect', [1536, 1344], [768, 858], 336),
      clip.frames.map((f: { svg: string }) => `ambient_pack_v1/${f.svg}`),
      clip.frames.map(
        (f: { durationRational: number[] }) =>
          (1000 * f.durationRational[0]!) / f.durationRational[1]!,
      ),
      !!clip.loop,
      true,
    );
  }
  await finish();
}
