import { ResourcePool } from './resource-pool';
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
// Readers share a download while at least one claim remains. Only verified bytes
// outlive those claims, in the runtime's bounded cache.
export class AssetByteSource {
  private readonly lifetime = new AbortController();
  private readonly files = new Map<
    string,
    { bundle: RuntimeBundles[number]; offset: number; bytes: number }
  >();
  private readonly bundles = new Map<string, RuntimeBundles[number]>();
  private readonly downloads = new ResourcePool(
    async (id, signal) => {
      const bundle = this.bundles.get(id)!;
      const response = await this.transport('/' + id, { signal });
      signal.throwIfAborted();
      if (!response.ok) throw new Error('Runtime asset bundle unavailable: ' + response.status);
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      if (bytes.byteLength !== bundle.bytes || (await sha256(bytes)) !== bundle.hash)
        throw new Error('Runtime asset bundle hash or size differs');
      signal.throwIfAborted();
      this.cache.set(id, bytes);
      this.cachedBytes += bytes.byteLength;
      while (this.cachedBytes > 32 * 1024 ** 2) {
        const [oldest, data] = this.cache.entries().next().value!;
        this.cache.delete(oldest);
        this.cachedBytes -= data.byteLength;
      }
      return bytes;
    },
    () => {}, // ArrayBuffers have no external resources; the bounded cache owns retention.
  );
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
      this.bundles.set(bundle.path, bundle);
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
      const bytes = await readUntilAborted(Promise.resolve(cached), signal);
      signal.throwIfAborted();
      return new Response(bytes.slice(file.offset, file.offset + file.bytes));
    }
    // The pool owns every reader claim and retires the last claim before abort
    // callbacks can acquire a successor. Only a copied response crosses this wait.
    return readUntilAborted(
      this.downloads.acquire([file.bundle.path], signal).then((held) => {
        try {
          signal.throwIfAborted();
          return new Response(
            held.resources.get(file.bundle.path)!.slice(file.offset, file.offset + file.bytes),
          );
        } finally {
          held.release();
        }
      }),
      signal,
    );
  };
  dispose() {
    this.lifetime.abort();
    this.downloads.dispose();
    this.cache.clear();
    this.cachedBytes = 0;
  }
}
