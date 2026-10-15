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
  ['W A S D', 'Move', 'Explore the paths around you.'],
  ['Mouse', 'Aim', 'Point in the direction of your next strike.'],
  ['LMB', 'Sword', 'Sweep or lunge toward your aim.'],
  ['Shift', 'Dodge', 'Slip out of an incoming attack.'],
  ['RMB', 'Lantern burst', 'Push back the darkness.'],
  ['E', 'Interact', 'Collect loot, open containers, or rest at a fire.'],
  ['I', 'Inventory', 'Inspect your supplies and change equipment.'],
  ['Q', 'Health Potion', 'Restore 40 health from your supplies.'],
  ['Esc', 'Pause / resume', 'Take a breath. The world will wait.'],
];

export const gameMenu = `<dialog class="modal game-menu is-title" id="modal" aria-labelledby="pause-title">
  <div class="menu-shell">
    <header class="menu-heading"><button id="menu-back" hidden>← Back</button><p class="eyebrow" id="menu-eyebrow">A sword. A lantern. A way forward.</p><h1 id="pause-title">Lantern<br>Knight</h1><p id="menu-description">Carry a little light into the unknown.</p></header>
    <section class="menu-home" id="menu-home" aria-label="Main menu">
      <div class="menu-actions">
        <button id="menu-start" class="primary-action" autofocus><span id="start-label">Begin journey</span><span aria-hidden="true">→</span></button>
        <button id="resume" class="primary-action" hidden>Resume<span aria-hidden="true">→</span></button>
        <button id="new-game">New Game</button>
        <button id="menu-settings">Settings<span aria-hidden="true">↗</span></button>
        <button id="menu-help">Controls &amp; help<span aria-hidden="true">↗</span></button>
      </div>
      <div id="checkpoint-actions" class="checkpoint-actions" hidden><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="reset">Reset encounter</button><button id="return-title">Save &amp; main menu</button></div>
    </section>
    <section id="settings-page" class="menu-page" aria-label="Settings" hidden>
      <p class="page-intro">Make yourself comfortable. Changes are saved automatically.</p>
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
          .join(
            '',
          )}<p class="muted">Rain appears when the scene or weather calls for it.</p></fieldset></div>
    </section>
    <section id="help-page" class="menu-page controls-help" aria-label="Controls and help" hidden>
      <p class="page-intro">Keep your sword ready and your lantern close.</p>
      <dl class="control-grid">${controlRows.map(([key, action, detail]) => `<div><dt><kbd>${key}</kbd><strong>${action}</strong></dt><dd>${detail}</dd></div>`).join('')}</dl>
      <div class="field-notes"><p><strong>Find your footing.</strong> Windups and strikes finish before queued actions start. Move or use another action to interrupt recovery.</p><p><strong>Rest by the fire.</strong> Rest heals you and resets enemies. Collected loot stays yours; potions do not refill.</p></div>
    </section>
    <footer class="menu-footer"><p id="menu-status" role="status" aria-live="polite"></p><p id="save-notice"></p><div id="dev-return"></div></footer>
  </div>
  <aside class="journey-summary"><span class="eyebrow" id="journey-label">Your journey begins</span><h2 id="journey-area"></h2><p id="journey-detail">Follow the paths. Find a place to rest.</p><span class="journey-rule" aria-hidden="true"></span><p class="journey-edition">An adventure in light &amp; shadow</p></aside>
  <dialog id="new-confirm" class="confirmation" aria-labelledby="new-game-question"><p class="eyebrow">A fresh beginning</p><h2 id="new-game-question">Start a new journey?</h2><p>Your saved journey will be replaced. This cannot be undone.</p><p id="new-status" role="status" aria-live="polite"></p><div class="buttons"><button id="cancel-new" autofocus>Keep my journey</button><button id="confirm-new">Confirm New Game</button></div></dialog>
</dialog>`;
