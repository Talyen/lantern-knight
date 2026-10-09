import { authoringCatalog } from '../assets/authoring-catalog';
import { AssetRuntime } from '../assets/loader';
import { bindAssetPicker } from './asset-picker';
import { mountShell } from './shell';
import type { PreviewContext, EffectsState } from './workspace';
import { supportedPosition, heightAt } from '../content/world';
import { assetPickerUI, previewHUD } from './ui';
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

export function mountEffects(context: PreviewContext) {
  const loading = new LoadingScreen();
  const settings = playgroundDefaults(),
    $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const shell = mountShell(
    context,
    `<section data-preview-panel="visuals" hidden>
    <label>Treatment<select id="treatment"><option value="quiet">Quiet ink</option><option value="rich">Richer HD-2D</option></select></label>
    <label>All effects off<input type="checkbox" id="baseline"></label>
    <details data-section="effects-individual"><summary>Individual effects</summary><div class="buttons"><button id="all-on">All on</button><button id="all-off">All off</button></div>
    ${Object.entries(effectLabels)
      .map(
        ([key, label]) =>
          `<label>${label}<input type="checkbox" data-effect="${key}" checked></label>`,
      )
      .join('')}</details>
    <details data-section="effects-outline"><summary>Outline appearance</summary><label for="outline-width">Thickness <output id="outline-width-value">1 px</output></label><input id="outline-width" type="range" min="0.5" max="2" step="0.25" value="1"><label for="outline-opacity">Opacity <output id="outline-opacity-value">25%</output></label><input id="outline-opacity" type="range" min="0" max="50" step="5" value="25"><label>Color<input id="outline-color" type="color" value="#29343b"></label></details>
    <details data-section="effects-rendering"><summary>Rendering</summary><label>Render scale<select id="render-scale"><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label><p>Production light rigs, looks and focus controls use Outdoor, Interior or Systems.</p><button data-fixture="outdoor-fixture">Open Outdoor fixture</button></details></section>
    <section data-preview-panel="animation" hidden>${assetPickerUI}<p>Animation requires Outdoor, Interior or Systems.</p><button id="preview-library-asset">Preview selected asset in Outdoor</button></section>
    <section data-preview-panel="inspect" hidden><label>Freeze enemies<input id="freeze-enemies" type="checkbox"></label><p>Calibration, registration and occlusion inspection require Outdoor, Interior or Systems.</p><button data-fixture="outdoor-fixture">Open Outdoor fixture</button></section>`,
    previewHUD,
  );
  const registry = new ContentRegistry(effectsDefinitions);
  let app: Application<EffectsPresentation>;
  let view: EffectsPlayground;
  let disposed = false,
    previewReady = false;
  const remembered = context.remembered?.kind === 'effects' ? context.remembered : undefined;
  if (remembered) Object.assign(settings, structuredClone(remembered.settings));
  const abort = new AbortController();
  let picker: ReturnType<typeof bindAssetPicker> | undefined;
  let selectedAsset = 'ink-hero-current';
  function synchronize() {
    for (const box of document.querySelectorAll<HTMLInputElement>('[data-effect]'))
      box.checked = settings.effects[box.dataset.effect as PlaygroundEffect];
    $('baseline').classList.toggle('active', settings.baseline);
    $<HTMLInputElement>('baseline').checked = settings.baseline;
    $<HTMLSelectElement>('treatment').value = settings.treatment;
    $<HTMLInputElement>('outline-width').value = String(settings.outline.thickness);
    $('outline-width-value').textContent = settings.outline.thickness + ' px';
    $<HTMLInputElement>('outline-opacity').value = String(settings.outline.opacity * 100);
    $('outline-opacity-value').textContent = Math.round(settings.outline.opacity * 100) + '%';
    $<HTMLInputElement>('outline-color').value = settings.outline.color;
    shell.sync();
    savePreview();
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
    app.presentation.generation = app.session.generation;
    app.events.setGeneration(app.session.generation);
    app.clock.reset();
    app.input.clear();
  }
  function dispose() {
    if (disposed) return;
    savePreview();
    disposed = true;
    abort.abort();
    shell.dispose();
    Reflect.deleteProperty(window, 'effectsPlayground');
    app?.dispose();
    loading.dispose();
    window.removeEventListener('beforeunload', dispose);
    window.removeEventListener('pagehide', savePreview);
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
          if (!disposed) shell.status(message);
        },
        pause: (value) => {
          settings.paused = value;
          synchronize();
        },
        frame: () => {
          const hero = app.sim.hero;
          $('hp').textContent = `${hero.health} / ${hero.definition.maxHealth}`;
          $('health-fill').style.width = `${(hero.health / hero.definition.maxHealth) * 100}%`;
          $('enemy-count').textContent =
            `${app.sim.enemies.filter((enemy) => enemy.health > 0).length} enemies`;
          $('state').textContent = hero.state;
          $('dodge-status').textContent = hero.dodgeCooldown
            ? `${(hero.dodgeCooldown / 60).toFixed(1)} s`
            : 'ready';
          $('ability-status').textContent = hero.cooldown
            ? `${(hero.cooldown / 60).toFixed(1)} s`
            : 'ready';
          shell.diagnostics(() => ({ stats: view.stats(), details: view.diagnostics() }));
          shell.sync();
        },
        loading: loading.set,
      },
    );
    app.session = new GameSession(registry, 903);
    app.readOnly = true;
    app.beforeStep = (sim) => {
      if ($<HTMLInputElement>('freeze-enemies').checked)
        sim.enemies.forEach((enemy) => {
          enemy.stun = 2;
        });
    };
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
    if (remembered) {
      const position = supportedPosition(registry.area('effects-playground'), remembered.hero, 0.3);
      const y = heightAt(registry.area('effects-playground'), position.x, position.z);
      Object.assign(app.sim.hero, position, {
        px: position.x,
        pz: position.z,
        y,
        py: y,
        yaw: remembered.hero.yaw,
      });
      app.scale = remembered.scale;
      $<HTMLInputElement>('freeze-enemies').checked = remembered.freeze;
      app.pause(remembered.settings.paused);
    }
    app.presentation.resize(app.scale);
    $<HTMLSelectElement>('render-scale').value = String(app.scale);
    $('render-scale').onchange = () => {
      app.scale = Number($<HTMLSelectElement>('render-scale').value);
      app.presentation.resize(app.scale);
    };
    document
      .querySelectorAll<HTMLElement>('[data-fixture]')
      .forEach((el) => (el.onclick = () => context.select('outdoor-fixture')));
    shell.bind({
      capabilities: { animation: false, calibration: false, productionLighting: false },
      open: (panel) => {
        if (panel === 'animation')
          app.safe(async () => {
            if (!picker) {
              const catalog = await authoringCatalog(abort.signal);
              if (disposed) return;
              picker = bindAssetPicker(
                new AssetRuntime(catalog),
                abort.signal,
                () => 'effects-playground',
                async (id) => {
                  selectedAsset = id;
                  picker!.selected(id);
                },
                context.ui.assetFilters,
              );
              $('preview-library-asset').onclick = () => context.previewAsset(selectedAsset);
            }
            await picker.load();
          });
      },
      clearInput: () => app.input?.clear(),
      togglePause: pause,
      restart: reset,
      resize: () => app.presentation?.resize(app.scale),
      save: savePreview,
      isPaused: () => settings.paused,
      isAnimation: () => false,
    });
    previewReady = true;
    shell.status('Ready');
    synchronize();
  }
  window.effectsPlayground = {
    get ready() {
      return !disposed && previewReady && (app?.ready ?? false);
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
      savePreview();
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
  function savePreview() {
    if (disposed || !previewReady || !app?.ready || app.busy) return;
    const state: EffectsState = {
      kind: 'effects',
      settings: structuredClone(settings),
      scale: app.scale as EffectsState['scale'],
      freeze: $<HTMLInputElement>('freeze-enemies').checked,
      hero: { x: app.sim.hero.x, z: app.sim.hero.z, yaw: app.sim.hero.yaw },
    };
    context.remember(state);
  }
  window.addEventListener('pagehide', savePreview);
  window.addEventListener('beforeunload', dispose);
  void boot().catch((error) => {
    if (!disposed) {
      shell.status(`Effects failed: ${error.message}`, true);
      console.error(error);
    }
    app?.dispose();
    loading.dispose();
  });
  return dispose;
}
