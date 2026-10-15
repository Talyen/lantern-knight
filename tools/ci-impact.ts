import { runCli } from './cli';
import { coverageFor } from './coverage-policy';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function main() {
  const base = process.env.LANTERN_CI_BASE;
  let desktop = true,
    authoring = true,
    assets = true;
  if (base && /^[a-f0-9]{40,64}$/.test(base) && !/^0+$/.test(base)) {
    try {
      const files = execFileSync(
        'git',
        ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
        { encoding: 'utf8' },
      )
        .split('\0')
        .filter(Boolean);
      ({ desktop, authoring, assets } = coverageFor(files));
    } catch {
      console.log('Comparison unavailable; selecting all optional verification');
    }
  }
  console.log(`Optional CI: desktop=${desktop}; authoring=${authoring}; assets=${assets}`);
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `desktop=${desktop}\nauthoring=${authoring}\nassets=${assets}\n`,
    );
}
runCli(import.meta.url, () => main());
