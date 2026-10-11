import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { readAuthoringCatalog } from '../assets/authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
const unit = z.number().finite().min(0).max(1),
  uv = z.tuple([unit, unit]);
const rect = z
  .tuple([unit, unit, unit, unit])
  .refine((v) => v[0] < v[2] && v[1] < v[3], 'Empty selection rectangle');
const SelectionSchema = z
  .object({
    asset: z.string().regex(/^[a-z0-9_-]+$/),
    frame: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    crop: rect,
    box: rect.optional(),
    points: z
      .array(z.object({ uv, include: z.boolean() }).strict())
      .max(256)
      .default([]),
    operation: z.enum(['select', 'detect']).default('select'),
    text: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine(
    (v) => (v.operation === 'detect' ? !!v.text : !!v.box || v.points.length > 0),
    'Selection needs prompts',
  );
export class SegmentationService {
  private worker?: ChildProcessWithoutNullStreams;
  private pending?: { id: number; resolve: (v: unknown) => void; reject: (e: Error) => void };
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private closed = false;
  readonly modelRoot = path.resolve(
    process.env.LANTERN_SAM_ROOT ??
      path.join(os.homedir(), 'Library/Application Support/LanternKnight/segmentation'),
  );
  constructor(
    private root: string,
    private preparedPublic: string,
  ) {}
  async status() {
    return {
      installed: await fs.access(path.join(this.modelRoot, 'venv/bin/python')).then(
        () => true,
        () => false,
      ),
      running: !!this.worker,
    };
  }
  private start() {
    if (this.worker) return this.worker;
    const worker = spawn(
      path.join(this.modelRoot, 'venv/bin/python'),
      [path.join(this.root, 'tools/segmentation/worker.py')],
      {
        env: { ...process.env, LANTERN_SAM_ROOT: this.modelRoot, PYTORCH_ENABLE_MPS_FALLBACK: '0' },
        stdio: 'pipe',
      },
    );
    this.worker = worker;
    let diagnostics = '';
    worker.stderr.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-4096);
    });
    createInterface({ input: worker.stdout }).on('line', (line) => {
      try {
        const result = JSON.parse(line);
        if (!this.pending || result.id !== this.pending.id) return;
        const pending = this.pending;
        this.pending = undefined;
        if (result.error) pending.reject(new Error(result.error));
        else pending.resolve(result.result);
      } catch {
        this.stop(new Error('Invalid segmentation response'));
      }
    });
    worker.on('error', (e) =>
      this.stop(
        new Error('Local selection unavailable. Run npm run segmentation:setup. ' + e.message),
      ),
    );
    worker.on('exit', () => {
      if (this.worker === worker)
        this.stop(new Error('Local selection worker stopped. ' + diagnostics));
    });
    return worker;
  }
  select(value: unknown, signal: AbortSignal) {
    const request = SelectionSchema.parse(value);
    const work = this.queue.then(async () => {
      signal.throwIfAborted();
      if (this.closed) throw new Error('Selection service closed');
      clearTimeout(this.idle);
      const catalog = await readAuthoringCatalog(this.preparedPublic),
        file = catalog[request.asset];
      if (!file) throw new Error('Unknown prepared selection asset');
      const manifest = parseManifest(
        JSON.parse(await fs.readFile(path.join(this.preparedPublic, file), 'utf8')),
      );
      const frame = manifest.frames.find((f) => f.id === request.frame),
        page = frame && manifest.pages.find((p) => p.id === frame.page);
      if (!frame || !page) throw new Error('Missing selection frame');
      if (page.hash !== request.hash) throw new Error('Selection artwork changed');
      const image = path.resolve(path.dirname(path.join(this.preparedPublic, file)), page.path);
      if (!image.startsWith(path.resolve(this.preparedPublic) + path.sep))
        throw new Error('Invalid prepared image path');
      const [x, y, w, h] = frame.rect,
        id = ++this.sequence;
      signal.throwIfAborted();
      const onAbort = () => this.stop(new Error('Selection cancelled'));
      const timer = setTimeout(
        () => this.stop(new Error('Selection timed out; manual tools remain available')),
        180000,
      );
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          this.pending = { id, resolve, reject };
          this.start().stdin.write(
            JSON.stringify({
              ...request,
              id,
              image,
              identity: page.hash,
              frameRect: [x, y, x + w, y + h],
              canvas: manifest.asset.canvas,
              trim: frame.trim,
            }) + '\n',
          );
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.idle = setTimeout(() => this.stop(), 300000);
        this.idle.unref();
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }
  private stop(error = new Error('Selection worker released')) {
    this.pending?.reject(error);
    this.pending = undefined;
    const worker = this.worker;
    this.worker = undefined;
    worker?.kill();
    clearTimeout(this.idle);
  }
  dispose() {
    this.closed = true;
    this.stop();
  }
}
