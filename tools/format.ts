import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeFiles, quietRun, withRuff } from './code-tools';
import { projectRoot } from './assets/paths';
import { checkCommandScripts } from './task-runner';
async function formatCode(check: boolean) {
  const files = await codeFiles();
  const python = files.filter((n) => n.endsWith('.py')),
    web = files.filter((n) => !n.endsWith('.py'));
  if (web.length)
    await quietRun(process.execPath, [
      'node_modules/prettier/bin/prettier.cjs',
      check ? '--check' : '--write',
      ...web,
    ]);
  if (python.length)
    await withRuff((executable) =>
      quietRun(executable, ['format', ...(check ? ['--check'] : []), ...python]),
    );
  await checkCommandScripts(
    JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')).scripts,
  );
  console.log(
    `PASS: ${files.length} handwritten files ${check ? 'formatted consistently' : 'formatted'}.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--check')) throw new Error('Use format [--check]');
  formatCode(args.includes('--check')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
