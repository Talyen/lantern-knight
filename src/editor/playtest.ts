import { editorError } from './errors';
import { Application } from '../application';
import { GamePresentation } from '../presentation/game-scene';
import type { ContentRegistry } from '../content/world';
import type { SceneContent } from '../content/game-content';
import type { SceneDocument } from '../content/scene-document';
import type { Bridge } from '../core/save';
import { heightAt } from '../content/world';
type Host = {
  document: () => SceneDocument;
  compose: (snapshot: SceneDocument) => { registry: ContentRegistry; scenes: SceneContent };
  catalog: () => Readonly<Record<string, string>>;
  status: (message: string, error?: boolean) => void;
};
export class DraftPlaytest {
  private dialog: HTMLDialogElement;
  private canvas: HTMLCanvasElement;
  private app: Application<GamePresentation> | undefined;
  private request = 0;
  private busy = false;
  private closed = false;
  private snapshot: SceneDocument | undefined;
  constructor(private host: Host) {
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'playtest-dialog';
    this.dialog.innerHTML =
      '<header><strong>Draft playtest</strong><button id="playtest-pause">Pause</button><button id="playtest-reset">Restart</button><button id="playtest-return">Return to editor</button></header><canvas id="playtest-viewport" tabindex="0" aria-label="Draft gameplay"></canvas><p id="playtest-status" role="status"></p>';
    document.body.append(this.dialog);
    this.canvas = this.dialog.querySelector('canvas')!;
    const button = document.createElement('button');
    button.id = 'play-from-here';
    button.textContent = 'Play';
    button.onclick = () => void this.start().catch((e) => host.status(editorError(e), true));
    document.getElementById('play-action')!.append(button);
    this.dialog.querySelector<HTMLButtonElement>('#playtest-return')!.onclick = () => this.close();
    this.dialog.querySelector<HTMLButtonElement>('#playtest-pause')!.onclick = () =>
      this.app?.pause(!this.app.paused);
    this.dialog.querySelector<HTMLButtonElement>('#playtest-reset')!.onclick = () => {
      if (this.snapshot)
        void this.start(this.snapshot).catch((e) => host.status(editorError(e), true));
    };
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.app?.pause(!this.app.paused);
    });
    this.dialog.addEventListener('close', () => this.close());
  }
  async start(snapshot = this.host.document()) {
    if (this.closed || this.busy) return;
    this.busy = true;
    this.app?.dispose();
    this.app = undefined;
    const request = ++this.request;
    try {
      this.snapshot = structuredClone(snapshot);
      const { registry, scenes } = this.host.compose(this.snapshot);
      // This bridge never touches browser or desktop storage. Unexpected writes fail.
      const bridge: Bridge = {
        automatedRun: new URLSearchParams(location.search).has('automated'),
        loadGame: async () => ({ status: 'empty' }),
        loadSettings: async () => ({ status: 'empty' }),
        saveGame: async () => {
          throw new Error('Playtests cannot write checkpoints');
        },
        saveSettings: async () => {
          throw new Error('Playtests cannot write preferences');
        },
      };
      const app = new Application(
        this.canvas,
        registry,
        this.host.catalog(),
        bridge,
        scenes,
        (...args) => new GamePresentation(...args),
        {
          status: (message, error) => {
            this.dialog.querySelector('#playtest-status')!.textContent = message;
            this.host.status(message, error);
          },
          pause: (paused) => {
            this.dialog.querySelector('#playtest-pause')!.textContent = paused ? 'Resume' : 'Pause';
          },
          frame: () => {},
        },
      );
      app.readOnly = true;
      this.app = app;
      if (!this.dialog.open) this.dialog.showModal();
      await app.boot();
      if (request !== this.request) {
        app.dispose();
        return;
      }
      const hero = this.snapshot.hero,
        y = heightAt(app.sim.areaDefinition, hero.x, hero.z);
      Object.assign(app.sim.hero, { x: hero.x, z: hero.z, px: hero.x, pz: hero.z, y, py: y });
      app.pause(false);
      this.canvas.focus();
    } catch (error) {
      if (request === this.request) this.close();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  close() {
    ++this.request;
    this.app?.dispose();
    this.app = undefined;
    if (this.dialog.open) {
      this.dialog.close();
      document.getElementById('viewport')?.focus();
    }
  }
  state() {
    return this.app
      ? {
          ready: this.app.ready,
          tick: this.app.sim.tick,
          hero: {
            x: this.app.sim.hero.x,
            z: this.app.sim.hero.z,
            health: this.app.sim.hero.health,
          },
          area: this.app.sim.area,
        }
      : undefined;
  }
  dispose() {
    this.closed = true;
    this.close();
    this.snapshot = undefined;
    this.dialog.remove();
  }
}
