import {parseRegistration,type PreparedRegistration} from './registration';
import {Texture, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter} from 'three';
import {parseManifest, type Manifest} from './schema';
type Entry<T> = {
  refs: number;
  promise: Promise<T>;
  value?: T;
  dispose: (value: T) => void;
};
export class ResourcePool<T> {
  entries = new Map<string, Entry<T>>();
  constructor(
    private load: (id: string) => Promise<T>,
    private dispose: (value: T) => void,
  ) {}
  retain(id: string) {
    let entry = this.entries.get(id);
    if (!entry) {
      const created = {refs: 0, dispose: this.dispose} as Entry<T>;
      entry = created;
      created.promise = this.load(id).then(
        (value) => {
          created.value = value;
          if (created.refs === 0) {
            created.dispose(value);
            if (this.entries.get(id) === created) this.entries.delete(id);
          }
          return value;
        },
        (error) => {
          if (this.entries.get(id) === created) this.entries.delete(id);
          throw error;
        },
      );
      this.entries.set(id, created);
    }
    entry.refs++;
    const held = entry;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        held.refs--;
        if (held.refs === 0 && held.value) {
          held.dispose(held.value);
          if (this.entries.get(id) === held) this.entries.delete(id);
        }
      },
    };
  }
  async acquire(
    ids: string[],
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ) {
    if (signal?.aborted) throw new Error('load cancelled');
    const leases = [...new Set(ids)].map(
      (id) => [id, this.retain(id)] as const,
    );
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      leases.forEach(([, l]) => l.release());
    };
    const abort = () => release();
    signal?.addEventListener('abort', abort, {once: true});
    let done = 0;
    try {
      const results = await Promise.all(
        leases.map(async ([id, l]) => {
          const value = await l.promise;
          onProgress?.(++done, leases.length);
          return [id, value] as const;
        }),
      );
      if (signal?.aborted) throw new Error('load cancelled');
      return {resources: new Map(results), release};
    } catch (error) {
      release();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}
export type PackLease = {
  manifest: Manifest;
  textures: Map<string, Texture>;
  release: () => void;
};
type PageRequest = {url: string; hash: string; width: number; height: number; mipmaps?: boolean};
export const pageIdentity = (
  p: Pick<Manifest['pages'][number], 'hash' | 'width' | 'height'> & {mipmaps?:boolean},
) => `${p.hash}:${p.width}x${p.height}:srgb-straight-${p.mipmaps?'terrain-mips':'linear-no-mips'}`;
export class AssetRuntime {
  registration!:PreparedRegistration;
  readonly manifests = new Map<string, Promise<Manifest>>();
  private pages = new Map<string, PageRequest>();
  readonly pool: ResourcePool<Texture>;
  constructor(
    public readonly catalog: Readonly<Record<string, string>>,
    private production = false,
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
    decode?: (page: PageRequest) => Promise<Texture>,
    dispose?: (texture: Texture) => void,
  ) {
    for (const [id, url] of Object.entries(catalog))
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
        const response = await this.request(p.url);
        if (!response.ok) throw new Error(`${p.url}: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
        )
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        if (digest !== p.hash) throw new Error(`${p.url}: hash mismatch`);
        const bitmap = await createImageBitmap(
          new Blob([buffer], {type: 'image/png'}),
          {
            imageOrientation: 'flipY',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          },
        );
        if (bitmap.width !== p.width || bitmap.height !== p.height) {
          bitmap.close();
          throw new Error('page dimensions differ');
        }
        const texture = new Texture(bitmap);
        texture.colorSpace = SRGBColorSpace;
        texture.generateMipmaps = p.mipmaps===true;
        texture.minFilter = p.mipmaps?LinearMipmapLinearFilter:LinearFilter;
        texture.magFilter = LinearFilter;
        texture.flipY = false;
        texture.premultiplyAlpha = false;
        texture.needsUpdate = true;
        return texture;
      },
      dispose ??
        ((texture) => {
          (texture.image as ImageBitmap).close();
          texture.dispose();
        }),
    );
  }
  get developmentContent() {
    return !this.production;
  }
  async manifest(id: string) {
    let promise = this.manifests.get(id);
    if (!promise) {
      const path = this.catalog[id];
      if (!path) throw new Error(`unknown asset ${id}`);
      promise = this.request('/' + path)
        .then(async (r) => {
          if (!r.ok) throw new Error(`manifest unavailable: ${id}`);
          const manifest = parseManifest(await r.json(), this.production);
          for (const page of manifest.pages) {
            const key = pageIdentity(page),
              url = '/' + path.slice(0, path.lastIndexOf('/') + 1) + page.path;
            if (!this.pages.has(key))
              this.pages.set(key, {
                url,
                hash: page.hash,
                width: page.width,
                height: page.height,
                mipmaps: page.mipmaps,
              });
          }
          return manifest;
        })
        .catch((e) => {
          this.manifests.delete(id);
          throw e;
        });
      this.manifests.set(id, promise);
    }
    return promise;
  }
  async loadPack(
    id: string,
    signal?: AbortSignal,
    progress?: (done: number, total: number) => void,
  ): Promise<PackLease> {
    if (signal?.aborted) throw new Error('load cancelled');
    const manifest = await this.manifest(id);
    if (signal?.aborted) throw new Error('load cancelled');
    const held = await this.pool.acquire(
      manifest.pages.map(pageIdentity),
      signal,
      progress,
    );
    return {
      manifest,
      textures: new Map(
        manifest.pages.map((p) => [p.id, held.resources.get(pageIdentity(p))!]),
      ),
      release: held.release,
    };
  }
  static async open(catalog: Readonly<Record<string, string>>) {
    const response = await fetch('/build-mode.json');
    if (!response.ok) throw new Error('missing build-mode policy');
    const flags = await response.json();
    const runtime=new AssetRuntime(catalog,flags.allowDevelopmentContent!==true);const registration=await fetch('/registration.json');if(!registration.ok)throw new Error('Prepared registration unavailable');const bytes=await registration.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!==flags.registrationHash)throw new Error('Prepared registration hash differs');runtime.registration=parseRegistration(JSON.parse(new TextDecoder().decode(bytes)));return runtime;
  }
}
