import { createItemArtwork } from './item-art';
import { GroundLootLabels } from './ground-loot-labels';
import { Vector3 } from 'three';
import { heightAt } from './content/world';
import { bindAudioControls } from './audio/controls';
import { gameMenu } from './game-menu';
import './player-controls.css';
import './game-ui.css';
import './adventure-ui.css';
import { bindAdventureUI } from './adventure-ui';
import { type VisualEffect } from './content/visual-effects';
import type { Application } from './application';
import { tuning } from './content/gameplay';
import { clearSegment } from './content/collision';
import { itemArt } from './content/item-art';
import { playerIcon } from './player-icons';
import { bindPlayerTooltips } from './player-tooltips';
export const gameUI = `<main class="stage game-stage"><canvas aria-label="Lantern Knight game" tabindex="0"></canvas>
<div class="travel-veil" aria-hidden="true"></div><div class="title-card"><h2 id="room-title"></h2></div>
<section class="hud" aria-label="Health and supplies"><div class="health-orb" tabindex="0" data-tip="Health"><div class="health" role="meter" aria-label="Health" aria-valuemin="0"><span id="health-fill"></span></div><span id="hp"></span></div><div class="supply-row" tabindex="0" role="group" aria-label="Health Potion" data-tip="Health Potion · Q"><span class="supply-art"></span><kbd>Q</kbd><span id="potion-count"></span></div><div id="lantern-readiness" tabindex="0" data-tip="Lantern burst · RMB" hidden><div class="lantern-heading"><span></span><kbd>RMB</kbd><span id="lantern-state" class="visually-hidden"></span></div><div class="lantern-charge" role="meter" aria-label="Lantern recharge" aria-valuemin="0" aria-valuemax="100"><span id="lantern-fill"></span></div></div></section>
<div class="ground-loot-labels" aria-label="Ground items"></div><p id="interaction-hint" aria-live="polite"></p><p id="lantern-hint" aria-live="polite"></p><p id="action-hint" aria-live="polite"></p>
<div class="game-toolbar"><button id="open-inventory" class="icon-button" aria-label="Inventory I" data-tip="Inventory · I">${playerIcon('bag')}<kbd>I</kbd></button><button id="pause" class="icon-button" aria-label="Pause menu" data-tip="Menu · Esc">${playerIcon('settings')}<kbd>Esc</kbd></button></div>
<p id="status" role="status"></p><section id="startup-error" class="startup-failure" aria-labelledby="startup-error-title" hidden><p class="eyebrow">Lantern Knight</p><h1 id="startup-error-title">The path could not be opened.</h1><p id="startup-error-detail" role="alert"></p><a href="./index.html">Try again</a></section>${gameMenu}</main>`;
// The mounted Game owns its controls, async feedback and adventure dialog.
export function createGameUI(root: HTMLElement) {
  const lifetime = new AbortController();
  let closed = false;
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  // Per-frame writes only when a value actually changed; repeated style/value
  // writes re-dirty layout for no visible difference.
  const setText = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };
  const setStyle = (element: HTMLElement, property: string, value: string) => {
    if (element.style.getPropertyValue(property) !== value)
      element.style.setProperty(property, value);
  };
  const on = <K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) => element.addEventListener(type, listener, { signal: lifetime.signal });
  let adventure: ReturnType<typeof bindAdventureUI> | undefined;
  let unsubscribe: (() => void) | undefined;
  let bound = false;
  let pending = false;
  let atTitle = true;
  let journeyStarted = false;
  let page: 'home' | 'settings' | 'help' = 'home';
  let helpReturn: 'home' | 'settings' = 'home';
  let application: Application | undefined;
  const cuePosition = new Vector3();
  let lootLabels: GroundLootLabels | undefined;
  bindPlayerTooltips(root, lifetime.signal);
  function bind(app: Application) {
    if (closed || bound) throw new Error('Game UI already bound or disposed');
    bound = true;
    application = app;
    journeyStarted = app.startedFromCheckpoint;
    const artwork = createItemArtwork(app.runtime, lifetime.signal);
    $('.supply-row > span').prepend(artwork('ui-potion'));

    $('.lantern-heading > span').prepend(artwork('ui-lantern'));
    $('.menu-crest').append(artwork('ui-title'));
    $('.health-orb').append(artwork('ui-health', 'health-frame'));
    for (const icon of root.querySelectorAll<SVGElement>('[data-player-icon]')) {
      const id = `ui-${icon.dataset.playerIcon}`;
      if (itemArt[id]) icon.replaceWith(artwork(id, 'control-icon'));
    }
    lootLabels = new GroundLootLabels($('.ground-loot-labels'), app, lifetime.signal);
    adventure = bindAdventureUI(app, root, lifetime.signal);
    bindAudioControls(app, root, lifetime.signal);
    const modal = $<HTMLDialogElement>('#modal'),
      confirmation = $<HTMLDialogElement>('#new-confirm');
    const perform = (message: string, action: () => Promise<string>) =>
      app.safe(async () => {
        if (closed || pending) return;
        const trigger = document.activeElement as HTMLElement | null;
        pending = true;
        status(message);
        update(app);
        let result: string;
        try {
          result = await action();
        } finally {
          pending = false;
          update(app);
          if (!closed && modal.open) {
            if (confirmation.open) $('#cancel-new').focus();
            else if (atTitle && page === 'home') $('#menu-start').focus();
            else if (trigger?.getClientRects().length) trigger.focus();
          }
        }
        status(result);
      });
    const cancelNew = () => {
      if (pending) return;
      confirmation.close();
      void app.audio.play('ui-cancel', { world: false }).catch(() => {});
    };
    on(modal, 'cancel', (event) => {
      event.preventDefault();
      navigateBack();
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
            else navigateBack();
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
    on($('#menu-start'), 'click', () => {
      journeyStarted = true;
      app.pause(false);
    });
    on($('#menu-settings'), 'click', () => showPage('settings'));
    on($('#menu-help'), 'click', () => {
      helpReturn = 'home';
      showPage('help');
    });
    on($('#settings-controls'), 'click', () => {
      helpReturn = 'settings';
      showPage('help');
    });
    const settingTabs = [...root.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')];
    function selectSettings(tab: HTMLButtonElement) {
      for (const candidate of settingTabs) {
        const active = candidate === tab;
        candidate.setAttribute('aria-selected', String(active));
        candidate.tabIndex = active ? 0 : -1;
        $('#' + candidate.getAttribute('aria-controls')).hidden = !active;
      }
    }
    for (const tab of settingTabs) {
      on(tab, 'click', () => selectSettings(tab));
      on(tab, 'keydown', (event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? settingTabs.length - 1
              : (settingTabs.indexOf(tab) +
                  (event.key === 'ArrowUp' ? -1 : 1) +
                  settingTabs.length) %
                settingTabs.length;
        const next = settingTabs[index]!;
        selectSettings(next);
        next.focus();
      });
    }
    on($('#menu-back'), 'click', navigateBack);
    on($('#open-inventory'), 'click', () => adventure?.openInventory());
    on($('#return-title'), 'click', () =>
      perform('Saving your journey…', async () => {
        await app.save();
        if (!closed) {
          journeyStarted = true;
          atTitle = true;
          showPage('home');
          app.pause(true);
        }
        return 'Journey saved';
      }),
    );
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
        (await app.load()) ? 'Checkpoint loaded' : 'No checkpoint. Begin a new journey.',
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
      perform('Starting journey…', async () => {
        await app.newGame();
        journeyStarted = true;
        return 'New journey started';
      }),
    );
    $<HTMLSelectElement>('#zoom-span').value = String(app.presentation.verticalSpan);
    on($('#zoom-span'), 'change', () => {
      app.presentation.verticalSpan = Number($<HTMLSelectElement>('#zoom-span').value);
      app.presentation.resize(app.scale);
      app.safe(() => app.saveSettings());
    });
    $<HTMLSelectElement>('#ui-scale').value = String(app.uiScale);
    on($('#ui-scale'), 'change', () => {
      app.uiScale = Number($<HTMLSelectElement>('#ui-scale').value) as 0.9 | 1 | 1.15;
      root.style.setProperty('--ui-scale', String(app.uiScale));
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
      if (event.kind === 'action-unavailable') status(event.reason, true);
      if (event.kind === 'potion-used') status('Health Potion · restored health');
      if (event.kind === 'room-reset' && event.reason === 'death') status('Returned to checkpoint');
    });
    showPage('home');
    app.pause(true);
    update(app);
  }
  function showPage(next: typeof page) {
    if (closed) return;
    page = next;
    const home = page === 'home';
    const modal = $('#modal');
    modal.classList.toggle('is-title', atTitle && home);
    modal.classList.toggle('is-subpage', !home);
    modal.classList.toggle('is-help', page === 'help');
    $('#menu-home').hidden = !home;
    $('#settings-page').hidden = page !== 'settings';
    $('#help-page').hidden = page !== 'help';
    $('#menu-back').hidden = home && atTitle;
    $('#menu-back').setAttribute('aria-label', home ? 'Return to game' : 'Back');
    $('#menu-back').dataset.tip = home ? 'Resume · Esc' : 'Back · Esc';
    $('#menu-help').hidden = false;
    if (atTitle) $('.menu-utilities').prepend($('#menu-help'));
    else $('#menu-actions').insertBefore($('#menu-help'), $('#return-title'));
    $('#menu-start').hidden = !atTitle;
    $('#resume').hidden = atTitle;
    $('#new-game').hidden = atTitle && !journeyStarted;
    $('#return-title').hidden = atTitle;
    $('#checkpoint-options').hidden = atTitle;
    $<HTMLDetailsElement>('#checkpoint-options').open = false;
    const newGame = $('#new-game');
    if (atTitle) $('#menu-actions').insertBefore(newGame, $('#menu-settings'));
    else $('#checkpoint-actions').append(newGame);
    $('#pause-title').innerHTML = home
      ? atTitle
        ? 'Lantern<br>Knight'
        : 'Paused'
      : page === 'settings'
        ? 'Settings'
        : 'Controls';
    $('#start-label').textContent = journeyStarted ? 'Continue' : 'Begin';
    $('#menu-start').setAttribute(
      'aria-label',
      journeyStarted ? 'Continue journey' : 'Begin journey',
    );
    const focus = home ? (atTitle ? '#menu-start' : '#resume') : '#menu-back';
    $(focus).focus();
  }
  function navigateBack() {
    if (pending) return;
    const options = $<HTMLDetailsElement>('#checkpoint-options');
    if (options.open && page === 'home') {
      options.open = false;
      options.querySelector('summary')?.focus();
      return;
    }
    if (page !== 'home') {
      const previous = page;
      if (page === 'help' && helpReturn === 'settings') {
        showPage('settings');
        $('#settings-controls').focus();
        return;
      }
      showPage('home');
      $(previous === 'settings' ? '#menu-settings' : '#menu-help').focus();
    } else if (!atTitle) application?.pause(false);
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
      }, 2800);
  }
  function showPause(paused: boolean) {
    if (closed) return;
    const modal = $<HTMLDialogElement>('#modal'),
      confirmation = $<HTMLDialogElement>('#new-confirm');
    if (paused && !adventure?.isOpen()) {
      if (!modal.open) {
        showPage('home');
        modal.showModal();
        $(atTitle ? '#menu-start' : '#resume').focus();
      }
    } else if (!paused) {
      atTitle = false;
      if (confirmation.open) confirmation.close();
      if (modal.open) modal.close();
      root.querySelector<HTMLCanvasElement>('canvas')?.focus();
    }
    root.classList.toggle('menu-open', paused);
  }
  function update(app: Application) {
    if (closed) return;
    setStyle(root, '--ui-scale', String(app.uiScale));
    const s = app.sim;
    lootLabels?.update(app.roomReady && !app.busy && !app.paused && !adventure?.isOpen());
    if (adventure?.isOpen() && $<HTMLDialogElement>('#modal').open)
      $<HTMLDialogElement>('#modal').close();
    const interaction = app.roomReady && !app.busy && !app.paused ? app.interaction : undefined;
    const lanternReady =
      app.roomReady &&
      !app.busy &&
      !app.paused &&
      !adventure?.isOpen() &&
      s.inCombat &&
      s.hero.health > 0 &&
      s.hero.cooldown === 0 &&
      !app.session.onboarding.completed.includes('lantern') &&
      !app.session.onboarding.dismissed.includes('lantern') &&
      s.enemies.some(
        (enemy) =>
          enemy.health > 0 &&
          Math.hypot(enemy.x - s.hero.x, enemy.z - s.hero.z) <= tuning.ability.range &&
          Math.abs(enemy.y - s.hero.y) <= tuning.maxCombatHeightDifference &&
          clearSegment(s.areaDefinition, s.hero, enemy, 0.001),
      );
    const lanternHint = $('#lantern-hint'),
      lanternText = lanternReady ? 'RMB · Repel with lantern' : '';
    if (lanternHint.textContent !== lanternText) lanternHint.textContent = lanternText;
    const actionHint = $('#action-hint'),
      queued =
        app.roomReady && !app.busy && !app.paused && !adventure?.isOpen() && s.hero.health > 0
          ? s.hero.pendingAction?.kind
          : undefined;
    setText(
      actionHint,
      queued ? `${{ sword: 'Sword', lantern: 'Lantern', dodge: 'Dodge' }[queued]} queued` : '',
    );
    if (queued) {
      cuePosition.set(s.hero.x, s.hero.y + 2.4, s.hero.z).project(app.presentation.camera);
      setStyle(actionHint, 'left', `${(cuePosition.x + 1) * 50}%`);
      setStyle(actionHint, 'top', `${(1 - cuePosition.y) * 50}%`);
    }
    const cue = $('#interaction-hint');
    const cueText = interaction
      ? interaction.blocked
        ? s.inCombat
          ? 'In combat'
          : 'Guarded'
        : (
            {
              drop: 'E · Take',
              campfire: 'E · Rest',
              container: 'E · Open',
              exit: `E · ${interaction.label}`,
              breakable: 'LMB · Break',
            } as const
          )[interaction.kind]
      : '';
    if (cue.textContent !== cueText) {
      cue.textContent = cueText;
      cue.style.setProperty('--cue-margin', `${Math.ceil(cue.offsetWidth / 2 + 12)}px`);
    }
    if (interaction) {
      cue.setAttribute('aria-label', interaction.blocked ?? interaction.label);
      cuePosition
        .set(
          interaction.x,
          heightAt(s.areaDefinition, interaction.x, interaction.z) + 0.2,
          interaction.z,
        )
        .project(app.presentation.camera);
      cue.style.left = `clamp(var(--cue-margin), ${(cuePosition.x + 1) * 50}%, calc(100% - var(--cue-margin)))`;
      cue.style.top = `${(1 - cuePosition.y) * 50}%`;
    } else cue.removeAttribute('aria-label');
    const potions = app.session.inventory['health-potion'] ?? 0;
    setText($('#potion-count'), `×${potions}`);
    $('.supply-row').classList.toggle('empty', potions === 0);
    setText($('#hp'), `${s.hero.health} / ${s.maxHealth}`);
    $('.health').setAttribute('aria-valuenow', String(s.hero.health));
    $('.health').setAttribute('aria-valuemax', String(s.maxHealth));
    $('.hud').classList.toggle('low-health', s.hero.health <= s.maxHealth * 0.3);
    setStyle($('#health-fill'), 'height', `${(s.hero.health / s.maxHealth) * 100}%`);
    const cooldown = s.hero.cooldown,
      charge = Math.floor((1 - cooldown / tuning.ability.cooldown) * 100),
      lanternState =
        cooldown > 0 ? `${(Math.ceil((cooldown * 10) / tuning.tickHz) / 10).toFixed(1)}s` : 'Ready';
    $('#lantern-readiness').hidden =
      !app.roomReady ||
      app.busy ||
      app.paused ||
      !!adventure?.isOpen() ||
      s.hero.health <= 0 ||
      (cooldown === 0 && !s.inCombat);
    setText($('#lantern-state'), lanternState);
    setStyle($('#lantern-readiness'), '--charge', `${charge}%`);
    $('.lantern-charge').setAttribute('aria-valuenow', String(charge));
    $('.lantern-charge').setAttribute('aria-valuetext', lanternState);
    setStyle($('#lantern-fill'), 'width', `${charge}%`);
    if (lastArea !== s.area) {
      lastArea = s.area;
      $('#room-title').textContent = s.areaDefinition.name;
      const title = $('.title-card');
      title.classList.remove('location-enter');
      void title.offsetWidth;
      title.classList.add('location-enter');
    }
    const unavailable = app.busy || pending;
    for (const id of [
      'save',
      'reset',
      'load',
      'new-game',
      'confirm-new',
      'return-title',
      'menu-start',
      'menu-settings',
      'menu-help',
      'menu-back',
      'cancel-new',
      'settings-controls',
    ])
      $<HTMLButtonElement>('#' + id).disabled = unavailable;
    $<HTMLButtonElement>('#resume').disabled = unavailable || !app.roomReady;
    $<HTMLButtonElement>('#menu-start').disabled = unavailable || !app.roomReady;
    $<HTMLButtonElement>('#save').disabled = unavailable || !app.roomReady;
    setText(
      $('#save-notice'),
      (!app.roomReady
        ? 'Room unavailable. Reset, load a checkpoint, or start a new game to recover.'
        : '') ||
        app.persistence.error ||
        app.settingsError ||
        '',
    );
  }

  return {
    bind,
    prepare() {
      if (closed || !application) throw new Error('Game UI is not active');
      return createItemArtwork(application.runtime, lifetime.signal).prepare();
    },
    failure(message: string) {
      $('#startup-error-detail').textContent = message;
      $('#startup-error').hidden = false;
      root.querySelector<HTMLAnchorElement>('#startup-error a')?.focus();
    },
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
