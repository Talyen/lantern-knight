import * as T from 'three';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';
import { verifiedBitmap } from '../assets/bitmap';
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
function disposeNormal(texture: T.Texture) {
  cleanupAll([() => texture.dispose(), () => (texture.image as ImageBitmap).close()]);
}
export class NormalLibrary {
  private entries: Record<string, Companion> = {};
  private current = { textures: new Map<string, T.Texture>(), bytes: 0 };
  get textures(): ReadonlyMap<string, T.Texture> {
    return this.current.textures;
  }
  get bytes() {
    return this.current.bytes;
  }
  private disposed = false;
  private readonly lifetime = new AbortController();
  private inventory?: Promise<void>;
  private pending = Promise.resolve();
  load(assets: Iterable<string>) {
    if (this.disposed) return Promise.reject(new Error('lighting companions disposed'));
    const selected = [...assets];
    const operation = this.pending.then(() => this.loadSelected(selected));
    this.pending = operation.catch(() => {});
    return operation;
  }
  private async loadSelected(assets: Iterable<string>) {
    this.lifetime.signal.throwIfAborted();
    this.inventory ??= (async () => {
      const response = await fetch('/lighting/manifest.json', { signal: this.lifetime.signal });
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
    await this.inventory;
    this.lifetime.signal.throwIfAborted();
    const selected = new Set(assets),
      wanted = Object.entries(this.entries).filter(([key]) => selected.has(key.split(':')[0]!)),
      keep = new Set(wanted.map(([key]) => key)),
      missing = wanted.filter(([key]) => !this.current.textures.has(key)),
      acquired = new Map<string, T.Texture>();
    let index = 0;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(8, missing.length) }, async () => {
        while (!this.disposed && index < missing.length) {
          const [key, entry] = missing[index++]!;
          const bitmap = await verifiedBitmap(
            '/lighting/' + entry.file,
            entry,
            fetch,
            this.lifetime.signal,
          );
          if (this.disposed) {
            bitmap.close();
            return;
          }
          const texture = new T.Texture(bitmap);
          acquired.set(key, texture);
          texture.flipY = false;
          texture.generateMipmaps = false;
          texture.minFilter = T.LinearFilter;
          texture.magFilter = T.LinearFilter;
          texture.needsUpdate = true;
        }
      }),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure || this.disposed) {
      const error = failure?.status === 'rejected' ? failure.reason : this.lifetime.signal.reason;
      cleanupAfterFailure(error, () =>
        cleanupAll([...acquired.values()].map((texture) => () => disposeNormal(texture))),
      );
    }
    const removed = [...this.current.textures].filter(([key]) => !keep.has(key));
    // Transfer the complete selection before calling external dispose listeners.
    // Failed retirement cannot leave disposed textures installed or bytes stale.
    const textures = new Map([
      ...[...this.current.textures].filter(([key]) => keep.has(key)),
      ...acquired,
    ]);
    this.current = {
      textures,
      bytes: [...textures.values()].reduce((sum, texture) => {
        const image = texture.image as ImageBitmap;
        return sum + image.width * image.height * 4;
      }, 0),
    };
    cleanupAll(
      removed.map(
        ([, texture]) =>
          () =>
            disposeNormal(texture),
      ),
    );
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
    const textures = [...this.current.textures.values()];
    this.current = { textures: new Map(), bytes: 0 };
    this.lifetime.abort();
    cleanupAll(textures.map((texture) => () => disposeNormal(texture)));
  }
}
