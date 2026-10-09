import { buildWeb } from './build-workflow';
if (process.argv.slice(2).some((arg) => !['--dev', '--local'].includes(arg)))
  throw new Error('Use build [--dev] [--local]');
buildWeb(
  process.argv.includes('--dev') ? 'authoring' : 'game',
  process.argv.includes('--local'),
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
