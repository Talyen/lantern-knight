import test from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot } from '../tools/assets/paths';

test('external source recovery survives reorganization through normal readers and import preflight', () => {
  execFileSync('python3', ['-B', path.join(projectRoot, 'tests/source_recovery.py')], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

test('TypeScript tooling reads recover a renamed library and sidecar without a relink step', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-source-entry-')),
    home = await fs.realpath(tmp);
  try {
    const documents = path.join(home, 'Documents'),
      library = path.join(documents, 'Asset Library'),
      root = path.join(library, '2d Assets', 'Lantern Knight');
    await fs.mkdir(root, { recursive: true });
    const source = Buffer.from('immutable fixture source');
    const { createHash } = await import('node:crypto'),
      indexPath = path.join(home, 'sources.json');
    await fs.writeFile(
      indexPath,
      JSON.stringify({
        libraryDirectory: '2d Assets/Lantern Knight',
        archives: {},
        prefixes: {},
        directories: {},
        files: {
          'ink-collection-01': {
            'collection/README_Import.txt': {
              bytes: source.length,
              sha256: createHash('sha256').update(source).digest('hex'),
            },
          },
        },
      }),
    );
    await fs.writeFile(path.join(root, 'README_Import.txt'), source);
    const script = `
   import fs from 'node:fs/promises';import path from 'node:path';import { createHash } from 'node:crypto';
   import {readLibrarySource} from ${JSON.stringify(pathToFileURL(path.join(projectRoot, 'tools/assets/sources.ts')).href)};
   const location={root:${JSON.stringify(root)},indexPath:${JSON.stringify(indexPath)}};
   const read=()=>readLibrarySource('collection/README_Import.txt','ink-collection-01',location);
   const before=await read();
   const library=process.env.ASSET_LIBRARY_ROOT,renamed=path.join(process.env.HOME,'Documents','Reorganized');
   await fs.rename(library,renamed);
   await fs.rename(path.join(renamed,'2d Assets','Lantern Knight','README_Import.txt'),path.join(renamed,'renamed-sidecar.data'));
   const after=await read();
   if(!before.equals(after))throw new Error('Preparation source bytes changed after reorganization');
   const concurrent=await Promise.all(Array.from({length:4},()=>read()));
   if(concurrent.some(data=>!data.equals(before)))throw new Error('Concurrent preparation reads differ');
   console.log(createHash('sha256').update(after).digest('hex'));
  `;
    const result = execFileSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(path.join(projectRoot, 'node_modules/tsx/dist/loader.mjs')).href,
        '--input-type=module',
        '-e',
        script,
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          ASSET_LIBRARY_ROOT: library,
          LANTERN_CACHE_ROOT: path.join(home, 'cache'),
          LANTERN_SOURCE_SEARCH_ROOTS: '',
        },
        encoding: 'utf8',
        timeout: 20000,
      },
    );
    assert.equal(result.trim(), createHash('sha256').update(source).digest('hex'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
