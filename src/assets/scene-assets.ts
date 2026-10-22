import { cleanupAll } from './cleanup';
import type { AssetPack, PackBatch } from './loader';

// A renderer borrows this stable view. Installation consumes the batch even when
// rebuilding the renderer throws: a partially rebuilt room may reference either
// generation. Only a successful rebuild, or renderer disposal, can release them.
export class SceneAssets {
  private readonly view = new Map<string, AssetPack>();
  private readonly held = new Set<PackBatch>();
  private closed = false;
  private installation = 0;
  private rebuilding = 0;
  get packs(): ReadonlyMap<string, AssetPack> {
    return this.view;
  }
  install(next: PackBatch, rebuild: () => void) {
    if (this.closed) {
      next.release();
      throw new Error('Scene assets disposed');
    }
    this.held.add(next);
    const installation = ++this.installation;
    this.view.clear();
    for (const [id, pack] of next.packs) this.view.set(id, pack);
    this.rebuilding++;
    try {
      rebuild();
    } catch (error) {
      if (!this.closed) {
        // A failed rebuild may keep either generation. Expose both so preview
        // inspection can still resolve a renderer that rolled itself back.
        this.exposeHeld();
      }
      throw error;
    } finally {
      this.rebuilding--;
    }
    // External rebuilding can dispose this owner or install a successor. The
    // returning predecessor cannot release resources borrowed by that successor.
    if (this.closed) return;
    if (this.rebuilding || installation !== this.installation) {
      // A suspended outer rebuild can resume borrowing either generation, even
      // after a nested installation succeeds. Only a later independent rebuild
      // can prove that those borrows have ended.
      this.exposeHeld();
      return;
    }
    const previous = [...this.held].filter((batch) => batch !== next);
    for (const batch of previous) this.held.delete(batch);
    cleanupAll(previous.map((batch) => () => batch.release()));
  }
  private exposeHeld() {
    this.view.clear();
    for (const batch of this.held) for (const [id, pack] of batch.packs) this.view.set(id, pack);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.view.clear();
    const held = [...this.held];
    this.held.clear();
    cleanupAll(held.map((batch) => () => batch.release()));
  }
}
