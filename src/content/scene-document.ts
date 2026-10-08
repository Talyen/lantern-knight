import { z } from 'zod';
import type { ArtPlacement, WorldVisualDefinition } from './world-art';
import type { Manifest } from '../assets/schema';
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const coordinate = z.number().finite().min(-1000).max(1000);
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
const change = z.object({ id, ...transform, deleted: z.boolean().optional() }).strict();
const object = z
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
export const SceneDocumentSchema = z
  .object({
    version: z.literal(1),
    id,
    name: z.string().trim().min(1).max(80),
    base: z.enum(['flat', 'court', 'upper-landing']),
    target: z.enum(['draft', 'live']),
    floor: z
      .object({
        asset: z.string(),
        clip: z.string(),
        width: z.number().finite().min(2).max(100),
        depth: z.number().finite().min(2).max(100),
      })
      .strict()
      .optional(),
    changes: z.array(change).max(500),
    objects: z.array(object).max(500),
    hero: z.object({ x: coordinate, z: coordinate }).strict(),
    look: z
      .object({
        rig: z.enum(['golden', 'silver']),
        look: z.enum(['ink', 'diorama', 'cinematic']),
      })
      .strict(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.base === 'flat' && (!d.floor || d.target === 'live' || d.changes.length))
      ctx.addIssue({
        code: 'custom',
        message: 'Flat drafts require a floor and cannot override an existing room',
      });
    if (d.base !== 'flat' && d.floor)
      ctx.addIssue({
        code: 'custom',
        message: 'Existing room foundations are locked',
      });
    if (d.target === 'live' && d.id !== `live-${d.base}`)
      ctx.addIssue({
        code: 'custom',
        message: 'Live documents use the room identity',
      });
    if (d.target === 'draft' && d.id.startsWith('live-'))
      ctx.addIssue({
        code: 'custom',
        message: 'Draft names cannot use live identities',
      });
    for (const list of [d.changes, d.objects])
      if (new Set(list.map((p) => p.id)).size !== list.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate object identity' });
  });
export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type SceneObject = SceneDocument['objects'][number];
export const sceneBytesLimit = 64 * 1024;
export function parseSceneDocument(value: unknown) {
  return SceneDocumentSchema.parse(value);
}
export function editablePlacement(p: ArtPlacement, art: WorldVisualDefinition) {
  return (
    !p.mount &&
    !p.wallFace &&
    !p.door &&
    !p.flame &&
    !p.light &&
    !(art.fixtures ?? []).some((f) => f.prop === p.id)
  );
}
export function placementAsset(p: ArtPlacement, kind: 'prop' | 'decal') {
  return p.asset;
}
export function paletteKind(m: Manifest): 'prop' | 'decal' | undefined {
  if (m.asset.status === 'diagnostic' || m.asset.renderStyle !== 'clean-ink') return;
  if (m.asset.projection === 'top-down' && (m.asset.type === 'prop' || m.asset.type === 'material'))
    return 'decal';
  if (m.asset.type === 'prop' && m.asset.projection === 'painted-cutout') return 'prop';
}
export function paletteClips(m: Manifest) {
  return Object.entries(m.asset.clips)
    .filter(([, directions]) => directions.d45?.frames.length === 1)
    .map(([clip]) => clip);
}
export function floorClips(m: Manifest) {
  return m.asset.type === 'material' &&
    m.asset.projection === 'top-down' &&
    m.asset.status !== 'diagnostic'
    ? paletteClips(m)
    : [];
}
export function validateSceneReferences(
  d: SceneDocument,
  base: WorldVisualDefinition | undefined,
  manifests?: ReadonlyMap<string, Manifest>,
) {
  const placements = base ? [...base.props, ...base.decals] : [];
  for (const c of d.changes) {
    const p = placements.find((p) => p.id === c.id);
    if (!p || !base || !editablePlacement(p, base))
      throw new Error(`Locked or unavailable object: ${c.id}`);
    if (base.props.includes(p) && c.rotation !== undefined)
      throw new Error('Upright artwork has a fixed authored facing');
  }
  const ids = new Set([
    ...placements.map((p) => p.id),
    ...(base?.walls.map((w) => w.id) ?? []),
    ...(base?.fixtures?.map((f) => f.id) ?? []),
  ]);
  for (const p of d.objects) {
    if (ids.has(p.id)) throw new Error(`Object identity already exists: ${p.id}`);
    ids.add(p.id);
    if (p.kind === 'prop' && p.rotation !== undefined)
      throw new Error('Upright artwork has a fixed authored facing');
    if (manifests) {
      const m = manifests.get(p.asset);
      if (!m || paletteKind(m) !== p.kind || !paletteClips(m).includes(p.clip))
        throw new Error(`Unavailable scenery: ${p.asset}/${p.clip}`);
    }
  }
  if (d.floor && manifests) {
    const m = manifests.get(d.floor.asset);
    if (!m || !floorClips(m).includes(d.floor.clip)) throw new Error('Unavailable ground material');
  }
}
export function resolveSceneDocument(
  d: SceneDocument,
  base?: WorldVisualDefinition,
): WorldVisualDefinition {
  validateSceneReferences(d, base);
  const f = d.floor;
  const source = base ?? {
    floor: f!.asset,
    props: [],
    decals: [],
    walls: [],
    paths: [],
    graves: [],
    patches: [],
    lights: [],
    assemblies: [],
    proceduralAssets: [],
    camera: {
      bounds: {
        minX: -f!.width / 2,
        maxX: f!.width / 2,
        minZ: -f!.depth / 2,
        maxZ: f!.depth / 2,
      },
      bias: { x: 0, z: 0 },
    },
  };
  const apply = (items: readonly ArtPlacement[]) =>
    items.flatMap((p) => {
      const c = d.changes.find((c) => c.id === p.id);
      if (c?.deleted) return [];
      if (!c) return [p];
      const { id: _, deleted: __, ...fields } = c;
      return [{ ...p, ...fields }];
    });
  const added = (kind: 'prop' | 'decal') =>
    d.objects
      .filter((p) => p.kind === kind)
      .map(({ kind: _, ...p }) => ({
        ...p,
        purpose: 'Scene editor scenery',
        shadow: p.shadow ?? ('none' as const),
      }));
  const props = [...apply(source.props), ...added('prop')],
    decals = [...apply(source.decals), ...added('decal')];
  return {
    ...source,
    props,
    decals,
    editorFloor: f ? { asset: f.asset, clip: f.clip } : undefined,
    look: d.look,
    proceduralAssets: source.proceduralAssets,
  };
}
export function emptyScene(base: SceneDocument['base'] = 'flat'): SceneDocument {
  return {
    version: 1,
    id: 'untitled',
    name:
      base === 'flat'
        ? 'Untitled scene'
        : `Copy of ${base === 'court' ? 'Graveyard Approach' : 'Ruined Chapel'}`,
    base,
    target: 'draft',
    ...(base === 'flat'
      ? { floor: { asset: 'ink-moss', clip: 'surface', width: 20, depth: 20 } }
      : {}),
    changes: [],
    objects: [],
    hero: { x: 0, z: 0 },
    look: { rig: 'golden', look: 'diorama' },
  };
}
