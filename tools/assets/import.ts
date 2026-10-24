import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { runCli } from '../cli';
import { acquireCommandLane } from '../command-lane';
import { onAsyncExit } from '../scope-exit';
import { sourceLibraryRoot } from './paths';
import { safeRelative } from './files';
import { shaFile } from './sources';

// An import owns copies, never links. Preflight every collision before writing;
// rollback removes only paths created by this invocation.
export async function importSources(
  input: string,
  into: string,
  destination = sourceLibraryRoot(),
) {
  safeRelative(into);
  destination = path.resolve(destination);
  const source = path.resolve(input),
    target = path.join(destination, into);
  if (
    source === target ||
    source.startsWith(target + path.sep) ||
    target.startsWith(source + path.sep)
  )
    throw new Error('Import source and destination must be separate');
  const inputs: Record<string, { sha256: string; bytes: number }> = {};
  const files: { input: string; output: string; sha256: string; bytes: number }[] = [];
  const checkDestination = async (directory: string) => {
    let current = directory;
    while (current === destination || current.startsWith(destination + path.sep)) {
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new Error('Import destination is a symlink');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (current === destination) break;
      current = path.dirname(current);
    }
  };
  const inspect = async (file: string, relative: string) => {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Imports cannot follow symlinks: ' + file);
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(file)) {
        if (entry === '.DS_Store') continue;
        if (entry === '.git') throw new Error('Cannot import a Git checkout');
        await inspect(path.join(file, entry), relative ? relative + '/' + entry : entry);
      }
    } else {
      if (!stat.isFile()) throw new Error('Unsupported import file: ' + file);
      safeRelative(relative);
      const output = path.join(target, relative),
        sha256 = await shaFile(file);
      if (!relative.split('/').includes('.lantern') && !into.split('/').includes('.lantern'))
        inputs[path.posix.join(into, relative)] = { sha256, bytes: stat.size };
      await checkDestination(path.dirname(output));
      try {
        const existing = await fs.lstat(output);
        if (existing.isSymbolicLink() || !existing.isFile() || (await shaFile(output)) !== sha256)
          throw new Error('Import conflicts with an owned source: ' + output);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        files.push({ input: file, output, sha256, bytes: stat.size });
      }
    }
  };
  const initial = await fs.lstat(source);
  await inspect(source, initial.isDirectory() ? '' : path.basename(source));
  const manifest = path.join(destination, '../source-inputs.json.gz');
  let previous: { schemaVersion: number; files: typeof inputs } = { schemaVersion: 1, files: {} };
  if (Object.keys(inputs).length) {
    try {
      previous = JSON.parse(gunzipSync(await fs.readFile(manifest)).toString());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous.schemaVersion !== 1) throw new Error('Invalid owned source inventory');
  }
  const installed: string[] = [];
  try {
    for (const file of files) {
      // Check all existing destination components before creating directories.
      let parent = path.dirname(file.output);
      while (parent.startsWith(destination)) {
        try {
          if ((await fs.lstat(parent)).isSymbolicLink())
            throw new Error('Import destination is a symlink');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (parent === destination) break;
        parent = path.dirname(parent);
      }
      await fs.mkdir(path.dirname(file.output), { recursive: true });
      const temporary = file.output + '.' + randomUUID();
      try {
        await fs.copyFile(
          file.input,
          temporary,
          constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL,
        );
        if (
          (await fs.stat(temporary)).size !== file.bytes ||
          (await shaFile(temporary)) !== file.sha256 ||
          (await shaFile(file.input)) !== file.sha256
        )
          throw new Error('Source changed during import: ' + file.input);
        // link is exclusive and only transfers this independently copied inode.
        await fs.link(temporary, file.output);
        installed.push(file.output);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      if (installed.length % 1000 === 0) console.log(`Imported ${installed.length} source files.`);
    }
    if (Object.keys(inputs).length) {
      const files = Object.fromEntries(
        Object.entries({ ...previous.files, ...inputs }).sort(([a], [b]) => a.localeCompare(b)),
      );
      const temporary = manifest + '.' + randomUUID();
      try {
        await fs.writeFile(temporary, gzipSync(JSON.stringify({ schemaVersion: 1, files })));
        await fs.rename(temporary, manifest);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
  } catch (error) {
    for (const file of installed) await fs.rm(file);
    throw error;
  }
  return installed.length;
}

runCli(import.meta.url, async () => {
  const { values, positionals } = parseArgs({
    options: { into: { type: 'string' } },
    allowPositionals: true,
  });
  if (positionals.length !== 1)
    throw new Error('Use assets:import -- --into <project-folder> <file-or-folder>');
  const lane = await acquireCommandLane({ command: 'assets:import' });
  await using cleanup = onAsyncExit(() => lane.release());
  console.log(
    `Imported ${await importSources(positionals[0]!, values.into ?? 'Lantern Knight')} source files. Run assets:prepare to update the prepared catalog.`,
  );
});
