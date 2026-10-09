import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { GameSession } from '../../src/core/session';
import { Persistence } from '../../src/core/persistence';
import { parseGame } from '../../src/core/save';
import { type ContentRegistry } from '../../src/content/world';
import { content } from '../../src/content/game-content';
import { AssetCache } from '../assets/cache';
import { digest, sourceIdentity } from '../source-identity';

const point = z.object({ x: z.number().finite(), z: z.number().finite() }).strict();
const command = z
  .object({
    move: point,
    aim: point,
    attack: z.boolean().optional(),
    ability: z.boolean().optional(),
    dodge: z.boolean().optional(),
    generation: z.number().int().nonnegative().optional(),
  })
  .strict();
const action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('step'), ticks: z.number().int().min(1).max(3600), command }).strict(),
  z.object({ kind: z.literal('save') }).strict(),
  z.object({ kind: z.literal('load') }).strict(),
  z.object({ kind: z.literal('reset') }).strict(),
]);
export const RecipeSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff).default(142),
    initialSave: z.unknown().optional(),
    actions: z.array(action).min(1).max(1000),
  })
  .strict()
  .refine(
    (r) => r.actions.reduce((n, a) => n + (a.kind === 'step' ? a.ticks : 0), 0) <= 36000,
    'Replay exceeds 36,000 fixed steps',
  );
export async function executeRecipe(
  input: unknown,
  registry: ContentRegistry = content,
  journal?: (entry: {
    index: number;
    phase: 'attempted' | 'completed';
    hash?: string;
  }) => Promise<void>,
) {
  const recipe = RecipeSchema.parse(input),
    session = new GameSession(registry, recipe.seed);
  if (recipe.initialSave !== undefined)
    session.restoreSave(parseGame(recipe.initialSave, registry));
  let bytes: string | undefined;
  const persistence = new Persistence({
    async loadGame() {
      return bytes === undefined
        ? { status: 'empty' }
        : { status: 'ok', data: parseGame(JSON.parse(bytes), registry) };
    },
    async saveGame(save) {
      bytes = JSON.stringify(save);
    },
  });
  const hashes: string[] = [],
    events: Record<string, number> = {},
    areas = new Set([session.sim.area]);
  let eventDigest = digest([]);
  const observe = (values: readonly { kind: string }[]) => {
    for (const event of values) events[event.kind] = (events[event.kind] ?? 0) + 1;
    if (values.length) eventDigest = digest([eventDigest, values]);
  };
  for (const [index, a] of recipe.actions.entries()) {
    await journal?.({ index, phase: 'attempted' });
    if (a.kind === 'step')
      for (let tick = 0; tick < a.ticks; tick++) {
        const result = session.step(a.command);
        observe(result.events);
        if (result.transition) {
          const plan = session.prepareTransition(result.transition);
          observe(plan.events);
          observe(session.commitTransition(plan));
        }
        areas.add(session.sim.area);
      }
    else if (a.kind === 'reset') observe(session.resetCurrentArea());
    else if (a.kind === 'save') {
      const snapshot = session.captureSave();
      await persistence.save(snapshot);
      assert.deepEqual(
        parseGame(JSON.parse(bytes!), registry),
        snapshot,
        'shipping save parser changed the checkpoint',
      );
    } else {
      const loaded = await persistence.load();
      if (loaded.status !== 'ok')
        throw new Error('Replay Load requires a previously saved checkpoint');
      observe(session.restoreSave(loaded.data));
      areas.add(session.sim.area);
      assert.deepEqual(
        session.captureSave(),
        loaded.data,
        'session did not restore supported checkpoint fields',
      );
    }
    // Include transient simulation state as well as persisted bytes; save-only hashes
    // would miss divergence in action buffers, RNG and damage/event ordering.
    hashes.push(
      digest({
        save: session.captureSave(),
        sim: session.sim,
        events,
        eventDigest,
        bytes: bytes ?? null,
      }),
    );
    await journal?.({ index, phase: 'completed', hash: hashes.at(-1)! });
  }
  return {
    hashes,
    events,
    areas: [...areas],
    finalSave: session.captureSave(),
    targeted: recipe.initialSave !== undefined,
  };
}
const identity = z
  .object({
    identityVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    archiveRecipeSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    preparationRecipeSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    commit: z.string().nullable(),
    dirty: z.boolean(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const BundleSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    source: identity,
    node: z.string(),
    recipe: RecipeSchema,
    result: z
      .object({
        hashes: z.array(z.string()),
        events: z.record(z.string(), z.number()),
        areas: z.array(z.string()),
        finalSave: z.unknown(),
        targeted: z.boolean(),
      })
      .strict(),
  })
  .strict();
async function readJSON(file: string) {
  if ((await fs.stat(file)).size > 16 * 1024 * 1024) throw new Error('Replay input exceeds 16 MiB');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function replayBundle(
  input: unknown,
  source: Awaited<ReturnType<typeof sourceIdentity>>,
  options: { experiment?: boolean; node?: string; registry?: ContentRegistry } = {},
) {
  const bundle = BundleSchema.parse(input),
    same =
      bundle.schemaVersion === 2 &&
      [2, 3, 4].includes(bundle.source.identityVersion ?? 0) &&
      source.sha256 === bundle.source.sha256 &&
      source.assetSha256 === bundle.source.assetSha256 &&
      (bundle.source.identityVersion === 2 ||
        (source.archiveRecipeSha256 === bundle.source.archiveRecipeSha256 &&
          source.preparationRecipeSha256 === bundle.source.preparationRecipeSha256)) &&
      (options.node ?? process.version) === bundle.node;
  if (!same && !options.experiment)
    throw new Error(
      'Replay source, asset pin or Node version differs; use --experiment to label a regression experiment',
    );
  const result = await executeRecipe(bundle.recipe, options.registry);
  assert.deepEqual(result, bundle.result, 'recorded session diverged');
  return { result, same };
}
async function main() {
  const [mode, file, ...options] = process.argv.slice(2),
    root = fileURLToPath(new URL('../../', import.meta.url));
  if (
    !file ||
    !['record', 'replay'].includes(mode ?? '') ||
    options.some((o) => o !== '--experiment') ||
    (mode === 'record' && options.length)
  )
    throw new Error('Use record <recipe.json> or replay <bundle.json> [--experiment]');
  const input = await readJSON(path.resolve(file)),
    source = await sourceIdentity(root);
  if (mode === 'record') {
    const recipe = RecipeSchema.parse(input);
    if (recipe.initialSave !== undefined)
      recipe.initialSave = parseGame(recipe.initialSave, content);
    const held = await new AssetCache().lease(
      'diagnostics-replay-' + randomUUID(),
      20 * 1024 * 1024,
    );
    try {
      await fs.writeFile(path.join(held.root, 'recipe.json'), JSON.stringify(recipe));
      await fs.writeFile(
        path.join(held.root, 'source.json'),
        JSON.stringify({ source, node: process.version }),
      );
      const result = await executeRecipe(recipe, content, (entry) =>
        fs.appendFile(path.join(held.root, 'actions.jsonl'), JSON.stringify(entry) + '\n'),
      );
      assert.deepEqual(await sourceIdentity(root), source, 'source changed while recording');
      const output = path.join(held.root, 'session.json');
      await fs.writeFile(
        output,
        JSON.stringify({ schemaVersion: 2, source, node: process.version, recipe, result }),
      );
      console.log(
        `PASS: ${recipe.actions.length} actions; ${result.targeted ? 'targeted checkpoint' : 'fresh session'}; areas ${result.areas.join(', ')}. Replay bundle: ${output}`,
      );
    } catch (error) {
      await fs.writeFile(
        path.join(held.root, 'failure.json'),
        JSON.stringify({ error: String((error as Error).stack ?? error).slice(0, 16000) }),
      );
      console.error('Replay failure diagnostics: ' + held.root);
      throw error;
    } finally {
      await held.release();
    }
  } else {
    const { result, same } = await replayBundle(input, source, {
      experiment: options.includes('--experiment'),
    });
    assert.deepEqual(await sourceIdentity(root), source, 'source changed while replaying');
    if (!same)
      console.log('REGRESSION EXPERIMENT: source, assets or Node differ from recorded evidence.');
    console.log(
      `PASS: ${result.hashes.length} recorded actions matched in this fresh process; ${same ? 'matching source identity' : 'regression experiment'}.`,
    );
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message.slice(0, 3000));
    process.exitCode = 1;
  });
