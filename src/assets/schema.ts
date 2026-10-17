import { z } from 'zod';
import { cameraContract as contract } from './camera-contract';
import { HEADINGS } from '../content/headings';
import type { ContentSnapshot } from '../content/snapshot';
const finite = z.number().finite();
const positive = finite.positive();
const int = z.number().int().nonnegative();
const pair = z.tuple([finite, finite]);
const rect = z.tuple([int, int, z.number().int().positive(), z.number().int().positive()]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const path = z
  .string()
  .regex(/^[a-zA-Z0-9_/-]+\.(png|json|ktx2)$/)
  .refine(
    (v) => !v.split('/').includes('..') && !v.startsWith('/'),
    'relative approved-root path required',
  );
const notify = z.strictObject({
  id,
  atMs: finite.nonnegative(),
  kind: z.enum(['footstep', 'whoosh', 'flash', 'dust']),
});
const timing = z.strictObject({
  frames: z.array(id).min(1),
  durationsMs: z.array(positive).min(1),
  loop: z.boolean(),
  notifies: z.array(notify),
  endBehavior: z.enum(['hold', 'hide']).optional(),
  markers: z
    .array(z.strictObject({ id: z.string().min(1), atMs: finite.nonnegative() }))
    .optional(),
});
const metadata = z.strictObject({
  id,
  type: z.enum(['character', 'prop', 'material', 'effect']),
  schemaVersion: z.literal(2),
  contentVersion: z.string().min(1),
  viewMode: z
    .enum(['directional', 'four-directional', 'mixed-directional', 'fixed-authored', 'supplied'])
    .optional(),
  projection: z.enum(['painted-cutout', 'projected-world', 'top-down', 'front-view']).optional(),
  allowEmptyFrames: z.boolean().optional(),
  limitations: z.array(z.string()).optional(),
  label: z.string().min(1).optional(),
  category: z.enum(['scenery', 'ground', 'character', 'pickup', 'effect', 'reference']).optional(),
  mirroring: z.boolean().optional(),
  placement: z.enum(['upright', 'ground', 'reference']).optional(),
  layer: z.enum(['world', 'below-actor', 'overlay']).optional(),
  imageRole: z.enum(['image', 'scene-painting']).optional(),
  atlasSize: z.number().int().positive().optional(),
  bundle: z.enum(['hero', 'room']),
  status: z.enum(['diagnostic', 'proxy', 'production']),
  provenance: z.strictObject({
    creator: z.string().min(1),
    license: z.string().min(1),
    source: z.string().min(1),
  }),
  contractId: z.literal(contract.id),
  bakeVersion: z.literal(contract.bakeVersion),
  canvas: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  density: positive,
  anchor: pair,
  padding: int,
  colorSpace: z.literal('srgb'),
  alpha: z.literal('straight'),
  recipe: z.string().min(1),
  sampling: z.enum(['linear', 'terrain-mipmapped']).optional(),
  designReference: z.string().min(1),
  renderStyle: z.string().min(1),
  canonicalReferenceHash: hash.optional(),
  legacyBake: z
    .strictObject({
      contractId: z.string(),
      bakeVersion: z.number().int().positive(),
      azimuthDeg: finite,
      elevationDeg: finite,
      maxProjectionErrorPx: finite.nonnegative(),
      reason: z.string(),
    })
    .optional(),
  renderCategory: z.enum(['cutout', 'opaque', 'translucent']),
  shadow: z.strictObject({ radius: positive, opacity: finite.min(0).max(1) }),
  collisionFootprint: z.enum(['hero-circle-v1', 'actor-definition', 'none']),
  occlusion: z.enum([
    'vertical-plane-preserved-projection-v1',
    'ground-plane-v1',
    'wall-face-v1',
    'camera-card-v1',
  ]),
  fallbacks: z.record(z.string(), z.string()),
  dependencies: z.array(id),
  requiredClips: z.array(id),
  clips: z.record(z.string(), z.partialRecord(z.enum(HEADINGS), timing)),
});
const frameRegistration = z.strictObject({
  canvas: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  density: positive,
  anchor: pair,
});
const sourceFrame = z.strictObject({
  id,
  path,
  origin: z.string().min(1),
  attachments: z.record(z.string(), pair),
  visualOffsetPx: pair.optional(),
  registration: frameRegistration.optional(),
});
const SourceSchema = z.strictObject({
  schemaVersion: z.literal(2),
  asset: metadata,
  frames: z.array(sourceFrame).min(1),
});
const runtimeFrame = sourceFrame
  .omit({ path: true })
  .extend({ source: path, page: id, rect, trim: rect, rotated: z.literal(false) });
const deliveryImage = z.strictObject({
  path,
  hash,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: int,
  gpuBytes: int,
  encoding: z.enum(['png', 'ktx2-uastc']),
  mipmaps: z.boolean(),
  quality: z
    .strictObject({
      rmse: finite.nonnegative(),
      alphaMaxError: int,
      ssim: finite.min(0).max(1).optional(),
    })
    .optional(),
});
const page = z.strictObject({
  id,
  path,
  hash,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: int,
  rgbaBytes: int,
  extrusion: int,
  gutter: int,
  mipmaps: z.boolean(),
  preview: deliveryImage.optional(),
  delivery: z.array(deliveryImage).optional(),
});
const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  contractId: z.literal(contract.id),
  bakeVersion: z.literal(contract.bakeVersion),
  hash,
  toolVersion: z.string(),
  asset: metadata,
  frames: z.array(runtimeFrame),
  pages: z.array(page),
  bundles: z.record(
    z.string(),
    z.strictObject({
      required: z.array(id),
      optional: z.array(id),
      dependencies: z.array(z.string()),
    }),
  ),
});
export type Source = z.infer<typeof SourceSchema>;
export type ManifestDraft = z.infer<typeof ManifestSchema>;
export type Manifest = ContentSnapshot<ManifestDraft>;
export type Frame = Manifest['frames'][number];
export type Clip = ContentSnapshot<z.infer<typeof timing>>;
function validateSemantics(value: Source | Manifest) {
  const a = value.asset;
  if (a.sampling === 'terrain-mipmapped' && a.type !== 'material')
    throw new Error('terrain mipmaps require a material');
  if ('pages' in value)
    for (const p of value.pages)
      if (p.mipmaps) {
        const f = value.frames.filter((f) => f.page === p.id);
        if (
          a.sampling !== 'terrain-mipmapped' ||
          f.length !== 1 ||
          f[0]!.rect.join() !== [0, 0, p.width, p.height].join()
        )
          throw new Error('mipmaps require one complete standalone ground frame per page');
      }
  const ids = new Set<string>(),
    paths = new Set<string>();
  const fail = (field: string, message: string): never => {
    throw new Error(`${a.id}.${field}: ${message}`);
  };
  for (const f of value.frames) {
    const registration = f.registration ?? a;
    if (registration.anchor.some((v, i) => v < 0 || v > registration.canvas[i]!))
      fail(`frames.${f.id}.registration`, 'anchor outside canvas');
    if (ids.has(f.id)) fail(`frames.${f.id}`, 'duplicate ID');
    ids.add(f.id);
    const p = 'path' in f ? f.path : f.source;
    if (paths.has(p.toLowerCase()))
      fail(`frames.${f.id}.path`, 'duplicate or case-colliding source path');
    paths.add(p.toLowerCase());
    for (const [name, point] of Object.entries(f.attachments))
      if (point.some((v, i) => v < 0 || v > registration.canvas[i]!))
        fail(`frames.${f.id}.attachments.${name}`, 'outside original canvas');
    if ('trim' in f) {
      if (
        f.trim[0] + f.trim[2] > registration.canvas[0] ||
        f.trim[1] + f.trim[3] > registration.canvas[1]
      )
        fail(`frames.${f.id}.trim`, 'outside source canvas');
      const m = value as Manifest,
        p = m.pages.find((p) => p.id === f.page);
      if (
        !p ||
        f.rect[0] + f.rect[2] > p.width ||
        f.rect[1] + f.rect[3] > p.height ||
        f.rect[2] !== f.trim[2] ||
        f.rect[3] !== f.trim[3]
      )
        fail(`frames.${f.id}.rect`, 'missing page or invalid atlas bounds');
    }
  }
  if (a.anchor.some((v, i) => v < 0 || v > a.canvas[i]!))
    fail('anchor', 'outside untrimmed canvas');
  for (const required of a.requiredClips)
    if (!Object.hasOwn(a.clips, required)) fail('requiredClips', `missing ${required}`);
  if (a.allowEmptyFrames && a.type !== 'effect')
    fail('allowEmptyFrames', 'only effects permit transparent timeline frames');
  if (
    a.viewMode === 'fixed-authored' &&
    Object.values(a.clips).some((d) => Object.keys(d).some((k) => k !== 'd45'))
  )
    fail('viewMode', 'fixed authored views declare only their single d45 storage slot');
  for (const [clip, dirs] of Object.entries(a.clips)) {
    const required =
      a.viewMode === 'supplied'
        ? []
        : a.viewMode === 'fixed-authored'
          ? ['d45']
          : a.viewMode === 'four-directional' ||
              (a.viewMode === 'mixed-directional' && clip !== 'walk')
            ? ['d00', 'd90', 'd180', 'd270']
            : HEADINGS;
    for (const dir of required)
      if (!Object.hasOwn(dirs, dir))
        fail(`clips.${clip}.${dir}`, 'missing required heading; mirroring forbidden');
    for (const [dir, c] of Object.entries(dirs)) {
      if (c.loop && c.endBehavior === 'hide')
        fail(`clips.${clip}.${dir}`, 'loop cannot hide at its end');
      if (c.frames.length !== c.durationsMs.length)
        fail(`clips.${clip}.${dir}`, 'duration count differs from frame count');
      for (const f of c.frames) if (!ids.has(f)) fail(`clips.${clip}.${dir}`, `missing frame ${f}`);
      const end = c.durationsMs.reduce((x, y) => x + y, 0);
      if (!Number.isFinite(end)) fail(`clips.${clip}.${dir}`, 'non-finite clip duration');
      const seen = new Set<string>();
      for (const n of c.notifies) {
        if (n.atMs >= end || seen.has(n.id))
          fail(`clips.${clip}.${dir}.notifies`, 'event outside clip or duplicate ID');
        seen.add(n.id);
      }
      seen.clear();
      for (const marker of c.markers ?? []) {
        if (marker.atMs > end || seen.has(marker.id))
          fail(`clips.${clip}.${dir}.markers`, 'marker outside clip or duplicate ID');
        seen.add(marker.id);
      }
    }
  }
  if (Object.values(a.clips).some((dirs) => !Object.keys(dirs).length))
    fail('clips', 'empty heading coverage');
  for (const [key, to] of Object.entries(a.fallbacks))
    if (!Object.hasOwn(a.clips, to) || Object.hasOwn(a.clips, key))
      fail('fallbacks', 'fallback target missing or overrides supported clip');
  if ('pages' in value) {
    const seen = new Set<string>(),
      pagePaths = new Set<string>();
    for (const p of value.pages) {
      if (
        seen.has(p.id) ||
        pagePaths.has(p.path.toLowerCase()) ||
        p.rgbaBytes !== p.width * p.height * 4
      )
        fail('pages', 'duplicate, case-colliding or invalid byte estimate');
      seen.add(p.id);
      pagePaths.add(p.path.toLowerCase());
    }
    for (const [name, b] of Object.entries(value.bundles)) {
      for (const p of b.required)
        if (!seen.has(p)) fail(`bundles.${name}`, `missing required resource ${p}`);
      for (const dep of b.dependencies)
        if (!Object.hasOwn(value.bundles, dep))
          fail(`bundles.${name}`, `missing dependency ${dep}`);
    }
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (name: string) => {
      if (visiting.has(name)) fail('bundles', 'cyclic dependency');
      if (visited.has(name)) return;
      visiting.add(name);
      for (const dep of value.bundles[name]!.dependencies) visit(dep);
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of Object.keys(value.bundles)) visit(name);
    for (const dep of a.dependencies)
      if (!seen.has(dep)) fail('dependencies', `missing asset resource ${dep}`);
  } else if (a.dependencies.length)
    fail(
      'dependencies',
      'this single-character source format requires self-contained staged inputs',
    );
}
export { resolveClip, resolveActorClip } from './clips';
export function parseSource(data: unknown) {
  const s = SourceSchema.parse(data);
  validateSemantics(s);
  return s;
}
export function parseManifest(data: unknown): ManifestDraft {
  const m = ManifestSchema.parse(data);
  validateSemantics(m);
  return m;
}
