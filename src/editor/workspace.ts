import { html } from '../dom';
const element = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
export type DockTab = 'artwork' | 'object' | 'objects' | 'scene' | 'review';
export function openDock(tab: DockTab, reveal = true) {
  if (reveal) document.body.classList.remove('dock-hidden', 'focus-mode');
  for (const name of ['artwork', 'object', 'objects', 'scene', 'review'] as const) {
    element(name + '-panel').hidden = name !== tab;
    if (name === 'object') continue;
    const button = element<HTMLButtonElement>(name + '-tab');
    const active = name === tab || (name === 'objects' && tab === 'object');
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (tab === 'review') element('review-panel').dispatchEvent(new Event('workspace-show'));
  element('focus-mode').setAttribute(
    'aria-pressed',
    String(document.body.classList.contains('focus-mode')),
  );
  element('focus-mode').textContent = document.body.classList.contains('focus-mode')
    ? 'Exit focus'
    : 'Focus';
  element('toggle-dock').setAttribute(
    'aria-expanded',
    String(!document.body.classList.contains('dock-hidden')),
  );
}
export class EditorWorkspace {
  private lifetime = new AbortController();
  private timer = 0;
  private navigation: HTMLElement | null = null;
  constructor(private readonly selectionSize: () => number) {
    const signal = this.lifetime.signal;
    for (const tab of ['artwork', 'objects', 'scene', 'review'] as const) {
      element(tab + '-tab').onclick = () => {
        openDock(tab);
        this.remember();
      };
      element(tab + '-tab').onkeydown = (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const tabs = ['artwork', 'objects', 'scene', 'review'] as const;
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : (tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        openDock(tabs[next]!);
        element(tabs[next]! + '-tab').focus();
        this.remember();
      };
    }
    element('edit-scene').onclick = () => openDock('scene');
    element('add-artwork').onclick = () => openDock('artwork');
    element('new-scene').onclick = () => {
      element<HTMLSelectElement>('scene').value = 'new';
      element('open').click();
    };
    element('back-to-objects').onclick = () => openDock('objects');
    for (const [id, tool] of [
      ['select-tool', 'select'],
      ['start-tool', 'hero'],
    ] as const)
      element(id).onclick = () => {
        const select = element<HTMLSelectElement>('tool');
        select.value = tool;
        select.dispatchEvent(new Event('change'));
        element('viewport').focus();
      };
    for (const id of ['clip', 'heading'])
      element('transform').append(element(id).closest('label')!);
    element('toggle-dock').onclick = () => {
      document.body.classList.toggle('dock-hidden');
      element('toggle-dock').setAttribute(
        'aria-expanded',
        String(!document.body.classList.contains('dock-hidden')),
      );
      this.remember();
    };
    element('focus-mode').onclick = () => {
      const focused = document.body.classList.toggle('focus-mode');
      element('focus-mode').setAttribute('aria-pressed', String(focused));
      element('focus-mode').textContent = focused ? 'Exit focus' : 'Focus';
      element('viewport').focus();
    };
    try {
      const state = JSON.parse(localStorage.getItem('lantern-editor-workspace') ?? '{}');
      openDock(
        ['artwork', 'object', 'objects', 'scene', 'review'].includes(state.tab)
          ? state.tab === 'object'
            ? 'objects'
            : state.tab
          : 'scene',
      );
      document.body.classList.toggle('dock-hidden', !!state.hidden);
    } catch {
      openDock('scene');
    }
    element('toggle-dock').setAttribute(
      'aria-expanded',
      String(!document.body.classList.contains('dock-hidden')),
    );
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Developer tools"]');
    this.navigation = nav;
    if (nav) element('developer-links').append(nav);
    document.addEventListener(
      'click',
      (e) => {
        for (const menu of document.querySelectorAll<HTMLDetailsElement>('.menu[open]'))
          if (
            !menu.contains(e.target as Node) ||
            (e.target instanceof Element && e.target.closest('button'))
          )
            menu.open = false;
      },
      { signal },
    );
    document.addEventListener(
      'keydown',
      (e) => {
        const dialog = element<HTMLDialogElement>('command-dialog');
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === 'k' &&
          !document.querySelector('dialog[open]')
        ) {
          e.preventDefault();
          this.commands();
        } else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
          document
            .querySelectorAll<HTMLDetailsElement>('.menu')
            .forEach((menu) => (menu.open = false));
          if (document.body.classList.contains('focus-mode')) element('focus-mode').click();
        } else if (
          e.key === 'Tab' &&
          !e.shiftKey &&
          e.target === element('viewport') &&
          !document.querySelector('dialog[open]')
        ) {
          e.preventDefault();
          element('focus-mode').click();
        } else if (e.key === 'ArrowDown' && e.target === element('command-search') && dialog.open) {
          e.preventDefault();
          element('command-results').querySelector<HTMLElement>('button')?.focus();
        }
      },
      { signal },
    );
    element('commands').onclick = () => this.commands();
    element('command-search').oninput = () => this.renderCommands();
    element('snap').addEventListener('change', () => this.refresh(), { signal });
  }
  private remember() {
    try {
      localStorage.setItem(
        'lantern-editor-workspace',
        JSON.stringify({
          tab: document.querySelector('[role="tab"][aria-selected="true"]')?.id.replace('-tab', ''),
          hidden: document.body.classList.contains('dock-hidden'),
        }),
      );
    } catch {
      /* Workspace preferences are disposable. */
    }
  }
  refresh() {
    element('spacing-label').hidden = !element<HTMLInputElement>('snap').checked;
    const tool = element<HTMLSelectElement>('tool');
    for (const [id, value] of [
      ['select-tool', 'select'],
      ['start-tool', 'hero'],
    ] as const) {
      element<HTMLButtonElement>(id).disabled = tool.disabled;
      element(id).setAttribute('aria-pressed', String(tool.value === value));
    }
    const placing = tool.value === 'place';
    element('placement-state').hidden = !placing;
    element('placement-state').textContent = element<HTMLInputElement>('repeat-placement').checked
      ? 'Keep placing'
      : 'Place artwork';
    element('viewport').style.cursor = placing
      ? 'crosshair'
      : element<HTMLSelectElement>('tool').value === 'hero'
        ? 'move'
        : 'default';
    const multiple = this.selectionSize() > 1;
    for (const id of ['clip', 'heading', 'place-clip', 'place-heading']) {
      const select = element<HTMLSelectElement>(id);
      select.closest('label')!.hidden =
        select.options.length < 2 || (multiple && (id === 'clip' || id === 'heading'));
    }
    const chips = element('filter-chips');
    chips.replaceChildren();
    for (const id of ['category', 'collection', 'asset-scope']) {
      const select = element<HTMLSelectElement>(id);
      if (select.value === 'all') continue;
      const button = html<HTMLButtonElement>`<button aria-label="Clear ${select.getAttribute('aria-label')}">${select.selectedOptions[0]!.text} ×</button>`;
      button.onclick = () => {
        select.value = 'all';
        select.dispatchEvent(new Event('change'));
        this.refresh();
      };
      chips.append(button);
    }
    const animated = element<HTMLInputElement>('asset-animated');
    if (animated.checked) {
      const button = html<HTMLButtonElement>`<button aria-label="Clear animated filter">Animated ×</button>`;
      button.onclick = () => {
        animated.checked = false;
        animated.dispatchEvent(new Event('change'));
      };
      chips.append(button);
    }
    const hasSelection =
      !element<HTMLFieldSetElement>('transform').disabled ||
      !!document.querySelector('#objects .object-select.active');
    element('scene-summary').hidden = hasSelection;
    element('transform').hidden = !hasSelection;
    element('selected-name').hidden = !hasSelection;
    element('arrange-section').hidden = !hasSelection;
    const appearance = document.getElementById('object-appearance');
    if (appearance) appearance.hidden = !hasSelection;
    element('canvas-hint').textContent =
      tool.value === 'hero'
        ? 'Drag the hero to set the saved player start · Select to finish'
        : tool.value === 'geometry'
          ? 'Drag geometry handles · Select to finish'
          : placing
            ? 'Click to place artwork · Esc: cancel placement'
            : 'WASD: walking preview · Esc: restore preview';
  }
  notify(message: string, error: boolean) {
    clearTimeout(this.timer);
    element('status').textContent = message;
    if (!error)
      this.timer = window.setTimeout(() => {
        element('status').textContent = '';
      }, 2500);
  }
  private commands() {
    element<HTMLInputElement>('command-search').value = '';
    this.renderCommands();
    element<HTMLDialogElement>('command-dialog').showModal();
    element('command-search').focus();
  }
  private renderCommands() {
    const query = element<HTMLInputElement>('command-search').value.toLowerCase().trim();
    const list = element('command-results');
    list.replaceChildren();
    const actions = [
      ['Save', 'save'],
      ['Save As', 'save-as'],
      ['New scene', 'new-scene'],
      ['Open scene library', 'scene-library'],
      ['Browse arrangements', 'arrangements'],
      ['Select objects', 'select-tool'],
      ['Set player start', 'start-tool'],
      ['Export JSON', 'export-scene'],
      ['Undo', 'undo'],
      ['Redo', 'redo'],
      ['Duplicate selection', 'duplicate'],
      ['Delete selection', 'delete'],
      ['Game camera', 'reset-game-zoom'],
      ['Fit scene', 'fit'],
      ['Focus selection', 'focus-selection'],
      ['Focus mode', 'focus-mode'],
      ['Play', 'play-from-here'],
      ['Test movement and pathfinding', 'test-movement'],
      ['Ground interaction: run AI selection', 'ground-refine'],
      ['Ground interaction: finish polygon', 'ground-finish'],
      ['Pause animations', 'play-animation'],
      ['Replay animations', 'replay-animation'],
      ['Shortcuts', 'shortcuts'],
    ];
    for (const [name, id] of actions) {
      const target = element<HTMLButtonElement>(id!);
      if (!target || !name!.toLowerCase().includes(query)) continue;
      const button = html<HTMLButtonElement>`<button>${name}</button>`;
      button.disabled = target.disabled;
      button.onclick = () => {
        element<HTMLDialogElement>('command-dialog').close();
        target.click();
      };
      list.append(button);
    }
    for (const [tab, name] of [
      ['artwork', 'Browse artwork'],
      ['objects', 'Find objects'],
      ['scene', 'Scene settings'],
      ['review', 'Review scene assets and replacement queue'],
    ] as const) {
      if (!name.toLowerCase().includes(query)) continue;
      const button = html<HTMLButtonElement>`<button>${name}</button>`;
      button.onclick = () => {
        element<HTMLDialogElement>('command-dialog').close();
        openDock(tab);
      };
      list.append(button);
    }
    this.properties(query, list);
    if (!list.children.length) list.textContent = 'No matching actions or settings.';
  }
  private properties(query: string, results: HTMLElement) {
    if (!query.trim()) return;
    for (const label of document.querySelectorAll<HTMLLabelElement>(
      '#scene-panel label,#object-panel label',
    )) {
      const input = label.querySelector<HTMLInputElement>('input,select');
      if (!input || input.disabled || input.closest('fieldset')?.disabled) continue;
      if (
        label.closest('#ground-painting-tools[hidden]') ||
        (label.hidden && !['ground-brush-radius', 'ground-task'].includes(input.id))
      )
        continue;
      const text =
        label.childNodes[0]?.textContent?.trim() ?? input.getAttribute('aria-label') ?? '';
      const groups = [...label.closest('[role="tabpanel"]')!.querySelectorAll('summary')].filter(
        (s) => s.parentElement?.contains(label),
      );
      const title = [...groups.map((s) => s.textContent?.trim()), text].join(' › ');
      if (!title.toLowerCase().includes(query)) continue;
      const button = html<HTMLButtonElement>`<button>${title}</button>`;
      button.onclick = () => {
        if (['ground-brush-radius', 'ground-task'].includes(input.id)) {
          const canvasTool = element<HTMLSelectElement>('tool');
          canvasTool.value = 'select';
          canvasTool.dispatchEvent(new Event('change'));
          const drawing = element<HTMLSelectElement>('ground-task');
          drawing.value = input.id === 'ground-brush-radius' ? 'brush-add' : 'footprint';
          drawing.dispatchEvent(new Event('change'));
        }
        openDock(label.closest('#scene-panel') ? 'scene' : 'object');
        let parent = label.parentElement;
        while (parent) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        element<HTMLDialogElement>('command-dialog').close();
        input.focus();
        input.scrollIntoView({ block: 'center' });
      };
      results.append(button);
    }
  }
  dispose() {
    this.lifetime.abort();
    clearTimeout(this.timer);
    document.body.classList.remove('focus-mode', 'dock-hidden');
    if (this.navigation) document.body.append(this.navigation);
  }
}
