import { authoredGameplay } from './authored-gameplay';
import { resolveFixtures, SCENE_LIGHT_CAPACITY, type ResolvedFixture } from './scenery-presets';
import { parseSceneDocument, resolveSceneDocument, type SceneDocument } from './scene-document';
import {
  isSupportedPosition,
  type AreaDefinition,
  type PropDefinition,
  type Bounds,
  type Point,
} from './world';
import type { WeatherState } from './visual-effects';
import type { Manifest } from '../assets/schema';
import { type SceneProfile } from './scene-design';
import { cameraContract } from '../assets/camera-contract';
type PlacementBase = {
  id: string;
  clip: string;
  heading?: (typeof import('../core/camera').HEADINGS)[number];
  x: number;
  z: number;
  y?: number;
  scale?: number;
  fade?: boolean;
  mirror?: boolean;
  tint?: number;
  footprint?: readonly [number, number];
  purpose: string;
  zone?: string;
  door?: boolean;
  rotation?: number;
  asset: string;
  footprintAngle?: number;
  coverage?: string;
  assembly?: string;
  shadow?: 'contact' | 'cast' | 'none';
  wallFace?: string;
  fixture?: FixtureDefinition;
  emissive?: boolean;
  opacity?: number;
};
export type ArtPlacement = PlacementBase &
  (
    | {
        role: 'attachment';
        mount: { to: string; offset: readonly [number, number, number]; socket?: string };
      }
    | { role?: 'ground' | 'upright'; mount?: never }
  );
type GroundPath = {
  points: readonly Point[];
  width: number;
  widths?: readonly number[];
};
export type SiteWall = {
  id: string;
  from: Point;
  to: Point;
  height: number;
  thickness: number;
  visualHeight?: number;
  breaks?: readonly number[];
  cutout?: 'wall' | 'wall-x' | 'wall-z' | 'boundary-x' | 'boundary-z' | 'fence';
  surface?: 'masonry';
  assembly?: string;
  fade?: boolean;
};
type BurialPlot = {
  id: string;
  x: number;
  z: number;
  width: number;
  length: number;
  age: 'kept' | 'old' | 'damaged';
  angle?: number;
  marker?: 'gravestone' | 'memorial' | 'fallen-marker';
};
export type FixtureDefinition = {
  id: string;
  socket: readonly [number, number, number];
  power: number;
  range: number;
  phase: number;
  smoke: boolean;
  embersScale: number;
  flame?: {
    asset: string;
    clip: string;
    offset: readonly [number, number, number];
    scale: number;
    phase: number;
    depthOffset: number;
    decorative: boolean;
  };
};
type OverlapAllowance = {
  a: string;
  b: string;
  region: Bounds;
  reason: string;
};
export type SurroundLayer = {
  asset: string;
  clip: string;
  scale: number;
  base: number;
  parallax: number;
  tint: number;
  detail: number;
};
export type SceneSurroundDefinition = {
  anchor: Point;
  color: number;
  ground: readonly Point[];
  layers: readonly SurroundLayer[];
};
export type WorldVisualDefinition = {
  designProfile?: SceneProfile;
  editorFloor?: { asset: string; clip: string };
  look?: { rig: 'golden' | 'silver'; look: 'ink' | 'diorama' | 'cinematic' };
  surround?: SceneSurroundDefinition;
  weather?: WeatherState;
  rainBounds?: Bounds;
  rainShelters?: readonly Bounds[];
  floor: string;
  props: readonly ArtPlacement[];
  proceduralAssets: readonly string[];
  decals: readonly ArtPlacement[];
  paths: readonly GroundPath[];
  walls: readonly SiteWall[];
  graves: readonly BurialPlot[];
  interior?: Bounds;
  camera: {
    bounds: Bounds;
    bias: Point;
    keepHeroVisible?: boolean;
    targetHeight?: number;
    arrival?: {
      start: number;
      end: number;
      biasZ: number;
      span?: number;
      targetHeight?: number;
    };
  };
  propOrder?: readonly string[];
  resolvedFixtures?: readonly ResolvedFixture[];
  overlaps?: readonly OverlapAllowance[];
};
export const floorUV = (x: number, z: number): readonly [number, number] => [x / 4, -z / 4];
export function resolveAuthoredScene(document: SceneDocument): WorldVisualDefinition {
  const art = resolveSceneDocument(document);
  if (document.geometry) {
    const area: AreaDefinition = {
      id: document.base,
      name: document.name,
      subtitle: '',
      seedOffset: 0,
      spawns: [],
      exits: [],
      floorColor: 0,
      ...document.geometry,
      props: churchyardColliders(art),
    };
    for (const entry of area.entries)
      if (!isSupportedPosition(area, entry, 0.3))
        throw new Error('Scene entry is obstructed: ' + entry.id);
  }
  const resolvedFixtures = resolveFixtures(art);
  if (resolvedFixtures.length > SCENE_LIGHT_CAPACITY)
    throw new Error('The scene already has three lights. Remove a light before adding another.');
  return {
    ...art,
    resolvedFixtures,
    proceduralAssets: [
      ...new Set([
        ...art.proceduralAssets,
        ...resolvedFixtures.flatMap((f) => [
          ...(f.flame ? [f.flame.asset] : []),
          'fx-embers',
          ...(f.smoke ? ['fx-smoke'] : []),
        ]),
      ]),
    ],
  };
}
export function churchyardColliders(art: WorldVisualDefinition): PropDefinition[] {
  return [
    ...art.props
      .filter((p) => p.footprint)
      .map((p) => ({
        id: p.id,
        kind: 'wall' as const,
        x: p.x,
        z: p.z,
        radius: 0.2,
        height: 1,
        shape: 'box' as const,
        size: p.footprint,
        rotation: p.footprintAngle ?? 0,
        blocking: true,
      })),
    ...art.walls.map((w) => ({
      id: w.id,
      kind: 'wall' as const,
      x: (w.from.x + w.to.x) / 2,
      z: (w.from.z + w.to.z) / 2,
      radius: 0.2,
      height: w.height,
      shape: 'box' as const,
      size: [Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z), w.thickness] as const,
      rotation: Math.atan2(w.to.z - w.from.z, w.to.x - w.from.x),
      blocking: true,
    })),
  ];
}
export function sceneAssets(art: WorldVisualDefinition) {
  return [
    ...new Set([
      art.floor,
      'ink-cues',
      ...art.proceduralAssets,
      ...art.props.map((p) => p.asset),
      ...art.decals.map((p) => p.asset),
      ...(art.surround?.layers.map((l) => l.asset) ?? []),
    ]),
  ];
}
export function validateAreaArt(
  _area: AreaDefinition,
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
  area: string,
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
        compositionHeight(area, hero, art) * Math.cos(e),
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
  _area: string,
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

export function compositionHeight(
  _area: string,
  hero: Point,
  art: WorldVisualDefinition | undefined,
): number {
  const f = art?.camera,
    base = f?.targetHeight ?? 0,
    a = f?.arrival;
  const t = a ? Math.max(0, Math.min(1, (hero.z - a.start) / (a.end - a.start))) : 0;
  return base + ((a?.targetHeight ?? base) - base) * t;
}

export type ResolvedScene = {
  document: SceneDocument;
  area: AreaDefinition;
  visuals: WorldVisualDefinition;
  assets: readonly string[];
};
export function resolveScene(
  value: unknown,
  gameplay: Partial<
    Pick<AreaDefinition, 'subtitle' | 'seedOffset' | 'spawns' | 'exits' | 'floorColor'>
  > = {},
): ResolvedScene {
  const document = parseSceneDocument(value);
  const visuals = resolveAuthoredScene(document);
  const floor = document.floor;
  const geometry = document.geometry ?? {
    bounds: {
      minX: -floor!.width / 2,
      maxX: floor!.width / 2,
      minZ: -floor!.depth / 2,
      maxZ: floor!.depth / 2,
    },
    surface: { kind: 'flat' as const, height: 0 },
    baselineEntry: 'start',
    entries: [{ id: 'start', x: 0, z: 0 }],
  };
  let area: AreaDefinition = {
    id: document.base === 'flat' ? 'editor-flat' : document.base,
    name: document.name,
    subtitle: '',
    seedOffset: 0,
    spawns: [],
    exits: [],
    floorColor: 0x344b4e,
    ...geometry,
    ...gameplay,
    props: churchyardColliders(visuals),
  };
  area = authoredGameplay(document, area, visuals.props);
  return { document, area, visuals, assets: sceneAssets(visuals) };
}
