import { phases, candidateValidationPlan, type ValidationPlan } from './validation-plan';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AssetCache } from './cache';
import { LockSchema, lockFile } from './pack';
import { prepareAssets } from './prepare';
import { publishPrepared, validateCandidate, type PreparedAssets } from './publication';
import { projectRoot, cacheRoot } from './paths';
import { shaFile } from './sources';
import { verificationIdentity } from '../verification';
import { runProcess } from '../run-process';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.object({
  commit: z.string().nullable(),
  dirty: z.boolean(),
  sha256: hash,
});
const names = phases;
const planSchema = z
  .object({
    full: z.boolean(),
    reasons: z.array(z.string()),
    phases: z.array(z.enum(names)).min(5).max(names.length),
  })
  .strict();
const artifactSchema = z.object({
  phase: z.enum(names),
  path: z.string(),
  sha256: hash,
  bytes: z.number().int().positive(),
});
const evidenceSchema = z
  .object({
    schemaVersion: z.literal(2),
    platform: z.enum(['darwin', 'win32']),
    requestedFull: z.boolean(),
    plan: planSchema,
    source: sourceSchema,
    withoutPin: hash,
    candidate: LockSchema,
    artifacts: z.array(artifactSchema).max(128),
    steps: z
      .array(
        z.object({
          name: z.enum(names),
          passed: z.literal(true),
          output: z.string().max(12000),
        }),
      )
      .min(5)
      .max(names.length),
  })
  .strict();
export type CompletionEvidence = z.infer<typeof evidenceSchema>;
export type CompletionSource = z.infer<typeof sourceSchema>;
export function reviewIdentifier(evidence: CompletionEvidence) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, canonical(v)]),
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify(canonical(evidence)))
    .digest('hex');
}
export type CompletionDependencies = {
  plan?: (candidate: PreparedAssets, full: boolean) => Promise<ValidationPlan>;
  source: () => Promise<CompletionSource>;
  withoutPin: () => Promise<string>;
  validate: (candidate: PreparedAssets) => Promise<void>;
  run: (name: string, args: string[]) => Promise<string>;
  artifacts: (
    phase: (typeof names)[number],
    output: string,
  ) => Promise<CompletionEvidence['artifacts']>;
  validateArtifacts: (artifacts: CompletionEvidence['artifacts']) => Promise<void>;
  publish: (candidate: PreparedAssets, beforePin: () => Promise<void>) => Promise<void>;
  pin: () => Promise<string>;
  restore: (old: string, expected: string) => Promise<void>;
};
export function completionCommands(
  platform: NodeJS.Platform = process.platform,
  plan: ValidationPlan = {
    full: true,
    reasons: ['Full validation'],
    phases: [...phases],
  },
): [(typeof names)[number], string[]][] {
  if (platform !== 'darwin' && platform !== 'win32')
    throw new Error('Packaged asset finalization requires the supported macOS or Windows host');
  const host = platform === 'darwin' ? 'mac' : 'win';
  const commands: [(typeof names)[number], string[]][] = [
    ['regular local checks', ['run', 'check', '--', '--local']],
    ['Game build', ['run', 'build', '--', '--local']],
    ['Dev build', ['run', 'build:dev', '--', '--local']],
    ['Game identity', ['run', 'build:verify', '--', '--local']],
    ['Dev identity', ['run', 'build:dev:verify', '--', '--local']],
    ['Game package', ['run', 'package:' + host + ':prebuilt']],
    ['Dev package', ['run', 'package:dev:' + host + ':prebuilt']],
    ['animation smoke', ['run', 'smoke:animation', '--', '--local', '--capture']],
    ['hero smoke', ['run', 'smoke:hero', '--', '--local', '--capture']],
    ['lighting smoke', ['run', 'smoke:lighting', '--', '--local', '--quick', '--capture']],
    ['Game smoke', ['run', 'smoke:game', '--', '--local', '--capture']],
    ['Effects smoke', ['run', 'smoke:effects', '--', '--local', '--capture']],
    ['Graveyard scene', ['run', 'scene:check', '--', '--scene', 'court', '--local', '--capture']],
    [
      'Chapel scene',
      ['run', 'scene:check', '--', '--scene', 'upper-landing', '--local', '--capture'],
    ],
  ];
  const selected = commands.filter(([name]) => plan.phases.includes(name));
  let reloaded = false;
  for (const [name, args] of selected)
    if (name.endsWith(' scene')) {
      if (reloaded) args.push('--skip-reload');
      reloaded = true;
    }
  return selected;
}
function sameSource(a: CompletionSource, b: CompletionSource) {
  return a.commit === b.commit && a.dirty === b.dirty && a.sha256 === b.sha256;
}
export async function validateCompletion(
  candidate: PreparedAssets,
  deps: CompletionDependencies,
  platform: NodeJS.Platform = process.platform,
  requestedFull = false,
): Promise<CompletionEvidence> {
  await deps.validate(candidate);
  const source = await deps.source(),
    withoutPin = await deps.withoutPin(),
    steps: CompletionEvidence['steps'] = [],
    artifacts: CompletionEvidence['artifacts'] = [];
  const plan = deps.plan
    ? await deps.plan(candidate, requestedFull)
    : { full: true, reasons: ['Full validation'], phases: [...phases] };
  console.log('Validation selection: ' + plan.reasons.join('; '));
  for (const [name, args] of completionCommands(platform, plan)) {
    console.log('Validating ' + name + '…');
    const output = await deps.run(name, args);
    steps.push({ name, passed: true, output: output.slice(-12000) });
    if (args.includes('--capture')) {
      const captures = await deps.artifacts(name, output);
      if (!captures.length) throw new Error('No review captures retained for ' + name);
      artifacts.push(...captures);
    }
    if (!sameSource(source, await deps.source()))
      throw new Error('Source inputs changed during asset validation; validate again');
  }
  await deps.validate(candidate);
  await deps.validateArtifacts(artifacts);
  return evidenceSchema.parse({
    schemaVersion: 2,
    platform,
    requestedFull,
    plan,
    source,
    withoutPin,
    candidate: candidate.lock,
    steps,
    artifacts,
  });
}
export async function completeReviewedCandidate(
  candidate: PreparedAssets,
  value: unknown,
  reviewId: string,
  deps: CompletionDependencies,
) {
  const evidence = evidenceSchema.parse(value);
  const expectedPlan = deps.plan
    ? await deps.plan(candidate, evidence.requestedFull)
    : { full: true, reasons: ['Full validation'], phases: [...phases] };
  if (JSON.stringify(evidence.plan) !== JSON.stringify(expectedPlan))
    throw new Error('Validation selection changed; validate and review again');
  const expectedSteps = completionCommands(evidence.platform, expectedPlan).map(([name]) => name);
  if (JSON.stringify(evidence.steps.map((s) => s.name)) !== JSON.stringify(expectedSteps))
    throw new Error('Completion evidence omits a required check');
  const visual = expectedSteps.filter((name) => name.endsWith(' smoke') || name.endsWith(' scene'));
  if (visual.some((name) => !evidence.artifacts.some((a) => a.phase === name)))
    throw new Error('Completion evidence omits required visual captures');
  if (reviewId !== reviewIdentifier(evidence))
    throw new Error('Visual review identifier differs from the validated candidate');
  if (JSON.stringify(evidence.candidate) !== JSON.stringify(candidate.lock))
    throw new Error('Prepared candidate differs from the reviewed pack');
  const stable = async () => {
    if (
      !sameSource(evidence.source, await deps.source()) ||
      evidence.withoutPin !== (await deps.withoutPin())
    )
      throw new Error('Source inputs changed after visual review; validate and review again');
  };
  await stable();
  await deps.validate(candidate);
  await deps.validateArtifacts(evidence.artifacts);
  const oldPin = await deps.pin();
  await deps.publish(candidate, async () => {
    await stable();
    await deps.validateArtifacts(evidence.artifacts);
  });
  const expected = JSON.stringify(candidate.lock, null, 2) + '\n';
  try {
    if ((await deps.pin()) !== expected)
      throw new Error('Published pin differs from the reviewed candidate');
    if (evidence.withoutPin !== (await deps.withoutPin()))
      throw new Error('Inputs other than the asset pin changed during completion');
    await deps.run('published pack', ['run', 'assets:ensure']);
    await deps.run('pinned asset checks', ['run', 'assets:check']);
    if (
      evidence.withoutPin !== (await deps.withoutPin()) ||
      (await deps.source()).commit !== evidence.source.commit
    )
      throw new Error('Inputs other than the asset pin changed during pinned verification');
  } catch (error) {
    await deps.restore(oldPin, expected);
    throw error;
  }
  console.log(
    'COMPLETE: reviewed pack published, pinned and verified through the ordinary pinned path.',
  );
}
export async function reusablePreparation(
  cache: AssetCache,
  prepare = prepareAssets,
): Promise<PreparedAssets> {
  const held = await cache.lease('preparation', 0, true);
  try {
    const lock = LockSchema.parse(
      JSON.parse(await fs.readFile(path.join(held.root, 'prepared.json'), 'utf8')),
    );
    const candidate = {
      held,
      payload: path.join(held.root, 'work/payload'),
      archive: path.join(held.root, 'lantern-assets.tar.gz'),
      lock,
    };
    await validateCandidate(candidate);
    console.log('Reusing prepared ' + lock.releaseTag);
    return candidate;
  } catch (error) {
    await held.release();
    console.log('No matching intact preparation; preparing current runtime assets.');
    return prepare(cache);
  }
}
async function reviewedPreparation(cache: AssetCache): Promise<PreparedAssets> {
  const held = await cache.lease('preparation', 0, true);
  try {
    const lock = LockSchema.parse(
        JSON.parse(await fs.readFile(path.join(held.root, 'prepared.json'), 'utf8')),
      ),
      candidate = {
        held,
        payload: path.join(held.root, 'work/payload'),
        archive: path.join(held.root, 'lantern-assets.tar.gz'),
        lock,
      };
    await validateCandidate(candidate);
    return candidate;
  } catch (error) {
    await held.release();
    throw new Error(
      'Reviewed preparation is missing or stale; run assets:finalize and inspect its new captures first',
      { cause: error },
    );
  }
}
export async function validateReviewArtifacts(artifacts: CompletionEvidence['artifacts']) {
  for (const artifact of artifacts) {
    const stat = await fs.lstat(artifact.path);
    if (
      !stat.isFile() ||
      stat.size !== artifact.bytes ||
      (await shaFile(artifact.path)) !== artifact.sha256
    )
      throw new Error('Visual review capture changed or expired: ' + artifact.path);
  }
}
export async function collectCaptureDirectories(
  phase: (typeof names)[number],
  directories: string[],
): Promise<CompletionEvidence['artifacts']> {
  const artifacts: CompletionEvidence['artifacts'] = [];
  const approved = path.join(cacheRoot(), 'entries') + path.sep;
  for (const directory of [...new Set(directories)]) {
    if (!(await fs.realpath(directory)).startsWith(approved))
      throw new Error('Capture directory must remain in the external cache');
    const visit = async (root: string) => {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Review artifacts may not contain links');
        const file = path.join(root, entry.name);
        if (entry.isDirectory() && entry.name !== '.leases') await visit(file);
        else if (entry.isFile() && /\.png$/i.test(entry.name)) {
          const bytes = (await fs.stat(file)).size;
          if (bytes > 32 * 1024 ** 2) throw new Error('Review capture exceeds its bounded size');
          artifacts.push({
            phase,
            path: file,
            sha256: await shaFile(file),
            bytes,
          });
          if (artifacts.length > 128) throw new Error('Too many review captures');
        }
      }
    };
    await visit(directory);
  }
  return artifacts;
}
export async function finalizeAssets(
  args: string[],
  env: NodeJS.ProcessEnv,
  execute?: (args: string[]) => Promise<{ output: string; captureDirectories: string[] }>,
) {
  const requestedFull = args.includes('--full');
  args = args.filter((a) => a !== '--full');
  const reviewed = args[0] === '--reviewed';
  if (reviewed ? args.length !== 2 || !hash.safeParse(args[1]).success : args.length !== 0)
    throw new Error(
      'Use assets:finalize, inspect its captures, then assets:finalize --reviewed <review-id>',
    );
  const cache = new AssetCache(),
    candidate = reviewed ? await reviewedPreparation(cache) : await reusablePreparation(cache),
    file = path.join(candidate.held.root, 'completion.json');
  let captureDirectories: string[] = [];
  const deps: CompletionDependencies = {
    plan: candidateValidationPlan,
    source: () => verificationIdentity(projectRoot),
    withoutPin: async () =>
      (await verificationIdentity(projectRoot, { ignoreAssetPin: true })).sha256,
    validate: validateCandidate,
    artifacts: async (phase) => collectCaptureDirectories(phase, captureDirectories),
    validateArtifacts: validateReviewArtifacts,
    run: async (name, args) => {
      if (!execute) throw new Error('Asset finalization must run through the command supervisor');
      const result = await execute(args);
      captureDirectories = result.captureDirectories;
      return result.output;
    },
    publish: (p, stable) => publishPrepared(p, undefined, undefined, lockFile, stable),
    pin: () => fs.readFile(lockFile, 'utf8'),
    restore: async (old, expected) => {
      if ((await fs.readFile(lockFile, 'utf8')) !== expected)
        throw new Error(
          'Pinned verification failed and the pin was changed by another writer; automatic rollback refused',
        );
      const tmp = lockFile + '.rollback-' + randomUUID();
      try {
        await fs.writeFile(tmp, old);
        await fs.rename(tmp, lockFile);
      } finally {
        await fs.rm(tmp, { force: true });
      }
      console.error('Pinned verification failed; previous pin restored.');
    },
  };
  try {
    if (reviewed) {
      await completeReviewedCandidate(
        candidate,
        JSON.parse(await fs.readFile(file, 'utf8')),
        args[1]!,
        deps,
      );
      return;
    }
    await fs.rm(file, { force: true });
    const evidence = await validateCompletion(candidate, deps, process.platform, requestedFull);
    await fs.writeFile(file, JSON.stringify(evidence));
    console.log(
      'Agent visual review required: inspect the retained capture directories printed above.',
    );
    console.log('Review ID: ' + reviewIdentifier(evidence));
    console.log(
      'After accepting these exact captures, run npm run assets:finalize -- --reviewed ' +
        reviewIdentifier(evidence),
    );
  } catch (error) {
    await fs.writeFile(
      path.join(candidate.held.root, 'completion-failure.json'),
      JSON.stringify({
        error: String(error).slice(0, 4000),
        candidate: candidate.lock,
      }),
    );
    throw error;
  } finally {
    await candidate.held.release();
  }
}
