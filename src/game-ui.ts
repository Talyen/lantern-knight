import { visualEffectLabels, type VisualEffect } from './content/visual-effects';
import type { Application } from './application';
export const gameUI = `<main class="stage game-stage"><canvas aria-label="Lantern Knight game" tabindex="0"></canvas>
<div class="title-card"><div class="eyebrow">Lanternkeeper’s Rest</div><h2 id="room-title"></h2></div>
<section class="hud"><div class="row"><span>THE LAMPLIGHTER</span><span id="hp"></span></div><div class="health"><span id="health-fill"></span></div><p id="objective"></p></section>
<div class="actions"><div class="action">Sword<small>LMB · Sweep / Lunge</small></div><div class="action">Dodge<small id="dodge-status"></small></div><div class="action">Lantern<small id="ability-status"></small></div></div>
<p class="controls-hint">WASD move · Mouse aim · LMB sword · Shift dodge · RMB lantern · Esc pause</p>
<button id="pause" aria-label="Pause / save">Ⅱ</button><p id="status" role="status"></p>
<dialog class="modal" id="modal" aria-labelledby="pause-title"><div><div class="eyebrow">Lantern Knight</div><h2 id="pause-title">Paused</h2><div class="buttons"><button id="resume" autofocus>Resume</button><button id="reset">Reset encounter</button><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="new-game">New Game</button></div><p id="menu-status" role="status" aria-live="polite"></p><p id="save-notice"></p><dialog id="new-confirm" class="confirmation" aria-labelledby="new-game-question"><p id="new-game-question">Replace the saved session with a new game?</p><p id="new-status" role="status" aria-live="polite"></p><div class="buttons"><button id="confirm-new">Confirm New Game</button><button id="cancel-new" autofocus>Cancel</button></div></dialog>
<label>Camera distance<select id="zoom-span"><option value="9">Close</option><option value="11">Medium</option><option value="13">Wide</option><option value="15">Far</option></select></label>
<label for="depth-of-field">Depth of field <output id="depth-of-field-value">100%</output></label><input id="depth-of-field" type="range" min="0" max="100" step="5" value="100"><p class="muted">Foreground and distance blur. Set to 0% to turn off.</p><label>Render scale<select id="render-scale"><option value="1">100% · up to 4K</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label><fieldset class="visual-options"><legend>Visual effects</legend>${Object.entries(
  visualEffectLabels,
)
  .map(
    ([key, label]) =>
      `<label>${label}<input type="checkbox" data-visual-effect="${key}" checked></label>`,
  )
  .join(
    '',
  )}<p class="muted">Rain appears only when the scene or weather calls for it.</p></fieldset><div id="dev-return"></div></div></dialog></main>`;
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
let pending = false;
export function bindGameUI(app: Application) {
  const modal = $<HTMLDialogElement>('#modal'),
    confirmation = $<HTMLDialogElement>('#new-confirm');
  const perform = (message: string, action: () => Promise<string>) =>
    app.safe(async () => {
      if (pending) return;
      pending = true;
      status(message);
      updateGameUI(app);
      let result: string;
      try {
        result = await action();
      } finally {
        pending = false;
        updateGameUI(app);
      }
      status(result);
    });
  modal.oncancel = (event) => {
    event.preventDefault();
    app.pause(false);
  };
  document.addEventListener(
    'keydown',
    (event) => {
      if (!modal.open || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          if (confirmation.open) confirmation.close();
          else app.pause(false);
        }
      } else if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-visual-effect]')) {
    const key = box.dataset.visualEffect as VisualEffect;
    box.checked = app.presentation.visualEffects[key];
    box.onchange = () => {
      app.presentation.setVisualEffects({ [key]: box.checked });
      app.safe(() => app.saveSettings());
    };
  }
  const dof = $<HTMLInputElement>('#depth-of-field'),
    label = $('#depth-of-field-value');
  const syncDof = () => {
    dof.value = String(Math.round(app.presentation.depthOfField * 100));
    label.textContent = app.presentation.depthOfField === 0 ? 'Off' : dof.value + '%';
  };
  syncDof();
  dof.oninput = () => {
    app.presentation.setDepthOfField(Number(dof.value) / 100);
    syncDof();
  };
  dof.onchange = () => app.safe(() => app.saveSettings());
  $('#pause').onclick = () => app.pause(!app.paused);
  $('#resume').onclick = () => app.pause(false);
  $('#reset').onclick = () =>
    perform('Resetting encounter…', async () => {
      await app.reset();
      return 'Encounter reset';
    });
  $('#save').onclick = () =>
    perform('Saving checkpoint…', async () => {
      await app.save();
      return 'Checkpoint saved';
    });
  $('#load').onclick = () =>
    perform('Loading checkpoint…', async () =>
      (await app.load()) ? 'Checkpoint loaded' : 'No saved checkpoint',
    );
  $('#new-game').onclick = () => {
    if (!confirmation.open) {
      $('#new-status').textContent = '';
      confirmation.showModal();
    }
  };
  $('#cancel-new').onclick = () => {
    confirmation.close();
  };
  $('#confirm-new').onclick = () =>
    perform('Starting new game…', async () => {
      await app.newGame();
      return 'New game started';
    });
  $<HTMLSelectElement>('#zoom-span').value = String(app.presentation.verticalSpan);
  $('#zoom-span').onchange = () => {
    app.presentation.verticalSpan = Number($<HTMLSelectElement>('#zoom-span').value);
    app.presentation.resize(app.scale);
    app.safe(() => app.saveSettings());
  };
  $<HTMLSelectElement>('#render-scale').value = String(app.scale);
  $('#render-scale').onchange = () => {
    app.scale = Number($<HTMLSelectElement>('#render-scale').value);
    app.presentation.resize(app.scale);
    app.safe(() => app.saveSettings());
  };
  app.events.subscribe((event) => {
    if (event.kind === 'room-clear')
      status(
        app.sim.area === 'upper-landing' ? 'The chapel is at rest' : 'The chapel door is unsealed',
      );
  });
}
let lastArea = '';
let statusTimeout: ReturnType<typeof setTimeout> | undefined;
export function status(message: string, error = false) {
  const elements = [$('#status'), $('#menu-status'), $('#new-status')];
  for (const el of elements) {
    el.textContent = message;
    el.classList.toggle('error', error);
  }
  clearTimeout(statusTimeout);
  if (!error && !pending)
    statusTimeout = setTimeout(() => {
      for (const el of elements) el.textContent = '';
    }, 5000);
}
export function showPause(paused: boolean) {
  const modal = $<HTMLDialogElement>('#modal'),
    confirmation = $<HTMLDialogElement>('#new-confirm');
  if (confirmation.open) confirmation.close();
  if (paused && !modal.open) modal.showModal();
  else if (!paused && modal.open) modal.close();
}
export function updateGameUI(app: Application) {
  const s = app.sim;
  $('#hp').textContent = `${s.hero.health} / ${s.hero.definition.maxHealth}`;
  $('#health-fill').style.width = `${(s.hero.health / s.hero.definition.maxHealth) * 100}%`;
  $('#objective').textContent = s.cleared
    ? s.area === 'court'
      ? 'Enter the chapel'
      : 'The chapel is at rest'
    : s.engaged
      ? 'Clear the restless dead'
      : s.area === 'court'
        ? 'Follow the lantern path'
        : 'Approach the altar';
  $('#dodge-status').textContent = s.hero.dodgeCooldown
    ? `${(s.hero.dodgeCooldown / 60).toFixed(1)} s`
    : 'Shift · ready';
  $('#ability-status').textContent = s.hero.cooldown
    ? `${(s.hero.cooldown / 60).toFixed(1)} s`
    : 'RMB · ready';
  if (lastArea !== s.area) {
    lastArea = s.area;
    $('#room-title').textContent = s.areaDefinition.name;
    const title = $('.title-card');
    title.classList.remove('location-enter');
    void title.offsetWidth;
    title.classList.add('location-enter');
  }
  const unavailable = app.busy || pending;
  $<HTMLButtonElement>('#save').disabled = !app.persistence.canWrite || unavailable;
  for (const id of ['reset', 'load']) $<HTMLButtonElement>('#' + id).disabled = unavailable;
  for (const id of ['new-game', 'confirm-new'])
    $<HTMLButtonElement>('#' + id).disabled = app.persistence.mode === 'unreadable' || unavailable;
  $('#save-notice').textContent =
    app.persistence.error ||
    app.settingsError ||
    (!app.persistence.canWrite
      ? 'Existing checkpoint protected. Load it or confirm New Game.'
      : 'Manual saves and boundary autosaves share this checkpoint.');
}
