import * as T from 'three';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';
import { ResourcePool } from '../assets/resource-pool';
import { BitmapTexture } from './bitmap-texture';
import { verifiedBitmap } from '../assets/bitmap';
import { readUntilAborted } from '../abort';
import { DecodeQueue } from '../assets/decode-queue';
import type { ActorSprite } from './sprite';

type Companion = {
  file: string;
  hash: string;
  sourceHash: string;
  rect: number[];
  trim: number[];
  width: number;
  height: number;
};
export class NormalLibrary {
  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private entries: Record<string, Companion> = {};
  private current = { textures: new Map<string, T.Texture>(), release: () => {} };
  private readonly pool = new ResourcePool(
    async (key, signal) => {
      const entry = this.entries[key]!;
      const owner = new BitmapTexture(
        (signal) =>
          this.decodes.run(
            () => verifiedBitmap('/lighting/' + entry.file, entry, this.request, signal),
            signal,
          ),
        (texture) => {
          texture.flipY = false;
          texture.generateMipmaps = false;
          texture.minFilter = texture.magFilter = T.LinearFilter;
          texture.needsUpdate = true;
        },
      );
      const cancel = () => owner.dispose();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        await owner.load();
        signal.throwIfAborted();
        return owner;
      } catch (error) {
        cleanupAfterFailure(error, cancel);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    (owner) => owner.dispose(),
  );
  get textures(): ReadonlyMap<string, T.Texture> {
    return this.current.textures;
  }
  get bytes() {
    return [...this.current.textures.values()].reduce((sum, texture) => {
      const image = texture.image as ImageBitmap;
      return sum + image.width * image.height * 4;
    }, 0);
  }
  private disposed = false;
  private readonly lifetime = new AbortController();
  private readonly decodes = new DecodeQueue(8);
  private inventory?: Promise<void>;
  private pending = Promise.resolve();
  load(assets: Iterable<string>, signal?: AbortSignal) {
    if (this.disposed) return Promise.reject(new Error('lighting companions disposed'));
    const selected = [...assets],
      lifetime = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    const operation = this.pending.then(() => this.loadSelected(selected, lifetime));
    this.pending = operation.catch(() => {});
    // Queued callers also stop waiting immediately. The internal queue advances
    // only after the cancelled selection has released its completed staging.
    return readUntilAborted(operation, lifetime);
  }
  private async loadSelected(assets: Iterable<string>, signal: AbortSignal) {
    signal.throwIfAborted();
    this.inventory ??= (async () => {
      const response = await this.request('/lighting/manifest.json', {
        signal: this.lifetime.signal,
      });
      if (!response.ok) throw new Error('Lighting companions unavailable.');
      const manifest = await response.json();
      if (manifest.recipe !== 'alpha-volume-v1')
        throw new Error('Lighting companion recipe differs');
      this.lifetime.signal.throwIfAborted();
      this.entries = manifest.entries;
    })().catch((error) => {
      this.inventory = undefined;
      throw error;
    });
    await readUntilAborted(this.inventory, signal);
    signal.throwIfAborted();
    const selected = new Set(assets);
    const keys = Object.keys(this.entries).filter((key) => selected.has(key.split(':')[0]!));
    // Normal replacements retain the accepted selection until all staging settles.
    const held = await this.pool.acquire(keys, signal, undefined, false);
    if (signal.aborted) cleanupAfterFailure(signal.reason, held.release);
    const previous = this.current;
    this.current = {
      textures: new Map([...held.resources].map(([key, owner]) => [key, owner.value!])),
      release: held.release,
    };
    previous.release();
  }
  get(sprite: ActorSprite, frame = sprite.lightingSample?.frame) {
    if (!frame) return undefined;
    const key = `${sprite.manifest.asset.id}:${frame.id}`,
      entry = this.entries[key];
    if (!entry) return undefined;
    const page = sprite.manifest.pages.find((p) => p.id === frame.page)!;
    if (
      entry.sourceHash !== page.hash ||
      entry.rect.join() !== frame.rect.join() ||
      entry.trim.join() !== frame.trim.join()
    )
      throw new Error(`stale lighting companion: ${key}`);
    return this.current.textures.get(key);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.current = { textures: new Map(), release: () => {} };
    this.lifetime.abort();
    cleanupAll([() => this.decodes.dispose(), () => this.pool.dispose()]);
  }
}
