import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { AssetCache } from '../tools/assets/cache';
import { makeArchive, recipeHash } from '../tools/assets/pack';
import {
  publishPrepared,
  validateCandidate,
  type PreparedAssets,
} from '../tools/assets/publication';
import {
  validateCompletion,
  completeReviewedCandidate,
  reviewIdentifier,
  validateReviewArtifacts,
  reusablePreparation,
  type CompletionDependencies,
} from '../tools/assets/finalize';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-finalize-')),
    payload = path.join(root, 'payload'),
    archive = path.join(root, 'assets.tar.gz');
  await fs.mkdir(path.join(payload, 'public'), { recursive: true });
  await fs.mkdir(path.join(payload, 'metadata'));
  await fs.writeFile(path.join(payload, 'public/sample.png'), 'original pixels');
  const lock = await makeArchive(payload, archive, await recipeHash()),
    cache = new AssetCache(path.join(root, 'cache'), 1024 * 1024),
    held = await cache.lease('candidate');
  const candidate: PreparedAssets = { held, payload, archive, lock },
    capture = path.join(root, 'review.png');
  await fs.writeFile(capture, 'reviewed pixels');
  let source = 'a'.repeat(64),
    withoutPin = 'b'.repeat(64),
    pin = 'previous pin',
    fail = '';
  const calls: string[] = [];
  const deps: CompletionDependencies = {
    source: async () => ({ commit: null, dirty: true, sha256: source }),
    withoutPin: async () => withoutPin,
    validate: validateCandidate,
    run: async (name) => {
      calls.push(name);
      if (name === fail) throw new Error('failed ' + name);
      return 'capture ' + capture;
    },
    artifacts: async (phase) => [
      {
        phase,
        path: capture,
        bytes: 15,
        sha256: createHash('sha256').update('reviewed pixels').digest('hex'),
      },
    ],
    validateArtifacts: validateReviewArtifacts,
    publish: async (p, stable) => {
      await stable();
      pin = JSON.stringify(p.lock, null, 2) + '\n';
    },
    pin: async () => pin,
    restore: async (old, expected) => {
      assert.equal(pin, expected);
      pin = old;
    },
  };
  return {
    root,
    candidate,
    deps,
    capture,
    calls,
    setSource: (v: string) => {
      source = v;
    },
    setWithoutPin: (v: string) => {
      withoutPin = v;
    },
    setFailure: (v: string) => {
      fail = v;
    },
    pin: () => pin,
    close: async () => {
      await held.release();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test('finalization publishes the reviewed candidate without preparing again and verifies the pinned path', async () => {
  const f = await fixture();
  try {
    const evidence = await validateCompletion(f.candidate, f.deps, 'darwin');
    await completeReviewedCandidate(f.candidate, evidence, reviewIdentifier(evidence), f.deps);
    assert.deepEqual(JSON.parse(f.pin()), f.candidate.lock);
    assert.deepEqual(f.calls.slice(-2), ['published pack', 'pinned asset checks']);
  } finally {
    await f.close();
  }
});
test('failed gates, stale source, missing evidence and changed captures cannot change the pin', async () => {
  const f = await fixture();
  try {
    const run = f.deps.run;
    f.deps.run = async (name, args) => {
      const output = await run(name, args);
      f.setSource('c'.repeat(64));
      return output;
    };
    await assert.rejects(validateCompletion(f.candidate, f.deps, 'darwin'), /changed during/);
    f.deps.run = run;
    f.setSource('a'.repeat(64));
    f.setFailure('hero smoke');
    await assert.rejects(validateCompletion(f.candidate, f.deps, 'darwin'), /failed hero/);
    assert.equal(f.pin(), 'previous pin');
    f.setFailure('');
    const evidence = await validateCompletion(f.candidate, f.deps, 'darwin'),
      id = reviewIdentifier(evidence);
    await assert.rejects(completeReviewedCandidate(f.candidate, {}, id, f.deps));
    const missing = {
      ...evidence,
      artifacts: evidence.artifacts.filter((a) => a.phase !== 'hero smoke'),
    };
    await assert.rejects(
      completeReviewedCandidate(f.candidate, missing, reviewIdentifier(missing), f.deps),
      /omits required visual/,
    );
    await assert.rejects(
      completeReviewedCandidate(f.candidate, evidence, '0'.repeat(64), f.deps),
      /identifier/,
    );
    f.setSource('c'.repeat(64));
    await assert.rejects(
      completeReviewedCandidate(f.candidate, evidence, id, f.deps),
      /changed after/,
    );
    f.setSource('a'.repeat(64));
    await fs.writeFile(f.capture, 'different pixels');
    await assert.rejects(
      completeReviewedCandidate(f.candidate, evidence, id, f.deps),
      /capture changed/,
    );
    assert.equal(f.pin(), 'previous pin');
  } finally {
    await f.close();
  }
});
test('archive tampering and failed pinned verification leave or restore the previous pin', async () => {
  const f = await fixture();
  try {
    const evidence = await validateCompletion(f.candidate, f.deps, 'darwin'),
      id = reviewIdentifier(evidence),
      bytes = await fs.readFile(f.candidate.archive);
    await fs.writeFile(f.candidate.archive, 'modified');
    await assert.rejects(
      completeReviewedCandidate(f.candidate, evidence, id, f.deps),
      /archive differs/,
    );
    assert.equal(f.pin(), 'previous pin');
    await fs.writeFile(f.candidate.archive, bytes);
    f.setFailure('pinned asset checks');
    await assert.rejects(
      completeReviewedCandidate(f.candidate, evidence, id, f.deps),
      /failed pinned asset/,
    );
    assert.equal(f.pin(), 'previous pin');
  } finally {
    await f.close();
  }
});
test('upload failures are not mistaken for absent releases; retries reuse immutable verified release bytes', async () => {
  const f = await fixture();
  try {
    const target = path.join(f.root, 'lock.json');
    await fs.writeFile(target, 'previous pin');
    let created = false;
    const uploadFailure = async (args: string[]) => {
      if (args[1] === 'view') return JSON.stringify({ assets: [] });
      if (args[1] === 'upload') throw new Error('upload failed');
      created = true;
      return '';
    };
    await assert.rejects(
      publishPrepared(f.candidate, uploadFailure, async () => {}, target),
      /upload failed/,
    );
    assert.equal(created, false);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous pin');
    await assert.rejects(
      publishPrepared(
        f.candidate,
        async () => JSON.stringify({ assets: [{ name: f.candidate.lock.filename }] }),
        async () => {
          throw new Error('remote bytes differ');
        },
        target,
      ),
      /remote bytes/,
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'previous pin');
    await publishPrepared(
      f.candidate,
      async (args) => {
        assert.equal(args[1], 'view');
        return JSON.stringify({ assets: [{ name: f.candidate.lock.filename }] });
      },
      async () => {},
      target,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), f.candidate.lock);
  } finally {
    await f.close();
  }
});

test('intact matching preparation is reused; corrupt preparation is replaced before validation', async () => {
  const f = await fixture();
  try {
    const cache = new AssetCache(path.join(f.root, 'reuse'), 1024 * 1024),
      held = await cache.lease('preparation');
    await fs.mkdir(path.join(held.root, 'work'), { recursive: true });
    await fs.cp(f.candidate.payload, path.join(held.root, 'work/payload'), { recursive: true });
    await fs.copyFile(f.candidate.archive, path.join(held.root, 'lantern-assets.tar.gz'));
    await fs.writeFile(path.join(held.root, 'prepared.json'), JSON.stringify(f.candidate.lock));
    await held.release();
    let prepared = 0;
    const prepare = async () => {
      prepared++;
      return f.candidate;
    };
    const reused = await reusablePreparation(cache, prepare);
    assert.equal(prepared, 0);
    assert.deepEqual(reused.lock, f.candidate.lock);
    await reused.held.release();
    await fs.writeFile(path.join(held.root, 'lantern-assets.tar.gz'), 'corrupt');
    assert.equal(await reusablePreparation(cache, prepare), f.candidate);
    assert.equal(prepared, 1);
  } finally {
    await f.close();
  }
});

test('selected finalization rejects a changed plan and omitted mandatory checks before publication', async () => {
  const f = await fixture();
  try {
    const { selectValidation } = await import('../tools/assets/validation-plan');
    let plan = selectValidation({ assets: ['oak'] }, { court: ['oak'] });
    f.deps.plan = async () => plan;
    const evidence = await validateCompletion(f.candidate, f.deps, 'darwin');
    assert.ok(!f.calls.includes('hero smoke'));
    assert.ok(f.calls.includes('Graveyard scene'));
    const missing = {
      ...evidence,
      steps: evidence.steps.filter((s) => s.name !== 'Game identity'),
    };
    await assert.rejects(
      completeReviewedCandidate(f.candidate, missing, reviewIdentifier(missing), f.deps),
      /required check/,
    );
    plan = selectValidation({ assets: [], shared: true }, { court: ['oak'] });
    await assert.rejects(
      completeReviewedCandidate(f.candidate, evidence, reviewIdentifier(evidence), f.deps),
      /selection changed/,
    );
    assert.equal(f.pin(), 'previous pin');
  } finally {
    await f.close();
  }
});
