import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { runCli } from './cli';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import {
  completeCapture,
  prepareRound,
  readRound,
  recordPreference,
  sha256,
} from './scene-placement/session';

runCli(import.meta.url, async (args) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      spec: { type: 'string' },
      round: { type: 'string' },
      choice: { type: 'string' },
      software: { type: 'boolean' },
    },
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !values.round)
    throw new Error(
      'Use scene:compare prepare --spec FILE --round NEW_EXTERNAL_DIR | capture --round DIR [--software] | vote --round DIR --choice A|B',
    );
  const directory = path.resolve(values.round);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  const realParent = await fs.realpath(path.dirname(directory));
  const realRoot = await fs.realpath(projectRoot);
  const relative = path.relative(realRoot, realParent);
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new Error('Comparisons must live outside the checkout');
  if (command === 'prepare') {
    if (!values.spec) throw new Error('Supply --spec FILE');
    await prepareRound(directory, values.spec, {
      checkout: realRoot,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }).trim(),
      assetsFile: path.join(projectRoot, 'assets/lock.json'),
    });
    console.log('Prepared comparison: ' + directory);
  } else if (command === 'capture') {
    const { round } = await readRound(directory);
    if (round.assets !== sha256(await fs.readFile(path.join(projectRoot, 'assets/lock.json'))))
      throw new Error('Pinned assets changed; prepare a new comparison');
    await fs.mkdir(path.join(directory, 'capture-lock'));
    try {
      try {
        await fs.access(path.join(directory, 'capture.json'));
        throw new Error('Comparison already captured; prepare a new round for another view');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await runProcess(
        process.execPath,
        ['--import', 'tsx', 'tools/browser-tests.ts', 'scene-placement'],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            LANTERN_PLACEMENT_ROUND: directory,
            LANTERN_TEST_GPU: values.software ? 'software' : 'hardware',
          },
        },
      );
      await completeCapture(directory);
    } finally {
      await fs.rmdir(path.join(directory, 'capture-lock'));
    }
    console.log(
      'Which do you prefer, A or B?\nA: ' +
        path.join(directory, 'A.png') +
        '\nB: ' +
        path.join(directory, 'B.png'),
    );
  } else if (command === 'vote') {
    if (values.choice !== 'A' && values.choice !== 'B') throw new Error('Choice must be A or B');
    console.log(await recordPreference(directory, values.choice));
  } else throw new Error('Unknown comparison command: ' + command);
});
