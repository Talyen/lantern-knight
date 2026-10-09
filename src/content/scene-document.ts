import { AuthoredGameplaySchema } from './authored-gameplay';
import { z } from 'zod';
import type { ArtPlacement, WorldVisualDefinition } from './world-art';
import type { Manifest } from '../assets/schema';
import { placementOffset } from './scenery-presets';
import { HEADINGS } from '../core/camera';
import { deriveScenePlacement } from './scene-design';
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const coordinate = z.number().finite().min(-1000).max(1000),
  positive = z.number().finite().positive();
const vector = z.tuple([coordinate, coordinate, coordinate]);
const transform = {
  x: coordinate,
  z: coordinate,
  y: coordinate.optional(),
  scale: z.number().finite().min(0.05).max(20).optional(),
  mirror: z.boolean().optional(),
  rotation: z
    .number()
    .finite()
    .min(-Math.PI * 2)
    .max(Math.PI * 2)
    .optional(),
};
const placementSchema = z
  .object({
    id,
    kind: z.enum(['prop', 'decal']),
    tint: z.number().int().min(0).max(0xffffff).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    fade: z.boolean().optional(),
    shadow: z.enum(['none', 'contact', 'cast']).optional(),
    asset: z.string().regex(/^[a-z0-9_-]+$/),
    clip: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    ...transform,
  })
  .strict();
const fixture = z
  .object({
    id,
    socket: vector,
    power: positive,
    range: positive,
    phase: z.number().finite(),
    smoke: z.boolean(),
    embersScale: positive,
    flame: z
      .object({
        asset: z.string(),
        clip: z.string(),
        offset: vector,
        scale: positive,
        phase: z.number().finite(),
        depthOffset: coordinate,
        decorative: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
const object = placementSchema
  .extend({
    kind: z.enum(['prop', 'decal', 'character', 'effect']),
    heading: z.enum(HEADINGS).optional(),
    x: coordinate.optional(),
    z: coordinate.optional(),
    purpose: z.string().min(1).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    footprint: z.tuple([positive, positive]).optional(),
    footprintAngle: coordinate.optional(),
    coverage: z.string().optional(),
    assembly: z.string().optional(),
    zone: z.string().optional(),
    emissive: z.boolean().optional(),
    door: z.boolean().optional(),
    role: z.enum(['ground', 'upright', 'attachment']).optional(),
    mount: z.object({ to: id, offset: vector, socket: z.string().optional() }).strict().optional(),
    fixture: fixture.optional(),
  })
  .superRefine((p, ctx) => {
    if (
      p.mount
        ? p.x !== undefined || p.z !== undefined || p.y !== undefined || p.role !== 'attachment'
        : p.x === undefined || p.z === undefined || p.role === 'attachment'
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Mounted objects use only support-relative offsets; free objects require x/z',
      });
    if (p.kind === 'decal' && (p.mount || p.fixture))
      ctx.addIssue({ code: 'custom', message: 'Ground details cannot carry fixtures or mounts' });
  });
const point = z.object({ x: coordinate, z: coordinate }).strict();
const bounds = z
  .object({ minX: coordinate, maxX: coordinate, minZ: coordinate, maxZ: coordinate })
  .strict()
  .refine((b) => b.minX < b.maxX && b.minZ < b.maxZ, 'Bounds must have positive dimensions');
const camera = z
  .object({
    bounds,
    bias: point,
    keepHeroVisible: z.boolean().optional(),
    targetHeight: coordinate.optional(),
    arrival: z
      .object({
        start: coordinate,
        end: coordinate,
        biasZ: coordinate,
        span: positive.optional(),
        targetHeight: coordinate.optional(),
      })
      .strict()
      .refine((a) => a.start < a.end, 'Camera arrival needs a nonempty range')
      .optional(),
  })
  .strict();
const surface = z.union([
  z.object({ kind: z.literal('flat'), height: coordinate }).strict(),
  z
    .object({
      kind: z.enum(['ramp', 'stairs']),
      steps: z.number().int().positive().optional(),
      terraceBounds: bounds.optional(),
      stairWidth: positive.optional(),
      axis: z.enum(['x', 'z']),
      start: coordinate,
      end: coordinate,
      startHeight: coordinate,
      endHeight: coordinate,
    })
    .strict()
    .refine((s) => s.start !== s.end, 'Surface needs a nonempty range'),
]);
const geometry = z
  .object({
    bounds,
    surface,
    activation: bounds.optional(),
    baselineEntry: id,
    entries: z.array(point.extend({ id }).strict()).min(1),
  })
  .strict();
const surround = z
  .object({
    anchor: point,
    color: z.number().int().min(0).max(0xffffff),
    ground: z.array(point).min(3),
    layers: z.array(
      z
        .object({
          asset: z.string(),
          clip: z.string(),
          scale: positive,
          base: coordinate,
          parallax: z.number().finite().min(0).max(1),
          tint: z.number().int().min(0).max(0xffffff),
          detail: z.number().finite().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();
const wall = z
  .object({
    id,
    from: point,
    to: point,
    height: positive,
    thickness: positive,
    visualHeight: positive.optional(),
    breaks: z.array(coordinate).optional(),
    cutout: z.enum(['wall', 'wall-x', 'wall-z', 'boundary-x', 'boundary-z', 'fence']).optional(),
    surface: z.literal('masonry').optional(),
    assembly: z.string().optional(),
    fade: z.boolean().optional(),
  })
  .strict();
const SceneDocumentSchema = z
  .object({
    version: z.literal(5),
    id,
    name: z.string().trim().min(1).max(80),
    base: id,
    target: z.enum(['draft', 'live']),
    profile: z.enum(['graveyard', 'chapel', 'study']),
    floor: z
      .object({
        asset: z.string(),
        clip: z.string().optional(),
        width: positive.max(100),
        depth: positive.max(100),
      })
      .strict(),
    hero: point,
    look: z
      .object({ rig: z.enum(['golden', 'silver']), look: z.enum(['ink', 'diorama', 'cinematic']) })
      .strict(),
    camera,
    geometry: geometry.optional(),
    gameplay: AuthoredGameplaySchema.optional(),
    surround: surround.optional(),
    weather: z
      .object({ rain: z.number().min(0).max(1), wind: point })
      .strict()
      .optional(),
    rainBounds: bounds.optional(),
    rainShelters: z.array(bounds).optional(),
    proceduralAssets: z.array(z.string()).default([]),
    paths: z
      .array(
        z
          .object({ points: z.array(point), width: positive, widths: z.array(positive).optional() })
          .strict(),
      )
      .default([]),
    walls: z.array(wall).default([]),
    graves: z
      .array(
        z
          .object({
            id,
            x: coordinate,
            z: coordinate,
            width: positive,
            length: positive,
            age: z.enum(['kept', 'old', 'damaged']),
            angle: coordinate.optional(),
            marker: z.enum(['gravestone', 'memorial', 'fallen-marker']).optional(),
          })
          .strict(),
      )
      .default([]),
    interior: bounds.optional(),
    propOrder: z.array(id).default([]),
    overlaps: z
      .array(z.object({ a: id, b: id, region: bounds, reason: z.string() }).strict())
      .default([]),
    objects: z.array(object).max(500),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (new Set(d.objects.map((p) => p.id)).size !== d.objects.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate object identity' });
    if (d.base !== 'flat' && !d.geometry)
      ctx.addIssue({ code: 'custom', message: 'Gameplay scenes require geometry and entries' });
    for (const p of d.gameplay?.pickups ?? [])
      if (!d.objects.some((o) => o.id === p.object && o.kind !== 'decal'))
        ctx.addIssue({
          code: 'custom',
          message: 'Pickup references missing upright artwork: ' + p.object,
        });
  });
export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type SceneObject = SceneDocument['objects'][number];
export const sceneBytesLimit = 64 * 1024;
export function parseSceneDocument(value: unknown): SceneDocument {
  return SceneDocumentSchema.parse(value);
}
export type PaletteKind = SceneObject['kind'];
export function paletteKind(m: Manifest): PaletteKind | undefined {
  if (m.asset.placement === 'reference') return;
  if (m.asset.type === 'character') return 'character';
  if (m.asset.type === 'effect') return 'effect';
  if (m.asset.projection === 'top-down' && (m.asset.type === 'prop' || m.asset.type === 'material'))
    return 'decal';
  if (m.asset.type === 'prop' && m.asset.projection === 'painted-cutout') return 'prop';
}
export function paletteClips(m: Manifest) {
  return Object.entries(m.asset.clips)
    .filter(([, d]) => Object.values(d).some((c) => c && c.frames.length > 0))
    .map(([c]) => c);
}
export function floorClips(m: Manifest) {
  return m.asset.type === 'material' &&
    m.asset.projection === 'top-down' &&
    m.asset.status !== 'diagnostic'
    ? paletteClips(m).filter((c) => m.asset.clips[c]?.d45?.frames.length === 1)
    : [];
}
export function validateSceneReferences(
  d: SceneDocument,
  manifests?: ReadonlyMap<string, Manifest>,
) {
  const ids = new Set<string>();
  for (const p of d.objects) {
    if (ids.has(p.id)) throw new Error('Duplicate object identity: ' + p.id);
    ids.add(p.id);
    if (manifests) {
      const m = manifests.get(p.asset);
      if (!m || paletteKind(m) !== p.kind || !paletteClips(m).includes(p.clip))
        throw new Error(`Unavailable scenery: ${p.asset}/${p.clip}`);
      const heading = p.heading ?? 'd45';
      if (!m.asset.clips[p.clip]?.[heading])
        throw new Error(`Unavailable facing: ${p.asset}/${p.clip}/${heading}`);
    }
  }
  for (const p of d.objects)
    if (p.fixture) {
      if (ids.has(p.fixture.id)) throw new Error('Duplicate fixture identity: ' + p.fixture.id);
      ids.add(p.fixture.id);
      const f = p.fixture.flame;
      if (manifests && f && !manifests.get(f.asset)?.asset.clips[f.clip]?.d45)
        throw new Error(`Unavailable flame: ${f.asset}/${f.clip}`);
    }
  if (manifests) {
    for (const asset of d.proceduralAssets)
      if (!manifests.has(asset)) throw new Error('Unavailable scene asset: ' + asset);
    for (const layer of d.surround?.layers ?? []) {
      const manifest = manifests.get(layer.asset);
      if (
        !manifest ||
        manifest.asset.projection !== 'painted-cutout' ||
        !manifest.asset.clips[layer.clip]?.d45
      )
        throw new Error('Unavailable surround: ' + layer.asset + '/' + layer.clip);
    }
  }
  if (d.floor && manifests) {
    const m = manifests.get(d.floor.asset);
    if (
      !m ||
      m.asset.type !== 'material' ||
      m.asset.projection !== 'top-down' ||
      (d.floor.clip && !floorClips(m).includes(d.floor.clip))
    )
      throw new Error('Unavailable ground material');
  }
}
export function resolveSceneDocument(d: SceneDocument): WorldVisualDefinition {
  validateSceneReferences(d);
  const source: WorldVisualDefinition = {
    floor: d.floor.asset,
    camera: d.camera,
    surround: d.surround,
    weather: d.weather,
    rainBounds: d.rainBounds,
    rainShelters: d.rainShelters,
    paths: d.paths,
    walls: d.walls,
    graves: d.graves,
    interior: d.interior,
    proceduralAssets: d.proceduralAssets,
    propOrder: d.propOrder,
    overlaps: d.overlaps,
    props: [],
    decals: [],
  };
  const raw = new Map<string, ArtPlacement | SceneObject>(
    [...source.props, ...source.decals, ...d.objects].map((p) => [p.id, p]),
  );
  const resolved = new Map<string, ArtPlacement>(),
    visiting = new Set<string>();
  const resolve = (id: string): ArtPlacement => {
    if (resolved.has(id)) return resolved.get(id)!;
    const p = raw.get(id);
    if (!p) throw new Error('Missing attachment support: ' + id);
    if (visiting.has(id)) throw new Error('Cyclic attachment support: ' + id);
    visiting.add(id);
    const { kind: _, ...fields } = p as SceneObject;
    fields.purpose ??= 'Scene editor scenery';
    let placement: ArtPlacement;
    if (p.mount) {
      const parent = resolve(p.mount.to),
        [x, y, z] = placementOffset(parent, p.mount.offset);
      placement = {
        ...fields,
        purpose: fields.purpose,
        role: 'attachment',
        mount: p.mount,
        x: parent.x + x,
        z: parent.z + z,
        y: (parent.y ?? 0) + y,
      };
    } else
      placement = {
        ...fields,
        purpose: fields.purpose,
        role: p.role as 'ground' | 'upright' | undefined,
        mount: undefined,
        x: p.x!,
        z: p.z!,
      };
    visiting.delete(id);
    placement = deriveScenePlacement(placement);
    resolved.set(id, placement);
    return placement;
  };
  const props = [...source.props, ...d.objects.filter((p) => p.kind !== 'decal')].map((p) =>
    resolve(p.id),
  );
  const order = new Map(d.propOrder.map((id, i) => [id, i]));
  props.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  const decals = [...source.decals, ...d.objects.filter((p) => p.kind === 'decal')].map((p) =>
    resolve(p.id),
  );
  const art: WorldVisualDefinition = {
    ...source,
    designProfile: d.profile === 'study' ? undefined : d.profile,
    props,
    decals,
    editorFloor: d.floor.clip ? { asset: d.floor.asset, clip: d.floor.clip } : undefined,
    look: d.look,
  };
  return art;
}

export function parseSceneFragment(value: unknown) {
  const fragment = z
    .object({
      version: z.literal(1),
      name: z.string().trim().min(1).max(80),
      objects: z.array(object).min(1).max(500),
    })
    .strict()
    .parse(value);
  const objects = new Map(fragment.objects.map((p) => [p.id, p]));
  if (objects.size !== fragment.objects.length)
    throw new Error('Duplicate fragment object identity');
  for (const p of fragment.objects) {
    const seen = new Set([p.id]);
    let support = p.mount?.to;
    while (support) {
      if (seen.has(support)) throw new Error('Cyclic fragment attachment');
      seen.add(support);
      const parent = objects.get(support);
      if (!parent) throw new Error('Fragment attachment must include its support');
      support = parent.mount?.to;
    }
  }
  return fragment;
}
