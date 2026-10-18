import { audioControls } from './audio/controls';
import type { VisualEffect } from './content/visual-effects';
import { playerIcon } from './player-icons';

const playerEffectLabels: Record<VisualEffect, string> = {
  livingLights: 'Flickering lights',
  smoke: 'Smoke & embers',
  rain: 'Rain & splashes',
  surfaceDepth: 'Detailed surface lighting',
  relief: 'Surface depth',
  wind: 'Moving foliage',
  atmosphere: 'Mist & drifting motes',
  palette: 'Rich shadows & highlights',
  bloom: 'Soft light glow',
};
const controlRows = [
  ['W A S D', 'Move', 'move'],
  ['Mouse', 'Aim', 'aim'],
  ['LMB', 'Sword', 'sword'],
  ['RMB', 'Lantern burst', 'lantern'],
  ['Shift', 'Dodge', 'dodge'],
  ['E', 'Interact', 'hand'],
  ['I', 'Inventory', 'bag'],
  ['Q', 'Health Potion', 'potion'],
  ['Esc', 'Pause / resume', 'pause'],
] as const;

export const gameMenu = `<dialog class="modal game-menu is-title" id="modal" aria-labelledby="pause-title">
  <div class="menu-shell gothic-panel">
    <header class="menu-heading"><button id="menu-back" class="icon-button" aria-label="Back" data-tip="Back · Esc" hidden>${playerIcon('close')}</button><div class="menu-crest" aria-hidden="true"></div><h1 id="pause-title">Lantern<br>Knight</h1></header>
    <section class="menu-home" id="menu-home" aria-label="Main menu">
      <div class="menu-actions" id="menu-actions">
        <button id="menu-start" class="primary-action" aria-label="Begin journey" autofocus><span id="start-label">Begin</span></button>
        <button id="resume" class="primary-action" hidden>Resume</button>
        <button id="new-game" aria-label="New Game">New journey</button>
        <button id="menu-settings">Settings</button>
        <button id="return-title" hidden>Main menu</button>
      </div>
      <div class="menu-utilities"><button id="menu-help" class="icon-button" aria-label="Controls & help" data-tip="Controls">${playerIcon('controls')}<span class="title-help-label">Controls</span></button>
        <details id="checkpoint-options" hidden><summary class="icon-button" aria-label="Journey options" data-tip="Journey options">${playerIcon('more')}</summary><div id="checkpoint-actions" class="checkpoint-actions"><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="reset">Reset encounter</button></div></details>
      </div>
    </section>
    <section id="settings-page" class="menu-page" aria-label="Settings" hidden>
      <div class="settings-layout"><nav class="settings-nav" aria-label="Settings sections"><div role="tablist" aria-label="Settings categories" aria-orientation="vertical"><button id="settings-display-tab" class="icon-button" role="tab" aria-selected="true" aria-controls="settings-display" data-settings-tab="display" aria-label="Display" data-tip="Display">${playerIcon('display')}<span>Display</span></button><button id="settings-sound-tab" class="icon-button" role="tab" aria-selected="false" tabindex="-1" aria-controls="settings-sound" data-settings-tab="sound" aria-label="Sound" data-tip="Sound">${playerIcon('sound')}<span>Sound</span></button></div><button id="settings-controls" class="icon-button" aria-label="Controls" data-tip="Controls">${playerIcon('controls')}<span>Controls</span></button></nav>
        <div class="settings-content"><section id="settings-display" role="tabpanel" aria-labelledby="settings-display-tab"><fieldset class="display-options"><legend class="visually-hidden">Display</legend><label>Camera<select id="zoom-span" aria-label="Camera distance"><option value="8.55">Close</option><option value="9">Near</option><option value="11">Medium</option><option value="13">Wide</option><option value="15">Far</option></select></label>
          <label>Interface size<select id="ui-scale" data-tip="Size of menus and HUD"><option value="0.9">Small</option><option value="1">Default</option><option value="1.15">Large</option></select></label><label>Render scale<select id="render-scale" data-tip="Lower values improve performance"><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label>
          <label for="depth-of-field">Depth of field <output id="depth-of-field-value">100%</output></label><input id="depth-of-field" type="range" min="0" max="100" step="5" value="100"></fieldset>
          <details class="advanced-settings"><summary>Advanced</summary><fieldset class="visual-options"><legend class="visually-hidden">Atmosphere</legend>${Object.entries(
            playerEffectLabels,
          )
            .map(
              ([key, label]) =>
                `<label>${label}<input type="checkbox" data-visual-effect="${key}" checked></label>`,
            )
            .join('')}</fieldset></details>
        </section><section id="settings-sound" role="tabpanel" aria-labelledby="settings-sound-tab" hidden>${audioControls()}</section></div>
      </div>
    </section>
    <section id="help-page" class="menu-page controls-help" aria-label="Controls and help" hidden><dl class="control-grid">${controlRows
      .map(
        ([key, action, icon]) =>
          `<div tabindex="0" aria-label="${key} · ${action}" data-tip="${action}"><dt><span class="control-keys">${
            key === 'Mouse'
              ? `<span class="mouse-key">${playerIcon('mouse')}<span class="visually-hidden">Mouse</span></span>`
              : key === 'W A S D'
                ? key
                    .split(' ')
                    .map((k) => `<kbd>${k}</kbd>`)
                    .join('')
                : `<kbd>${key}</kbd>`
          }</span>${playerIcon(icon)}</dt><dd>${action}</dd></div>`,
      )
      .join('')}</dl></section>
    <footer class="menu-footer"><p id="menu-status" role="status" aria-live="polite"></p><p id="save-notice"></p><div id="dev-return"></div></footer>
  </div>
  <dialog id="new-confirm" class="confirmation gothic-panel" aria-labelledby="new-game-question"><h2 id="new-game-question">Replace saved journey?</h2><p>This cannot be undone.</p><p id="new-status" role="status" aria-live="polite"></p><div class="buttons"><button id="cancel-new" autofocus>Keep journey</button><button id="confirm-new" aria-label="Confirm New Game">Replace</button></div></dialog>
</dialog>`;
