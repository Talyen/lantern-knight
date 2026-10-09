const element = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
export type DockTab = 'artwork' | 'object' | 'objects' | 'scene';
export function openDock(tab: DockTab, reveal = true) {
  if (reveal) document.body.classList.remove('dock-hidden', 'focus-mode');
  for (const name of ['artwork', 'object', 'objects', 'scene'] as const) {
    element(name + '-panel').hidden = name !== tab;
    const button = element<HTMLButtonElement>(name + '-tab');
    button.setAttribute('aria-selected', String(name === tab));
    button.tabIndex = name === tab ? 0 : -1;
  }
  element('property-search').hidden = tab === 'artwork' || tab === 'objects';
  element('property-results').hidden = true;
  element('focus-mode').setAttribute(
    'aria-pressed',
    String(document.body.classList.contains('focus-mode')),
  );
  element('toggle-dock').setAttribute(
    'aria-expanded',
    String(!document.body.classList.contains('dock-hidden')),
  );
}
export class EditorWorkspace {
  private lifetime = new AbortController();
  private timer = 0;
  private navigation: HTMLElement | null = null;
  constructor() {
    const signal = this.lifetime.signal;
    for (const tab of ['artwork', 'object', 'objects', 'scene'] as const) {
      element(tab + '-tab').onclick = () => {
        openDock(tab);
        this.remember();
      };
      element(tab + '-tab').onkeydown = (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const tabs: DockTab[] = ['artwork', 'object', 'objects', 'scene'];
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? 3
              : (tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 3)) % 4;
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
    document.querySelector('.primary-actions')!.prepend(element('focus-mode'));
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
      element('viewport').focus();
    };
    try {
      const state = JSON.parse(localStorage.getItem('lantern-editor-workspace') ?? '{}');
      openDock(
        ['artwork', 'object', 'objects', 'scene'].includes(state.tab) ? state.tab : 'object',
      );
      document.body.classList.toggle('dock-hidden', !!state.hidden);
    } catch {
      openDock('object');
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
    element('property-search').oninput = () => this.properties();
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
    const placing = element<HTMLSelectElement>('tool').value === 'place';
    element('placement-state').hidden = !placing;
    element('placement-state').textContent = element<HTMLInputElement>('repeat-placement').checked
      ? 'Keep placing'
      : 'Place artwork';
    element('viewport').style.cursor = placing
      ? 'crosshair'
      : element<HTMLSelectElement>('tool').value === 'hero'
        ? 'move'
        : 'default';
    for (const id of ['clip', 'heading', 'place-clip', 'place-heading']) {
      const select = element<HTMLSelectElement>(id);
      select.closest('label')!.hidden = select.options.length < 2;
    }
    const chips = element('filter-chips');
    chips.replaceChildren();
    for (const id of ['category', 'collection', 'asset-scope']) {
      const select = element<HTMLSelectElement>(id);
      if (select.value === 'all') continue;
      const button = document.createElement('button');
      button.textContent = select.selectedOptions[0]!.text + ' ×';
      button.setAttribute('aria-label', 'Clear ' + select.getAttribute('aria-label'));
      button.onclick = () => {
        select.value = 'all';
        select.dispatchEvent(new Event('change'));
        this.refresh();
      };
      chips.append(button);
    }
    const animated = element<HTMLInputElement>('asset-animated');
    if (animated.checked) {
      const button = document.createElement('button');
      button.textContent = 'Animated ×';
      button.ariaLabel = 'Clear animated filter';
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
    if (element<HTMLInputElement>('property-search').value) this.properties();
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
    const query = element<HTMLInputElement>('command-search').value.toLowerCase();
    const list = element('command-results');
    list.replaceChildren();
    const actions = [
      ['Save', 'save'],
      ['Save As', 'save-as'],
      ['New scene', 'new-scene'],
      ['Open scene library', 'scene-library'],
      ['Export JSON', 'export-scene'],
      ['Undo', 'undo'],
      ['Redo', 'redo'],
      ['Duplicate selection', 'duplicate'],
      ['Delete selection', 'delete'],
      ['Fit scene', 'fit'],
      ['Focus selection', 'focus-selection'],
      ['Focus mode', 'focus-mode'],
      ['Play', 'play-from-here'],
      ['Pause animations', 'play-animation'],
      ['Replay animations', 'replay-animation'],
      ['Shortcuts', 'shortcuts'],
    ];
    for (const [name, id] of actions) {
      const target = element<HTMLButtonElement>(id!);
      if (!target || !name!.toLowerCase().includes(query)) continue;
      const button = document.createElement('button');
      button.textContent = name!;
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
    ] as const) {
      if (!name.toLowerCase().includes(query)) continue;
      const button = document.createElement('button');
      button.textContent = name;
      button.onclick = () => {
        element<HTMLDialogElement>('command-dialog').close();
        openDock(tab);
      };
      list.append(button);
    }
    if (!list.children.length) list.textContent = 'No matching actions.';
  }
  private properties() {
    const query = element<HTMLInputElement>('property-search').value.toLowerCase().trim();
    const results = element('property-results');
    results.replaceChildren();
    results.hidden = !query;
    if (!query) return;
    for (const label of document.querySelectorAll<HTMLLabelElement>(
      '#scene-panel label,#object-panel label',
    )) {
      const input = label.querySelector<HTMLInputElement>('input,select');
      if (!input || input.disabled || input.closest('fieldset')?.disabled) continue;
      const text =
        label.childNodes[0]?.textContent?.trim() ?? input.getAttribute('aria-label') ?? '';
      const groups = [...label.closest('[role="tabpanel"]')!.querySelectorAll('summary')].filter(
        (s) => s.parentElement?.contains(label),
      );
      const title = [...groups.map((s) => s.textContent?.trim()), text].join(' › ');
      if (!title.toLowerCase().includes(query)) continue;
      const button = document.createElement('button');
      button.textContent = title;
      button.onclick = () => {
        openDock(label.closest('#scene-panel') ? 'scene' : 'object');
        let parent = label.parentElement;
        while (parent) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        element<HTMLInputElement>('property-search').value = '';
        results.hidden = true;
        input.focus();
        input.scrollIntoView({ block: 'center' });
      };
      results.append(button);
    }
    if (!results.children.length) results.textContent = 'No matching settings.';
  }
  dispose() {
    this.lifetime.abort();
    clearTimeout(this.timer);
    document.body.classList.remove('focus-mode', 'dock-hidden');
    if (this.navigation) document.body.append(this.navigation);
  }
}
