import { runCli } from './cli';
import { fileURLToPath } from 'node:url';

import { codeFiles, quietRun, withRuff } from './code-tools';

async function lintCode(mode: string, fix = false) {
  if (!['all', 'js', 'py', 'knip'].includes(mode) || (mode === 'knip' && fix))
    throw new Error('Use lint[:js|:py] [--fix] or knip');
  if (mode === 'knip') {
    await quietRun(process.execPath, [
      'node_modules/knip/bin/knip.js',
      '--no-progress',
      '--reporter',
      'compact',
      '--treat-config-hints-as-errors',
      '--treat-tag-hints-as-errors',
    ]);
  } else {
    const files = await codeFiles();
    const web = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    const python = files.filter((file) => file.endsWith('.py'));
    if (mode !== 'py') import.meta.resolve('oxlint-tsgolint/package.json');
    const failures: unknown[] = [];
    if (mode !== 'py' && web.length) {
      try {
        await quietRun(process.execPath, [
          fileURLToPath(new URL('bin/oxlint', import.meta.resolve('oxlint/package.json'))),
          '--config',
          '.oxlintrc.json',
          '--threads=2',
          '--deny-warnings',
          '--report-unused-disable-directives-severity=error',
          ...(fix ? ['--fix'] : []),
          ...web,
        ]);
      } catch (error) {
        failures.push(error);
      }
    }
    if (mode !== 'js' && python.length) {
      try {
        await withRuff((executable) =>
          quietRun(executable, [
            'check',
            '--no-cache',
            '--config',
            'ruff.toml',
            ...(fix ? ['--fix'] : []),
            ...python,
          ]),
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Lint checks failed');
  }
  console.log('PASS: ' + (mode === 'knip' ? 'unused-code checks' : mode + ' lint checks') + '.');
}
runCli(
  import.meta.url,
  () => {
    const [mode = 'all', ...args] = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== '--fix'))
      throw new Error('Unknown lint arguments');
    return lintCode(mode, args.includes('--fix'));
  },
  'message',
);
