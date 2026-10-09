import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export function requiresDesktop(files: readonly string[]) {
  return files.some((file) =>
    /^(electron\/|package(?:-lock)?\.json$|electron-builder.*\.json$|vite\.config\.ts$|.*\.html$|assets\/lock\.json$|src\/core\/save\.ts$|src\/content\/asset-catalog\.ts$|tools\/(?:build|package|desktop|select-runtime-assets)|tools\/assets\/(?:pack|archive|bundles|workspace|publication|paths)\.ts$|tests\/desktop\/|\.github\/workflows\/)/.test(
      file,
    ),
  );
}
export function requiresAuthoring(files: readonly string[]) {
  return files.some((file) =>
    /^(src\/(?:editor|effects-playground|sandbox)|src\/content\/scene-(?:document|design)|tools\/(?:dev|browser-tests)|tests\/browser\/(?:editor|effects)|vite\.config)/.test(
      file,
    ),
  );
}
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
      desktop = requiresDesktop(files);
      authoring = requiresAuthoring(files);
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
