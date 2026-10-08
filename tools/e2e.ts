import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractFile } from '@electron/asar';
import { smokeExecutable, withSmokeSessions, takeSmokeWork } from './smoke-launch';
import { verificationIdentity, requireStableInputs } from './verification';

const before = await verificationIdentity(process.cwd());
// Validate the actual packages, including stale packages beside fresh build outputs.
for (const dev of [false, true]) {
  const executable = smokeExecutable(dev),
    archive =
      process.platform === 'darwin'
        ? path.resolve(path.dirname(executable), '../Resources/app.asar')
        : path.join(path.dirname(executable), 'resources/app.asar'),
    dist = dev ? 'dist-dev' : 'dist',
    identity = JSON.parse(extractFile(archive, `${dist}/build-identity.json`).toString());
  assert.deepEqual(
    identity,
    JSON.parse(await fs.readFile(`${dist}/build-identity.json`, 'utf8')),
    'Packaged application differs from verified build; package again',
  );
  if (process.env.GITHUB_SHA) {
    // Hosted builds travel between OSes; filesystem mode bits are not portable.
    assert.equal(identity.sourceCommit, before.commit, 'Package comes from another commit');
    assert.equal(before.dirty, false, 'Hosted source must remain clean');
  } else
    assert.equal(
      identity.inputSha256,
      before.sha256,
      'Package differs from current authored inputs',
    );
}
const phases =
  process.platform === 'win32'
    ? ([['Windows integration', './desktop-smoke.ts', []]] as const)
    : ([
        ['Game controls, combat and persistence', './game-smoke.ts', []],
        ['Isolated player preferences', './visual-options-smoke.ts', []],
        ['Sandbox routing and native buffers', './churchyard-smoke.ts', ['--ci']],
        ['Crypt frozen pixels, occlusion and lifetime', './crypt-smoke.ts', ['--quick']],
        ['Room weather and resource ownership', './visual-scenes-smoke.ts', []],
        ['Effects contribution and developer routing', './effects-playground-smoke.ts', []],
      ] as const);
const timings: { name: string; ms: number }[] = [];
const argv = process.argv;
await withSmokeSessions(async () => {
  for (const [name, module, flags] of phases) {
    process.argv = [argv[0]!, module, ...flags];
    const started = performance.now();
    try {
      await import(module);
    } finally {
      process.argv = argv;
      const ms = Math.round(performance.now() - started),
        work = takeSmokeWork();
      timings.push({ name, ms });
      console.log(
        `E2E ${name}: ${ms}ms${work ? `; ${work.updates} presentation updates; ${work.submissions} renderer submissions` : ''}.`,
      );
    }
  }
});
assert.ok(timings.length > 0, 'E2E executed no scenarios');
await requireStableInputs(process.cwd(), before);
console.log(
  `PASS: ${timings.length} E2E phases; slowest: ${timings
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)
    .map((t) => `${t.name} ${t.ms}ms`)
    .join('; ')}.`,
);
