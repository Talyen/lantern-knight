import type { Bridge, GameSave } from './save';
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
      this.error = String((error as Error).message ?? error);
      throw error;
    }
  }
}
