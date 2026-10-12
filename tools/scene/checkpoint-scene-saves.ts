import { createHash } from 'node:crypto';
import { GroundProfileSchema } from '../../src/content/ground-profile';
import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSceneDocument } from '../../src/content/scene-document';

const exec = promisify(execFile);

// Run only while holding the repository integration lock. Scene saves are user
// content: checkpoint their exact bytes before incorporating agent changes.
export async function checkpointSceneSaves(main: string) {
  const git = async (...args: string[]) =>
    (await exec('git', args, { cwd: main, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).stdout;
  const status = (await git('status', '--porcelain', '--untracked-files=all', '-z'))
    .split('\0')
    .filter(Boolean);
  if (!status.length) return;
  const files = status.map((entry) => {
    const file = entry.slice(3);
    if (
      ![' M', '??'].includes(entry.slice(0, 2)) ||
      !(
        /^authoring\/scenes\/[a-z][a-z0-9-]{0,63}\.json$/.test(file) ||
        (entry.startsWith('?? ') && /^authoring\/ground-profiles\/[a-f0-9]{64}\.json$/.test(file))
      )
    )
      throw new Error(
        'Local main has unfinished changes outside saved scenes; preserve them and leave the task committed on its branch',
      );
    return file;
  });
  const snapshots = new Map<string, string>();
  for (const file of files) {
    if (!(await lstat(path.join(main, file))).isFile())
      throw new Error('Scene save must be a regular file: ' + file);
    const body = await readFile(path.join(main, file), 'utf8');
    if (Buffer.byteLength(body) > 4 * 1024 * 1024)
      throw new Error('Scene save exceeds 4 MiB: ' + file);
    if (file.startsWith('authoring/scenes/')) {
      const document = parseSceneDocument(JSON.parse(body));
      if (document.id !== path.basename(file, '.json'))
        throw new Error('Scene save ID does not match its file: ' + file);
    } else {
      GroundProfileSchema.parse(JSON.parse(body));
      if (createHash('sha256').update(body).digest('hex') !== path.basename(file, '.json'))
        throw new Error('Ground profile revision is damaged: ' + file);
    }
    snapshots.set(file, body);
  }
  let committed = false;
  try {
    await git('add', '--', ...files);
    for (const [file, body] of snapshots) {
      if (
        (await git('show', ':' + file)) !== body ||
        (await readFile(path.join(main, file), 'utf8')) !== body
      )
        throw new Error(
          'Scene changed while checkpointing; saved data preserved, retry integration',
        );
    }
    const staged = (await git('diff', '--cached', '--name-only', '-z')).split('\0').filter(Boolean);
    if (staged.length !== files.length || staged.some((file) => !snapshots.has(file)))
      throw new Error('Index changed while checkpointing scene saves; integration stopped');
    await git('commit', '-m', 'Preserve saved scenes before integration');
    committed = true;
    console.log('Preserved saved scenes in ' + (await git('rev-parse', '--short', 'HEAD')).trim());
  } finally {
    if (!committed) {
      // Restore only the staging entries this operation owns, never saved files.
      const owned = [];
      for (const [file, body] of snapshots)
        if ((await git('show', ':' + file).catch(() => undefined)) === body) owned.push(file);
      if (owned.length) await git('restore', '--staged', '--', ...owned);
    }
  }
  if ((await git('status', '--porcelain')).trim())
    throw new Error(
      'Local main changed after scene checkpoint; saved data preserved, retry integration',
    );
}
