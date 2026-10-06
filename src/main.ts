import './style.css';
import {AssetRuntime, type PackLease} from './assets/loader';
import {Presentation, type Mode} from './presentation/scene';
import {FixedClock, type Command} from './core/simulation';
import {GameSession} from './core/session';
import {Persistence} from './core/persistence';
import {EventHub, type GameplayEvent} from './core/events';
import {Input} from './core/input';
import {HEADINGS, calibrationFixture, contract} from './core/camera';
import {clipDuration} from './core/animation';
import {tuning, swordCombo} from './content/gameplay';
import {
  content,
  contentDefinitions,
  ContentRegistry,
  PLAYER_ID,
  type AreaId,
} from './content/world';
import {assetCatalog, actorVisuals} from './content/visuals';
import {parseGame, type GameSave} from './core/save';
import {browserBridge} from './platform/browser-store';
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
$('#app').innerHTML =
  `<header><div><h1>LANTERN</h1><small>Foundation / 003</small></div><span class="badge">DIAGNOSTIC ART · RUST / CLEAN INK PENDING</span><nav aria-label="Rooms"><button data-mode="encounter" class="active">Encounter</button><button data-mode="calibration">Calibration</button><button data-mode="animation">Animation lab</button><button data-mode="occlusion">Occlusion</button></nav></header><main class="stage"><canvas aria-label="Lantern Knight game" tabindex="0"></canvas><div class="title-card"><div class="eyebrow" id="room-eyebrow">A small playable encounter</div><h2 id="room-title">The Lamplighter’s Court</h2><p id="room-subtitle">Three wardens. One light. Keep moving.</p></div><section class="panel" id="lab" hidden><h3>Animation laboratory</h3><label>Asset<select id="asset"></select></label><label>Clip<select id="clip"></select></label><label>World heading<select id="heading"></select></label><div class="buttons"><button id="play">Pause</button><button id="step">Step frame</button></div><label>Speed<select id="speed"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label><label for="scrub">Visual timeline <span id="visual-time"></span></label><input id="scrub" type="range" min="0" max="800" value="0" step="1"><p class="muted">Seeking is silent. Damage is simulation-owned.</p><label>Anchor / trim / sockets<input id="overlays" type="checkbox" checked></label><label>Backdrop<select id="background"><option value="dark">Dark</option><option value="light">Light</option></select></label><p class="eyebrow">Sword authority / 60 Hz</p><div class="timeline"></div><p class="muted" id="action-timing"></p><p id="frame-status" class="muted"></p><div id="notify" class="log"></div></section><section class="panel" id="calibration" hidden><h3>Camera &amp; asset space</h3><p class="muted">${contract.id}<br>SELECTED · 45° azimuth / 35.264° elevation</p><p>XZ ground · +Y height<br>13-unit initial span · 1.8-unit ruler (provisional hero scale)</p><div class="directions">${calibrationFixture()
    .headings.map(
      (h) =>
        `<span>${h.id} ${h.facing === 'toward camera' ? '↓ FRONT' : h.facing === 'away from camera' ? '↑ BACK' : h.screenVector[0]! > 0.1 ? '→' : h.screenVector[0]! < -0.1 ? '←' : h.screenVector[1]! > 0 ? '↓' : '↑'}</span>`,
    )
    .join(
      '',
    )}</div><p class="muted">W → (−X, −Z) · D → (+X, −Z)<br>Travel faces movement; idle faces aim.</p><label>Framing<select id="zoom-span"><option value="11">11 m · close</option><option value="13" selected>13 m · selected default</option><option value="15">15 m · wide</option></select></label><p class="muted">Angles stay locked. Framing changes retain source density and registration. Historical engineering proxy; canonical Rust art pending.</p><label>Backdrop<select id="calibration-background"><option value="dark">Dark</option><option value="light">Light</option></select></label><div class="swatches"><span style="background:#808080"></span><span style="background:#e9bc67"></span><span style="background:#263b4a"></span></div><p class="muted">Reference sRGB swatches appear in the scene.</p></section><section class="panel" id="occlusion" hidden><h3>Composition proof</h3><p>Walk around the pillar, tree, corner and foreground crown.</p><p class="muted">Opaque geometry + alpha cutout actors. Contact shadows and translucent effects keep depth testing.</p><label>Collision / foot markers<input id="collision" type="checkbox" checked></label><div class="buttons"><button id="occlude-front">In front</button><button id="occlude-back">Behind</button></div><p class="muted">Nearby obstructing geometry fades to 38%. Collision is unchanged. General bridges and overhangs are outside this foundation.</p></section><section class="hud"><div class="row"><span>THE LAMPLIGHTER</span><span id="hp">100 / 100</span></div><div class="health"><span id="health-fill"></span></div><div class="row"><span id="enemy-count">3 wardens remain</span><span id="state">idle</span></div></section><div class="actions"><div class="action">Sword<small>LMB · buffered three-hit combo</small></div><div class="action">Dodge<small id="dodge-status">Shift · recovery cancel / ready</small></div><div class="action">Lantern flare<small id="ability-status">RMB · ready</small></div></div><section class="modal" id="modal" hidden><div><div class="eyebrow">Lantern Knight / Foundation</div><h2 id="modal-title">Paused</h2><p id="modal-copy">The court can wait.</p><div class="buttons"><button id="resume">Resume</button><button id="reset">Reset room</button><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="new-game">New Game</button></div><p id="save-notice" class="muted"></p><div id="new-confirm" hidden><p>Replace the saved session with a new game?</p><div class="buttons"><button id="confirm-new">Confirm New Game</button><button id="cancel-new">Cancel</button></div></div><label>Render scale <select id="render-scale"><option value="1">100% · DPR capped at 1</option><option value=".75">75%</option><option value=".5">50%</option></select></label></div></section></main><footer><span>WASD move · mouse aim · LMB sword · Shift dodge · RMB flare · Esc pause</span><button id="pause">Pause / save</button><span class="status" id="status" role="status">Loading manifest…</span></footer>`;
let session = new GameSession(),
  presentation: Presentation,
  input: Input,
  runtime: AssetRuntime,
  paused = false,
  mode: Mode = 'encounter',
  scale = 1,
  ready = false,
  busy = false,
  disposed = false,
  settingsError = '';
const clock = new FixedClock(),
  bridge = window.lantern ?? browserBridge,
  persistence = new Persistence(bridge),
  events = new EventHub();
const packs = new Map<string, PackLease>(),
  persistentLeases = new Map<string, PackLease>();
let roomLeases = new Map<string, PackLease>(),
  loadAbort = new AbortController(),
  loadRequest = 0;
let last = performance.now(),
  aim = {x: 0, z: 1},
  benchmark = false,
  benchmarkMeasuring = false,
  verification = false,
  benchmarkFrames: number[] = [],
  returnSave: GameSave | undefined;
function status(message: string, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
const safe = (fn: () => Promise<unknown>) =>
  void fn().catch((e) => status(String(e.message ?? e), true));
function pause(value: boolean) {
  paused = value;
  last = performance.now();
  clock.reset();
  input?.clear();
  $('#modal').hidden = !value;
  $('#new-confirm').hidden = true;
  $('#modal-title').textContent = 'Paused';
  $('#modal-copy').textContent = 'The court can wait.';
}
events.setGeneration(session.generation);
const unsubscribe = events.subscribe((event) => {
  if (event.kind === 'room-clear')
    status('Encounter cleared · walk through the amber gate');
  if (event.kind === 'room-reset')
    status('The light returns · current encounter reset');
  if (event.kind === 'area-transition')
    status(session.sim.areaDefinition.name + ' · encounter ready');
});
function publish(value: readonly GameplayEvent[]) {
  events.setGeneration(session.generation);
  events.publish(value);
}
async function acquireArea(area: AreaId, signal: AbortSignal) {
  const definition = content.area(area),
    ids = [
      ...new Set(
        definition.spawns.map((s) => {
          const visual = actorVisuals[content.actor(s.actor).visual];
          if (!visual) throw new Error('unknown actor visual');
          return visual.asset;
        }),
      ),
    ];
  const results = await Promise.allSettled(
    ids.map((id) => runtime.loadPack(id, signal)),
  );
  const leases = new Map<string, PackLease>();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') leases.set(ids[i]!, r.value);
  });
  const failed = results.find((r) => r.status === 'rejected');
  if (failed || signal.aborted) {
    for (const lease of leases.values()) lease.release();
    throw failed?.status === 'rejected'
      ? failed.reason
      : new Error('load cancelled');
  }
  try {
    for (const spawn of definition.spawns) {
      const visual = actorVisuals[content.actor(spawn.actor).visual]!;
      validateBinding(visual.id, leases.get(visual.asset)!);
    }
  } catch (error) {
    for (const lease of leases.values()) lease.release();
    throw error;
  }
  return leases;
}
function validateBinding(id: string, pack: PackLease) {
  const visual = actorVisuals[id]!;
  for (const clip of [...Object.values(visual.clips), ...visual.attacks]) {
    const clips = pack.manifest.asset.clips;
    if (!clips[clip] && !clips[pack.manifest.asset.fallbacks[clip] ?? ''])
      throw new Error(`missing visual clip ${id}/${clip}`);
  }
}
function installRoom(next: Map<string, PackLease>) {
  const old = roomLeases;
  roomLeases = next;
  for (const [id, lease] of next) packs.set(id, lease);
  for (const [id, lease] of persistentLeases) packs.set(id, lease);
  presentation.resetRoom(session.sim.areaDefinition);
  presentation.generation = session.generation;
  for (const [id, lease] of old) {
    lease.release();
    if (!next.has(id) && !persistentLeases.has(id)) packs.delete(id);
  }
  clock.reset();
  input.resetAim();
}
async function replaceArea(
  area: AreaId,
  commit: () => readonly GameplayEvent[],
) {
  const request = ++loadRequest;
  loadAbort.abort();
  const controller = new AbortController();
  loadAbort = controller;
  busy = true;
  clock.reset();
  input.clear();
  let next: Map<string, PackLease> | undefined;
  try {
    next = await acquireArea(area, controller.signal);
    if (request !== loadRequest) throw new Error('load cancelled');
    for (const pack of next.values()) presentation.warmPack(pack);
    const changes = commit();
    installRoom(next);
    next = undefined;
    publish(changes);
  } finally {
    if (next) for (const lease of next.values()) lease.release();
    if (request === loadRequest) busy = false;
  }
}
function autosave() {
  if (!benchmark && !verification)
    safe(async () => {
      if (await persistence.save(session.captureSave(), true))
        status('Checkpoint autosaved');
    });
}
async function transition(exit: string) {
  const plan = session.prepareTransition(exit);
  publish(plan.events);
  try {
    await replaceArea(plan.destination, () => session.commitTransition(plan));
    autosave();
  } catch (e) {
    publish(session.cancelTransition(plan));
    pause(true);
    throw e;
  }
}
async function resetRoom() {
  await replaceArea(session.sim.area, () => session.resetCurrentArea());
  pause(false);
  status('Room ready · engineering placeholders');
}
function setMode(next: Mode) {
  mode = next;
  presentation.setMode(next);
  clock.reset();
  input.clear();
  pause(false);
  presentation.debug = next === 'animation'
    ? $<HTMLInputElement>('#overlays').checked
    : next === 'occlusion' && $<HTMLInputElement>('#collision').checked;
  if (next === 'calibration')
    $<HTMLSelectElement>('#zoom-span').value = String(
      presentation.verticalSpan,
    );
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    el.classList.toggle('active', el.dataset.mode === next);
  $('#lab').hidden = next !== 'animation';
  $('#calibration').hidden = next !== 'calibration';
  $('#occlusion').hidden = next !== 'occlusion';
  $('.hud').hidden = next === 'animation' || next === 'calibration';
  $('.actions').hidden = $('.hud').hidden;
  $('#room-title').textContent =
    next === 'animation'
      ? 'From source to motion'
      : next === 'calibration'
        ? 'A shared frame of reference'
        : next === 'occlusion'
          ? 'Grounded in the world'
          : session.sim.areaDefinition.name;
  $('#room-eyebrow').textContent =
    next === 'encounter'
      ? 'A small playable encounter'
      : 'Foundation / inspection';
  $('#room-subtitle').textContent =
    next === 'animation'
      ? 'Same animator. Independent assets and actors.'
      : 'Selected camera v2 · historical engineering placeholders';
}
async function restore(save: GameSave) {
  const validated = parseGame(save);
  await replaceArea(validated.area, () => session.restoreSave(validated));
  persistence.loaded();
  verification = false;
  pause(false);
}
function updateLabClips() {
  const clips = Object.keys(presentation.manifest.asset.clips);
  $('#clip').innerHTML = clips.map((c) => `<option>${c}</option>`).join('');
  $<HTMLSelectElement>('#clip').value = presentation.labClip;
}
async function boot() {
  for (const definition of content.actors.values())
    if (
      !actorVisuals[definition.visual] ||
      !assetCatalog[actorVisuals[definition.visual]!.asset]
    )
      throw new Error(`invalid visual binding ${definition.visual}`);
  runtime = await AssetRuntime.open(assetCatalog);
  const heroId =
      actorVisuals[content.actor(content.definitions.player).visual]!.asset,
    hero = await runtime.loadPack(heroId, loadAbort.signal, (done, total) =>
      status(`Decoding hero ${done}/${total}`),
    );
  persistentLeases.set(heroId, hero);
  validateBinding(content.actor(content.definitions.player).visual, hero);
  packs.set(heroId, hero);
  roomLeases = await acquireArea(session.sim.area, loadAbort.signal);
  for (const [id, lease] of roomLeases) packs.set(id, lease);
  presentation = new Presentation($('canvas'), packs, events);
  input = new Input($('canvas'), presentation.camera, () => pause(!paused));
  const settings = await bridge.loadSettings();
  if (settings.status === 'ok' || settings.status === 'recovered') {
    scale = settings.data.renderScale;
    presentation.debug = settings.data.showDebug;
    presentation.verticalSpan = settings.data.verticalSpan;
  }
  if (settings.status === 'unreadable') settingsError = settings.message;
  await persistence.inspect();
  presentation.resize(scale);
  await presentation.warm();
  $('#asset').innerHTML = Object.keys(assetCatalog)
    .map((id) => `<option>${id}</option>`)
    .join('');
  $<HTMLSelectElement>('#asset').value = presentation.labAsset;
  updateLabClips();
  $('#heading').innerHTML = HEADINGS.map((d) => `<option>${d}</option>`).join(
    '',
  );
  $<HTMLSelectElement>('#heading').value = 'd45';
  $('#asset').onchange = () =>
    safe(async () => {
      const id = $<HTMLSelectElement>('#asset').value;
      if (!persistentLeases.has(id)) {
        const pack = await runtime.loadPack(id);
        presentation.warmPack(pack);
        persistentLeases.set(id, pack);
        packs.set(id, pack);
      }
      presentation.selectLabAsset(id);
      updateLabClips();
    });
  $('#clip').onchange = () => {
    presentation.labClip = $<HTMLSelectElement>('#clip').value;
    presentation.notifyLog = [];
  };
  $('#heading').onchange = () => {
    presentation.labHeading = $<HTMLSelectElement>('#heading')
      .value as (typeof HEADINGS)[number];
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
  $('#overlays').onchange = () =>
    (presentation.debug = $<HTMLInputElement>('#overlays').checked);
  $('#zoom-span').onchange = () => {
    presentation.verticalSpan = Number(
      $<HTMLSelectElement>('#zoom-span').value,
    );
    presentation.resize(scale);
  };
  $('#collision').onchange = () =>
    (presentation.debug = $<HTMLInputElement>('#collision').checked);
  for (const id of ['background', 'calibration-background'])
    $('#' + id).onchange = () => {
      presentation.background = $<HTMLSelectElement>('#' + id).value;
      for (const control of ['background', 'calibration-background'])
        $<HTMLSelectElement>('#' + control).value = presentation.background;
    };
  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((el) => (el.onclick = () => setMode(el.dataset.mode as Mode)));
  $('#pause').onclick = () => pause(!paused);
  $('#resume').onclick = () => pause(false);
  $('#reset').onclick = () => safe(resetRoom);
  $('#save').onclick = () =>
    safe(async () => {
      status('Saving checkpoint…');
      await persistence.save(session.captureSave());
      try {
        await bridge.saveSettings({
          version: 2,
          renderScale: scale,
          showDebug: presentation.debug,
          verticalSpan: presentation.verticalSpan,
        });
        settingsError = '';
      } catch (e) {
        settingsError = String((e as Error).message ?? e);
        throw e;
      }
      status('Checkpoint saved');
    });
  $('#load').onclick = () =>
    safe(async () => {
      const result = await persistence.load();
      if (result.status === 'ok' || result.status === 'recovered') {
        await restore(result.data);
        status(
          result.status === 'recovered'
            ? 'Loaded backup checkpoint'
            : 'Checkpoint loaded',
        );
      } else
        status(
          result.status === 'unreadable'
            ? result.message
            : 'No saved checkpoint',
          result.status === 'unreadable',
        );
    });
  $('#new-game').onclick = () => {
    $('#new-confirm').hidden = false;
  };
  $('#cancel-new').onclick = () => {
    $('#new-confirm').hidden = true;
  };
  $('#confirm-new').onclick = () =>
    safe(async () => {
      if (persistence.mode === 'unreadable')
        throw new Error('Unreadable save preserved; saving is disabled.');
      await replaceArea(content.definitions.initialArea, () => {
        session = new GameSession(
          content,
          142,
          content.definitions.initialArea,
          session.generation + 1,
        );
        return [];
      });
      persistence.confirmNew();
      verification = false;
      await persistence.save(session.captureSave());
      pause(false);
      status('New game saved');
    });
  $<HTMLSelectElement>('#render-scale').value = String(scale);
  $('#render-scale').onchange = () => {
    scale = Number($<HTMLSelectElement>('#render-scale').value);
    presentation.resize(scale);
  };
  $('#occlude-front').onclick = () => {
    Object.assign(session.sim.hero, {x: -1.2, z: 0.8, px: -1.2, pz: 0.8});
    session.sim.move(session.sim.hero, 0, 0);
  };
  $('#occlude-back').onclick = () => {
    Object.assign(session.sim.hero, {x: -2.8, z: -0.8, px: -2.8, pz: -0.8});
    session.sim.move(session.sim.hero, 0, 0);
  };
  window.addEventListener('resize', () => presentation.resize(scale));
  window.addEventListener('blur', () => {
    if (ready) pause(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ready) pause(true);
    last = performance.now();
    clock.reset();
  });
  ready = true;
  status(settingsError ? 'Settings unavailable: ' + settingsError : 'Ready · Rust / Clean INK art deferred', !!settingsError);
  last = performance.now();
  requestAnimationFrame(loop);
}
function loop(now: number) {
  if (disposed) return;
  const ms = Math.max(0, now - last);
  last = now;
  let alpha = 1;
  const step = (cmd: Command) => {
    const previous = session.generation,
      result = session.step(cmd);
    publish(result.events);
    if (result.reset) {
      clock.reset();
      input.resetAim();
      autosave();
      return false;
    }
    if (result.transition && !benchmark) {
      safe(() => transition(result.transition!));
      return false;
    }
    return session.generation === previous;
  };
  if (!paused && !busy && (mode === 'encounter' || benchmark))
    alpha = clock.advance(ms, () => {
      const sim = session.sim;
      if (benchmark && sim.cleared) {
        publish(session.resetCurrentArea());
        return false;
      }
      const target = sim.enemies.find((a) => a.health > 0) ?? sim.hero,
        angle = sim.tick / 120;
      const cmd: Command = benchmark
        ? {
            move: {x: Math.cos(angle), z: Math.sin(angle)},
            aim: {x: target.x, z: target.z},
            attack: true,
            ability: sim.tick % 180 === 0,
            dodge: sim.tick % 100 === 50,
            generation: sim.generation,
          }
        : input.consume(sim.hero, sim.areaDefinition, sim.generation);
      aim = cmd.aim;
      return step(cmd);
    });
  else if (!paused && !busy && mode === 'occlusion')
    alpha = clock.advance(ms, () => {
      const sim = session.sim,
        cmd = input.consume(sim.hero, sim.areaDefinition, sim.generation);
      aim = cmd.aim;
      sim.enemies.forEach((a) => (a.stun = 2));
      return step(cmd);
    });
  const sim = session.sim;
  presentation.update(sim, alpha, paused || busy ? 0 : ms, aim);
  if (benchmark && benchmarkMeasuring) benchmarkFrames.push(ms);
  if (mode === 'animation') {
    const c = presentation.labAnimator.clip,
      duration = clipDuration(c);
    $<HTMLInputElement>('#scrub').max = String(duration);
    $<HTMLInputElement>('#scrub').value = String(
      presentation.labTime % duration,
    );
    $('#visual-time').textContent =
      `${Math.round(presentation.labTime % duration)} / ${duration} ms`;
    const stage = swordCombo.find((s) => s.clip === presentation.labClip);
    $('#action-timing').textContent = stage
      ? `Ticks: wind-up ${stage.windup}, active to ${stage.activeEnd}, recovery to ${stage.total}; dash cancel from ${stage.cancelStart}. Stages 02/03 reuse placeholder drawings.`
      : 'Visual-only inspection; simulation owns action consequences.';
    $('#notify').textContent = presentation.notifyLog.join('\n');
    const f = presentation.frameMap.get(presentation.labAnimator.frame)!;
    $('#frame-status').textContent =
      `HISTORICAL / DIAGNOSTIC · ${f.id} · untrimmed foot (${presentation.manifest.asset.anchor.join(',')})`;
  }
  $('#hp').textContent =
    `${sim.hero.health} / ${sim.hero.definition.maxHealth}`;
  $('#health-fill').style.width =
    `${(sim.hero.health / sim.hero.definition.maxHealth) * 100}%`;
  $('#enemy-count').textContent =
    `${sim.enemies.filter((a) => a.health > 0).length} wardens remain`;
  $('#state').textContent =
    sim.hero.state === 'attack'
      ? `sword ${sim.hero.swingStage + 1} / 3`
      : sim.hero.state;
  if (mode === 'encounter') {
    $('#room-title').textContent = sim.areaDefinition.name;
    $('#room-subtitle').textContent = sim.cleared
      ? sim.areaDefinition.exits.length
        ? 'Walk through the amber gate to the connected area.'
        : 'Encounter cleared.'
      : sim.areaDefinition.subtitle;
  }
  $('#dodge-status').textContent =
    `Shift · ${sim.hero.dodgeCooldown ? (sim.hero.dodgeCooldown / 60).toFixed(1) + ' s' : 'ready'}`;
  $('#ability-status').textContent =
    `RMB · ${sim.hero.cooldown ? (sim.hero.cooldown / 60).toFixed(1) + ' s' : 'ready'}`;
  $<HTMLButtonElement>('#save').disabled =
    !persistence.canWrite || busy || benchmark || verification;
  $<HTMLButtonElement>('#new-game').disabled =
    persistence.mode === 'unreadable' || busy || benchmark || verification;
  $('#save-notice').textContent =
    persistence.error ||
    (settingsError ? 'Settings unavailable: ' + settingsError : '') ||
    (!persistence.canWrite
      ? 'Existing save protected. Choose Load or confirm New Game before saving.'
      : 'Manual saves and boundary autosaves share this checkpoint.');
  if (persistence.error)
    status('Saving unavailable: ' + persistence.error, true);
  else if (settingsError)
    status('Settings unavailable: ' + settingsError, true);
  requestAnimationFrame(loop);
}
async function startBenchmark(stress = false) {
  if (!runtime.developmentContent)
    throw new Error('benchmark unavailable in production');
  if (!returnSave) returnSave = session.captureSave();
  const definitions = stress
    ? {
        ...contentDefinitions,
        areas: contentDefinitions.areas.map((a) =>
          a.id === 'court'
            ? {
                ...a,
                spawns: [
                  ...a.spawns,
                  ...Array.from({length: 28}, (_, n) => {
                    const i = n + 5;
                    return {
                      id: `stress-${i}`,
                      actor: 'warden',
                      x: ((i % 6) - 3) * 1.2,
                      z: (Math.floor(i / 6) - 2) * 1.2,
                    };
                  }),
                ],
              }
            : a,
        ),
      }
    : contentDefinitions;
  await replaceArea('court', () => {
    session = new GameSession(
      new ContentRegistry(definitions),
      142,
      'court',
      session.generation + 1,
    );
    return [];
  });
  benchmark = true;
  benchmarkMeasuring = true;
  benchmarkFrames = [];
  clock.droppedMs = 0;
  pause(false);
  setMode('encounter');
}
Object.assign(window, {
  foundation: {
    get ready() {
      return ready;
    },
    get sim() {
      return session.sim;
    },
    get session() {
      return session;
    },
    get persistence() {
      return persistence;
    },
    get eventHistory() {
      return events.history;
    },
    get presentation() {
      return presentation;
    },
    get manifest() {
      return packs.get(
        actorVisuals[content.actor(content.definitions.player).visual]!.asset,
      )?.manifest;
    },
    async fixture(area: AreaId) {
      if (!runtime.developmentContent)
        throw new Error('diagnostic fixture unavailable in production');
      await replaceArea(area, () => {
        session = new GameSession(content, 142, area, session.generation + 1);
        verification = true;
        return [];
      });
      pause(false);
    },
    mode: setMode,
    pause,
    reset: resetRoom,
    stats: () => presentation.stats(),
    saveValue: () => session.captureSave(),
    startBenchmark,
    async finishBenchmark(restoreSession = true) {
      const result = {
        frames: benchmarkFrames,
        stats: presentation.stats(),
        droppedMs: clock.droppedMs,
        simulatedTicks: session.sim.tick,
      };
      benchmarkMeasuring = false;
      if (restoreSession && returnSave) {
        const snapshot = returnSave;
        await replaceArea(snapshot.area, () => {
          session = new GameSession(
            content,
            snapshot.seed,
            snapshot.area,
            session.generation,
          );
          return session.restoreSave(snapshot);
        });
        returnSave = undefined;
        benchmark = false;
      }
      return result;
    },
    dispose,
  },
});
function dispose() {
  if (disposed) return;
  disposed = true;
  ready = false;
  loadAbort.abort();
  input?.dispose();
  presentation?.dispose();
  for (const lease of roomLeases.values()) lease.release();
  for (const lease of persistentLeases.values()) lease.release();
  unsubscribe();
  events.dispose();
}
window.addEventListener('beforeunload', dispose);
boot().catch((e) => {
  dispose();
  status(`Boot failed: ${e.message}`, true);
  console.error(e);
});
