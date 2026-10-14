import { z } from 'zod';
import { readUntilAborted } from './abort';
import { sha256 } from './bitmap';

const localPath = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_/-]*\.[a-zA-Z0-9]+$/)
  .refine((p) => !p.split('/').includes('..'));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const size = z
  .number()
  .int()
  .nonnegative()
  .max(32 * 1024 ** 2);
const RuntimeBundlesSchema = z.array(
  z.strictObject({
    path: localPath,
    hash,
    bytes: size.positive(),
    files: z.record(localPath, z.strictObject({ offset: size, bytes: size, hash })),
  }),
);
export type RuntimeBundles = z.infer<typeof RuntimeBundlesSchema>;

// The runtime owns transport; each decoder borrows independently cancellable reads.
export class AssetByteSource {
  private readonly lifetime = new AbortController();
  private readonly files = new Map<
    string,
    { bundle: RuntimeBundles[number]; offset: number; bytes: number }
  >();
  private readonly pending = new Map<string, Promise<ArrayBuffer>>();
  private readonly cache = new Map<string, ArrayBuffer>();
  private cachedBytes = 0;
  constructor(
    bundles: unknown = [],
    private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    const paths = new Set<string>();
    for (const bundle of RuntimeBundlesSchema.parse(bundles)) {
      if (paths.has(bundle.path)) throw new Error('Duplicate runtime asset bundle');
      paths.add(bundle.path);
      let end = 0;
      for (const [path, file] of Object.entries(bundle.files).sort(
        (a, b) => a[1].offset - b[1].offset,
      )) {
        if (
          this.files.has('/' + path) ||
          file.offset !== end ||
          file.offset + file.bytes > bundle.bytes
        )
          throw new Error('Invalid runtime asset byte range');
        end += file.bytes;
        this.files.set('/' + path, { bundle, offset: file.offset, bytes: file.bytes });
      }
      if (end !== bundle.bytes) throw new Error('Incomplete runtime asset bundle');
    }
  }
  readonly request: typeof fetch = async (input, init) => {
    this.lifetime.signal.throwIfAborted();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const file = this.files.get(url);
    const signal = AbortSignal.any([this.lifetime.signal, ...(init?.signal ? [init.signal] : [])]);
    signal.throwIfAborted();
    if (!file) return this.transport(input, { ...init, signal });
    if (init?.method && init.method !== 'GET') throw new Error('Runtime assets require GET');
    const cached = this.cache.get(file.bundle.path);
    if (cached) {
      this.cache.delete(file.bundle.path);
      this.cache.set(file.bundle.path, cached);
    }
    let pending = cached ? Promise.resolve(cached) : this.pending.get(file.bundle.path);
    if (!pending) {
      pending = Promise.resolve()
        .then(async () => {
          const response = await this.transport('/' + file.bundle.path, {
            signal: this.lifetime.signal,
          });
          if (!response.ok) throw new Error('Runtime asset bundle unavailable: ' + response.status);
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength !== file.bundle.bytes || (await sha256(bytes)) !== file.bundle.hash)
            throw new Error('Runtime asset bundle hash or size differs');
          this.lifetime.signal.throwIfAborted();
          this.pending.delete(file.bundle.path);
          this.cache.set(file.bundle.path, bytes);
          this.cachedBytes += bytes.byteLength;
          while (this.cachedBytes > 32 * 1024 ** 2) {
            const [path, data] = this.cache.entries().next().value!;
            this.cache.delete(path);
            this.cachedBytes -= data.byteLength;
          }
          return bytes;
        })
        .catch((error) => {
          this.pending.delete(file.bundle.path);
          throw error;
        });
      this.pending.set(file.bundle.path, pending);
    }
    const bytes = await readUntilAborted(pending, signal);
    signal.throwIfAborted();
    return new Response(bytes.slice(file.offset, file.offset + file.bytes));
  };
  dispose() {
    this.lifetime.abort();
    this.pending.clear();
    this.cache.clear();
    this.cachedBytes = 0;
  }
}
