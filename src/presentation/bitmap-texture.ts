import { Texture } from 'three';
import { readUntilAborted } from '../assets/abort';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';

// A single immutable companion per renderer lifetime. Callers borrow the texture.
export class BitmapTexture {
  private readonly lifetime = new AbortController();
  private pending?: Promise<Texture>;
  private texture?: Texture;
  constructor(
    private readonly decode: (signal: AbortSignal) => Promise<ImageBitmap>,
    private readonly configure: (texture: Texture) => void,
  ) {}
  get value() {
    return this.texture;
  }
  load(): Promise<Texture> {
    if (this.lifetime.signal.aborted) return Promise.reject(new Error('companion disposed'));
    if (this.texture) return Promise.resolve(this.texture);
    if (this.pending) return this.pending;
    // Register before running transport or decoder code; reentrant loads share it.
    const operation = Promise.resolve().then(async () => {
      this.lifetime.signal.throwIfAborted();
      const bitmap = await this.decode(this.lifetime.signal);
      if (this.lifetime.signal.aborted) {
        bitmap.close();
        throw new Error('companion disposed');
      }
      const texture = new Texture(bitmap);
      try {
        this.configure(texture);
        this.lifetime.signal.throwIfAborted();
      } catch (error) {
        cleanupAfterFailure(error, () =>
          cleanupAll([() => texture.dispose(), () => bitmap.close()]),
        );
      }
      this.texture = texture;
      return texture;
    });
    this.pending = readUntilAborted(operation, this.lifetime.signal).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    const texture = this.texture;
    this.texture = undefined;
    if (texture)
      cleanupAll([() => texture.dispose(), () => (texture.image as ImageBitmap).close()]);
  }
}
