import { z } from 'zod';
import { contract, HEADINGS } from '../core/camera';
const finite = z.number().finite();
const positive = finite.positive();
const int = z.number().int().nonnegative();
const pair = z.tuple([finite, finite]);
const rect = z.tuple([int, int, z.number().int().positive(), z.number().int().positive()]);
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const path = z
  .string()
  .regex(/^[a-zA-Z0-9_/-]+\.(png|json)$/)
  .refine(
    (v) => !v.split('/').includes('..') && !v.startsWith('/'),
    'relative approved-root path required',
  );
const notify = z
  .object({ id, atMs: finite.nonnegative(), kind: z.enum(['footstep', 'whoosh', 'flash', 'dust']) })
  .strict();
const timing = z
  .object({
    frames: z.array(id).min(1),
    durationsMs: z.array(positive).min(1),
    loop: z.boolean(),
    notifies: z.array(notify),
  })
  .strict();
const metadata = z
  .object({
    id,
    type: z.enum(['character', 'prop', 'material', 'effect']),
    schemaVersion: z.literal(2),
    contentVersion: z.string().min(1),
    viewMode: z
      .enum(['directional', 'four-directional', 'mixed-directional', 'fixed-authored'])
      .optional(),
    projection: z.enum(['painted-cutout', 'projected-world', 'top-down', 'front-view']).optional(),
    allowEmptyFrames: z.boolean().optional(),
    limitations: z.array(z.string()).optional(),
    atlasSize: z.number().int().min(64).max(contract.atlasMaxSize).optional(),
    bundle: z.enum(['hero', 'room']),
    status: z.enum(['diagnostic', 'proxy', 'production']),
    provenance: z
      .object({ creator: z.string().min(1), license: z.string().min(1), source: z.string().min(1) })
      .strict(),
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
    designReference: z.enum([
      'engineering-placeholder',
      'collection-study',
      'libfile_0da5071239448191b6962495ce1e0164',
    ]),
    renderStyle: z.enum(['diagnostic', 'clean-ink']),
    canonicalReferenceHash: z.string().length(64).optional(),
    legacyBake: z
      .object({
        contractId: z.string(),
        bakeVersion: z.number().int().positive(),
        azimuthDeg: finite,
        elevationDeg: finite,
        maxProjectionErrorPx: finite.nonnegative(),
        reason: z.string(),
      })
      .strict()
      .optional(),
    renderCategory: z.enum(['cutout', 'opaque', 'translucent']),
    shadow: z.object({ radius: positive, opacity: finite.min(0).max(1) }).strict(),
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
  })
  .strict();
const frameRegistration = z
  .object({
    canvas: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    density: positive,
    anchor: pair,
  })
  .strict();
const sourceFrame = z
  .object({
    id,
    path,
    origin: z.enum(['diagnostic', 'blender-proxy', 'imported-study', 'production']),
    attachments: z.record(z.string(), pair),
    visualOffsetPx: pair.optional(),
    registration: frameRegistration.optional(),
  })
  .strict();
export const SourceSchema = z
  .object({ schemaVersion: z.literal(2), asset: metadata, frames: z.array(sourceFrame).min(1) })
  .strict();
const runtimeFrame = sourceFrame
  .omit({ path: true })
  .extend({ source: path, page: id, rect, trim: rect, rotated: z.literal(false) })
  .strict();
const page = z
  .object({
    id,
    path,
    hash: z.string().length(64),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: int,
    rgbaBytes: int,
    extrusion: int,
    gutter: int,
    mipmaps: z.boolean(),
  })
  .strict();
export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    contractId: z.literal(contract.id),
    bakeVersion: z.literal(contract.bakeVersion),
    hash: z.string().length(64),
    toolVersion: z.string(),
    asset: metadata,
    frames: z.array(runtimeFrame),
    pages: z.array(page),
    bundles: z.record(
      z.string(),
      z
        .object({ required: z.array(id), optional: z.array(id), dependencies: z.array(z.string()) })
        .strict(),
    ),
  })
  .strict();
export type Source = z.infer<typeof SourceSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Frame = Manifest['frames'][number];
export type Clip = z.infer<typeof timing>;
export function validateSemantics(value: Source | Manifest, production = false) {
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
    if (!a.clips[required]) fail('requiredClips', `missing ${required}`);
  if (a.allowEmptyFrames && a.type !== 'effect')
    fail('allowEmptyFrames', 'only effects permit transparent timeline frames');
  if (
    a.viewMode === 'fixed-authored' &&
    Object.values(a.clips).some((d) => Object.keys(d).some((k) => k !== 'd45'))
  )
    fail('viewMode', 'fixed authored views declare only their single d45 storage slot');
  if (a.viewMode === 'fixed-authored' && a.status === 'production')
    fail('viewMode', 'fixed authored studies are development-only');
  for (const [clip, dirs] of Object.entries(a.clips))
    for (const dir of a.viewMode === 'fixed-authored'
      ? (['d45'] as const)
      : a.viewMode === 'four-directional' || (a.viewMode === 'mixed-directional' && clip !== 'walk')
        ? (['d00', 'd90', 'd180', 'd270'] as const)
        : HEADINGS) {
      const c =
        dirs[dir] ?? fail(`clips.${clip}.${dir}`, 'missing required heading; mirroring forbidden');
      if (c.loop && /(death|hit|dodge|sweep|lunge)$|attack_sword_|cast_lantern_flare/.test(clip))
        fail(`clips.${clip}.${dir}.loop`, 'action and death clips must not loop');
      if (c.frames.length !== c.durationsMs.length)
        fail(`clips.${clip}.${dir}`, 'duration count differs from frame count');
      for (const f of c.frames) if (!ids.has(f)) fail(`clips.${clip}.${dir}`, `missing frame ${f}`);
      const end = c.durationsMs.reduce((x, y) => x + y, 0),
        seen = new Set<string>();
      for (const n of c.notifies) {
        if (n.atMs >= end || seen.has(n.id))
          fail(`clips.${clip}.${dir}.notifies`, 'event outside clip or duplicate ID');
        seen.add(n.id);
      }
    }
  for (const [key, to] of Object.entries(a.fallbacks))
    if (!a.clips[to] || a.clips[key])
      fail('fallbacks', 'fallback target missing or overrides supported clip');
  if ('pages' in value) {
    const seen = new Set<string>(),
      pagePaths = new Set<string>();
    for (const p of value.pages) {
      if (
        seen.has(p.id) ||
        pagePaths.has(p.path.toLowerCase()) ||
        p.width > contract.atlasMaxSize ||
        p.height > contract.atlasMaxSize ||
        p.rgbaBytes !== p.width * p.height * 4
      )
        fail('pages', 'duplicate, case-colliding, oversized or invalid byte estimate');
      seen.add(p.id);
      pagePaths.add(p.path.toLowerCase());
    }
    for (const [name, b] of Object.entries(value.bundles)) {
      for (const p of b.required)
        if (!seen.has(p)) fail(`bundles.${name}`, `missing required resource ${p}`);
      for (const dep of b.dependencies)
        if (!value.bundles[dep]) fail(`bundles.${name}`, `missing dependency ${dep}`);
    }
    const visit = (name: string, chain: string[]) => {
      if (chain.includes(name)) fail('bundles', 'cyclic dependency');
      for (const dep of value.bundles[name]!.dependencies) visit(dep, [...chain, name]);
    };
    for (const name of Object.keys(value.bundles)) visit(name, []);
    for (const dep of a.dependencies)
      if (!seen.has(dep)) fail('dependencies', `missing asset resource ${dep}`);
  } else if (a.dependencies.length)
    fail(
      'dependencies',
      'this single-character source format requires self-contained staged inputs',
    );
  if (
    a.legacyBake &&
    (a.status === 'production' ||
      a.legacyBake.maxProjectionErrorPx > 0.001 ||
      Math.abs(a.legacyBake.azimuthDeg - contract.azimuthDeg) > 1e-6 ||
      Math.abs(a.legacyBake.elevationDeg - contract.elevationDeg) > 1e-6)
  )
    fail(
      'legacyBake',
      'historical bakes may only be revalidated for negligible precision changes in development',
    );
  if (
    production &&
    (a.status !== 'production' ||
      contract.approval !== 'approved' ||
      a.legacyBake ||
      !a.canonicalReferenceHash ||
      a.designReference !== 'libfile_0da5071239448191b6962495ce1e0164' ||
      a.renderStyle !== 'clean-ink' ||
      value.frames.some((f) => f.origin !== 'production'))
  )
    fail(
      'status',
      'production requires canonical Rust/Clean INK source and production frames; placeholders are development-only',
    );
}
export function resolveClip(
  manifest: Manifest,
  id: string,
  heading: (typeof HEADINGS)[number],
): Clip {
  const key = manifest.asset.clips[id] ? id : (manifest.asset.fallbacks[id] ?? id);
  const direction =
    manifest.asset.viewMode === 'fixed-authored'
      ? 'd45'
      : manifest.asset.viewMode === 'four-directional' ||
          (manifest.asset.viewMode === 'mixed-directional' && key !== 'walk')
        ? HEADINGS[(Math.floor((HEADINGS.indexOf(heading) + 1) / 2) * 2) % 8]!
        : heading;
  const clip = manifest.asset.clips[key]?.[direction];
  if (!clip) throw new Error(`required clip unavailable: ${manifest.asset.id}/${id}/${direction}`);
  return clip;
}
export function parseSource(data: unknown, production = false) {
  const s = SourceSchema.parse(data);
  validateSemantics(s, production);
  return s;
}
export function parseManifest(data: unknown, production = false) {
  const m = ManifestSchema.parse(data);
  validateSemantics(m, production);
  return m;
}
