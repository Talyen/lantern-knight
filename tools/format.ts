import { runCli } from './cli';
import { codeFiles, quietRun, withRuff } from './code-tools';
async function formatCode(check: boolean) {
  const files = await codeFiles();
  const python = process.argv.includes('--python') ? files.filter((n) => n.endsWith('.py')) : [],
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
  console.log(
    `PASS: ${web.length + python.length} handwritten files ${check ? 'formatted consistently' : 'formatted'}.`,
  );
}
runCli(
  import.meta.url,
  () => {
    const args = process.argv.slice(2);
    if (args.some((a) => a !== '--check' && a !== '--python'))
      throw new Error('Use format [--check]');
    return formatCode(args.includes('--check'));
  },
  'message',
);
