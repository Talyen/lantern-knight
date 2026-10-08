import type { ArtPlacement, WorldVisualDefinition, SiteFixture } from './world-art';
export const SCENE_LIGHT_CAPACITY = 3;
type Preset = { light: NonNullable<ArtPlacement['light']> };
export const sceneryPresets: Readonly<Record<string, Preset>> = {
  'ink-graveyard-scenery:crook-lamp': {
    light: { offset: [0.3, 2.0875, -0.3], power: 0.45, range: 2.4, phase: 0.2 },
  },
  'ink-graveyard-scenery:lantern-hardware': {
    light: { offset: [-0.03, 0.22, 0.03], power: 0.8, range: 3, phase: 0.7 },
  },
  'ink-graveyard-scenery:cresset-hardware': {
    light: { offset: [-0.11, 0.32, 0.11], power: 1.65, range: 4.1, phase: 0.45 },
  },
  'ink-crypt:votive-hardware': {
    light: { offset: [0, 0.38, 0], power: 0.85, range: 3.4, phase: 0.31 },
  },
};
export function applySceneryPreset(p: ArtPlacement): ArtPlacement {
  const preset = sceneryPresets[`${p.asset}:${p.clip}`];
  if (!preset) return p;
  const offset = [...preset.light.offset] as [number, number, number];
  if (p.mirror) {
    const lateral = (offset[0] - offset[2]) / Math.SQRT2;
    offset[0] -= Math.SQRT2 * lateral;
    offset[2] += Math.SQRT2 * lateral;
  }
  return {
    ...p,
    light: { ...preset.light, offset },
    flame: { clip: 'editor-lamp', phase: preset.light.phase },
  };
}
export type ResolvedFixture = SiteFixture & {
  flame?: {
    asset: string;
    clip: string;
    offset: readonly [number, number, number];
    scale: number;
    phase: number;
    depthOffset: number;
    decorative: boolean;
  };
  embersScale: number;
  constructionSocket: boolean;
};
export function resolveFixtures(art: WorldVisualDefinition): ResolvedFixture[] {
  const result: ResolvedFixture[] = [];
  for (const p of art.props) {
    const authored = art.fixtures?.find((f) => f.prop === p.id),
      scale = p.scale ?? 1,
      light = p.light;
    if (!light && !authored) continue;
    const socket = (light ? light.offset.map((v) => v * scale) : authored!.socket) as [
      number,
      number,
      number,
    ];
    const candle = p.flame?.clip === 'votive',
      generic = p.flame?.clip === 'editor-lamp';
    const existing = authored !== undefined;
    const offset: readonly [number, number, number] = existing
      ? authored.socket
      : generic
        ? socket
        : candle
          ? [0, 0, 0]
          : [-0.1, 0.25, 0.1];
    result.push({
      id: authored?.id ?? p.id + '-flame',
      prop: p.id,
      socket,
      power: light?.power ?? authored!.power,
      radius: light?.range ?? authored!.radius,
      phase: light?.phase ?? authored!.phase,
      smoke: authored?.smoke ?? p.flame?.clip === 'cresset',
      flame:
        existing || p.flame
          ? {
              asset:
                existing || generic
                  ? 'ink-ambient'
                  : candle
                    ? 'ink-crypt-flame'
                    : 'ink-crypt-ambient',
              clip: candle ? 'votive' : 'lamp_flame',
              offset,
              scale: existing ? (authored.flameScale ?? 0.65) : scale * (candle ? 1 : 0.38),
              phase: existing ? authored.phase : (p.flame?.phase ?? light!.phase),
              depthOffset: existing ? 0 : 0.008,
              decorative: !existing,
            }
          : undefined,
      embersScale: candle ? 0.16 : 0.28,
      constructionSocket: existing,
    });
  }
  return result;
}
export const sceneFixtures = (art: WorldVisualDefinition) =>
  art.resolvedFixtures ?? resolveFixtures(art);
