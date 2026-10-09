import './effects.css';
import { LoadingScreen } from '../loading-screen';
import { Application } from '../application';
import { ContentRegistry } from '../content/world';
import { GameSession } from '../core/session';
import { EffectsPlayground } from '../presentation/effects-playground';
import { EffectsPresentation } from './effects-presentation';
import {
  effectsDefinitions,
  playgroundCatalog,
  effectLabels,
  playgroundDefaults,
  type PlaygroundEffect,
} from '../content/effects-playground';
import type { Bridge } from '../core/save';
import '../inspection';
declare global {
  interface Window {
    effectsPlayground: {
      readonly ready: boolean;
      readonly settings: ReturnType<typeof playgroundDefaults>;
      setEffect(key: PlaygroundEffect, value: boolean): void;
      setBaseline(value: boolean): void;
      setTreatment(value: 'quiet' | 'rich'): void;
      pause(value: boolean): void;
      step(ms: number): void;
      render(): void;
      reset(): void;
      stats(): ReturnType<EffectsPlayground['stats']>;
      diagnostics(): ReturnType<EffectsPlayground['diagnostics']>;
      dispose(): void;
    };
  }
}

export function mountEffects(selectScene: (scene: string) => void) {
  document.body.classList.add('effects-mode');
  const loading = new LoadingScreen();
  const settings = playgroundDefaults(),
    $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  document.getElementById('app')!.innerHTML =
    `<header><div><strong>Effects Playground</strong><span>Separate developer scene · SMAA 1× High</span></div><label>Scene<select id="scene-select"><option value="outdoor-fixture">Outdoor fixture</option><option value="interior-fixture">Interior fixture</option><option value="systems-fixture">Systems fixture</option><option value="effects-playground" selected>Effects test scene</option></select></label><button id="back">Return to Sandbox</button></header>
 <main><canvas id="scene" tabindex="0" aria-label="Effects Playground game"></canvas><aside><h1>Compare effects</h1>
 <label>Treatment<select id="treatment"><option value="quiet">Quiet ink</option><option value="rich">Richer HD-2D</option></select></label>
 <label class="compare"><input type="checkbox" id="baseline">Compare with all off</label>
 <div class="buttons"><button id="all-on">All on</button><button id="all-off">All off</button></div>
 ${Object.entries(effectLabels)
   .map(
     ([key, label]) =>
       `<label><input type="checkbox" data-effect="${key}" checked>${label}</label>`,
   )
   .join('')}
 <fieldset><legend>Outline appearance</legend><label>Thickness <output id="outline-width-value">1 px</output><input id="outline-width" type="range" min="0.5" max="2" step="0.25" value="1"></label><label>Opacity <output id="outline-opacity-value">25%</output><input id="outline-opacity" type="range" min="0" max="50" step="5" value="25"></label><label>Color<input id="outline-color" type="color" value="#29343b"></label></fieldset>
 <div class="buttons"><button id="pause">Pause</button><button id="reset">Replay from start</button></div>
 <p>WASD move · Shift dash · mouse aim · sword / lantern controls work. The left platform is sheltered from rain.</p><p>Switch one effect at a time, or compare your selection against all off.</p><output id="stats"></output></aside></main><footer id="status" role="status">Loading playground artwork…</footer>`;
  const registry = new ContentRegistry(effectsDefinitions);
  let app: Application<EffectsPresentation>;
  let view: EffectsPlayground;
  let disposed = false;
  const abort = new AbortController();
  function synchronize() {
    for (const box of document.querySelectorAll<HTMLInputElement>('[data-effect]'))
      box.checked = settings.effects[box.dataset.effect as PlaygroundEffect];
    $('baseline').classList.toggle('active', settings.baseline);
    $<HTMLInputElement>('baseline').checked = settings.baseline;
    $<HTMLSelectElement>('treatment').value = settings.treatment;
    $('pause').textContent = settings.paused ? 'Resume' : 'Pause';
  }

  function pause() {
    app.pause(!app.paused);
  }
  function reset() {
    app.session = new GameSession(
      registry,
      903,
      effectsDefinitions.initialArea,
      app.session.generation + 1,
    );
    view.time = 0;
    app.clock.reset();
    app.input.clear();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    document.body.classList.remove('effects-mode');
    app?.dispose();
    loading.dispose();
    window.removeEventListener('beforeunload', dispose);
  }
  async function boot() {
    const response = await fetch('/dev-effects/emitters.json', { signal: abort.signal });
    if (!response.ok) throw new Error('playground emitter registration missing');
    const emitters = await response.json();
    abort.signal.throwIfAborted();
    const bridge: Bridge = {
      automatedRun: window.lantern?.automatedRun,
      loadGame: async () => ({ status: 'empty' }),
      loadSettings: async () => ({ status: 'empty' }),
      saveGame: async () => {
        throw new Error('Sandbox checkpoint writes denied');
      },
      saveSettings: async () => {},
    };
    app = new Application(
      $('scene'),
      registry,
      playgroundCatalog,
      bridge,
      {
        initialAssets: Object.keys(playgroundCatalog),
        area: (id) => ({ area: registry.area(id), assets: [] }),
        validate: () => {},
      },
      (canvas, packs) => {
        view = new EffectsPlayground(canvas, packs, emitters);
        return new EffectsPresentation(view, settings);
      },
      {
        status: (message) => {
          $('status').textContent = message;
        },
        pause: (value) => {
          settings.paused = value;
          synchronize();
        },
        frame: () => {
          const stats = view.stats();
          $('stats').textContent =
            `${settings.baseline ? 'All effects off' : settings.treatment === 'quiet' ? 'Quiet ink' : 'Richer HD-2D'}\n${stats.buffer.join(' × ')} · ${stats.objects.textures} textures\nTime ${stats.time.toFixed(1)} s`;
        },
        loading: loading.set,
      },
    );
    app.session = new GameSession(registry, 903);
    app.readOnly = true;
    app.beforeStep = (sim) =>
      sim.enemies.forEach((enemy) => {
        enemy.stun = 2;
      });
    await app.boot();
    abort.signal.throwIfAborted();
    for (const box of document.querySelectorAll<HTMLInputElement>('[data-effect]'))
      box.onchange = () => (settings.effects[box.dataset.effect as PlaygroundEffect] = box.checked);
    $('baseline').onchange = () => {
      settings.baseline = $<HTMLInputElement>('baseline').checked;
      synchronize();
    };
    $('treatment').onchange = () =>
      (settings.treatment = $<HTMLSelectElement>('treatment').value as 'quiet' | 'rich');
    for (const [id, enabled] of [
      ['all-on', true],
      ['all-off', false],
    ] as const)
      $(id).onclick = () => {
        for (const key of Object.keys(effectLabels) as PlaygroundEffect[])
          settings.effects[key] = enabled;
        settings.baseline = false;
        synchronize();
      };
    $('outline-width').oninput = () => {
      settings.outline.thickness = Number($<HTMLInputElement>('outline-width').value);
      $('outline-width-value').textContent = settings.outline.thickness + ' px';
    };
    $('outline-opacity').oninput = () => {
      settings.outline.opacity = Number($<HTMLInputElement>('outline-opacity').value) / 100;
      $('outline-opacity-value').textContent = Math.round(settings.outline.opacity * 100) + '%';
    };
    $('outline-color').oninput = () =>
      (settings.outline.color = $<HTMLInputElement>('outline-color').value);
    $('pause').onclick = pause;
    $('reset').onclick = reset;
    $('back').onclick = () => selectScene('outdoor-fixture');
    $('scene-select').onchange = () => selectScene($<HTMLSelectElement>('scene-select').value);
    $('status').textContent = 'Developer experiment only · no checkpoints or settings written';
    synchronize();
  }
  window.effectsPlayground = {
    get ready() {
      return !disposed && (app?.ready ?? false);
    },
    get settings() {
      return structuredClone(settings);
    },
    setEffect(key: PlaygroundEffect, value: boolean) {
      settings.effects[key] = value;
      synchronize();
    },
    setBaseline(value: boolean) {
      settings.baseline = value;
      synchronize();
    },
    setTreatment(value: 'quiet' | 'rich') {
      settings.treatment = value;
      synchronize();
    },
    pause(value: boolean) {
      app.pause(value);
    },
    step(ms: number) {
      view.draw(app.sim, 1, ms, { ...settings, paused: false });
    },
    render() {
      view.draw(app.sim, 1, 0, settings);
    },
    reset,
    stats: () => view.stats(),
    diagnostics: () => view.diagnostics(),
    dispose,
  };
  window.addEventListener('beforeunload', dispose);
  void boot().catch((error) => {
    if (!disposed) {
      $('status').textContent = `Playground failed: ${error.message}`;
      console.error(error);
    }
    dispose();
  });
  return dispose;
}
