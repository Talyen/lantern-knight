import type { Bridge } from './platform/bridge';
import type { GameSave } from './core/save';
import type { Settings } from './platform/settings';
import { readUntilAborted } from './abort';
import { SessionOperationCancelled } from './session-operation';

// Adapters own admitted I/O and its ordering. This owner revokes application
// admission and waits, without cancelling writes already submitted to an adapter.
export class Persistence {
  private error = '';
  private readonly lifetime = new AbortController();
  readonly view: { readonly error: string };
  constructor(
    private readonly bridge: Bridge,
    private readonly admitCheckpoint: () => void,
  ) {
    const readError = () => this.error;
    this.view = Object.freeze({
      get error() {
        return readError();
      },
    });
  }
  private async run<T>(work: () => Promise<T>): Promise<T> {
    this.lifetime.signal.throwIfAborted();
    try {
      const value = await readUntilAborted(work(), this.lifetime.signal);
      this.lifetime.signal.throwIfAborted();
      return value;
    } catch (error) {
      this.lifetime.signal.throwIfAborted();
      throw error;
    }
  }
  load() {
    return this.run(() => this.bridge.loadGame());
  }
  loadSettings() {
    return this.run(() => this.bridge.loadSettings());
  }
  saveSettings(value: Settings) {
    return this.run(() => this.bridge.saveSettings(value));
  }
  async save(value: GameSave) {
    this.lifetime.signal.throwIfAborted();
    this.admitCheckpoint();
    try {
      await this.run(() => this.bridge.saveGame(value));
      this.lifetime.signal.throwIfAborted();
      this.error = '';
      return true;
    } catch (error) {
      this.lifetime.signal.throwIfAborted();
      this.error = String((error as Error | null | undefined)?.message ?? error);
      throw error;
    }
  }
  dispose() {
    this.lifetime.abort(new SessionOperationCancelled('application disposed'));
  }
}
