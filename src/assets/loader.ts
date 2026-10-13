import { CleanupFailure, cleanupAll, cleanupAfterFailure } from './cleanup';
import { parseRegistration, type PreparedRegistration } from './registration';
import { Texture, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from 'three';
import { parseManifest, type Manifest } from './schema';
import { sha256, verifiedBitmap } from './bitmap';
import { TextureDelivery, type SourcePage, type ImageQuality } from './texture-delivery';
import { ResourcePool } from './resource-pool';
import { contentSnapshot } from '../content/snapshot';
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
    delivery?: Manifest['pages'][number]['delivery'];
  },
) =>
  `${p.hash}:${p.width}x${p.height}:srgb-straight-${p.mipmaps ? 'terrain-mips' : 'linear-no-mips'}:${p.delivery?.map((v) => v.hash + ':' + v.mipmaps).join('|') ?? ''}`;
export class AssetRuntime {
  readonly catalog: Readonly<Record<string, string>>;
  registration!: PreparedRegistration;
  libraryInventory = false;
  private readonly manifests = new Map<string, Promise<Manifest>>();
  private pages = new Map<string, PageRequest>();
  private readonly pool: ResourcePool<Texture>;
  private readonly lifetime = new AbortController();
  private assertActive() {
    if (this.lifetime.signal.aborted) throw new Error('Asset runtime disposed');
  }
  get resourceCount() {
    return this.pool.size;
  }
  constructor(
    catalog: Readonly<Record<string, string>>,
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
    decode?: (page: PageRequest) => Promise<Texture>,
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
      async (key) => {
        const p = this.pages.get(key);
        if (!p) throw new Error('missing page descriptor');
        if (decode) return decode(p);
        if (this.delivery) return this.delivery.decode(p);
        const bitmap = await verifiedBitmap(p.url, p, (url, init) =>
          this.request(url, { ...init, signal: this.lifetime.signal }),
        );
        const texture = new Texture(bitmap);
        texture.colorSpace = SRGBColorSpace;
        texture.generateMipmaps = p.mipmaps === true;
        texture.minFilter = p.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
        texture.magFilter = LinearFilter;
        texture.flipY = false;
        texture.premultiplyAlpha = false;
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
      const path = this.catalog[id];
      if (!path) throw new Error(`unknown asset ${id}`);
      promise = this.request('/' + path, { signal: this.lifetime.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(`manifest unavailable: ${id}`);
          const data = await r.json();
          this.assertActive();
          return this.acceptManifest(id, data);
        })
        .catch((e) => {
          this.manifests.delete(id);
          throw e;
        });
      this.manifests.set(id, promise);
    }
    return promise;
  }
  seedManifest(id: string, data: unknown) {
    this.assertActive();
    const file = this.catalog[id];
    if (!file) return;
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
    const manifest = await this.manifest(id);
    this.assertActive();
    if (signal?.aborted) throw new Error('load cancelled');
    const keys = manifest.pages.map((page) => {
      const original = this.pages.get(pageIdentity(page))!;
      if (!this.delivery) return pageIdentity(page);
      const selected = this.delivery.choose(original);
      const key = pageIdentity(selected) + ':' + (selected.encoding ?? 'png');
      this.pages.set(key, selected);
      return key;
    });
    const held = await this.pool.acquire(keys, signal, progress);
    try {
      this.assertActive();
      if (signal?.aborted) throw new Error('load cancelled');
    } catch (error) {
      cleanupAfterFailure(error, held.release);
    }
    return {
      manifest,
      textures: new Map(manifest.pages.map((p, i) => [p.id, held.resources.get(keys[i]!)!])),
      release: held.release,
    };
  }
  async loadPacks(ids: Iterable<string>, signal?: AbortSignal): Promise<PackBatch> {
    this.assertActive();
    signal?.throwIfAborted();
    const selected = [...new Set(ids)],
      failure = new AbortController(),
      batchSignal = AbortSignal.any([
        this.lifetime.signal,
        failure.signal,
        ...(signal ? [signal] : []),
      ]),
      packs = new Map<string, PackLease>();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      cleanupAll([...packs.values()].map((pack) => () => pack.release()));
    };
    const cancellationErrors: unknown[] = [];
    const cancel = () => {
      try {
        release();
      } catch (error) {
        cancellationErrors.push(error);
      }
    };
    // A completed pack no longer listens to acquisition cancellation. The batch
    // owns it until transfer, including while other packs are still pending.
    batchSignal.addEventListener('abort', cancel, { once: true });
    if (batchSignal.aborted) cancel();
    try {
      await Promise.allSettled(
        selected.map(async (id) => {
          try {
            const pack = await this.loadPack(id, batchSignal);
            if (released) {
              try {
                pack.release();
              } catch (error) {
                cancellationErrors.push(error);
              }
            } else packs.set(id, pack);
          } catch (error) {
            // Stop sibling claims immediately, but drain every acquisition so
            // late decodes and manifests cannot escape their resource owner.
            if (!batchSignal.aborted) failure.abort(error);
            else if (error instanceof CleanupFailure) cancellationErrors.push(error);
          }
        }),
      );
      if (failure.signal.aborted) throw failure.signal.reason;
      if (signal?.aborted) throw new Error('load cancelled');
      this.assertActive();
      return { packs: new Map(selected.map((id) => [id, packs.get(id)!])), release };
    } catch (error) {
      cleanupAfterFailure(error, () =>
        cleanupAll([
          release,
          ...cancellationErrors.map((failure) => () => {
            throw failure;
          }),
        ]),
      );
    } finally {
      batchSignal.removeEventListener('abort', cancel);
    }
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    cleanupAll([
      () => this.pool.dispose(),
      () => this.delivery?.dispose(),
      () => this.manifests.clear(),
      () => this.pages.clear(),
    ]);
  }
  static async open(
    catalog: Readonly<Record<string, string>>,
    canvas?: HTMLCanvasElement,
    quality: Exclude<ImageQuality, 'source'> = 'delivery',
  ) {
    const response = await fetch('/build-mode.json');
    if (!response.ok) throw new Error('missing build-mode policy');
    const flags = await response.json();
    const delivery = canvas
      ? new TextureDelivery(
          canvas,
          new URLSearchParams(location.search).get('images') === 'source' ? 'source' : quality,
        )
      : undefined;
    const runtime = new AssetRuntime(catalog, undefined, undefined, undefined, delivery);
    runtime.libraryInventory = flags.libraryInventory === true;
    try {
      const registration = await fetch('/registration.json');
      if (!registration.ok) throw new Error('Prepared registration unavailable');
      const bytes = await registration.arrayBuffer(),
        digest = await sha256(bytes);
      if (digest !== flags.registrationHash) throw new Error('Prepared registration hash differs');
      runtime.registration = parseRegistration(JSON.parse(new TextDecoder().decode(bytes)));
      return runtime;
    } catch (error) {
      cleanupAfterFailure(error, () => runtime.dispose());
    }
  }
}
