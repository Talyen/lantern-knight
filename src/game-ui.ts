import { audioControls, bindAudioControls } from './audio/controls';
import { bindAdventureUI } from './adventure-ui';
import { visualEffectLabels, type VisualEffect } from './content/visual-effects';
import type { Application } from './application';
export const gameUI = `<main class="stage game-stage"><canvas aria-label="Lantern Knight game" tabindex="0"></canvas>
<div class="travel-veil" aria-hidden="true"></div><div class="title-card"><div class="eyebrow">Lantern Knight</div><h2 id="room-title"></h2></div>
<section class="hud"><div class="row"><span>THE LAMPLIGHTER</span><span id="hp"></span></div><div class="health"><span id="health-fill"></span></div><p id="objective"></p></section>
<div class="actions"><div class="action">Sword<small>LMB · Sweep / Lunge</small></div><div class="action">Dodge<small id="dodge-status"></small></div><div class="action">Lantern<small id="ability-status"></small></div></div>
<p class="controls-hint">WASD move · Mouse aim · LMB sword · Shift dodge · RMB lantern · E interact · I inventory · Q potion · Esc pause</p>
<p id="interaction-hint" aria-live="polite"></p><span id="potion-count"></span><button id="pause" aria-label="Pause / save">Ⅱ</button><p id="status" role="status"></p>
<dialog class="modal" id="modal" aria-labelledby="pause-title"><div><div class="eyebrow">Lantern Knight</div><h2 id="pause-title">Paused</h2><div class="buttons"><button id="resume" autofocus>Resume</button><button id="reset">Reset encounter</button><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="new-game">New Game</button></div><p id="menu-status" role="status" aria-live="polite"></p><p id="save-notice"></p><dialog id="new-confirm" class="confirmation" aria-labelledby="new-game-question"><p id="new-game-question">Replace the saved session with a new game?</p><p id="new-status" role="status" aria-live="polite"></p><div class="buttons"><button id="confirm-new">Confirm New Game</button><button id="cancel-new" autofocus>Cancel</button></div></dialog>
${audioControls}<label>Camera distance<select id="zoom-span"><option value="9">Close</option><option value="11">Medium</option><option value="13">Wide</option><option value="15">Far</option></select></label>
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
// The mounted Game owns its controls, async feedback and adventure dialog.
export function createGameUI(root: HTMLElement) {
  const lifetime = new AbortController();
  let closed = false;
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const on = <K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) => element.addEventListener(type, listener, { signal: lifetime.signal });
  let adventure: ReturnType<typeof bindAdventureUI> | undefined;
  let unsubscribe: (() => void) | undefined;
  let bound = false;
  let pending = false;
  function bind(app: Application) {
    if (closed || bound) throw new Error('Game UI already bound or disposed');
    bound = true;
    adventure = bindAdventureUI(app, root, lifetime.signal);
    bindAudioControls(app, root, lifetime.signal);
    const modal = $<HTMLDialogElement>('#modal'),
      confirmation = $<HTMLDialogElement>('#new-confirm');
    const perform = (message: string, action: () => Promise<string>) =>
      app.safe(async () => {
        if (closed || pending) return;
        pending = true;
        status(message);
        update(app);
        let result: string;
        try {
          result = await action();
        } finally {
          pending = false;
          update(app);
        }
        status(result);
      });
    const cancelNew = () => {
      confirmation.close();
      void app.audio.play('ui-cancel', { world: false }).catch(() => {});
    };
    on(modal, 'cancel', (event) => {
      event.preventDefault();
      app.pause(false);
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (!modal.open || event.target instanceof HTMLSelectElement) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) {
            if (confirmation.open) cancelNew();
            else app.pause(false);
          }
        } else if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      { capture: true, signal: lifetime.signal },
    );
    for (const box of root.querySelectorAll<HTMLInputElement>('[data-visual-effect]')) {
      const key = box.dataset.visualEffect as VisualEffect;
      box.checked = app.presentation.visualEffects[key];
      on(box, 'change', () => {
        app.presentation.setVisualEffects({ [key]: box.checked });
        app.safe(() => app.saveSettings());
      });
    }
    const dof = $<HTMLInputElement>('#depth-of-field'),
      label = $('#depth-of-field-value');
    const syncDof = () => {
      dof.value = String(Math.round(app.presentation.depthOfField * 100));
      label.textContent = app.presentation.depthOfField === 0 ? 'Off' : dof.value + '%';
    };
    syncDof();
    on(dof, 'input', () => {
      app.presentation.setDepthOfField(Number(dof.value) / 100);
      syncDof();
    });
    on(dof, 'change', () => app.safe(() => app.saveSettings()));
    on($('#pause'), 'click', () => app.pause(!app.paused));
    on($('#resume'), 'click', () => app.pause(false));
    on($('#reset'), 'click', () =>
      perform('Resetting encounter…', async () => {
        await app.reset();
        return 'Encounter reset';
      }),
    );
    on($('#save'), 'click', () =>
      perform('Saving checkpoint…', async () => {
        await app.save();
        return 'Checkpoint saved';
      }),
    );
    on($('#load'), 'click', () =>
      perform('Loading checkpoint…', async () =>
        (await app.load()) ? 'Checkpoint loaded' : 'No saved checkpoint',
      ),
    );
    on($('#new-game'), 'click', () => {
      if (!confirmation.open) {
        $('#new-status').textContent = '';
        confirmation.showModal();
        void app.audio.play('ui-confirm', { world: false }).catch(() => {});
      }
    });
    on($('#cancel-new'), 'click', cancelNew);
    on($('#confirm-new'), 'click', () =>
      perform('Starting new game…', async () => {
        await app.newGame();
        return 'New game started';
      }),
    );
    $<HTMLSelectElement>('#zoom-span').value = String(app.presentation.verticalSpan);
    on($('#zoom-span'), 'change', () => {
      app.presentation.verticalSpan = Number($<HTMLSelectElement>('#zoom-span').value);
      app.presentation.resize(app.scale);
      app.safe(() => app.saveSettings());
    });
    $<HTMLSelectElement>('#render-scale').value = String(app.scale);
    on($('#render-scale'), 'change', () => {
      app.scale = Number($<HTMLSelectElement>('#render-scale').value);
      app.presentation.resize(app.scale);
      app.safe(() => app.saveSettings());
    });
    if (app.bridge?.launchMode) {
      const button = document.createElement('button');
      button.textContent = 'Return to Sandbox';
      on(button, 'click', () => {
        app.pause(true);
        app.safe(() => app.bridge.launchMode!('sandbox'));
      });
      $('#dev-return').append(button);
    }
    unsubscribe = app.events.subscribe((event) => {
      if (event.kind === 'action-unavailable') status(event.reason);
      if (event.kind === 'potion-used') status('Health Potion · restored health');
      if (event.kind === 'room-clear')
        status(
          app.sim.areaDefinition.exits.length
            ? 'Area cleared. Passage available.'
            : 'Area cleared.',
        );
    });
  }
  let lastArea = '';
  let statusTimeout: ReturnType<typeof setTimeout> | undefined;
  function status(message: string, error = false) {
    if (closed) return;
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
  function showPause(paused: boolean) {
    if (closed) return;
    const modal = $<HTMLDialogElement>('#modal'),
      confirmation = $<HTMLDialogElement>('#new-confirm');
    if (confirmation.open) confirmation.close();
    if (paused && !adventure?.isOpen() && !modal.open) modal.showModal();
    else if (!paused && modal.open) {
      modal.close();
      root.querySelector<HTMLCanvasElement>('canvas')?.focus();
    }
  }
  function update(app: Application) {
    if (closed) return;
    const s = app.sim;
    if (adventure?.isOpen() && $<HTMLDialogElement>('#modal').open)
      $<HTMLDialogElement>('#modal').close();
    const interaction = app.interaction;
    $('#interaction-hint').textContent = interaction
      ? (interaction.blocked ??
        (interaction.kind === 'breakable' ? interaction.label : 'E · ' + interaction.label))
      : '';
    $('#potion-count').textContent =
      `Q · Health Potion ×${app.session.inventory['health-potion'] ?? 0}`;
    $('#hp').textContent = `${s.hero.health} / ${s.maxHealth}`;
    $('#health-fill').style.width = `${(s.hero.health / s.maxHealth) * 100}%`;
    $('#objective').textContent = '';
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
    for (const id of ['save', 'reset', 'load', 'new-game', 'confirm-new'])
      $<HTMLButtonElement>('#' + id).disabled = unavailable;
    $<HTMLButtonElement>('#resume').disabled = !app.roomReady;
    $<HTMLButtonElement>('#save').disabled = unavailable || !app.roomReady;
    $('#save-notice').textContent =
      (!app.roomReady
        ? 'Room unavailable. Reset, load a checkpoint, or start a new game to recover.'
        : '') ||
      app.persistence.error ||
      app.settingsError ||
      'Prototype checkpoints may reset when the game changes.';
  }

  return {
    bind,
    status,
    showPause,
    update,
    dispose() {
      if (closed) return;
      closed = true;
      lifetime.abort();
      unsubscribe?.();
      clearTimeout(statusTimeout);
      $<HTMLDialogElement>('#new-confirm').close();
      $<HTMLDialogElement>('#modal').close();
    },
  };
}
