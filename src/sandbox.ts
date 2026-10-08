import { readScenePreview, previewHero, previewKey, type ScenePreviewState } from './scene-preview';
import './style.css';
import { Application } from './application';
import { Presentation, type Mode } from './presentation/scene';
import { sandboxContent, sandboxDefinitions } from './content/sandbox-world';
import { ContentRegistry } from './content/world';
import { GameSession } from './core/session';
import { assetCatalog } from './content/visuals';
import { createBrowserBridge } from './platform/browser-store';
import { HEADINGS, contract } from './core/camera';
import { clipDuration } from './core/animation';
import { walkTimings, type WalkTiming } from './core/locomotion-timing';
import {
  sampleAnimation,
  animationTreatments,
  type AnimationTreatment,
} from './core/animation-treatment';
import { sandboxUI } from './sandbox-ui';
import { heroTimings } from './content/hero-actions';
import type { Clip } from './assets/schema';
import './inspection';
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
$('#app').innerHTML = sandboxUI;
const controls = document.createElement('div');
controls.className = 'sandbox-controls';
controls.innerHTML =
  '<label>Scene<select id="scene-select"><option value="court">Graveyard Approach</option><option value="upper-landing">Ruined Chapel</option><option value="systems-fixture">Systems fixture</option></select></label><button id="preview-game">Play Opening Scene</button>';
document.querySelector('header')!.append(controls);
const sandboxBridge = window.lantern ?? createBrowserBridge('sandbox');
let previewReady = false;
let mode: Mode = 'encounter',
  presentation: Presentation;
let lightingReplay = false,
  replayStart = 0;
const app = new Application(
  $('canvas'),
  sandboxContent,
  assetCatalog,
  sandboxBridge,
  (...args) => new Presentation(...args),
  {
    status,
    pause: (value) => {
      $('#modal').hidden = !value;
    },
    frame: updateUI,
  },
  ['ink-hero-current'],
);
app.readOnly = true;
function status(message: string, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
function syncLabZoom() {
  const percent = Math.round(presentation.labZoom * 100);
  $<HTMLInputElement>('#lab-zoom').value = String(percent);
  $('#lab-zoom-value').textContent = `${percent}%`;
  $<HTMLButtonElement>('#lab-zoom-out').disabled = percent <= 50;
  $<HTMLButtonElement>('#lab-zoom-in').disabled = percent >= 400;
}
function resizePresentation() {
  if (mode === 'animation') {
    const canvas = $('canvas').getBoundingClientRect(),
      panel = $('#lab').getBoundingClientRect();
    presentation.labPanelInset = canvas.right - panel.left + 24;
  }
  presentation.resize(app.scale);
}
function syncLightingControls() {
  const look = presentation.lookRenderer.settings;
  $<HTMLSelectElement>('#lighting-look').value = look.look;
  $<HTMLSelectElement>('#lighting-rig').value = look.rig;
  $<HTMLInputElement>('#lighting-strength').value = String(look.strength * 100);
  $('#lighting-strength-value').textContent = Math.round(look.strength * 100) + '%';
  for (const [id, key] of [
    ['lighting-baseline', 'baseline'],
    ['lighting-enabled', 'lighting'],
    ['lighting-shadows', 'shadows'],
    ['lighting-atmosphere', 'atmosphere'],
    ['lighting-post', 'postprocessing'],
  ] as const)
    $<HTMLInputElement>('#' + id).checked = look[key];
}
function setMode(next: Mode) {
  if (next !== 'lighting' && lightingReplay) {
    lightingReplay = false;
    app.command = undefined;
  }
  mode = next;
  presentation.setMode(next);
  syncLightingControls();
  app.clock.reset();
  app.input.clear();
  app.pause(false);
  presentation.debug =
    next === 'animation'
      ? $<HTMLInputElement>('#overlays').checked
      : next === 'occlusion' && $<HTMLInputElement>('#collision').checked;
  if (next === 'calibration')
    $<HTMLSelectElement>('#zoom-span').value = String(presentation.verticalSpan);
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    el.classList.toggle('active', el.dataset.mode === next);
  $('#lab').hidden = next !== 'animation';
  $('#calibration').hidden = next !== 'calibration';
  $('#occlusion').hidden = next !== 'occlusion';
  $('#lighting-lab').hidden = next !== 'lighting';
  syncLabZoom();
  resizePresentation();
  $('.hud').hidden = next === 'animation' || next === 'calibration';
  $('.actions').hidden = $('.hud').hidden;
  $('#room-title').textContent =
    next === 'animation'
      ? 'From source to motion'
      : next === 'calibration'
        ? 'A shared frame of reference'
        : next === 'occlusion'
          ? 'Grounded in the world'
          : app.sim.areaDefinition.name;
  $('#room-eyebrow').textContent =
    next === 'encounter' || next === 'lighting'
      ? 'A small playable encounter'
      : 'Foundation / inspection';
  $('#room-subtitle').textContent =
    next === 'lighting'
      ? 'Golden hour / Silver hour'
      : next === 'animation'
        ? 'Same animator. Independent assets and actors.'
        : 'Selected camera v2 · current calibrated artwork';
}
function updateLabClips() {
  const clips = Object.keys(presentation.manifest.asset.clips);
  $('#clip').innerHTML = clips.map((c) => `<option>${c}</option>`).join('');
  $<HTMLSelectElement>('#clip').value = presentation.labClip;
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
  presentation = app.presentation;
  $<HTMLSelectElement>('#render-scale').value = String(app.scale);
  $<HTMLSelectElement>('#zoom-span').value = String(presentation.verticalSpan);
  const syncDof = () => {
    for (const id of ['lighting-dof', 'depth-of-field']) {
      $<HTMLInputElement>('#' + id).value = String(Math.round(presentation.depthOfField * 100));
      $('#' + id + '-value').textContent =
        presentation.depthOfField === 0 ? 'Off' : Math.round(presentation.depthOfField * 100) + '%';
    }
  };
  syncDof();
  for (const id of ['lighting-dof', 'depth-of-field']) {
    $('#' + id).oninput = () => {
      presentation.setDepthOfField(Number($<HTMLInputElement>('#' + id).value) / 100);
      syncDof();
    };
    $('#' + id).onchange = () => app.safe(() => app.saveSettings());
  }
  $('#lighting-rig').onchange = () =>
    presentation.lightingLab.setSettings({
      rig: $<HTMLSelectElement>('#lighting-rig').value as 'golden' | 'silver',
    });
  $('#lighting-look').onchange = () =>
    presentation.lightingLab.setSettings({
      look: $<HTMLSelectElement>('#lighting-look').value as 'ink' | 'diorama' | 'cinematic',
    });
  for (const [id, key] of [
    ['lighting-baseline', 'baseline'],
    ['lighting-enabled', 'lighting'],
    ['lighting-shadows', 'shadows'],
    ['lighting-atmosphere', 'atmosphere'],
    ['lighting-post', 'postprocessing'],
  ] as const)
    $('#' + id).onchange = () =>
      presentation.lightingLab.setSettings({ [key]: $<HTMLInputElement>('#' + id).checked });
  $('#lighting-strength').oninput = () => {
    const strength = Number($<HTMLInputElement>('#lighting-strength').value);
    presentation.lightingLab.setSettings({ strength: strength / 100 });
    $('#lighting-strength-value').textContent = `${strength}%`;
  };
  $('#lighting-pause').onclick = () => {
    app.pause(!app.paused);
    $('#modal').hidden = true;
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
      presentation.animationTreatment = $<HTMLSelectElement>('#' + id).value as AnimationTreatment;
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
    app.safe(async () => {
      await app.loadAsset('ink-hero-current');
      if (!presentation.animationFlow) await presentation.loadAnimationFlow();
      app.pause(false);
      $<HTMLInputElement>('#overlays').checked = false;
      presentation.selectLabAsset('ink-hero-current');
      $<HTMLSelectElement>('#asset').value = 'ink-hero-current';
      presentation.labClip = 'walk';
      updateLabClips();
      presentation.labAnimator.start(presentation.getClip('walk', presentation.labHeading));
      presentation.labTime = 0;
      presentation.labPaused = false;
      $('#play').textContent = 'Pause';
      setMode('animation');
    });
  const zoomPreview = (zoom: number) => {
    presentation.setLabZoom(Math.round(zoom * 100) / 100);
    syncLabZoom();
  };
  $('#lab-zoom').oninput = () => zoomPreview(Number($<HTMLInputElement>('#lab-zoom').value) / 100);
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
  $('#walk-restart').onclick = () => presentation.restartLab();
  $('#asset').innerHTML = Object.keys(assetCatalog)
    .map((id) => `<option>${id}</option>`)
    .join('');
  $<HTMLSelectElement>('#asset').value = presentation.labAsset;
  updateLabClips();
  $('#asset').onchange = () =>
    app.safe(async () => {
      const id = $<HTMLSelectElement>('#asset').value;
      await app.loadAsset(id);
      if (id === 'ink-hero-current' && !presentation.animationFlow)
        await presentation.loadAnimationFlow();
      presentation.selectLabAsset(id);
      updateLabClips();
    });
  $('#clip').onchange = () => {
    presentation.labClip = $<HTMLSelectElement>('#clip').value;
    presentation.notifyLog = [];
    updateLabHeadings();
  };
  $('#heading').onchange = () => {
    presentation.labHeading = $<HTMLSelectElement>('#heading').value as (typeof HEADINGS)[number];
    presentation.notifyLog = [];
  };
  $('#play').onclick = () => {
    presentation.labPaused = !presentation.labPaused;
    $('#play').textContent = presentation.labPaused ? 'Play' : 'Pause';
  };
  $('#step').onclick = () => {
    presentation.labPaused = true;
    $('#play').textContent = 'Play';
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
    $('#play').textContent = 'Play';
    presentation.labAnimator.seek(Number($<HTMLInputElement>('#scrub').value));
    presentation.labTime = presentation.labAnimator.time;
  };
  $('#speed').onchange = () =>
    (presentation.labSpeed = Number($<HTMLSelectElement>('#speed').value));
  $('#overlays').onchange = () => (presentation.debug = $<HTMLInputElement>('#overlays').checked);
  $('#zoom-span').onchange = () => {
    presentation.verticalSpan = Number($<HTMLSelectElement>('#zoom-span').value);
    presentation.resize(app.scale);
    app.safe(() => app.saveSettings());
  };
  $('#collision').onchange = () => (presentation.debug = $<HTMLInputElement>('#collision').checked);
  for (const id of ['background', 'calibration-background'])
    $('#' + id).onchange = () => {
      presentation.background = $<HTMLSelectElement>('#' + id).value;
      for (const control of ['background', 'calibration-background'])
        $<HTMLSelectElement>('#' + control).value = presentation.background;
    };
  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((el) => (el.onclick = () => setMode(el.dataset.mode as Mode)));

  $('#pause').onclick = () => app.pause(!app.paused);
  $('#resume').onclick = () => app.pause(false);
  $('#reset').onclick = () => app.safe(() => app.reset());
  for (const id of ['save', 'load', 'new-game']) $<HTMLButtonElement>('#' + id).disabled = true;
  $('#scene-select').onchange = () =>
    app.safe(() => fixture($<HTMLSelectElement>('#scene-select').value));
  $('#preview-game').onclick = () => {
    app.pause(true);
    if (window.lantern?.launchMode) void window.lantern.launchMode('game');
    else location.href = '/index.html';
  };
  $('#render-scale').onchange = () => {
    app.scale = Number($<HTMLSelectElement>('#render-scale').value);
    presentation.resize(app.scale);
    app.safe(() => app.saveSettings());
  };
  const requested = new URLSearchParams(location.search).get('scene');
  let restored: ScenePreviewState | undefined;
  try {
    restored = readScenePreview(sessionStorage.getItem(previewKey), sandboxContent);
  } catch {}
  if (requested && requested !== restored?.scene) {
    await fixture(requested);
    app.pause(true);
  } else if (restored) {
    await fixture(restored.scene);
    Object.assign(app.sim.hero, previewHero(restored, sandboxContent));
    presentation.verticalSpan = restored.span;
    app.scale = restored.scale;
    setMode(restored.mode);
    presentation.lightingLab.setSettings(restored.look);
    presentation.setDepthOfField(restored.look.depthOfField);
    syncLightingControls();
    app.pause(restored.paused);
    presentation.resize(app.scale);
    syncDof();
  }
  $<HTMLSelectElement>('#scene-select').value = app.sim.area;
  $<HTMLSelectElement>('#render-scale').value = String(app.scale);
  $<HTMLSelectElement>('#zoom-span').value = String(presentation.verticalSpan);
  previewReady = true;
  status('Dev Sandbox · disposable encounters; player checkpoints are isolated');
}
async function fixture(area: string) {
  lightingReplay = false;
  app.command = undefined;
  await app.replaceArea(area, () => {
    app.session = new GameSession(sandboxContent, 142, area, app.session.generation + 1);
    return [];
  });
  app.pause(false);
  $<HTMLSelectElement>('#scene-select').value = area;
  if (location.protocol === 'http:') {
    const url = new URL(location.href);
    url.searchParams.set('scene', area);
    history.replaceState(null, '', url);
  }
}
async function startLightingReplay() {
  await fixture(app.sim.area);
  setMode('lighting');
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
  $('#save-notice').textContent = 'Sandbox sessions cannot load or write game checkpoints.';
  if (mode === 'encounter' || mode === 'lighting') {
    $('#room-title').textContent = sim.areaDefinition.name;
    $('#room-subtitle').textContent = sim.areaDefinition.subtitle;
  }
  if (mode === 'lighting') {
    const lab = presentation.lightingLab.stats();
    $('#lighting-pause').textContent = app.paused ? 'Resume scene' : 'Pause scene';
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
        : 'No undeclared Graveyard overlaps. Green: footprints. Gold: joins. Amber: light sockets.';
  }
  if (mode === 'animation') updateAnimationReview();
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
  $('#visual-time').textContent = `${Math.round(elapsed)} / ${Math.round(span)} ms`;
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
  lightingReplay = false;
  await app.loadAsset('ink-skeleton');
  returnSave ??= app.session.captureSave();
  const definitions = stress
    ? {
        ...sandboxDefinitions,
        areas: sandboxDefinitions.areas.map((a) =>
          a.id === 'court'
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
  await app.replaceArea('court', () => {
    app.session = new GameSession(
      new ContentRegistry(definitions),
      142,
      'court',
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
    return app.ready && previewReady;
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
  reset: () => app.reset(),
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
  dispose: () => app.dispose(),
};
function savePreview() {
  if (!previewReady || !app.ready || app.busy) return;
  const state: ScenePreviewState = {
    version: 1,
    scene: app.sim.area,
    hero: { x: app.sim.hero.x, z: app.sim.hero.z, yaw: app.sim.hero.yaw },
    span: presentation.verticalSpan,
    scale: app.scale as ScenePreviewState['scale'],
    mode,
    paused: app.paused,
    look: { ...presentation.lightingLab.settings, depthOfField: presentation.depthOfField },
  };
  try {
    sessionStorage.setItem(previewKey, JSON.stringify(state));
  } catch {}
}
window.addEventListener('pagehide', savePreview);
window.addEventListener('beforeunload', () => {
  savePreview();
  app.dispose();
});
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', savePreview);
  import.meta.hot.dispose(() => {
    savePreview();
    app.dispose();
  });
}
boot().catch((error) => {
  app.dispose();
  status(`Sandbox failed: ${error.message}`, true);
  console.error(error);
});
