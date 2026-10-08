import type { Bridge, GameSave, LoadResult } from './save';
// Session write authorization is independent of gameplay and filesystem recovery.
export class Persistence {
  mode: 'uninspected' | 'empty' | 'protected' | 'enabled' | 'unreadable' = 'uninspected';
  error = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private bridge: Pick<Bridge, 'loadGame' | 'saveGame'>) {}
  get canWrite() {
    return this.mode === 'empty' || this.mode === 'enabled';
  }
  async inspect() {
    const result = await this.bridge.loadGame();
    this.mode =
      result.status === 'empty'
        ? 'empty'
        : result.status === 'unreadable'
          ? 'unreadable'
          : 'protected';
    if (result.status === 'unreadable') this.error = result.message;
    return result;
  }
  async load(): Promise<LoadResult<GameSave>> {
    await this.queue;
    return this.bridge.loadGame();
  }
  loaded() {
    this.mode = 'enabled';
    this.error = '';
  }
  confirmNew() {
    if (this.mode === 'unreadable' || this.mode === 'uninspected')
      throw new Error('Existing save is unreadable; it has been preserved.');
    this.mode = 'enabled';
  }
  save(value: GameSave, automatic = false): Promise<boolean> {
    if (!this.canWrite) {
      if (automatic) return Promise.resolve(false);
      return Promise.reject(new Error('Choose Load or confirm New Game before saving.'));
    }
    const snapshot = structuredClone(value),
      write = async () => {
        try {
          await this.bridge.saveGame(snapshot);
          this.error = '';
          return true;
        } catch (e) {
          this.error = String((e as Error).message ?? e);
          throw e;
        }
      };
    const result = this.queue.then(write);
    this.queue = result.catch(() => {});
    return result;
  }
  async settled() {
    await this.queue;
  }
}
