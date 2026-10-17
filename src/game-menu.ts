import { audioControls } from './audio/controls';
import type { VisualEffect } from './content/visual-effects';

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
  ['W A S D', 'Move'],
  ['Mouse', 'Aim'],
  ['LMB', 'Sword'],
  ['Shift', 'Dodge'],
  ['RMB', 'Lantern burst'],
  ['E', 'Interact'],
  ['I', 'Inventory'],
  ['Q', 'Health Potion'],
  ['Esc', 'Pause / resume'],
];

export const gameMenu = `<dialog class="modal game-menu is-title" id="modal" aria-labelledby="pause-title">
  <div class="menu-shell">
    <header class="menu-heading"><button id="menu-back" hidden>← Back</button><h1 id="pause-title">Lantern<br>Knight</h1></header>
    <section class="menu-home" id="menu-home" aria-label="Main menu">
      <div class="menu-actions">
        <button id="menu-start" class="primary-action" autofocus><span id="start-label">Begin journey</span></button>
        <button id="resume" class="primary-action" hidden>Resume</button>
        <button id="new-game">New Game</button>
        <button id="menu-settings">Settings</button>
        <button id="menu-help">Controls &amp; help</button>
      </div>
      <div id="checkpoint-actions" class="checkpoint-actions" hidden><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="reset">Reset encounter</button><button id="return-title">Save &amp; main menu</button></div>
    </section>
    <section id="settings-page" class="menu-page" aria-label="Settings" hidden>

      <div class="settings-columns"><div>${audioControls()}
        <fieldset class="display-options"><legend>Display</legend><label>Camera distance<select id="zoom-span"><option value="8.55">Close</option><option value="9">9 m</option><option value="11">Medium</option><option value="13">Wide</option><option value="15">Far</option></select></label>
        <label>Render scale<select id="render-scale"><option value="1">100% · up to 4K</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label>
        <label for="depth-of-field">Depth of field <output id="depth-of-field-value">100%</output></label><input id="depth-of-field" type="range" min="0" max="100" step="5" value="100"><p class="muted">Foreground and distance blur. Set to 0% to turn off.</p></fieldset></div>
        <fieldset class="visual-options"><legend>Atmosphere</legend>${Object.entries(
          playerEffectLabels,
        )
          .map(
            ([key, label]) =>
              `<label>${label}<input type="checkbox" data-visual-effect="${key}" checked></label>`,
          )
          .join('')}</fieldset></div>
    </section>
    <section id="help-page" class="menu-page controls-help" aria-label="Controls and help" hidden>

      <dl class="control-grid">${controlRows.map(([key, action]) => `<div><dt><kbd>${key}</kbd><strong>${action}</strong></dt></div>`).join('')}</dl>

    </section>
    <footer class="menu-footer"><p id="menu-status" role="status" aria-live="polite"></p><p id="save-notice"></p><div id="dev-return"></div></footer>
  </div>
  <dialog id="new-confirm" class="confirmation" aria-labelledby="new-game-question"><h2 id="new-game-question">Start a new journey?</h2><p>Your saved journey will be replaced. This cannot be undone.</p><p id="new-status" role="status" aria-live="polite"></p><div class="buttons"><button id="cancel-new" autofocus>Keep my journey</button><button id="confirm-new">Confirm New Game</button></div></dialog>
</dialog>`;
