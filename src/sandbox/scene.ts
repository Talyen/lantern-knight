import { bindEffectControls } from './effect-controls';
import { bindLightingControls } from './lighting-controls';
import { composeSceneContent } from '../content/game-content';
import { developerVisuals as worldVisuals } from '../content/developer-scenes';
import { previewHero } from './preview';
import { mountShell } from './shell';
import type { PreviewContext, SceneState, AnimationState } from './workspace';
import { defaultVisualEffects } from '../content/visual-effects';
import type { Bridge } from '../core/save';
import '../style.css';
import { LoadingScreen } from '../loading-screen';
import { Application } from '../application';
import { Presentation, type Mode } from '../presentation/scene';
import { sandboxContent, sandboxDefinitions } from '../content/sandbox-world';
import { ContentRegistry } from '../content/world';
import { GameSession } from '../core/session';
import { animatedSequence, animatedAsset } from '../assets/asset-browser';
import { bindAssetPicker } from './asset-picker';
import { HEADINGS } from '../core/camera';
import { clipDuration } from '../core/animation';
import { walkTimings, type WalkTiming } from '../core/locomotion-timing';
import {
  sampleAnimation,
  animationTreatments,
  type AnimationTreatment,
} from '../core/animation-treatment';
import { sandboxUI, previewHUD } from './ui';
import { heroTimings } from '../content/hero-actions';
import type { Clip } from '../assets/schema';
import '../inspection';
import {
  SweepEffects,
  sweepAssetsFor,
  sweepTreatments,
  type SweepTreatment,
} from './sweep-effects';
import { tuning } from '../content/gameplay';
import { spawnActorId, heightAt } from '../content/world';
import type { Actor, Simulation } from '../core/simulation';

export function mountScene(
  context: PreviewContext,
  assetCatalog: Readonly<Record<string, string>>,
) {
  let closed = false;
  const lifetime = new AbortController();
  let picker: ReturnType<typeof bindAssetPicker>;
  const loading = new LoadingScreen();
  const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
  const shell = mountShell(context, sandboxUI, previewHUD);
  const sandboxBridge: Bridge = {
    automatedRun: window.lantern?.automatedRun,
    loadGame: async () => ({ status: 'empty' }),
    loadSettings: async () => ({ status: 'empty' }),
    saveGame: async () => {
      throw new Error('Dev Preview checkpoint writes denied');
    },
    saveSettings: async () => {},
  };
  let scenePaused = false,
    sceneSpan = 9;
  let effectsBaseline = false;
  let selectedEffects = defaultVisualEffects();
  const remembered = context.remembered?.kind === 'scene' ? context.remembered : undefined;
  let previewReady = false;
  let mode: Mode = 'encounter',
    presentation: Presentation;
  let lightingControls: ReturnType<typeof bindLightingControls>;
  let lightingReplay = false,
    replayStart = 0;
  let movementSpeed = sandboxContent.actor(sandboxContent.definitions.player).speed,
    movementReplay = false;
  let sweepEffects: SweepEffects | undefined,
    sweepReplay = false,
    sweepRange = tuning.sweepRange as number;
  const app = new Application(
    $('canvas'),
    sandboxContent,
    assetCatalog,
    sandboxBridge,
    composeSceneContent(sandboxContent, worldVisuals),
    (...args) => new Presentation(...args),
    {
      status,
      pause: () => {
        shell.sync();
        savePreview();
      },
      frame: updateUI,
      loading: loading.set,
    },
    ['ink-hero-current'],
  );
  app.readOnly = true;
  function status(message: string, error = false) {
    if (!closed) shell.status(message, error);
  }
  function syncLabZoom() {
    const percent = Math.round(presentation.labZoom * 100);
    $<HTMLInputElement>('#lab-zoom').value = String(percent);
    $('#lab-zoom-value').textContent = `${percent}%`;
    $<HTMLButtonElement>('#lab-zoom-out').disabled = percent <= 50;
    $<HTMLButtonElement>('#lab-zoom-in').disabled = percent >= 400;
  }
  function resizePresentation() {
    if (!presentation) return;
    if (mode === 'animation') {
      const canvas = $('canvas').getBoundingClientRect(),
        drawer = $('#preview-drawer');
      presentation.labPanelInset = drawer.hidden
        ? 0
        : canvas.right - drawer.getBoundingClientRect().left + 16;
    }
    presentation.resize(app.scale);
  }
  function setMode(next: Mode) {
    stopMovementReplay();
    stopSweepReplay();
    sweepEffects?.reset();
    if (sweepEffects) sweepEffects.group.visible = next !== 'animation' && next !== 'calibration';
    const special = mode === 'animation' || mode === 'calibration';
    const nextSpecial = next === 'animation' || next === 'calibration';
    if (!special && nextSpecial) {
      scenePaused = app.paused;
      sceneSpan = presentation.verticalSpan;
    }
    if (nextSpecial) {
      lightingReplay = false;
      app.command = undefined;
      app.pause(false);
    } else if (special) {
      presentation.verticalSpan = sceneSpan;
      app.pause(scenePaused);
    }
    mode = next;
    app.setSimulationEnabled(!nextSpecial);
    presentation.setMode(next);
    presentation.debug =
      next === 'animation'
        ? $<HTMLInputElement>('#overlays').checked
        : $<HTMLInputElement>('#collision').checked;
    app.clock.reset();
    app.input.clear();
    $('#calibration-toggle').textContent =
      next === 'calibration' ? 'Return to scene' : 'Open reference view';
    syncLabZoom();
    resizePresentation();
    shell.sync();
    savePreview();
  }
  function applyEffects() {
    presentation.setVisualEffects(
      effectsBaseline
        ? Object.fromEntries(Object.keys(selectedEffects).map((key) => [key, false]))
        : selectedEffects,
    );
  }
  function updateLabClips() {
    const entries = Object.entries(presentation.manifest.asset.clips);
    const select = $<HTMLSelectElement>('#clip');
    select.replaceChildren();
    for (const [label, animated] of [
      ['Animations', true],
      ['Still poses', false],
    ] as const) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const [name, directions] of entries)
        if (Object.values(directions).some((clip) => clip && animatedSequence(clip)) === animated)
          group.append(new Option(name.replaceAll('_', ' '), name));
      if (group.children.length) select.append(group);
    }
    select.value = presentation.labClip;
    updateLabHeadings();
  }
  function updateLabHeadings() {
    const headings = Object.keys(
      presentation.manifest.asset.clips[presentation.labClip]!,
    ) as (typeof HEADINGS)[number][];
    if (!headings.includes(presentation.labHeading)) presentation.labHeading = headings[0]!;
    $('#heading').innerHTML = headings.map((d) => `<option>${d}</option>`).join('');
    $<HTMLSelectElement>('#heading').value = presentation.labHeading;
  }

  async function boot() {
    await app.boot();
    if (closed) return;
    presentation = app.presentation;
    applyMovementSpeed();
    sweepEffects = new SweepEffects(presentation, () => app.sim);
    presentation.beforeSceneRender = (sim) => sweepEffects?.update(sim);
    $<HTMLSelectElement>('#sweep-treatment').replaceChildren(
      ...Object.entries(sweepTreatments).map(([id, recipe]) => new Option(recipe.label, id)),
    );
    $<HTMLSelectElement>('#sweep-treatment').value = 'baseline';
    $<HTMLSelectElement>('#movement-speed').value = String(movementSpeed);
    $<HTMLSelectElement>('#render-scale').value = String(app.scale);
    $<HTMLSelectElement>('#zoom-span').value = String(presentation.verticalSpan);
    lightingControls = bindLightingControls(presentation, savePreview);
    bindEffectControls(presentation, (key, enabled) => {
      selectedEffects[key] = enabled;
      applyEffects();
      savePreview();
    });
    $('#scene-baseline').onchange = () => {
      effectsBaseline = $<HTMLInputElement>('#scene-baseline').checked;
      applyEffects();
      savePreview();
    };
    $('#lighting-replay').onclick = () => app.safe(startLightingReplay);
    $('#lighting-stop').onclick = () => {
      lightingReplay = false;
      app.command = undefined;
      $('#lighting-stop').hidden = true;
    };
    const blendControls = ['walk-blend'];
    for (const id of blendControls) {
      $('#' + id).innerHTML = Object.entries(animationTreatments)
        .map(([key, value]) => `<option value="${key}">${value.label}</option>`)
        .join('');
      $('#' + id).onchange = () => {
        presentation.animationTreatment = $<HTMLSelectElement>('#' + id)
          .value as AnimationTreatment;
        for (const control of blendControls)
          $<HTMLSelectElement>('#' + control).value = presentation.animationTreatment;
        $('#walk-blend-help').textContent =
          animationTreatments[presentation.animationTreatment].description;
      };
    }
    $<HTMLSelectElement>('#walk-blend').value = presentation.animationTreatment;
    $('#walk-blend-help').textContent =
      animationTreatments[presentation.animationTreatment].description;
    $('#animation-comparison').onchange = () => {
      presentation.comparisonMode = $<HTMLSelectElement>('#animation-comparison').value as
        'treatment' | 'timing';
      presentation.restartLab();
    };
    for (const id of ['walk-stabilized'])
      $('#' + id).onchange = () => {
        presentation.stabilized = $<HTMLInputElement>('#' + id).checked;
        for (const control of ['walk-stabilized'])
          $<HTMLInputElement>('#' + control).checked = presentation.stabilized;
        presentation.lastLabOverlay = '';
      };
    for (const id of ['walk-rigid-sword'])
      $('#' + id).onchange = () => {
        presentation.rigidSword = $<HTMLInputElement>('#' + id).checked;
        for (const control of ['walk-rigid-sword'])
          $<HTMLInputElement>('#' + control).checked = presentation.rigidSword;
      };
    for (const id of ['locomotion-timing']) {
      $('#' + id).innerHTML = Object.entries(walkTimings)
        .map(([key, value]) => `<option value="${key}">${value.label}</option>`)
        .join('');
      $<HTMLSelectElement>('#' + id).value = presentation.walkTiming;
      $('#' + id).onchange = () => {
        presentation.walkTiming = $<HTMLSelectElement>('#' + id).value as WalkTiming;
        for (const control of ['locomotion-timing'])
          $<HTMLSelectElement>('#' + control).value = presentation.walkTiming;
        $('#locomotion-timing-help').textContent = walkTimings[presentation.walkTiming].description;
      };
    }
    $('#locomotion-timing-help').textContent = walkTimings[presentation.walkTiming].description;
    $('#walk-compare').onclick = () =>
      app.safe(() =>
        app.withLoading(async () => {
          await app.loadAsset('ink-hero-current');
          if (closed) return;
          if (!presentation.animationFlow) await presentation.loadAnimationFlow();
          if (closed) return;
          $<HTMLInputElement>('#overlays').checked = false;
          presentation.selectLabAsset('ink-hero-current');
          picker.selected('ink-hero-current');
          presentation.labClip = 'walk';
          updateLabClips();
          presentation.labAnimator.start(presentation.getClip('walk', presentation.labHeading));
          presentation.labTime = 0;
          presentation.labPaused = false;
          setMode('animation');
        }),
      );
    const zoomPreview = (zoom: number) => {
      presentation.setLabZoom(Math.round(zoom * 100) / 100);
      syncLabZoom();
    };
    $('#lab-zoom').oninput = () =>
      zoomPreview(Number($<HTMLInputElement>('#lab-zoom').value) / 100);
    $('#lab-zoom-out').onclick = () => zoomPreview(presentation.labZoom - 0.25);
    $('#lab-zoom-in').onclick = () => zoomPreview(presentation.labZoom + 0.25);
    $('#lab-zoom-reset').onclick = () => zoomPreview(2);
    $('canvas').addEventListener(
      'wheel',
      (event: WheelEvent) => {
        if (mode !== 'animation' || app.paused || app.busy || event.deltaY === 0) return;
        event.preventDefault();
        const pixels =
          event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? $('canvas').clientHeight : 1);
        zoomPreview(presentation.labZoom * Math.exp(-pixels * 0.0015));
      },
      { passive: false },
    );
    picker = bindAssetPicker(
      app.runtime,
      lifetime.signal,
      () => app.sim.area,
      async (id) => {
        await app.withLoading(async () => {
          await app.loadAsset(id);
          if (closed) return;
          presentation.selectLabAsset(id);
          updateLabClips();
          picker.selected(id);
          savePreview();
        });
      },
      context.ui.assetFilters,
    );
    updateLabClips();
    $('#clip').onchange = () => {
      presentation.labClip = $<HTMLSelectElement>('#clip').value;
      presentation.notifyLog = [];
      updateLabHeadings();
    };
    $('#heading').onchange = () => {
      presentation.labHeading = $<HTMLSelectElement>('#heading').value as (typeof HEADINGS)[number];
      presentation.notifyLog = [];
    };
    $('#step').onclick = () => {
      presentation.labPaused = true;
      shell.sync();
      const c = presentation.labAnimator.clip,
        t = presentation.labAnimator.time % clipDuration(c);
      let end = 0;
      for (const duration of c.durationsMs) {
        end += duration;
        if (end > t + 0.01) break;
      }
      presentation.labAnimator.seek(end >= clipDuration(c) ? 0 : end);
      presentation.labTime = presentation.labAnimator.time;
    };
    $('#scrub').oninput = () => {
      presentation.labPaused = true;
      shell.sync();
      presentation.labAnimator.seek(Number($<HTMLInputElement>('#scrub').value));
      presentation.labTime = presentation.labAnimator.time;
    };
    $('#speed').onchange = () =>
      (presentation.labSpeed = Number($<HTMLSelectElement>('#speed').value));
    $('#overlays').onchange = () => (presentation.debug = $<HTMLInputElement>('#overlays').checked);
    $('#zoom-span').onchange = () => {
      presentation.verticalSpan = Number($<HTMLSelectElement>('#zoom-span').value);
      presentation.resize(app.scale);
      savePreview();
    };
    $('#collision').onchange = () => {
      if (mode !== 'animation' && mode !== 'calibration')
        setMode($<HTMLInputElement>('#collision').checked ? 'occlusion' : 'encounter');
    };
    $('#calibration-toggle').onclick = () =>
      setMode(
        mode === 'calibration'
          ? $<HTMLInputElement>('#collision').checked
            ? 'occlusion'
            : 'encounter'
          : 'calibration',
      );
    for (const [id, z] of [
      ['occlude-front', -1],
      ['occlude-back', -3],
    ] as const)
      $('#' + id).onclick = () => {
        const position = previewHero(
          { ...captureState(), hero: { x: -4, z, yaw: app.sim.hero.yaw } },
          sandboxContent,
        );
        Object.assign(app.sim.hero, position);
        savePreview();
      };
    $('#return-scene').onclick = () =>
      setMode($<HTMLInputElement>('#collision').checked ? 'occlusion' : 'encounter');
    $('#movement-speed').onchange = () => {
      movementSpeed = Number($<HTMLSelectElement>('#movement-speed').value);
      applyMovementSpeed();
    };
    $('#movement-replay').onclick = () => app.safe(startMovementReplay);
    $('#movement-stop').onclick = stopMovementReplay;
    $('#sweep-treatment').onchange = () => app.safe(loadSweepEffects);
    $('#sweep-reverse').onchange = () => {
      if (sweepEffects) {
        sweepEffects.reset();
        sweepEffects.reverse = $<HTMLInputElement>('#sweep-reverse').checked;
      }
    };
    $('#sweep-rotation').oninput = () => {
      if (sweepEffects) {
        sweepEffects.reset();
        sweepEffects.rotation = Number($<HTMLInputElement>('#sweep-rotation').value);
        $('#sweep-rotation-value').textContent = `${sweepEffects.rotation}°`;
      }
    };
    $('#sweep-range').onchange = () => {
      sweepRange = Number($<HTMLSelectElement>('#sweep-range').value);
      applySweepRange();
    };
    $('#sweep-replay').onclick = () => app.safe(startSweepReplay);
    $('#sweep-stop').onclick = stopSweepReplay;
    app.beforeStep = (sim) => {
      applyMovementSpeed();
      applySweepRange();
      if ($<HTMLInputElement>('#freeze-enemies').checked)
        sim.enemies.forEach((enemy) => {
          enemy.stun = 2;
        });
    };
    for (const id of ['background', 'calibration-background'])
      $('#' + id).onchange = () => {
        presentation.background = $<HTMLSelectElement>('#' + id).value;
        for (const control of ['background', 'calibration-background'])
          $<HTMLSelectElement>('#' + control).value = presentation.background;
      };
    $('#render-scale').onchange = () => {
      app.scale = Number($<HTMLSelectElement>('#render-scale').value);
      presentation.resize(app.scale);
      savePreview();
    };
    if (context.fixture !== app.sim.area) await fixture(context.fixture);
    if (closed) return;
    if (remembered) {
      Object.assign(app.sim.hero, previewHero(remembered, sandboxContent));
      presentation.verticalSpan = remembered.span;
      app.scale = remembered.scale;
      presentation.lightingLab.setSettings(remembered.look);
      presentation.setDepthOfField(remembered.look.depthOfField);
      selectedEffects = { ...remembered.effects };
      effectsBaseline = remembered.effectsBaseline;
      applyEffects();
      $<HTMLInputElement>('#scene-baseline').checked = effectsBaseline;
      document
        .querySelectorAll<HTMLInputElement>('[data-scene-effect]')
        .forEach(
          (input) =>
            (input.checked =
              selectedEffects[input.dataset.sceneEffect as keyof typeof selectedEffects]),
        );
      $<HTMLInputElement>('#collision').checked = remembered.collision;
      $<HTMLInputElement>('#freeze-enemies').checked = remembered.freeze;
      await restoreAnimation(remembered.animation);
      if (closed) return;
      app.pause(remembered.paused);
      scenePaused = remembered.paused;
      // Inspectors are independent of the viewport. Restore special views explicitly.
      setMode(remembered.mode === 'lighting' ? 'encounter' : remembered.mode);
    }
    if (context.assetToPreview && context.assetToPreview in assetCatalog) {
      await app.loadAsset(context.assetToPreview);
      if (closed) return;
      presentation.selectLabAsset(context.assetToPreview);
      updateLabClips();
      context.ui.assetFilters.animated = animatedAsset(presentation.manifest);
      $<HTMLInputElement>('#asset-animated').checked = context.ui.assetFilters.animated;
      picker.selected(context.assetToPreview);
    }
    lightingControls.syncLook();
    lightingControls.syncDof();
    $<HTMLSelectElement>('#scene-select').value = app.sim.area;
    $<HTMLSelectElement>('#render-scale').value = String(app.scale);
    $<HTMLSelectElement>('#zoom-span').value = String(presentation.verticalSpan);
    $('[data-fixture]').onclick = () => context.select('effects-playground');
    shell.bind({
      capabilities: { animation: true, calibration: true, productionLighting: true },
      open: (panel) => {
        if (panel === 'animation') {
          if (mode !== 'animation') setMode('animation');
          app.safe(() => picker.load());
        }
      },
      clearInput: () => app.input?.clear(),
      togglePause: () => {
        if (mode === 'animation') {
          const resume = presentation.labPaused || app.paused;
          presentation.labPaused = !resume;
          app.pause(false);
        } else app.pause(!app.paused);
      },
      restart: () => {
        stopMovementReplay();
        stopSweepReplay();
        sweepEffects?.reset();
        if (mode === 'animation') presentation.restartLab();
        else
          app.safe(async () => {
            const paused = app.paused;
            const look = { ...presentation.lightingLab.settings };
            await app.reset();
            if (closed) return;
            presentation.lightingLab.setSettings(look);
            lightingControls.syncLook();
            app.pause(paused);
            savePreview();
          });
      },
      resize: resizePresentation,
      save: savePreview,
      isPaused: () => (mode === 'animation' ? presentation.labPaused || app.paused : app.paused),
      isAnimation: () => mode === 'animation',
    });
    await loadSweepEffects();
    if (closed) return;
    previewReady = true;
    status('Ready');
    savePreview();
  }
  async function restoreAnimation(value: AnimationState) {
    if (!(value.asset in assetCatalog)) return;
    const metadata = await app.runtime.manifest(value.asset);
    if (closed || !Object.keys(metadata.asset.clips).length) return;
    await app.loadAsset(value.asset);
    if (closed) return;
    presentation.selectLabAsset(value.asset);
    if (!presentation.manifest.asset.clips[value.clip]) return;
    presentation.labClip = value.clip;
    presentation.labHeading = value.heading;
    presentation.animationTreatment = value.treatment;
    presentation.walkTiming = value.timing;
    presentation.stabilized = value.stabilized;
    presentation.rigidSword = value.rigidSword;
    presentation.comparisonMode = value.comparison;
    presentation.labSpeed = value.speed;
    presentation.labZoom = value.zoom;
    presentation.labPaused = value.paused;
    presentation.labTime = value.time;
    presentation.background = value.background;
    picker.selected(value.asset);
    updateLabClips();
    presentation.labAnimator.start(
      presentation.getClip(presentation.labClip, presentation.labHeading),
    );
    presentation.labAnimator.seek(value.time);
    for (const [id, selected] of [
      ['walk-blend', value.treatment],
      ['locomotion-timing', value.timing],
      ['animation-comparison', value.comparison],
      ['speed', String(value.speed)],
      ['background', value.background],
      ['calibration-background', value.background],
    ])
      $<HTMLSelectElement>('#' + id).value = selected!;
    for (const [id, checked] of [
      ['overlays', value.overlays],
      ['walk-stabilized', value.stabilized],
      ['walk-rigid-sword', value.rigidSword],
    ] as const)
      $<HTMLInputElement>('#' + id).checked = checked;
  }

  async function fixture(area: string, prepare?: (sim: Simulation) => void) {
    stopMovementReplay();
    stopSweepReplay();
    sweepEffects?.reset();
    lightingReplay = false;
    app.command = undefined;
    await app.replaceArea(area, () => {
      app.session = new GameSession(sandboxContent, 142, area, app.session.generation + 1);
      prepare?.(app.sim);
      return [];
    });
    if (closed) return;
    $<HTMLSelectElement>('#scene-select').value = area;
    if (location.protocol === 'http:' && !window.lantern) {
      const url = new URL(location.href);
      url.searchParams.set('scene', area);
      history.replaceState(null, '', url);
    }
  }
  async function startLightingReplay() {
    await fixture(app.sim.area);
    if (closed) return;
    setMode('lighting');
    app.pause(false);
    presentation.lightingLab.time = 0;
    lightingReplay = true;
    replayStart = app.sim.tick;
    $('#lighting-stop').hidden = false;
    app.command = (sim) => {
      const t = (sim.tick - replayStart) % 1200,
        points = [
          { x: 0, z: 2.8 },
          { x: 1.8, z: -1 },
          { x: 1.6, z: -5.6 },
          { x: -1.8, z: -3.4 },
          { x: 0, z: 5.8 },
        ],
        target = points[Math.min(4, Math.floor(t / 240))]!,
        dx = target.x - sim.hero.x,
        dz = target.z - sim.hero.z,
        d = Math.hypot(dx, dz);
      sim.enemies.forEach((e) => (e.stun = 10000));
      return {
        move: d > 0.2 ? { x: dx / d, z: dz / d } : { x: 0, z: 0 },
        aim: { x: sim.hero.x + 2, z: sim.hero.z - 1 },
        ability: t === 620,
        attack: t === 730 || t === 760 || t === 790,
        generation: sim.generation,
      };
    };
  }
  function applyMovementSpeed() {
    const hero = app.sim.hero;
    if (hero.definition.speed !== movementSpeed)
      hero.definition = { ...hero.definition, speed: movementSpeed };
    const label = `${movementReplay ? 'Replay' : 'Free play'} · ${movementSpeed.toFixed(1)} m/s · fixed run cadence`;
    if ($('#movement-status').textContent !== label) $('#movement-status').textContent = label;
  }
  function stopMovementReplay() {
    if (!movementReplay) return;
    movementReplay = false;
    app.command = undefined;
    $('#movement-stop').hidden = true;
    applyMovementSpeed();
  }
  async function startMovementReplay() {
    const route = $<HTMLSelectElement>('#movement-route').value;
    await fixture(app.sim.area);
    if (closed) return;
    setMode('encounter');
    const position = previewHero(
      { ...captureState(), hero: { x: route === 'blocked' ? 6.5 : -2, z: 4, yaw: Math.PI / 2 } },
      sandboxContent,
    );
    Object.assign(app.sim.hero, position);
    movementReplay = true;
    const start = app.sim.tick;
    $('#movement-stop').hidden = false;
    applyMovementSpeed();
    app.pause(false);
    app.command = (sim) => {
      const elapsed = sim.tick - start;
      sim.enemies.forEach((enemy) => (enemy.stun = 2));
      let x = 0,
        z = 0;
      if (route === 'stride') {
        // Matching fixed-time passes, with a pause before each reversal.
        if (elapsed >= 30 && elapsed < 180) x = 1;
        else if (elapsed >= 210 && elapsed < 360) x = -1;
        else if (elapsed >= 390 && elapsed < 540) {
          x = Math.SQRT1_2;
          z = -Math.SQRT1_2;
        }
      } else if (route === 'headings' && elapsed < 720) {
        const heading = Math.floor(elapsed / 90);
        if (elapsed % 90 < 60) {
          x = Math.sin((heading * Math.PI) / 4);
          z = Math.cos((heading * Math.PI) / 4);
        }
      } else if (route === 'blocked' && elapsed >= 30 && elapsed < 360) x = 1;
      if (elapsed >= (route === 'headings' ? 720 : route === 'blocked' ? 390 : 570))
        stopMovementReplay();
      return {
        move: { x, z },
        aim: { x: sim.hero.x + Math.sin(sim.hero.yaw), z: sim.hero.z + Math.cos(sim.hero.yaw) },
        generation: sim.generation,
      };
    };
  }
  async function loadSweepEffects() {
    const treatment = $<HTMLSelectElement>('#sweep-treatment').value as SweepTreatment;
    const ids = sweepAssetsFor(treatment);
    if (ids.length) await app.withLoading(() => Promise.all(ids.map((id) => app.loadAsset(id))));
    if (closed || !sweepEffects) return;
    const changed = sweepEffects.treatment !== treatment;
    sweepEffects.reset();
    sweepEffects.treatment = treatment;
    if (changed) {
      sweepEffects.reverse =
        'reverse' in sweepTreatments[treatment] && sweepTreatments[treatment].reverse === true;
      sweepEffects.rotation = 0;
    }
    $<HTMLInputElement>('#sweep-reverse').checked = sweepEffects.reverse;
    $<HTMLInputElement>('#sweep-rotation').value = String(sweepEffects.rotation);
    $('#sweep-rotation-value').textContent = `${sweepEffects.rotation}°`;
  }
  function applySweepRange() {
    const hero = app.sim.hero;
    if (hero.definition.melee.sweepRange !== sweepRange)
      hero.definition = {
        ...hero.definition,
        melee: { ...hero.definition.melee, sweepRange: sweepRange },
      };
  }
  function stopSweepReplay() {
    if (!sweepReplay) return;
    sweepReplay = false;
    app.command = undefined;
    $('#sweep-stop').hidden = true;
    $('#sweep-status').textContent = 'Free play · preview sweep reach';
    sweepEffects?.reset();
  }
  async function startSweepReplay() {
    await loadSweepEffects();
    if (closed) return;
    const yaw =
        (HEADINGS.indexOf(
          $<HTMLSelectElement>('#sweep-heading').value as (typeof HEADINGS)[number],
        ) *
          Math.PI) /
        4,
      origin = previewHero({ ...captureState(), hero: { x: -2, z: 4, yaw } }, sandboxContent);
    const targets: { actor: Actor; distance: number; angle: number }[] = [];
    await fixture(app.sim.area, (sim) => {
      for (const [index, distance] of [1.45, 1.8, 2.05].entries()) {
        const angle = yaw + (index - 1) * 0.5;
        const actor = sim.create(
          spawnActorId(sim.area, `sweep-target-${index}`),
          'enemy',
          origin.x + Math.sin(angle) * 3.5,
          origin.z + Math.cos(angle) * 3.5,
          'warden',
        );
        actor.definition = { ...actor.definition, maxHealth: 500 };
        actor.health = 500;
        actor.stun = 10000;
        targets.push({ actor, distance, angle });
      }
      Object.assign(sim.hero, origin);
      sim.actors = [sim.hero, ...targets.map((target) => target.actor)];
      applySweepRange();
    });
    if (closed) return;
    setMode('encounter');
    const sim = app.sim;
    const start = sim.tick;
    sweepReplay = true;
    $('#sweep-stop').hidden = false;
    app.command = (sim) => {
      const elapsed = sim.tick - start;
      for (const { actor, distance, angle } of targets) {
        actor.stun = 10000;
        const d = elapsed < 150 ? 3.5 : distance;
        actor.x = actor.px = origin.x + Math.sin(angle) * d;
        actor.z = actor.pz = origin.z + Math.cos(angle) * d;
        actor.y = actor.py = heightAt(sim.areaDefinition, actor.x, actor.z);
      }
      const attack = [30, 180, 300, 420].includes(elapsed);
      if (attack) sim.hero.nextAttack = 'sweep';
      $('#sweep-status').textContent =
        `${elapsed < 150 ? 'Miss' : 'Targets: 1.45 / 1.80 / 2.05 m'} · ${sweepRange.toFixed(2)} m reach`;
      if (elapsed >= 570) stopSweepReplay();
      return {
        move: { x: 0, z: 0 },
        aim: { x: origin.x + Math.sin(yaw) * 4, z: origin.z + Math.cos(yaw) * 4 },
        attack,
        generation: sim.generation,
      };
    };
    app.pause(false);
  }
  function updateUI() {
    if (!presentation) return;
    const sim = app.sim;
    $('#hp').textContent = `${sim.hero.health} / ${sim.hero.definition.maxHealth}`;
    $('#health-fill').style.width = `${(sim.hero.health / sim.hero.definition.maxHealth) * 100}%`;
    $('#enemy-count').textContent =
      `${sim.enemies.filter((a) => a.health > 0).length} enemies remain`;
    $('#state').textContent = sim.hero.state;
    $('#dodge-status').textContent = sim.hero.dodgeCooldown
      ? `${sim.hero.dodgeCooldown / 60} s`
      : 'ready';
    $('#ability-status').textContent = sim.hero.cooldown ? `${sim.hero.cooldown / 60} s` : 'ready';
    if (mode === 'lighting') {
      const lab = presentation.lightingLab.stats();
      $('#lighting-playback').textContent = lightingReplay
        ? 'Replay: shade → lantern → combat → return'
        : 'Free play';
      $('#lighting-stop').hidden = !lightingReplay;
      $('#lighting-stats').textContent =
        `${presentation.renderer.domElement.width} × ${presentation.renderer.domElement.height}\n${lab.companions} generated companions · ${(lab.normalBytes / 1048576).toFixed(1)} MiB\nHDR color buffers ${(lab.targets.colorBytes / 1048576).toFixed(0)} MiB`;
    }
    if (mode === 'occlusion') {
      const label = document.querySelector<HTMLElement>('#art-registration-status');
      if (label)
        label.textContent = presentation.artConstruction.findings.length
          ? presentation.artConstruction.findings
              .map((f) => `${f.a}${f.b ? ' ↔ ' + f.b : ''}: ${f.message}`)
              .join('\n')
          : 'No undeclared scenery overlaps. Green: footprints. Gold: joins. Amber: light sockets.';
    }
    if (mode === 'animation') updateAnimationReview();
    shell.sync();
    shell.diagnostics(() => ({
      ...presentation.stats(),
      registration: presentation.artConstruction.findings,
      events: presentation.notifyLog,
    }));
  }
  let reviewClip: Clip | undefined,
    reviewMode = '';
  function updateAnimationReview() {
    const c = presentation.labAnimator.clip,
      d = clipDuration(c),
      original = presentation.getOriginalLabClip(),
      reference = clipDuration(original),
      timing = presentation.comparisonMode === 'timing',
      span = timing ? Math.max(d, reference) : d;
    const elapsed = c.loop ? presentation.labTime % span : Math.min(presentation.labTime, span);
    $<HTMLInputElement>('#scrub').max = String(span);
    $<HTMLInputElement>('#scrub').value = String(elapsed);
    $('#visual-time').textContent =
      `${Math.round(elapsed)} / ${Math.round(span)} ms · ${new Set(c.frames).size} drawings`;
    document.querySelector<HTMLDetailsElement>('[data-section="animation-comparison"]')!.hidden =
      presentation.labAsset !== 'ink-hero-current';
    const hero = presentation.labAsset === 'ink-hero-current',
      heading = c.frames[0]!.split('-')[1] as (typeof HEADINGS)[number],
      recipe = hero ? heroTimings[presentation.labClip]?.[heading] : undefined;
    if (reviewClip !== c || reviewMode !== presentation.comparisonMode) {
      reviewClip = c;
      reviewMode = presentation.comparisonMode;
      const timeline = $('.timeline');
      timeline.replaceChildren();
      let end = 0;
      for (const hold of c.durationsMs) {
        end += hold;
        const marker = document.createElement('span');
        marker.className = 'animation-marker';
        marker.style.left = `${(end / span) * 100}%`;
        marker.title = `Drawing boundary ${Math.round(end)} ms`;
        timeline.append(marker);
      }
      if (recipe?.damageMs) {
        const active = document.createElement('span');
        active.className = 'animation-active';
        active.style.left = `${(recipe.damageMs[0]! / span) * 100}%`;
        active.style.width = `${((recipe.damageMs[1]! - recipe.damageMs[0]!) / span) * 100}%`;
        active.title = 'Damage window';
        timeline.append(active);
      }
      if (recipe?.pulseMs !== undefined) {
        const pulse = document.createElement('span');
        pulse.className = 'animation-pulse';
        pulse.style.left = `${(recipe.pulseMs / span) * 100}%`;
        pulse.title = 'Lantern pulse';
        timeline.append(pulse);
      }
      const playhead = document.createElement('span');
      playhead.id = 'animation-playhead';
      timeline.append(playhead);
    }
    $('#animation-playhead').style.left = `${(elapsed / span) * 100}%`;
    const sample = sampleAnimation(
        c,
        presentation.labTime,
        'guarded',
        presentation.animationFlow?.pairs,
      ),
      pair = presentation.animationFlow?.pairs.find(
        (p) => p.asset === presentation.labAsset && p.from === sample.from && p.to === sample.to,
      );
    const status = presentation.labSprite.lightingSample?.blend
      ? 'Guarded transition'
      : pair?.supported
        ? 'Pose hold'
        : sample.from === sample.to
          ? c.loop
            ? 'Static pose'
            : 'Terminal pose'
          : (pair?.reviewReason ?? 'Authored hold');
    $('#frame-status').textContent =
      `${presentation.labAnimator.frame} · ${status}${pair?.supported && pair.intent ? ' · ' + pair.intent : ''}`;
    const markers = recipe?.damageMs
      ? `Damage ${Math.round(recipe.damageMs[0]!)}–${Math.round(recipe.damageMs[1]!)} ms`
      : recipe?.pulseMs !== undefined
        ? `Pulse ${Math.round(recipe.pulseMs)} ms`
        : presentation.labClip === 'dodge'
          ? 'Travel / invulnerability 100–233 ms'
          : c.frames.length === 1
            ? 'Static pose'
            : c.loop
              ? 'Loop'
              : 'Terminal drawing holds';
    $('#action-timing').textContent =
      `Directed ${Math.round(d)} ms · imported ${Math.round(reference)} ms. ${markers}.`;
    $('#walk-comparison').hidden = !hero;
    $('#walk-comparison').textContent = timing
      ? 'Left: directed rhythm and selected treatment. Right: imported rhythm and held drawings. Both start together on elapsed time.'
      : 'Left: selected treatment. Right: uncorrected held drawings. Both use identical directed timing. Green markers are fixed actor roots.';
    $('#notify').textContent = presentation.notifyLog.join('\n');
    for (const id of [
      'animation-comparison',
      'walk-blend',
      'walk-stabilized',
      'walk-rigid-sword',
      'locomotion-timing',
    ])
      $<HTMLInputElement>('#' + id).disabled =
        !hero || (id === 'locomotion-timing' && presentation.labClip !== 'walk');
  }
  let benchmarkFrames: number[] = [],
    benchmarkMeasuring = false,
    benchmarkStartTick = 0,
    benchmarkSkipFrame = true,
    returnSave: ReturnType<GameSession['captureSave']> | undefined;
  function beginBenchmarkMeasurement() {
    benchmarkFrames = [];
    benchmarkStartTick = app.sim.tick;
    benchmarkSkipFrame = true;
    app.clock.droppedMs = 0;
  }
  async function startBenchmark(stress = false) {
    stopMovementReplay();
    stopSweepReplay();
    lightingReplay = false;
    await app.loadAsset('ink-skeleton');
    returnSave ??= app.session.captureSave();
    const definitions = stress
      ? {
          ...sandboxDefinitions,
          areas: sandboxDefinitions.areas.map((a) =>
            a.id === 'outdoor-fixture'
              ? {
                  ...a,
                  activation: undefined,
                  spawns: Array.from({ length: 32 }, (_, i) => ({
                    id: `stress-${i}`,
                    actor: 'warden',
                    x: ((i % 6) - 3) * 1.2,
                    z: (Math.floor(i / 6) - 2) * 1.2,
                  })),
                }
              : a,
          ),
        }
      : sandboxDefinitions;
    await app.replaceArea('outdoor-fixture', () => {
      app.session = new GameSession(
        new ContentRegistry(definitions),
        142,
        'outdoor-fixture',
        app.session.generation + 1,
      );
      return [];
    });
    beginBenchmarkMeasurement();
    benchmarkMeasuring = true;
    app.command = (sim) => {
      if (sim.cleared) app.publish(app.session.resetCurrentArea());
      const target = sim.enemies.find((a) => a.health > 0) ?? sim.hero,
        angle = sim.tick / 120;
      return {
        move: { x: Math.cos(angle), z: Math.sin(angle) },
        aim: target,
        attack: true,
        ability: sim.tick % 180 === 0,
        dodge: sim.tick % 100 === 50,
        generation: sim.generation,
      };
    };
    setMode('encounter');
    app.pause(false);
  }
  app.afterFrame = (ms) => {
    if (benchmarkMeasuring) {
      if (benchmarkSkipFrame) benchmarkSkipFrame = false;
      else benchmarkFrames.push(ms);
    }
  };
  window.foundation = {
    get ready() {
      return !closed && app.ready && previewReady;
    },
    get session() {
      return app.session;
    },
    get sim() {
      return app.sim;
    },
    get presentation() {
      return app.presentation;
    },
    get persistence() {
      return app.persistence;
    },
    get eventHistory() {
      return app.events.history;
    },
    get manifest() {
      return app.packs.get('ink-hero-current')!.manifest;
    },
    fixture,
    mode: setMode,
    pause: (value) => app.pause(value),
    reset: () => {
      stopMovementReplay();
      stopSweepReplay();
      sweepEffects?.reset();
      return app.reset();
    },
    stats: () => app.presentation.stats(),
    saveValue: () => app.session.captureSave(),
    startBenchmark,
    beginBenchmarkMeasurement,
    async finishBenchmark(restoreSession = true) {
      const result = {
        frames: benchmarkFrames,
        stats: presentation.stats(),
        droppedMs: app.clock.droppedMs,
        simulatedTicks: app.sim.tick - benchmarkStartTick,
      };
      benchmarkMeasuring = false;
      app.command = undefined;
      if (restoreSession && returnSave) {
        const snapshot = returnSave;
        await app.replaceArea(snapshot.area, () => {
          app.session = new GameSession(
            sandboxContent,
            snapshot.seed,
            snapshot.area,
            app.session.generation + 1,
          );
          return app.session.restoreSave(snapshot);
        });
        returnSave = undefined;
      }
      return result;
    },
    dispose,
  };
  function savePreview() {
    if (closed || !previewReady || !app.ready || app.busy) return;
    context.remember(captureState());
  }
  function captureState(): SceneState {
    return {
      kind: 'scene',
      version: 1,
      scene: app.sim.area,
      hero: { x: app.sim.hero.x, z: app.sim.hero.z, yaw: app.sim.hero.yaw },
      span: mode === 'animation' || mode === 'calibration' ? sceneSpan : presentation.verticalSpan,
      scale: app.scale as SceneState['scale'],
      mode,
      paused: mode === 'animation' || mode === 'calibration' ? scenePaused : app.paused,
      look: { ...presentation.lightingLab.settings, depthOfField: presentation.depthOfField },
      effects: { ...selectedEffects },
      effectsBaseline,
      freeze: $<HTMLInputElement>('#freeze-enemies').checked,
      collision: $<HTMLInputElement>('#collision').checked,
      animation: {
        asset: presentation.labAsset,
        clip: presentation.labClip,
        heading: presentation.labHeading,
        treatment: presentation.animationTreatment,
        timing: presentation.walkTiming,
        stabilized: presentation.stabilized,
        rigidSword: presentation.rigidSword,
        comparison: presentation.comparisonMode,
        speed: presentation.labSpeed,
        zoom: presentation.labZoom,
        paused: presentation.labPaused,
        time: presentation.labTime,
        overlays: $<HTMLInputElement>('#overlays').checked,
        background: presentation.background === 'light' ? 'light' : 'dark',
      },
    };
  }
  window.addEventListener('pagehide', savePreview);
  function dispose() {
    if (closed) return;
    savePreview();
    closed = true;
    sweepEffects?.dispose();
    if (presentation) presentation.beforeSceneRender = undefined;
    lifetime.abort();
    previewReady = false;
    app.dispose();
    loading.dispose();
    shell.dispose();
    Reflect.deleteProperty(window, 'foundation');
    window.removeEventListener('beforeunload', dispose);
    window.removeEventListener('pagehide', savePreview);
  }
  window.addEventListener('beforeunload', dispose);
  void boot().catch((error) => {
    if (!closed) status('Dev Preview failed: ' + error.message, true);
    app.dispose();
    loading.dispose();
  });
  return dispose;
}
