import { buildWeb } from './build-workflow';
if (process.argv.slice(2).some((arg) => !['--dev', '--local', '--eager'].includes(arg)))
  throw new Error('Use build [--dev] [--local] [--eager]');
buildWeb(
  process.argv.includes('--dev') ? 'authoring' : 'game',
  process.argv.includes('--local'),
  process.argv.includes('--eager'),
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
