import { parseManifest } from '../../src/assets/schema';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { parseArgs } from 'node:util';
import { readLock, payloadDigest, type PackInventory } from './pack';
import { openFileWorkspace } from './file-delivery';
import { saveRepositoryAssets } from './repository';
import { importSources } from './import';
import { AssetCache } from './cache';
import { projectRoot } from './paths';
import { acquireCommandLane } from '../command-lane';
import { onAsyncExit } from '../scope-exit';
import { runCli } from '../cli';
import { retainedAssetCatalog } from './selection';
import { selectedFiles, copySelectedFiles } from '../select-runtime-assets';
import { gameRegistration } from '../build-runtime-delivery';
import { shaFile } from './sources';
import { safeRelative } from './files';
import audio from '../../assets/audio-sources.json';

type SourceIndex = {
  archives: Record<string, { sha256: string; bytes: number; pathHint?: string }>;
  archiveGroups: Record<string, string>;
  prefixes: Record<string, string[]>;
  files: Record<string, Record<string, { sha256: string; bytes: number; pathHint?: string }>>;
  includes?: string[];
};
runCli(import.meta.url, async () => {
  const { values } = parseArgs({
    options: { library: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  if (!values.library)
    throw new Error('Use assets:migrate -- --library <source-library-parent> [--dry-run]');
  const pin = await readLock();
  if (pin.schemaVersion !== 4) throw new Error('Migration needs a version 4 asset pin');
  const lane = await acquireCommandLane({ command: 'assets:migrate', waitMs: 30000 });
  await using cleanup = onAsyncExit(() => lane.release());
  const library = path.resolve(values.library),
    original = path.join(library, 'Lantern Knight');
  const cache = new AssetCache();
  const workspace = await openFileWorkspace(pin, cache);
  await using release = onAsyncExit(() => workspace.release());
  const ensure = (file: string) => workspace.ensurePublicFile(file);
  await ensure('generated/library/catalog.json');
  const available = JSON.parse(
    await fs.readFile(
      path.join(workspace.publicDirectory, 'generated/library/catalog.json'),
      'utf8',
    ),
  ) as Record<string, string>;
  const catalog = await retainedAssetCatalog(available);
  const selected = await selectedFiles(workspace.publicDirectory, 'authoring', ensure, catalog);
  const manifests: Record<string, ReturnType<typeof parseManifest>> = Object.fromEntries(
    await Promise.all(
      Object.entries(catalog).map(async ([id, file]) => [
        id,
        parseManifest(
          JSON.parse(await fs.readFile(path.join(workspace.publicDirectory, file), 'utf8')),
        ),
      ]),
    ),
  );
  selected.generated['generated/library/index.json'] = JSON.stringify(manifests);
  const projection = gameRegistration(
    await fs.readFile(path.join(workspace.publicDirectory, 'registration.json')),
    await fs.readFile(path.join(workspace.publicDirectory, 'build-mode.json')),
    Object.keys(catalog),
  );
  selected.generated['registration.json'] = projection.registration;
  selected.generated['build-mode.json'] = JSON.stringify(projection.policy);
  const extras = new Set<string>();
  for (const manifest of Object.values(manifests))
    for (const page of manifest.pages)
      if (page.delivery?.length)
        extras.add(path.posix.dirname(page.delivery[0]!.path) + '/receipt.json');
  for (const file of extras) {
    await ensure(file);
    selected.files.push(file);
  }
  const receiptFile = 'library/receipt.json';
  await workspace.ensureMetadataFile(receiptFile);
  const receipt = JSON.parse(
    await fs.readFile(path.join(workspace.metadataDirectory, receiptFile), 'utf8'),
  );
  receipt.sources = receipt.sources.filter((source: { asset: string }) => source.asset in catalog);

  const index: SourceIndex = { archives: {}, archiveGroups: {}, prefixes: {}, files: {} };
  const required = new Map<string, { sha256: string; bytes: number }>();
  const readIndex = async (name: string, retain: boolean) => {
    const data = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'assets', safeRelative(name)), 'utf8'),
    ) as SourceIndex;
    Object.assign(index.archives, data.archives);
    Object.assign(index.archiveGroups, data.archiveGroups);
    Object.assign(index.prefixes, data.prefixes);
    for (const [group, files] of Object.entries(data.files ?? {}))
      index.files[group] = { ...index.files[group], ...files };
    if (retain) {
      for (const [name, info] of Object.entries(data.archives ?? {}))
        required.set(info.pathHint ?? name, info);
      for (const files of Object.values(data.files ?? {}))
        for (const [name, info] of Object.entries(files)) {
          if (!info.pathHint) throw new Error('Migration source needs an owned path hint: ' + name);
          required.set(info.pathHint, info);
        }
    }
    for (const included of data.includes ?? [])
      await readIndex(included, included === 'hero-cursor-sources.json');
  };
  await readIndex('sources.json', true);
  await readIndex('loading-sources.json', true);
  const registry = JSON.parse(
    await fs.readFile(path.join(original, '.lantern/identities.json'), 'utf8'),
  );
  const snapshot = registry.sourceSnapshot.files as {
    path: string;
    sha256: string;
    bytes: number;
  }[];
  for (const source of receipt.sources as { group: string; member: string; sha256: string }[]) {
    const archive = index.archiveGroups[source.group];
    if (archive) {
      const info = index.archives[archive]!;
      required.set(info.pathHint ?? archive, info);
    } else if (source.group.startsWith('discovered-')) {
      const archive = snapshot.find((file) => file.sha256.startsWith(source.group.slice(11)));
      if (!archive) throw new Error('Missing discovered source archive: ' + source.group);
      required.set(archive.path, archive);
    } else {
      const info = index.files[source.group]?.[source.member];
      if (!info?.pathHint)
        throw new Error('Missing source provenance: ' + source.group + '/' + source.member);
      required.set(info.pathHint, info);
    }
  }
  const adapters = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'assets/library-packs.json'), 'utf8'),
  ) as { packs: { archive: string; requires?: string[] }[] };
  for (const adapter of adapters.packs) {
    const input = index.archives[adapter.archive];
    if (!input || ![...required.values()].some((value) => value.sha256 === input.sha256)) continue;
    for (const name of adapter.requires ?? []) {
      const dependency = index.archives[name];
      if (!dependency) throw new Error('Missing source adapter dependency: ' + name);
      required.set(dependency.pathHint ?? name, dependency);
    }
  }
  selected.generated['generated/library/inventory.json'] = JSON.stringify({
    schemaVersion: 1,
    files: [...required].map(([name, info]) => ({
      path: name,
      sha256: info.sha256,
      kind: path.extname(name) === '.zip' ? 'archive' : 'source',
      assets: [],
    })),
    images: [
      ...new Map(
        receipt.sources.map((source: { sha256: string; asset: string }) => [
          source.sha256,
          { sha256: source.sha256, asset: source.asset },
        ]),
      ).values(),
    ],
    media: [],
    unresolvedAnimations: [],
  });
  const sourceBytes = [...required.values()].reduce((sum, item) => sum + item.bytes, 0);
  console.log(
    `Retaining ${Object.keys(catalog).length} assets, ${selected.files.length} prepared paths (${(selected.bytes / 1024 ** 3).toFixed(2)} GiB), ${required.size} original inputs (${(sourceBytes / 1024 ** 3).toFixed(2)} GiB).`,
  );
  if (values['dry-run']) return;
  for (const [name, info] of required) {
    safeRelative(name);
    let relative = name;
    if (
      !(await fs.access(path.join(original, relative)).then(
        () => true,
        () => false,
      ))
    ) {
      const recovered = snapshot.find((file) => file.sha256 === info.sha256);
      if (!recovered) throw new Error('Missing original source identity: ' + name);
      relative = safeRelative(recovered.path);
    }
    const file = path.join(original, relative);
    if ((await shaFile(file)) !== info.sha256)
      throw new Error('Source differs before import: ' + name);
    await importSources(file, path.posix.join('Lantern Knight', path.posix.dirname(relative)));
  }
  await importSources(path.join(original, '.lantern'), 'Lantern Knight/.lantern');
  for (const source of new Set(audio.entries.map((entry) => entry.source)))
    await importSources(
      path.join(library, audio.libraryDirectory, source),
      path.posix.join('Sounds', path.posix.dirname(source)),
    );
  const directory = path.join(projectRoot, '.cache/migration');
  await fs.mkdir(path.join(directory, 'metadata'), { recursive: true });
  await copySelectedFiles(workspace.publicDirectory, path.join(directory, 'public'), selected);
  for (const name of [
    'ink/derivatives.json',
    'ink/flat-stage-receipt.json',
    'ink/hero-receipt.json',
    'ink/graveyard-art-receipt.json',
    'ink/tended-art-receipt.json',
    'ink/graveyard-ground-receipt.json',
    'ink/coverage-inputs.json',
    'rest/receipt.json',
    'effects-playground/receipt.json',
    'visual-effects/receipt.json',
    'audio/receipt.json',
  ]) {
    await workspace.ensureMetadataFile(name);
    const target = path.join(directory, 'metadata', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(
      path.join(workspace.metadataDirectory, name),
      target,
      constants.COPYFILE_FICLONE,
    );
  }
  await fs.writeFile(
    path.join(directory, 'metadata/preparation-inputs.json'),
    JSON.stringify(pin.preparation.inputs),
  );
  await fs.mkdir(path.join(directory, 'metadata/library'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'metadata/library/receipt.json'),
    JSON.stringify(receipt),
  );
  const inventory: PackInventory = { schemaVersion: 1, recipeSha256: pin.recipeSha256, files: {} };
  const walk = async (relative: string) => {
    for (const item of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name),
        file = path.join(directory, name);
      if (item.isDirectory()) await walk(name);
      else
        inventory.files[name] = { sha256: await shaFile(file), bytes: (await fs.stat(file)).size };
    }
  };
  await walk('public');
  await walk('metadata');
  await saveRepositoryAssets(directory, inventory, {
    ...pin.preparation,
    payloadSha256: payloadDigest(inventory),
  });
});
