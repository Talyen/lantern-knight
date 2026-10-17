import { ResourceCache } from './resource-cache';
import { z } from 'zod';
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
  private readonly cache = new ResourceCache<ArrayBuffer>(
    (bytes) => bytes.byteLength,
    32 * 1024 ** 2,
  );
  private async download(bundle: RuntimeBundles[number], signal: AbortSignal) {
    const response = await this.transport('/' + bundle.path, { signal });
    signal.throwIfAborted();
    if (!response.ok) throw new Error('Runtime asset bundle unavailable: ' + response.status);
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    if (bytes.byteLength !== bundle.bytes || (await sha256(bytes)) !== bundle.hash)
      throw new Error('Runtime asset bundle hash or size differs');
    signal.throwIfAborted();
    return bytes;
  }
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
    const resolved = typeof location === 'undefined' ? undefined : new URL(url, location.href);
    const file = this.files.get(
      resolved && resolved.protocol === location.protocol && resolved.host === location.host
        ? resolved.pathname
        : url,
    );
    const requestSignal =
      init?.signal === undefined && input instanceof Request ? input.signal : init?.signal;
    const signal = AbortSignal.any([
      this.lifetime.signal,
      ...(requestSignal ? [requestSignal] : []),
    ]);
    signal.throwIfAborted();
    if (!file) return this.transport(input, { ...init, signal });
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'GET') throw new Error('Runtime assets require GET');
    const held = await this.cache.acquire(
      file.bundle.path,
      (signal) => this.download(file.bundle, signal),
      signal,
    );
    try {
      signal.throwIfAborted();
      return new Response(held.value.slice(file.offset, file.offset + file.bytes));
    } finally {
      held.release();
    }
  };
  dispose() {
    this.lifetime.abort();
    this.cache.dispose();
  }
}
