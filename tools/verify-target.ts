import { parseArgs } from 'node:util';
import { runCli } from './cli';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';

// Existing build/test CLIs remain available for focused diagnosis. These targets
// own the normal setup/order so callers need not assemble an artifact pipeline.
export function verificationSteps(args: string[], host = process.platform) {
  const [target, ...options] = args;
  const { values } = parseArgs({
    args: options,
    options: {
      local: { type: 'boolean' },
      list: { type: 'boolean' },
      platform: { type: 'string' },
    },
  });
  if (!['game', 'authoring', 'desktop'].includes(target ?? ''))
    throw new Error('Use verify:game, verify:authoring or verify:desktop [--local] [--list]');
  if (values.platform && (target !== 'desktop' || !['mac', 'win'].includes(values.platform)))
    throw new Error('--platform mac|win is available for verify:desktop');
  if (
    target === 'desktop' &&
    !values.list &&
    (!['darwin', 'win32'].includes(host) ||
      (values.platform && values.platform !== (host === 'darwin' ? 'mac' : 'win')))
  )
    throw new Error(
      'Desktop verification must run on the selected macOS or Windows host; use package for cross-platform builds',
    );
  const local = values.local ? ['--local'] : [];
  const tests =
    target === 'game'
      ? ['browser-tests.ts', 'game', '--built']
      : target === 'authoring'
        ? ['browser-tests.ts', '--ci-development', '--authoring']
        : ['desktop-tests.ts'];
  if (values.list) return [[tests[0]!, ...tests.slice(1), '--list']];
  return [
    ...(target === 'game'
      ? [['build.ts', ...local]]
      : target === 'desktop'
        ? [
            [
              'package.ts',
              '--unsigned',
              ...local,
              ...(values.platform ? ['--platform', values.platform] : []),
            ],
          ]
        : []),
    tests,
  ];
}

runCli(import.meta.url, async () => {
  for (const [tool, ...args] of verificationSteps(process.argv.slice(2)))
    await runProcess(process.execPath, ['--import', 'tsx', 'tools/' + tool, ...args], {
      cwd: projectRoot,
    });
});
