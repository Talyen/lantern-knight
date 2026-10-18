import { acquireBatch } from './acquire-batch';
import { cleanupAll, cleanupAfterFailure } from './cleanup';
import { parseRegistration, type PreparedRegistration } from './registration';
import { Texture } from 'three';
import { parseManifest, type Manifest } from './schema';
import { verifiedBitmap, configureTexture, sha256 } from './bitmap';
import { TextureDelivery, type SourcePage, type ImageQuality } from './texture-delivery';
import { ResourcePool } from './resource-pool';
import { contentSnapshot } from '../content/snapshot';
import { AssetByteSource } from './byte-source';
import { startupStage } from './startup-timing';
import { readUntilAborted } from './abort';
export type AssetPack = {
  readonly manifest: Manifest;
  readonly textures: ReadonlyMap<string, Texture>;
};
export type PackLease = AssetPack & { release: () => void };
export type PackBatch = {
  packs: ReadonlyMap<string, PackLease>;
  release: () => void;
};
type PageRequest = SourcePage;
export const pageIdentity = (
  p: Pick<Manifest['pages'][number], 'hash' | 'width' | 'height'> & {
    mipmaps?: boolean;
  },
) => `${p.hash}:${p.width}x${p.height}:${p.mipmaps ? 'mips' : 'nomips'}`;
export class AssetRuntime {
  readonly catalog: Readonly<Record<string, string>>;
  registration!: PreparedRegistration;
  libraryInventory = false;
  private readonly manifests = new Map<string, Promise<Manifest>>();
  private pages = new Map<string, PageRequest>();
  private readonly pool: ResourcePool<Texture>;
  private readonly lifetime = new AbortController();
  private byteSource?: AssetByteSource;
  get imageRequest() {
    return this.byteSource?.request ?? this.request;
  }
  private assertActive() {
    if (this.lifetime.signal.aborted) throw new Error('Asset runtime disposed');
  }
  get resourceCount() {
    return this.pool.size;
  }
  constructor(
    catalog: Readonly<Record<string, string>>,
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
    decode?: (page: PageRequest, signal: AbortSignal) => Promise<Texture>,
    dispose?: (texture: Texture) => void,
    private delivery?: TextureDelivery,
  ) {
    this.catalog = Object.freeze({ ...catalog });
    for (const [id, url] of Object.entries(this.catalog))
      if (
        !/^[a-z0-9][a-z0-9_-]*$/.test(id) ||
        !/^generated\/[a-zA-Z0-9_/-]+\.json$/.test(url) ||
        url.split('/').includes('..')
      )
        throw new Error('invalid local asset catalog');
    this.pool = new ResourcePool(
      async (key, signal) => {
        const p = this.pages.get(key);
        if (!p) throw new Error('missing page descriptor');
        if (decode) return decode(p, signal);
        if (this.delivery) return this.delivery.decode(p, signal);
        const bitmap = await verifiedBitmap(p.url, p, this.request, signal);
        const texture = new Texture(bitmap);
        configureTexture(texture, p.mipmaps === true);
        texture.needsUpdate = true;
        return texture;
      },
      dispose ??
        ((texture) =>
          cleanupAll([
            () => (texture.image as { close?: () => void }).close?.(),
            () => texture.dispose(),
          ])),
    );
  }
  async manifest(id: string) {
    this.assertActive();
    let promise = this.manifests.get(id);
    if (!promise) {
      const path = Object.hasOwn(this.catalog, id) ? this.catalog[id] : undefined;
      if (!path) throw new Error(`unknown asset ${id}`);
      promise = Promise.resolve()
        .then(() => {
          this.assertActive();
          return this.request('/' + path, { signal: this.lifetime.signal });
        })
        .then(async (r) => {
          if (!r.ok) throw new Error(`manifest unavailable: ${id}`);
          const data = await r.json();
          this.assertActive();
          return this.acceptManifest(id, data);
        })
        .catch((e) => {
          if (this.manifests.get(id) === promise) this.manifests.delete(id);
          throw e;
        });
      this.manifests.set(id, promise);
    }
    // Metadata transfers no resource ownership. Closing the runtime settles
    // readers while the observed transport continues toward its lifetime check.
    return readUntilAborted(promise, this.lifetime.signal);
  }
  seedManifest(id: string, data: unknown) {
    this.assertActive();
    if (!Object.hasOwn(this.catalog, id)) return;
    this.manifests.set(id, Promise.resolve(this.acceptManifest(id, data)));
  }
  private acceptManifest(id: string, data: unknown): Manifest {
    const file = this.catalog[id]!;
    const parsed = parseManifest(data);
    if (parsed.asset.id !== id) throw new Error('Asset manifest identity differs: ' + id);
    const manifest = contentSnapshot(parsed);
    for (const page of manifest.pages) {
      const key = pageIdentity(page);
      if (!this.pages.has(key))
        this.pages.set(key, {
          url: '/' + file.slice(0, file.lastIndexOf('/') + 1) + page.path,
          hash: page.hash,
          width: page.width,
          height: page.height,
          mipmaps: page.mipmaps,
          delivery: page.delivery,
          bytes: page.bytes,
        });
    }
    return manifest;
  }
  async loadPack(
    id: string,
    signal?: AbortSignal,
    progress?: (done: number, total: number) => void,
  ): Promise<PackLease> {
    this.assertActive();
    if (signal?.aborted) throw new Error('load cancelled');
    // Manifest bytes are shared for this runtime, but an obsolete consumer must
    // not keep a room operation waiting for that shared transport.
    const manifest = await readUntilAborted(
      this.manifest(id),
      AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]),
    );
    this.assertActive();
    if (signal?.aborted) throw new Error('load cancelled');
    const keys = manifest.pages.map((page) => {
      const id = pageIdentity(page);
      const original = this.pages.get(id)!;
      if (!this.delivery) return id;
      const selected = this.delivery.choose(original);
      const key = pageIdentity(selected) + ':' + (selected.encoding ?? 'png');
      this.pages.set(key, selected);
      return key;
    });
    const held = await this.pool.acquire(keys, signal, progress);
    if (this.lifetime.signal.aborted)
      cleanupAfterFailure(new Error('Asset runtime disposed'), held.release);
    if (signal?.aborted) cleanupAfterFailure(new Error('load cancelled'), held.release);
    return {
      manifest,
      textures: new Map(manifest.pages.map((p, i) => [p.id, held.resources.get(keys[i]!)!])),
      release: held.release,
    };
  }
  async loadPacks(ids: Iterable<string>, signal?: AbortSignal): Promise<PackBatch> {
    const held = await acquireBatch(
      ids,
      (id, signal) => this.loadPack(id, signal),
      (pack) => pack.release(),
      AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]),
    );
    return { packs: held.resources, release: held.release };
  }

  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(new Error('Asset runtime disposed'));
    cleanupAll([
      () => this.pool.dispose(),
      () => this.delivery?.dispose(),
      () => this.byteSource?.dispose(),
      () => this.manifests.clear(),
      () => this.pages.clear(),
    ]);
  }
  // The host signal governs opening only. After transfer, the caller owns disposal.
  static async open(
    catalog: Readonly<Record<string, string>>,
    canvas?: HTMLCanvasElement,
    quality: ImageQuality = 'delivery',
    profile: 'game' | 'authoring' = 'authoring',
    prepareTexture?: (texture: Texture) => void,
    signal = new AbortController().signal,
  ) {
    signal.throwIfAborted();
    const response = await readUntilAborted(
      fetch(profile === 'game' ? '/game-build-mode.json' : '/build-mode.json', { signal }),
      signal,
    );
    if (!response.ok) throw new Error('missing build-mode policy');
    const flags = await readUntilAborted(response.json(), signal);
    signal.throwIfAborted();
    const byteSource = new AssetByteSource(flags.assetBundles);
    let delivery: TextureDelivery | undefined;
    let runtime: AssetRuntime | undefined;
    try {
      delivery = canvas
        ? new TextureDelivery(
            canvas,
            new URLSearchParams(location.search).get('images') === 'source' ? 'source' : quality,
            byteSource.request,
            prepareTexture,
          )
        : undefined;
      runtime = new AssetRuntime(catalog, byteSource.request, undefined, undefined, delivery);
      runtime.byteSource = byteSource;
      runtime.libraryInventory = flags.libraryInventory === true;
      signal.throwIfAborted();
      runtime.registration = await startupStage('registration', async () => {
        const registration = await readUntilAborted(
          fetch(flags.registrationUrl ?? '/registration.json', { signal }),
          signal,
        );
        if (!registration.ok) throw new Error('Prepared registration unavailable');
        const bytes = await readUntilAborted(registration.arrayBuffer(), signal),
          digest = await readUntilAborted(sha256(bytes), signal);
        signal.throwIfAborted();
        if (digest !== flags.registrationHash)
          throw new Error('Prepared registration hash differs');
        return parseRegistration(JSON.parse(new TextDecoder().decode(bytes)));
      });
      signal.throwIfAborted();
      return runtime;
    } catch (error) {
      cleanupAfterFailure(error, () => {
        if (runtime) runtime.dispose();
        else cleanupAll([() => delivery?.dispose(), () => byteSource.dispose()]);
      });
    }
  }
}
