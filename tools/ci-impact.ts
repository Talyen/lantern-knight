import { coverageFor } from './coverage-policy';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
async function main() {
  const base = process.env.LANTERN_CI_BASE;
  let desktop = true,
    authoring = true;
  if (base && /^[a-f0-9]{40,64}$/.test(base) && !/^0+$/.test(base)) {
    try {
      const files = execFileSync(
        'git',
        ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
        { encoding: 'utf8' },
      )
        .split('\0')
        .filter(Boolean);
      ({ desktop, authoring } = coverageFor(files));
    } catch {
      console.log('Comparison unavailable; selecting desktop verification');
    }
  }
  console.log('Desktop CI required: ' + desktop);
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(process.env.GITHUB_OUTPUT, `desktop=${desktop}\nauthoring=${authoring}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
