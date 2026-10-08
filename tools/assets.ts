import { managedTask } from './task-runner';
export { publishPrepared } from './assets/publication';
const legacy: Record<string, string> = {
  check: 'assets:check',
  'tools/scene-workflow.ts': 'scene:check',
};
if (process.argv[1]?.endsWith('assets.ts')) {
  const [mode = 'ensure', task, ...args] = process.argv.slice(2);
  const name = mode === 'run' ? (legacy[task!] ?? task!) : 'assets:' + mode;
  const forwarded = mode === 'run' ? args : [...(task ? [task] : []), ...args];
  managedTask(name, forwarded).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
