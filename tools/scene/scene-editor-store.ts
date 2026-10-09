import { FragmentStore } from './fragment-store';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseSceneDocument,
  parseSceneFragment,
  sceneBytesLimit,
  validateSceneReferences,
  type SceneDocument,
} from '../../src/content/scene-document';

import { readAuthoringCatalog } from '../assets/authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
import type { Plugin } from 'vite';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const validId = /^[a-z][a-z0-9-]{0,63}$/;
class SceneConflict extends Error {}
export class SceneStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    private validate: (d: SceneDocument) => Promise<void> = async () => {},
  ) {}
  private async location(id: string) {
    if (!validId.test(id)) throw new Error('Invalid scene identity');
    await fs.mkdir(this.directory, { recursive: true });
    if ((await fs.lstat(this.directory)).isSymbolicLink())
      throw new Error('Scene directory must not be a symbolic link');
    const file = path.join(this.directory, id + '.json');
    try {
      if (!(await fs.lstat(file)).isFile()) throw new Error('Scene file must be a regular file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return file;
  }
  async read(id: string) {
    const file = await this.location(id);
    let bytes: string;
    try {
      const stat = await fs.stat(file);
      if (stat.size > sceneBytesLimit) throw new Error('Scene exceeds repository size limit');
      bytes = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { document: null, revision: null };
      throw e;
    }
    const document = parseSceneDocument(JSON.parse(bytes));
    if (document.id !== id) throw new Error('Scene identity differs from filename');
    return { document, revision: digest(bytes) };
  }
  async list() {
    await this.location('untitled');
    const files = (await fs.readdir(this.directory)).filter((f) => f.endsWith('.json')).sort();
    return Promise.all(
      files.map(async (file) => {
        const id = file.slice(0, -5);
        try {
          const { document } = await this.read(id);
          return { id, name: document!.name, target: document!.target };
        } catch (error) {
          return { id, name: id, error: String(error) };
        }
      }),
    );
  }
  save(value: unknown, revision: unknown) {
    const work = this.queue.then(async () => {
      if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)))
        throw new Error('Invalid file revision');
      const document = parseSceneDocument(value);
      await this.validate(document);
      const bytes = JSON.stringify(document, null, 2) + '\n';
      if (Buffer.byteLength(bytes) > sceneBytesLimit)
        throw new Error('Scene exceeds the 64 KiB authored-file limit');
      const file = await this.location(document.id);
      let current: string | null = null;
      try {
        current = digest(await fs.readFile(file));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (current !== revision)
        throw new SceneConflict(
          'This scene changed on disk. Reload it or use Save As to preserve your edits.',
        );
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx' });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return { document, revision: digest(bytes) };
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
/** @knip-external Loaded by Vite ssrLoadModule and generated worktree fixture configs. */
export function sceneEditorPlugin(root: string, preparedPublic: string): Plugin {
  const token = randomUUID(),
    sourceFiles = ['src/content/scene-document.ts', 'src/assets/schema.ts', 'assets/lock.json'];
  const sourceRevision = async () =>
    digest(
      (await Promise.all(sourceFiles.map((f) => fs.readFile(path.join(root, f), 'utf8')))).join(
        '\n',
      ),
    );
  let initialRevision: Promise<string>;
  let loadBase: () => Promise<typeof import('../../src/content/world-art')>;
  const validate = async (d: SceneDocument) => {
    const ids = new Set([
      ...d.objects.flatMap((p) => [p.asset, ...(p.fixture?.flame ? [p.fixture.flame.asset] : [])]),
      ...(d.floor ? [d.floor.asset] : []),
    ]);
    const manifests = new Map(
      await Promise.all(
        [...ids].map(async (id) => {
          const file = (await readAuthoringCatalog(preparedPublic))[id];
          if (!file) throw new Error('Unknown prepared asset: ' + id);
          return [
            id,
            parseManifest(JSON.parse(await fs.readFile(path.join(preparedPublic, file), 'utf8'))),
          ] as const;
        }),
      ),
    );
    const { resolveAuthoredScene } = await loadBase();
    resolveAuthoredScene(d);
    validateSceneReferences(d, manifests);
    if ((await sourceRevision()) !== (await initialRevision))
      throw new SceneConflict(
        'Scene schema or pinned assets changed while saving. Restart and review the recovered draft.',
      );
  };
  const store = new SceneStore(path.join(root, 'authoring/scenes'), validate);
  const fragments = new FragmentStore(path.join(root, 'authoring/fragments'));
  return {
    name: 'lantern-scene-editor',
    configureServer(server) {
      initialRevision = sourceRevision();
      loadBase = () =>
        server.ssrLoadModule('/src/content/world-art.ts') as Promise<
          typeof import('../../src/content/world-art')
        >;
      server.middlewares.use(
        '/__lantern_editor',
        (req: IncomingMessage, res: ServerResponse, next) => {
          const handle = async () => {
            const respond = (status: number, value: unknown) => {
              res.statusCode = status;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-store');
              res.end(JSON.stringify(value));
            };
            try {
              const host = req.headers.host;
              if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) {
                respond(403, { error: 'Local editor requests only' });
                return;
              }
              const url = new URL(req.url ?? '/', `http://${host}`),
                origin = req.headers.origin;
              if (origin && origin !== `http://${host}`) {
                respond(403, { error: 'Editor origin differs' });
                return;
              }
              const baseRevision = await sourceRevision();
              if (baseRevision !== (await initialRevision))
                throw new SceneConflict(
                  'Scene schema or pinned assets or pinned assets changed. Preserve your draft and restart the editor before saving.',
                );
              if (req.method === 'GET') {
                if (url.searchParams.has('fragments')) {
                  respond(200, { fragments: await fragments.list() });
                  return;
                }
                const id = url.searchParams.get('id');
                respond(
                  200,
                  id
                    ? { ...(await store.read(id)), baseRevision }
                    : {
                        scenes: await store.list(),
                        token,
                        baseRevision,
                        workspace: digest(await fs.realpath(root)),
                      },
                );
                return;
              }
              if (
                req.method !== 'POST' ||
                req.headers['x-lantern-editor-token'] !== token ||
                req.headers['content-type'] !== 'application/json'
              ) {
                respond(403, { error: 'Invalid editor save request' });
                return;
              }
              let bytes = 0;
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > sceneBytesLimit + 4096) throw new Error('Save request too large');
                chunks.push(chunk);
              }
              const body = JSON.parse(Buffer.concat(chunks).toString());
              if (body.baseRevision !== baseRevision)
                throw new SceneConflict(
                  'Scene schema or pinned assets changed. Reload or save a separate recovered draft.',
                );
              if (body.action === 'fragment') {
                const fragment = parseSceneFragment(body.fragment);
                const document = parseSceneDocument({
                  ...body.document,
                  objects: fragment.objects,
                });
                await validate(document);
                respond(200, await fragments.create(fragment));
                return;
              }
              respond(200, { ...(await store.save(body.document, body.revision)), baseRevision });
            } catch (error) {
              respond(error instanceof SceneConflict ? 409 : 400, {
                error: (error as Error).message,
              });
            }
          };
          handle().catch(next);
        },
      );
    },
  };
}
