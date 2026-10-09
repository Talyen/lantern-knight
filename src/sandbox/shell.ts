import './style.css';
import { fixtures, fixtureNames, type PreviewContext, type Panel } from './workspace';

export type PreviewControls = {
  capabilities: { animation: boolean; calibration: boolean; productionLighting: boolean };
  open(panel: Panel): void;
  clearInput(): void;
  togglePause(): void;
  restart(): void;
  resize(): void;
  save(): void;
  isPaused(): boolean;
  isAnimation(): boolean;
};
export function mountShell(context: PreviewContext, panels: string, hud = '') {
  const root = document.getElementById('app')!;
  root.className = 'dev-preview';
  root.innerHTML = `<header class="preview-toolbar"><strong>Dev Preview</strong>
    <select id="scene-select" aria-label="Scene">${fixtures.map((id, i) => `<option value="${id}">${fixtureNames[i]}</option>`).join('')}</select>
    <nav aria-label="Preview tools">${(['animation', 'visuals', 'inspect'] as const).map((panel) => `<button data-panel="${panel}" aria-controls="preview-drawer" aria-expanded="false">${panel[0]!.toUpperCase() + panel.slice(1)}</button>`).join('')}</nav>
    <button id="pause">Pause</button><button id="reset">Restart</button><button id="preview-more" aria-label="More options" aria-expanded="false" aria-controls="preview-menu">•••</button></header>
    <main class="preview-stage"><canvas id="scene" tabindex="0" aria-label="Lantern Knight game"></canvas>
    <aside id="preview-drawer" aria-label="Preview inspector" hidden><div class="drawer-heading"><h2 id="drawer-title"></h2><button id="drawer-close" aria-label="Close inspector">×</button></div>${panels}
    <section data-preview-panel="diagnostics" hidden><output id="preview-diagnostics"></output><span id="status" role="status"></span></section></aside>
    <div id="preview-menu" aria-label="Preview options" hidden><div id="preview-navigation"></div><label><input id="preview-hud" type="checkbox">Gameplay HUD</label><button data-panel="diagnostics">Diagnostics</button><button id="preview-help">Keyboard help</button><button id="reset-scene-settings">Reset scene settings</button><button id="reset-workspace">Reset workspace…</button><button id="hide-controls">Hide controls</button></div>
    ${hud}<div id="preview-error" role="alert" hidden><span></span><button id="preview-retry">Retry</button></div></main>
    <dialog id="preview-help-dialog"><h2>Keyboard help</h2><p>WASD move · mouse aim · left-click sword · Shift dodge · right-click lantern.</p><p>Escape closes controls, restores hidden controls, or pauses the scene. Animation supports scroll to zoom and timeline seeking.</p><form method="dialog"><button>Close</button></form></dialog>
    <dialog id="preview-reset-dialog"><h2>Reset workspace?</h2><p>Clear all remembered preview settings and layout.</p><button id="confirm-workspace-reset">Reset workspace</button><form method="dialog"><button>Cancel</button></form></dialog>`;
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const abort = new AbortController();
  let controls: PreviewControls | undefined;
  let opener: HTMLElement | undefined;
  const developerNav = document.querySelector<HTMLElement>('nav[aria-label="Developer tools"]');
  const navParent = developerNav?.parentElement;
  const navNext = developerNav?.nextSibling;
  if (developerNav) $('#preview-navigation').append(developerNav);
  function persist() {
    controls?.save();
    context.changed();
  }
  function closeMenu() {
    $('#preview-menu').hidden = true;
    $('#preview-more').setAttribute('aria-expanded', 'false');
  }
  function layout() {
    root.classList.toggle('controls-hidden', context.ui.hidden);
    $('#preview-drawer').hidden = context.ui.panel === null || context.ui.hidden;
    $('#drawer-title').textContent = context.ui.panel
      ? context.ui.panel[0]!.toUpperCase() + context.ui.panel.slice(1)
      : '';
    root
      .querySelectorAll<HTMLElement>('[data-preview-panel]')
      .forEach((el) => (el.hidden = el.dataset.previewPanel !== context.ui.panel));
    root
      .querySelectorAll<HTMLElement>('.hud,.actions')
      .forEach((el) => (el.hidden = !context.ui.hud || controls?.isAnimation() === true));
    $<HTMLInputElement>('#preview-hud').checked = context.ui.hud;
    root
      .querySelectorAll<HTMLElement>('[data-panel]')
      .forEach((el) =>
        el.setAttribute(
          'aria-expanded',
          String(el.dataset.panel === context.ui.panel && !context.ui.hidden),
        ),
      );
    controls?.resize();
  }
  function show(panel: Panel, source?: HTMLElement) {
    opener = source ?? root.querySelector<HTMLElement>(`[data-panel="${panel}"]`) ?? undefined;
    context.ui.panel = context.ui.panel === panel ? null : panel;
    closeMenu();
    if (context.ui.panel) controls?.open(context.ui.panel);
    layout();
    persist();
  }
  function closeDrawer() {
    context.ui.panel = null;
    layout();
    persist();
    opener?.focus();
  }
  $('#drawer-close').onclick = closeDrawer;
  root
    .querySelectorAll<HTMLElement>('[data-panel]')
    .forEach((el) => (el.onclick = () => show(el.dataset.panel as Panel, el)));
  $('#preview-more').onclick = () => {
    const menu = $('#preview-menu');
    menu.hidden = !menu.hidden;
    $('#preview-more').setAttribute('aria-expanded', String(!menu.hidden));
  };
  $('#scene-select').onchange = () =>
    context.select($<HTMLSelectElement>('#scene-select').value as PreviewContext['fixture']);
  $<HTMLSelectElement>('#scene-select').value = context.fixture;
  $('#pause').onclick = () => {
    controls?.togglePause();
    sync();
    persist();
  };
  $('#reset').onclick = () => {
    controls?.restart();
    persist();
  };
  $('#preview-hud').onchange = () => {
    context.ui.hud = $<HTMLInputElement>('#preview-hud').checked;
    layout();
    persist();
  };
  $('#hide-controls').onclick = () => {
    context.ui.hidden = true;
    closeMenu();
    layout();
    persist();
    $('canvas').focus();
  };
  $('#preview-help').onclick = () => {
    closeMenu();
    $<HTMLDialogElement>('#preview-help-dialog').showModal();
  };
  $('#reset-scene-settings').onclick = () => context.resetScene();
  $('#reset-workspace').onclick = () => {
    closeMenu();
    $<HTMLDialogElement>('#preview-reset-dialog').showModal();
  };
  $('#confirm-workspace-reset').onclick = () => context.resetWorkspace();
  $('#preview-retry').onclick = () => context.select(context.fixture);
  root.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((el) => {
    el.open = context.ui.sections[el.dataset.section!] ?? false;
    el.addEventListener(
      'toggle',
      () => {
        context.ui.sections[el.dataset.section!] = el.open;
        persist();
      },
      { signal: abort.signal },
    );
  });
  root.addEventListener(
    'click',
    () =>
      queueMicrotask(() => {
        if (!abort.signal.aborted) persist();
      }),
    { signal: abort.signal },
  );
  root.addEventListener('input', persist, { signal: abort.signal });
  root.addEventListener('change', persist, { signal: abort.signal });
  root.addEventListener('focusin', () => controls?.clearInput(), { signal: abort.signal });
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target !== $('canvas')) controls?.clearInput();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointermove',
    (event) => {
      if (event.target !== $('canvas')) event.stopPropagation();
    },
    { signal: abort.signal },
  );
  $('canvas').addEventListener('pointerdown', () => $('canvas').focus(), { signal: abort.signal });
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.code === 'Escape' && !event.repeat) {
        if (root.querySelector('dialog[open]')) {
          event.stopImmediatePropagation();
          controls?.clearInput();
          return;
        }
        if (context.ui.hidden) {
          context.ui.hidden = false;
          layout();
          persist();
        } else if (!$('#preview-menu').hidden) {
          closeMenu();
          $('#preview-more').focus();
        } else if (context.ui.panel) closeDrawer();
        else {
          controls?.togglePause();
          sync();
          persist();
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        controls?.clearInput();
        return;
      }
      if (
        event.target instanceof Node &&
        root.contains(event.target) &&
        event.target !== $('canvas')
      ) {
        controls?.clearInput();
        event.stopPropagation();
      }
    },
    { capture: true, signal: abort.signal },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.target !== $('canvas')) {
        controls?.clearInput();
        event.stopPropagation();
      }
    },
    { capture: true, signal: abort.signal },
  );
  window.addEventListener('resize', () => controls?.resize(), { signal: abort.signal });
  function sync() {
    $('#pause').textContent = controls?.isPaused() ? 'Resume' : 'Pause';
    $('#reset').title = controls?.isAnimation() ? 'Restart animation cycle' : 'Restart scene';
    root
      .querySelectorAll<HTMLElement>('.hud,.actions')
      .forEach((el) => (el.hidden = !context.ui.hud || controls?.isAnimation() === true));
  }
  layout();
  return {
    bind(value: PreviewControls) {
      controls = value;
      if (context.ui.panel) value.open(context.ui.panel);
      $('[data-panel="animation"]').title = value.capabilities.animation
        ? 'Asset playback and comparison'
        : 'Animation requires Outdoor, Interior or Systems';
      $('[data-panel="visuals"]').title = value.capabilities.productionLighting
        ? 'Lighting, looks and effects'
        : 'Effects treatment and comparison';
      $('[data-panel="inspect"]').title = value.capabilities.calibration
        ? 'Registration, calibration and occlusion'
        : 'Enemy controls; calibration requires another fixture';
      layout();
      sync();
    },
    show,
    sync,
    layout,
    status(message: string, error = false) {
      $('#status').textContent = message;
      $('#preview-error').hidden = !error;
      $('#preview-error span').textContent = message;
    },
    diagnostics(value: () => unknown) {
      if (context.ui.panel === 'diagnostics' && !context.ui.hidden)
        $('#preview-diagnostics').textContent = JSON.stringify(value(), null, 2);
    },
    dispose() {
      abort.abort();
      if (developerNav && navParent)
        navParent.insertBefore(developerNav, navNext?.parentNode === navParent ? navNext : null);
    },
  };
}
