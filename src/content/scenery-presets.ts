import type { ArtPlacement, FixtureDefinition, WorldVisualDefinition } from './world-art';
export const SCENE_LIGHT_CAPACITY = 3;
const lamp = (
  socket: [number, number, number],
  power: number,
  range: number,
  phase: number,
): Omit<FixtureDefinition, 'id'> => ({
  socket,
  power,
  range,
  phase,
  smoke: false,
  embersScale: 0.28,
  flame: {
    asset: 'ink-ambient',
    clip: 'lamp_flame',
    offset: socket,
    scale: 0.38,
    phase,
    depthOffset: 0.008,
    decorative: true,
  },
});
export const sceneryPresets: Readonly<Record<string, Omit<FixtureDefinition, 'id'>>> = {
  'ink-graveyard-scenery:crook-lamp': lamp([0.3, 2.0875, -0.3], 0.45, 2.4, 0.2),
  'ink-graveyard-scenery:lantern-hardware': lamp([-0.03, 0.22, 0.03], 0.8, 3, 0.7),
  'ink-graveyard-scenery:cresset-hardware': lamp([-0.11, 0.32, 0.11], 1.65, 4.1, 0.45),
  'ink-crypt:votive-hardware': lamp([0, 0.38, 0], 0.85, 3.4, 0.31),
};
// Creation defaults; resolving a scene never replaces authored fixture values.
export function applySceneryPreset<
  P extends { id: string; asset: string; clip: string; fixture?: FixtureDefinition },
>(p: P): P {
  const preset = sceneryPresets[`${p.asset}:${p.clip}`];
  return !preset || p.fixture
    ? p
    : { ...p, fixture: { id: p.id + '-flame', ...structuredClone(preset) } };
}
export function placementOffset(
  p: { scale?: number; mirror?: boolean },
  v: readonly number[],
): [number, number, number] {
  const [x, y, z] = v,
    scale = p.scale ?? 1;
  return p.mirror ? [z! * scale, y! * scale, x! * scale] : [x! * scale, y! * scale, z! * scale];
}
export const localOffset = (p: { scale?: number; mirror?: boolean }, v: readonly number[]) =>
  placementOffset({ mirror: p.mirror, scale: 1 / (p.scale ?? 1) }, v);
export type ResolvedFixture = Omit<FixtureDefinition, 'range'> & { prop: string; radius: number };
export function resolveFixtures(art: WorldVisualDefinition): ResolvedFixture[] {
  return art.props.flatMap((p) => {
    if (!p.fixture) return [];
    const { range, ...f } = p.fixture,
      scale = p.scale ?? 1;
    return [
      {
        ...f,
        prop: p.id,
        radius: range,
        socket: placementOffset(p, f.socket),
        flame: f.flame
          ? { ...f.flame, offset: placementOffset(p, f.flame.offset), scale: f.flame.scale * scale }
          : undefined,
      },
    ];
  });
}
export const sceneFixtures = (art: WorldVisualDefinition) =>
  art.resolvedFixtures ?? resolveFixtures(art);
