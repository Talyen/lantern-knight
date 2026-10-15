import { groundPlacementPolicy } from '../content/scene-placement';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';
import { NavigationOverlay } from '../presentation/navigation-overlay';
import { walkablePoint } from '../presentation/camera';
import { editorError } from './errors';
import { Application } from '../application';
import { GamePresentation } from '../presentation/game-scene';
import type { ContentRegistry } from '../content/world';
import type { SceneContent } from '../content/game-content';
import {
  parseSceneDocument,
  type SceneDocument,
  type SceneSnapshot,
} from '../content/scene-document';
import type { Bridge } from '../platform/bridge';
import { heightAt, isSupportedPosition } from '../content/world';
import { Navigation, effectiveRadius } from '../core/navigation';
type Host = {
  document: () => SceneSnapshot;
  compose: (snapshot: SceneSnapshot) => { registry: ContentRegistry; scenes: SceneContent };
  catalog: () => Readonly<Record<string, string>>;
  status: (message: string, error?: boolean) => void;
};
export class DraftPlaytest {
  private movement = false;
  private overlay?: NavigationOverlay;
  private selectedActor = 'player';
  private lifetime = new AbortController();
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
      '<header><strong>Scene playtest</strong><button id="playtest-pause">Pause</button><button id="playtest-reset">Restart</button><button id="playtest-return">Return to editor</button></header><canvas id="playtest-viewport" tabindex="0" aria-label="Scene gameplay"></canvas><p id="playtest-status" role="status"></p>';
    const movementControls = document.createElement('div');
    movementControls.id = 'movement-controls';
    movementControls.hidden = true;
    movementControls.innerHTML =
      '<label>Actor<select id="movement-actor"></select></label><button id="movement-follow">Follow hero</button><label><input id="movement-outline" type="checkbox" checked> Hidden actor outlines</label><label>Test destination<select id="movement-destination"><option value="">Choose annotation</option></select></label><span id="movement-route-status" role="status"></span>';
    for (const key of ['blockers', 'masks', 'depth', 'cells', 'routes', 'footprints']) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = ['blockers', 'routes', 'footprints'].includes(key);
      input.onchange = () => {
        if (this.overlay) {
          Object.assign(this.overlay.options, { [key]: input.checked });
          this.overlay.invalidate();
        }
      };
      label.append(input, ' ' + key);
      movementControls.append(label);
    }
    this.dialog.insertBefore(movementControls, this.dialog.querySelector('canvas'));
    document.body.append(this.dialog);
    this.canvas = this.dialog.querySelector('canvas')!;
    const button = document.createElement('button');
    button.id = 'play-from-here';
    button.textContent = 'Play';
    button.onclick = () => void this.start().catch((e) => host.status(editorError(e), true));
    document.getElementById('play-action')!.append(button);
    const movementButton = document.createElement('button');
    movementButton.id = 'test-movement';
    movementButton.textContent = 'Test movement';
    movementButton.onclick = () =>
      void this.start(undefined, true).catch((e) => host.status(editorError(e), true));
    const tests = document.createElement('details');
    tests.className = 'menu';
    const summary = document.createElement('summary');
    summary.textContent = 'Test';
    const body = document.createElement('div');
    body.className = 'menu-body';
    body.append(movementButton);
    tests.append(summary, body);
    document.getElementById('play-action')!.append(tests);
    this.dialog.querySelector<HTMLSelectElement>('#movement-actor')!.onchange = (e) => {
      this.selectedActor = (e.target as HTMLSelectElement).value;
      this.canvas.focus();
    };
    this.dialog.querySelector<HTMLSelectElement>('#movement-destination')!.onchange = (e) => {
      const value = (e.target as HTMLSelectElement).value;
      if (value === '') return;
      const index = Number(value);
      const point = this.snapshot?.groundInteraction?.destinations[index];
      if (point && this.app)
        this.app.editPreview((sim) => {
          sim.setMovementTarget(this.selectedActor, point);
        });
      this.canvas.focus();
    };
    this.dialog.querySelector<HTMLButtonElement>('#movement-follow')!.onclick = () => {
      if (this.app && this.selectedActor !== this.app.sim.hero.id)
        this.app.editPreview((sim) => {
          sim.setMovementTarget(this.selectedActor, null);
        });
      this.canvas.focus();
    };
    this.dialog.querySelector<HTMLInputElement>('#movement-outline')!.onchange = (e) => {
      if (this.app?.presentation.groundOcclusion)
        this.app.presentation.groundOcclusion.outlines = (e.target as HTMLInputElement).checked;
    };
    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.movement || !this.app || e.button !== 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.canvas.focus();
        const point = walkablePoint(
          this.app.presentation.camera,
          e.clientX,
          e.clientY,
          this.canvas.getBoundingClientRect(),
          this.app.sim.areaDefinition,
        );
        if (point)
          this.app.editPreview((sim) => {
            sim.setMovementTarget(this.selectedActor, point);
          });
      },
      { capture: true, signal: this.lifetime.signal },
    );
    this.dialog.querySelector<HTMLButtonElement>('#playtest-return')!.onclick = () => this.close();
    this.dialog.querySelector<HTMLButtonElement>('#playtest-pause')!.onclick = () => {
      this.app?.pause(!this.app.paused);
      if (this.app && !this.app.paused) this.canvas.focus();
    };
    this.dialog.querySelector<HTMLButtonElement>('#playtest-reset')!.onclick = () => {
      if (this.snapshot)
        void this.start(this.snapshot, this.movement).catch((e) =>
          host.status(editorError(e), true),
        );
    };
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.app?.pause(!this.app.paused);
    });
    this.dialog.addEventListener('close', () => this.close());
  }
  async start(snapshot = this.host.document(), movement = false) {
    if (this.closed || this.busy) return;
    this.movement = movement;
    this.dialog.querySelector<HTMLElement>('#movement-controls')!.hidden = !movement;
    this.busy = true;
    const request = ++this.request;
    try {
      this.releasePreview();
      this.snapshot = parseSceneDocument(snapshot);
      let { registry, scenes } = this.host.compose(this.snapshot);
      if (movement && registry.area(registry.definitions.initialArea).spawns.length < 3) {
        const area = registry.area(registry.definitions.initialArea),
          navigation = new Navigation(area),
          radius = effectiveRadius(registry.actor('skeleton').radius),
          placementIssue = groundPlacementPolicy(this.snapshot, area);
        this.snapshot.gameplay ??= { spawns: [], exits: [], pickups: [] };
        const spawns = this.snapshot.gameplay.spawns;
        for (let distance = 2; distance <= 12 && spawns.length < 3; distance += 1)
          for (let angle = 0; angle < 16 && spawns.length < 3; angle++) {
            const point = {
              x: this.snapshot.hero.x + Math.cos((((angle * 5) % 16) * Math.PI) / 8) * distance,
              z: this.snapshot.hero.z + Math.sin((((angle * 5) % 16) * Math.PI) / 8) * distance,
            };
            if (
              !isSupportedPosition(area, point, radius) ||
              placementIssue(point, radius) ||
              spawns.some((p) => Math.hypot(p.x - point.x, p.z - point.z) < 1.5) ||
              navigation.route(this.snapshot.hero, point, radius).status !== 'ready'
            )
              continue;
            spawns.push({ id: 'movement-' + crypto.randomUUID(), actor: 'skeleton', ...point });
          }
        if (spawns.length < 3)
          throw new Error(
            'Could not place three reachable skeletons. Review the playable terrain.',
          );
        ({ registry, scenes } = this.host.compose(this.snapshot));
      }
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
          frame: () => {
            if (this.movement && this.app) {
              this.overlay?.update(this.app.sim, this.app.presentation.visuals);
              const route = this.app.sim
                .navigationDebug(false)
                .routes.find((r) => r.id === this.selectedActor);
              this.dialog.querySelector('#movement-route-status')!.textContent =
                route?.status === 'unreachable'
                  ? 'Destination unreachable'
                  : route
                    ? 'Following route'
                    : 'Click ground to route the selected actor';
            }
          },
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
      app.editPreview((sim) => {
        Object.assign(sim.hero, { x: hero.x, z: hero.z, px: hero.x, pz: hero.z, y, py: y });
        sim.movementPreview = movement;
      });
      this.selectedActor = app.sim.hero.id;
      this.dialog
        .querySelector<HTMLSelectElement>('#movement-destination')!
        .replaceChildren(
          new Option('Choose annotation', ''),
          ...(this.snapshot.groundInteraction?.destinations ?? []).map(
            (p, i) => new Option(p.name, String(i)),
          ),
        );
      const actorSelect = this.dialog.querySelector<HTMLSelectElement>('#movement-actor')!;
      actorSelect.replaceChildren(
        ...app.sim.actors.map((a) => new Option(a.kind === 'hero' ? 'Hero' : a.id, a.id)),
      );
      if (movement) {
        this.overlay = new NavigationOverlay();
        app.presentation.scene.add(this.overlay.group);
      }
      app.pause(false);
      this.canvas.focus();
    } catch (error) {
      cleanupAfterFailure(error, () => {
        if (request === this.request) this.close();
      });
    } finally {
      this.busy = false;
    }
  }
  private releasePreview() {
    const overlay = this.overlay,
      app = this.app;
    // Consume capabilities before external destruction can fail or re-enter.
    this.overlay = undefined;
    this.app = undefined;
    cleanupAll([() => overlay?.dispose(), () => app?.dispose()]);
  }
  close() {
    ++this.request;
    cleanupAll([
      () => this.releasePreview(),
      () => {
        if (this.dialog.open) {
          this.dialog.close();
          document.getElementById('viewport')?.focus();
        }
      },
    ]);
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
          movement: this.movement,
          actors: this.app.sim.actors.map((a) => ({ id: a.id, x: a.x, z: a.z, health: a.health })),
          navigation: this.app.sim.navigationDebug(),
        }
      : undefined;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.snapshot = undefined;
    cleanupAll([() => this.lifetime.abort(), () => this.close(), () => this.dialog.remove()]);
  }
}
