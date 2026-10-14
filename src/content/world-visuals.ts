import type { ContentSnapshot } from './snapshot';
import type { SceneDocument, SceneSnapshot } from './scene-document';
import type { Point } from './world';
import type { Manifest } from '../assets/schema';
import { cameraContract } from '../assets/camera-contract';

export const SCENE_LIGHT_CAPACITY = 3;
export const SCENE_SHADE_CAPACITY = 8;
export type SceneProfile = 'graveyard' | 'chapel';
type PlacementBase = Omit<
  SceneDocument['objects'][number],
  'kind' | 'label' | 'role' | 'mount' | 'x' | 'z' | 'purpose' | 'footprint' | 'fixture'
> & {
  x: number;
  z: number;
  purpose: string;
  footprint?: readonly [number, number];
  fixture?: FixtureDefinition;
  wallFace?: string;
};
export type ArtPlacement = PlacementBase &
  (
    | {
        role: 'attachment';
        mount: { to: string; offset: readonly [number, number, number]; socket?: string };
      }
    | { role?: 'ground' | 'upright'; mount?: never }
  );
export type SiteWall = SceneSnapshot['walls'][number];
export type FixtureDefinition = ContentSnapshot<
  NonNullable<SceneDocument['objects'][number]['fixture']>
>;
export type SceneSurroundDefinition = NonNullable<SceneSnapshot['surround']>;
export type SurroundLayer = SceneSurroundDefinition['layers'][number];
type SceneVisuals = { -readonly [K in keyof SceneSnapshot]: SceneSnapshot[K] };
export type WorldVisualDefinition = Partial<
  Pick<
    SceneVisuals,
    | 'groundInteraction'
    | 'look'
    | 'surround'
    | 'weather'
    | 'rainBounds'
    | 'rainShelters'
    | 'interior'
    | 'propOrder'
    | 'overlaps'
  >
> &
  Pick<SceneVisuals, 'paths' | 'walls' | 'graves' | 'proceduralAssets'> & {
    camera: SceneDocument['camera'];
    designProfile?: SceneProfile;
    editorFloor?: Omit<SceneSnapshot['floor'], 'clip'> & { clip: string };
    floor: string;
    props: readonly ArtPlacement[];
    decals: readonly ArtPlacement[];
    resolvedFixtures?: readonly ResolvedFixture[];
  };
export const floorUV = (x: number, z: number): readonly [number, number] => [x / 4, -z / 4];
export type ResolvedFixture = Omit<FixtureDefinition, 'range'> & { prop: string; radius: number };

export function sceneAssets(art: WorldVisualDefinition) {
  return [
    ...new Set([
      art.floor,
      'ink-cues',
      ...art.proceduralAssets,
      ...((art.weather?.rain ?? 0) > 0 ? ['fx-splash', 'fx-ripple'] : []),
      ...art.props.map((p) => p.asset),
      ...art.decals.map((p) => p.asset),
      ...(art.surround?.layers.map((l) => l.asset) ?? []),
    ]),
  ];
}
export function validateAreaArt(
  packs: ReadonlyMap<string, { manifest: Manifest }>,
  art: WorldVisualDefinition | undefined,
) {
  if (!art) return;
  const pack = (id: string) => {
    const p = packs.get(id);
    if (!p) throw new Error(`missing room art: ${id}`);
    return p.manifest;
  };
  for (const id of [art.floor]) {
    const m = pack(id);
    if (m.asset.type !== 'material' || m.asset.projection !== 'top-down')
      throw new Error('floor must use raw top-down material');
  }
  for (const p of art.props) {
    if (
      !Number.isFinite(p.x + p.z + (p.y ?? 0) + (p.scale ?? 1)) ||
      (p.scale ?? 1) <= 0 ||
      !p.purpose
    )
      throw new Error(`invalid art placement: ${p.id}`);
    if (!pack(p.asset).asset.clips[p.clip]?.[p.heading ?? 'd45'])
      throw new Error(`required clip unavailable: ${p.clip}`);
  }
  for (const p of art.decals) {
    const m = pack(p.asset);
    if (!m.asset.clips[p.clip]?.d45) throw new Error(`required clip unavailable: ${p.clip}`);
  }
  if (art.surround) {
    const s = art.surround;
    if (
      !Number.isFinite(s.anchor.x + s.anchor.z + s.color) ||
      s.ground.length < 3 ||
      s.ground.some((p) => !Number.isFinite(p.x + p.z))
    )
      throw new Error('invalid scene surround');
    for (const l of s.layers) {
      if (
        !Number.isFinite(l.scale + l.base + l.parallax + l.tint + l.detail) ||
        l.scale <= 0 ||
        l.parallax < 0 ||
        l.parallax > 1 ||
        l.detail < 0 ||
        l.detail > 1
      )
        throw new Error('invalid surround layer');
      const m = pack(l.asset);
      if (m.asset.projection !== 'painted-cutout' || !m.asset.clips[l.clip]?.d45)
        throw new Error(`required surround clip unavailable: ${l.clip}`);
    }
  }
  for (const id of ['ink-cues']) pack(id);
}

export function compositionPoint(
  hero: Point,
  frame: { halfWidth: number; halfHeight: number } | undefined,
  art: WorldVisualDefinition | undefined,
): Point {
  const f = art?.camera;
  if (!f) return { ...hero };
  const t = f.arrival
      ? Math.max(0, Math.min(1, (hero.z - f.arrival.start) / (f.arrival.end - f.arrival.start)))
      : 0,
    biasZ = f.bias.z + (f.arrival ? f.arrival.biasZ - f.bias.z : 0) * t;
  const target = {
    x: Math.max(f.bounds.minX, Math.min(f.bounds.maxX, hero.x + f.bias.x)),
    z: Math.max(f.bounds.minZ, Math.min(f.bounds.maxZ, hero.z + biasZ)),
  };
  if (frame && f.keepHeroVisible) {
    const a = (cameraContract.azimuthDeg * Math.PI) / 180,
      e = (cameraContract.elevationDeg * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a),
      sine = Math.sin(e);
    const dx = hero.x - target.x,
      dz = hero.z - target.z,
      lateral = dx * c - dz * s,
      limit = Math.max(0.1, frame.halfWidth - 0.75),
      shift = lateral - Math.max(-limit, Math.min(limit, lateral));
    target.x += shift * c;
    target.z -= shift * s;
    const vertical =
        -((hero.x - target.x) * s + (hero.z - target.z) * c) * sine -
        compositionHeight(hero, art) * Math.cos(e),
      low = -frame.halfHeight + 0.6,
      high = frame.halfHeight - cameraContract.heroHeight * Math.cos(e) - 0.6,
      correction = vertical - Math.max(low, Math.min(high, vertical));
    target.x -= (correction * s) / sine;
    target.z -= (correction * c) / sine;
  }
  return target;
}

// The requested span remains the saved preference; only the default framing reveals entry.
export function compositionSpan(
  hero: Point,
  requested: number,
  art: WorldVisualDefinition | undefined,
): number {
  const f = art?.camera,
    a = f?.arrival;
  if (!a?.span || requested !== 9) return requested;
  const t = Math.max(0, Math.min(1, (hero.z - a.start) / (a.end - a.start))),
    ease = t * t * (3 - 2 * t);
  return requested + (a.span - requested) * ease;
}

export function compositionHeight(hero: Point, art: WorldVisualDefinition | undefined): number {
  const f = art?.camera,
    base = f?.targetHeight ?? 0,
    a = f?.arrival;
  const t = a ? Math.max(0, Math.min(1, (hero.z - a.start) / (a.end - a.start))) : 0;
  return base + ((a?.targetHeight ?? base) - base) * t;
}
