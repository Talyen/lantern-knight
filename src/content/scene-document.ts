import { z } from 'zod';
import type { ArtPlacement, WorldVisualDefinition } from './world-art';
import type { Manifest } from '../assets/schema';
import { placementOffset } from './scenery-presets';
import { migrateSceneV1 } from './scene-v1';
import { HEADINGS } from '../core/camera';
import { deriveScenePlacement, validateSceneDesign, paletteEntry } from './scene-design';
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
const legacyObject = z
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
const object = legacyObject
  .extend({
    kind: z.enum(['prop', 'decal', 'character', 'effect']),
    heading: z.enum(HEADINGS).optional(),
    x: coordinate.optional(),
    z: coordinate.optional(),
    purpose: z.string().min(1).optional(),
    footprint: z.tuple([positive, positive]).optional(),
    footprintAngle: coordinate.optional(),
    coverage: z.string().optional(),
    assembly: z.string().optional(),
    zone: z.string().optional(),
    emissive: z.boolean().optional(),
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
const fields = {
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
  hero: z.object({ x: coordinate, z: coordinate }).strict(),
  look: z
    .object({ rig: z.enum(['golden', 'silver']), look: z.enum(['ink', 'diorama', 'cinematic']) })
    .strict(),
};
function documentRules(
  d: { base: string; floor?: unknown; target: string; id: string; objects: { id: string }[] },
  ctx: z.RefinementCtx,
) {
  if (d.base === 'flat' && (!d.floor || d.target === 'live'))
    ctx.addIssue({
      code: 'custom',
      message: 'Flat drafts require a floor and cannot override an existing room',
    });
  if (d.base !== 'flat' && d.floor)
    ctx.addIssue({ code: 'custom', message: 'Existing room foundations are locked' });
  if (d.target === 'live' && d.id !== `live-${d.base}`)
    ctx.addIssue({ code: 'custom', message: 'Live documents use the room identity' });
  if (d.target === 'draft' && d.id.startsWith('live-'))
    ctx.addIssue({ code: 'custom', message: 'Draft names cannot use live identities' });
  if (new Set(d.objects.map((p) => p.id)).size !== d.objects.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate object identity' });
}
const SceneDocumentSchema = z
  .object({
    version: z.literal(4),
    profile: z.enum(['graveyard', 'chapel', 'study']),
    ...fields,
    objects: z.array(object).max(500),
  })
  .strict()
  .superRefine((d, ctx) => {
    documentRules(d, ctx);
    if (
      d.profile === 'study'
        ? d.base !== 'flat' || d.target !== 'draft'
        : d.base !== 'flat' && d.profile !== (d.base === 'court' ? 'graveyard' : 'chapel')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Scene design profile does not match its production foundation',
      });
    if (d.profile !== 'study')
      for (const p of d.objects)
        if (p.footprint !== undefined || p.footprintAngle !== undefined || p.coverage !== undefined)
          ctx.addIssue({
            code: 'custom',
            message: 'Scenery registration comes from the curated palette, not placements',
          });
  });
const legacySchema = z
  .object({
    version: z.literal(1),
    ...fields,
    changes: z
      .array(z.object({ id, ...transform, deleted: z.boolean().optional() }).strict())
      .max(500),
    objects: z.array(legacyObject).max(500),
  })
  .strict()
  .superRefine((d, ctx) => {
    documentRules(d, ctx);
    if (new Set(d.changes.map((p) => p.id)).size !== d.changes.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate object identity' });
    if (d.base === 'flat' && d.changes.length)
      ctx.addIssue({ code: 'custom', message: 'Flat drafts cannot override an existing room' });
  });
export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type SceneObject = SceneDocument['objects'][number];
export const sceneBytesLimit = 64 * 1024;
export function parseSceneDocument(value: unknown): SceneDocument {
  if ([1, 2, 3].includes((value as { version?: number })?.version ?? 0))
    throw new Error(
      'Legacy scene requires explicit conversion to version 4 and a design profile; artwork and transforms are not silently changed',
    );
  return SceneDocumentSchema.parse(value);
}
export function convertLegacySceneDocument(
  value: unknown,
  profile: SceneDocument['profile'],
): SceneDocument {
  let prior = value as { version?: number; objects?: unknown[] };
  if (prior.version === 1) prior = migrateSceneV1(legacySchema.parse(prior));
  if (![2, 3].includes(prior.version ?? 0) || !Array.isArray(prior.objects))
    throw new Error('Unsupported legacy scene');
  if (
    prior.version === 2 &&
    prior.objects.some(
      (p) =>
        !p ||
        typeof p !== 'object' ||
        !['prop', 'decal'].includes((p as { kind: string }).kind) ||
        (p as { heading?: unknown }).heading !== undefined,
    )
  )
    throw new Error('Invalid version 2 scene objects');
  const result = parseSceneDocument({ ...prior, version: 4, profile });
  resolveSceneDocument(result);
  return result;
}
export type PaletteKind = SceneObject['kind'];
export function paletteKind(m: Manifest): PaletteKind | undefined {
  if (m.asset.status === 'diagnostic' || m.asset.renderStyle !== 'clean-ink') return;
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
  base: WorldVisualDefinition | undefined,
  manifests?: ReadonlyMap<string, Manifest>,
) {
  const ids = new Set([
    ...(base?.props ?? []).map((p) => p.id),
    ...(base?.decals ?? []).map((p) => p.id),
    ...(base?.walls ?? []).map((p) => p.id),
  ]);
  for (const p of d.objects) {
    if (
      d.profile !== 'study' &&
      p.kind !== (paletteEntry(p)?.category === 'ground-panel' ? 'decal' : 'prop')
    )
      throw new Error(`${p.id}: object kind differs from curated scene artwork`);
    if (ids.has(p.id)) throw new Error('Locked or duplicate object identity: ' + p.id);
    ids.add(p.id);
    if (p.kind !== 'decal' && p.rotation !== undefined)
      throw new Error('Upright artwork has a fixed authored facing');
    if (manifests) {
      const m = manifests.get(p.asset);
      if (!m || paletteKind(m) !== p.kind || !paletteClips(m).includes(p.clip))
        throw new Error(`Unavailable scenery: ${p.asset}/${p.clip}`);
      const heading = p.heading ?? 'd45';
      if (!m.asset.clips[p.clip]?.[heading])
        throw new Error(`Unavailable facing: ${p.asset}/${p.clip}/${heading}`);
      if (
        p.mirror &&
        (m.asset.mirroring === false ||
          (m.asset.type === 'character' && m.asset.mirroring !== true))
      )
        throw new Error(`Mirroring unavailable: ${p.asset}`);
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

    proceduralAssets: [],
    camera: {
      bounds: { minX: -f!.width / 2, maxX: f!.width / 2, minZ: -f!.depth / 2, maxZ: f!.depth / 2 },
      bias: { x: 0, z: 0 },
    },
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
    if (d.profile !== 'study') placement = deriveScenePlacement(placement);
    resolved.set(id, placement);
    return placement;
  };
  const props = [...source.props, ...d.objects.filter((p) => p.kind !== 'decal')].map((p) =>
    resolve(p.id),
  );
  const order = new Map((base?.propOrder ?? []).map((id, i) => [id, i]));
  props.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  const decals = [...source.decals, ...d.objects.filter((p) => p.kind === 'decal')].map((p) =>
    resolve(p.id),
  );
  const art: WorldVisualDefinition = {
    ...source,
    designProfile: d.profile === 'study' ? undefined : d.profile,
    props,
    decals,
    editorFloor: f ? { asset: f.asset, clip: f.clip } : undefined,
    look: d.look,
  };
  if (art.designProfile) validateSceneDesign(art);
  return art;
}
