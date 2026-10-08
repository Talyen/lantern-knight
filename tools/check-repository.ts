import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const forbidden =
  /^(?:staging|evidence|docs\/history|references\/(?:art|handoff|updates)|public\/(?:generated|lighting|visual-effects|dev-effects|dev-lighting)|dist(?:-dev|-electron(?:-dev)?)?|release(?:-dev)?|tmp|\.cache)(?:\/|$)/;
const exceptions: Readonly<Record<string, number>> = {
  'assets/sources.json': 80 * 1024,
  'package-lock.json': 512 * 1024,
  'references/hero/hero-reference.png': 1024 * 1024,
  'references/canon/image(3).png': 1024 * 1024,
};
export function repositoryFinding(file: string, bytes: number) {
  if (forbidden.test(file))
    return 'generated, historical or bulk asset data must remain outside Git';
  const limit = exceptions[file] ?? (/\.(json|ya?ml)$/i.test(file) ? 64 * 1024 : 256 * 1024);
  if (bytes > limit)
    return `file exceeds ${limit / 1024} KiB; use an external artifact or a documented authored-input exception`;
}
export async function checkRepository() {
  const names = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    )
      .split('\0')
      .filter(Boolean),
    errors = [];
  for (const file of names) {
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) errors.push(file + ': tracked links are not asset storage');
    const error = repositoryFinding(file, stat.size);
    if (error) errors.push(file + ': ' + error);
  }
  if (errors.length)
    throw new Error(
      `${errors.length} repository boundary violations:\n${errors.slice(0, 10).join('\n')}`,
    );
  console.log(
    `PASS: ${names.length} indexed and prospective authored paths respect authored-source and data-size boundaries.`,
  );
}
if (process.argv[1]?.endsWith('check-repository.ts'))
  checkRepository().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
