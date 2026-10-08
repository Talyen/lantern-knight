import fs from 'node:fs/promises';
import path from 'node:path';
import { assetCatalog } from '../../src/content/asset-catalog';
import { playgroundCatalog } from '../../src/content/effects-playground-assets';
import { worldVisuals, sceneAssets } from '../../src/content/world-art';
import { readLock, ensurePack, validatePack, recipeInputs } from './pack';
import type { PreparedAssets } from './publication';
import { actorVisuals } from '../../src/content/visuals';
import { createHash } from 'node:crypto';

export const phases = [
  'regular local checks',
  'Game build',
  'Dev build',
  'Game identity',
  'Dev identity',
  'Game package',
  'Dev package',
  'animation smoke',
  'hero smoke',
  'lighting smoke',
  'Game smoke',
  'Effects smoke',
  'Graveyard scene',
  'Chapel scene',
] as const;
export type Phase = (typeof phases)[number];
export type ValidationPlan = {
  full: boolean;
  reasons: string[];
  phases: Phase[];
};
export type AssetChanges = {
  assets: string[];
  animation?: boolean;
  coverage?: boolean;
  lighting?: boolean;
  effects?: boolean;
  shared?: boolean;
  unknown?: boolean;
};
export function selectValidation(
  changes: AssetChanges,
  rooms: Record<string, readonly string[]>,
  full = false,
): ValidationPlan {
  const reasons: string[] = [],
    selected = new Set<Phase>(phases.slice(0, 5));
  const fallback = full || changes.shared || changes.unknown;
  if (fallback)
    return {
      full: true,
      reasons: [
        full
          ? 'Explicit full validation'
          : changes.shared
            ? 'Shared preparation inputs changed'
            : 'Unknown change or unavailable baseline',
      ],
      phases: [...phases],
    };
  if (changes.assets.some((id) => Object.values(actorVisuals).some((v) => v.asset === id))) {
    selected.add('Game package');
    selected.add('Game smoke');
    reasons.push('Runtime actor asset');
  }
  const hero = changes.animation || changes.assets.some((id) => id === 'ink-hero-current');
  if (hero) {
    reasons.push('Hero artwork, animation or registration');
    for (const phase of [
      'Game package',
      'Dev package',
      'animation smoke',
      'hero smoke',
      'lighting smoke',
      'Game smoke',
    ] as const)
      selected.add(phase);
  }
  if (changes.lighting) {
    reasons.push('Lighting companions or surface relief');
    selected.add('Dev package');
    selected.add('lighting smoke');
  }
  const effects =
    changes.effects || changes.assets.some((id) => id in playgroundCatalog || id.startsWith('fx-'));
  if (effects) {
    reasons.push('Effects assets or emitters');
    selected.add('Dev package');
    selected.add('Effects smoke');
  }
  const runtimeEffects = changes.assets.some((id) => id.startsWith('fx-') && id in assetCatalog);
  if (runtimeEffects) {
    selected.add('Game package');
    selected.add('Game smoke');
  }
  for (const [scene, ids] of Object.entries(rooms)) {
    if (changes.coverage || runtimeEffects || changes.assets.some((id) => ids.includes(id))) {
      const phase =
        scene === 'court'
          ? 'Graveyard scene'
          : scene === 'upper-landing'
            ? 'Chapel scene'
            : undefined;
      if (!phase)
        return {
          full: true,
          reasons: ['Unrecognized consuming room'],
          phases: [...phases],
        };
      selected.add(phase);
      reasons.push('Affected room: ' + scene);
    }
  }
  if (!reasons.length)
    reasons.push('No visual payload changes; integrity and both builds remain required');
  return {
    full: false,
    reasons,
    phases: phases.filter((phase) => selected.has(phase)),
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export async function candidateValidationPlan(
  candidate: PreparedAssets,
  full = false,
): Promise<ValidationPlan> {
  const rooms = Object.fromEntries(
    Object.entries(worldVisuals).map(([id, art]) => [id, sceneAssets(art)]),
  );
  if (full) return selectValidation({ assets: [] }, rooms, true);
  let baseline: Awaited<ReturnType<typeof ensurePack>> | undefined;
  try {
    baseline = await ensurePack(await readLock());
    const old = await validatePack(baseline.root, await readLock()),
      next = await validatePack(candidate.payload, candidate.lock);
    const json = (root: string, file: string) =>
      fs.readFile(path.join(root, file), 'utf8').then(JSON.parse);
    const beforeInputs = (await json(baseline.root, 'metadata/preparation-inputs.json')) as Record<
        string,
        string
      >,
      afterInputs = await recipeInputs();
    if (
      createHash('sha256').update(JSON.stringify(beforeInputs)).digest('hex') !== old.recipeSha256
    )
      return selectValidation({ assets: [], unknown: true }, rooms);
    const changedInputs = [
      ...new Set([...Object.keys(beforeInputs), ...Object.keys(afterInputs)]),
    ].filter((file) => beforeInputs[file] !== afterInputs[file]);
    // Only small authored recipes have proven family ownership. Helper/catalog changes stay full.
    const owned = new Set([
      'authoring/hero-actions.json',
      'authoring/hero-motion.json',
      'authoring/graveyard-art.json',
      'authoring/chapel-art.json',
      'authoring/ground-overlays.json',
      'authoring/surface-depth.json',
    ]);
    if (changedInputs.some((file) => !owned.has(file)))
      return selectValidation({ shared: true, assets: [] }, rooms);
    const changes: AssetChanges = {
      assets: [],
      animation: changedInputs.some((f) => f.includes('hero-')),
      lighting: changedInputs.includes('authoring/surface-depth.json'),
    };
    const owners = new Map<string, Set<string>>();
    for (const root of [baseline.root, candidate.payload])
      for (const [id, file] of Object.entries({
        ...assetCatalog,
        ...playgroundCatalog,
      })) {
        const absolute = 'public/' + file;
        const manifest = await json(root, absolute).catch(() => undefined);
        const files = [
          absolute,
          ...(manifest?.pages ?? []).map(
            (p: { path: string }) => 'public/' + path.posix.join(path.posix.dirname(file), p.path),
          ),
        ];
        for (const name of files) {
          const ids = owners.get(name) ?? new Set();
          ids.add(id);
          owners.set(name, ids);
        }
      }
    const changedFiles = [
      ...new Set([...Object.keys(old.files), ...Object.keys(next.files)]),
    ].filter((file) => old.files[file]?.sha256 !== next.files[file]?.sha256);
    for (const file of changedFiles) {
      const ids = owners.get(file);
      if (ids) {
        changes.assets.push(...ids);
        continue;
      }
      if (file === 'metadata/preparation-inputs.json') continue;
      if (file === 'public/build-mode.json') {
        const a = await json(baseline.root, file),
          b = await json(candidate.payload, file);
        delete a.registrationHash;
        delete b.registrationHash;
        if (!same(a, b)) changes.shared = true;
        continue;
      }
      if (file === 'public/registration.json') {
        const a = await json(baseline.root, file),
          b = await json(candidate.payload, file);
        if (!same(a.animation, b.animation)) changes.animation = true;
        if (!same(a.coverage, b.coverage)) changes.coverage = true;
        if (a.schemaVersion !== b.schemaVersion) changes.shared = true;
      } else if (file.startsWith('public/animation/')) changes.animation = true;
      else if (file.startsWith('public/lighting/')) changes.lighting = true;
      else if (file === 'public/visual-effects/surfaces.json') {
        changes.lighting = true;
        const a = await json(baseline.root, file),
          b = await json(candidate.payload, file);
        for (const entry of [...Object.values(a.entries), ...Object.values(b.entries)] as {
          asset?: string;
        }[])
          if (entry.asset) changes.assets.push(entry.asset);
          else changes.coverage = true;
      } else if (file.startsWith('public/visual-effects/')) {
        changes.lighting = true;
        changes.coverage = true;
      } else if (file.startsWith('public/dev-effects/')) changes.effects = true;
      else if (file === 'metadata/ink/hero-receipt.json' || file === 'metadata/rest/receipt.json')
        changes.animation = true;
      else if (
        file === 'metadata/ink/graveyard-art-receipt.json' ||
        file === 'metadata/ink/tended-art-receipt.json' ||
        file === 'metadata/ink/graveyard-ground-receipt.json'
      )
        changes.coverage = true;
      else if (file === 'metadata/effects-playground/receipt.json') changes.effects = true;
      else changes.unknown = true;
    }
    return selectValidation(changes, rooms);
  } catch {
    return selectValidation({ assets: [], unknown: true }, rooms);
  } finally {
    await baseline?.release();
  }
}
