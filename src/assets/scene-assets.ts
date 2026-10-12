import type { AssetPack, PackBatch } from './loader';

// A renderer borrows this stable view. Installation consumes the batch even when
// rebuilding the renderer throws: a partially rebuilt room may reference either
// generation. Only a successful rebuild, or renderer disposal, can release them.
export class SceneAssets {
  private readonly view = new Map<string, AssetPack>();
  private readonly held = new Set<PackBatch>();
  private closed = false;
  get packs(): ReadonlyMap<string, AssetPack> {
    return this.view;
  }
  install(next: PackBatch, rebuild: () => undefined) {
    if (this.closed) {
      next.release();
      throw new Error('Scene assets disposed');
    }
    this.held.add(next);
    this.view.clear();
    for (const [id, pack] of next.packs) this.view.set(id, pack);
    rebuild();
    for (const previous of this.held)
      if (previous !== next) {
        this.held.delete(previous);
        previous.release();
      }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.view.clear();
    for (const batch of this.held) batch.release();
    this.held.clear();
  }
}
