import type { Bridge } from './platform/bridge';
import type { GameSave } from './core/save';
// Adapters own write ordering. The application keeps only useful operation feedback.
export class Persistence {
  error = '';
  constructor(private bridge: Pick<Bridge, 'loadGame' | 'saveGame'>) {}
  load() {
    return this.bridge.loadGame();
  }
  async save(value: GameSave) {
    try {
      await this.bridge.saveGame(value);
      this.error = '';
      return true;
    } catch (error) {
      this.error = String((error as Error | null | undefined)?.message ?? error);
      throw error;
    }
  }
}
