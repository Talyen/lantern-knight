import { html } from '../../src/dom';
import { columns, rows, fits, organize, samplePack, type StudyItem } from './pack';

type Layout = 'centered' | 'drawer' | 'split';
type Contents = 'empty' | 'populated' | 'full';
const root = document.querySelector<HTMLElement>('#study')!;
const layouts: Record<Layout, { name: string; description: string }> = {
  centered: {
    name: 'The workbench',
    description:
      'Equipment and pack share one quiet surface. A fixed inspection area keeps browsing steady.',
  },
  drawer: {
    name: 'The field pack',
    description:
      'A right-side inventory leaves the world in view, with equipment beside the scrolling pack.',
  },
  split: {
    name: 'The open road',
    description:
      'Equipment and pack sit on opposite sides. The space between them keeps the journey present.',
  },
};
let layout: Layout = 'centered';
let contents: Contents = 'populated';
let screen = 'inventory';
let items = samplePack(contents);
let selected = items[0]?.key;
let moving: { key: string; x: number; y: number; keyboard: boolean } | undefined;
let narrowTab = 'pack';
let notice = '';
let concept = 'title';
let activeSettings = 'display';
let forgeChoice = 'sword';
let forgeDone = false;
let conceptMessage = '';
const equipped: Record<string, string> = {
  sword: 'sword',
  body: 'leather-armor',
  lantern: 'lantern',
  gloves: 'gloves',
  belt: 'belt',
  boots: 'boots',
};
const names: Record<string, string> = {
  sword: 'Sword',
  body: 'Body',
  lantern: 'Lantern',
  gloves: 'Gloves',
  belt: 'Belt',
  boots: 'Boots',
  ring1: 'Ring',
  ring2: 'Ring',
  amulet: 'Amulet',
  trinket: 'Trinket',
};
const art = (id: string, className = '') =>
  html`<img class="art ${className}" src="art/${id}.png" alt="" draggable="false">`;
const ornament = () => html`<span class="flourish" aria-hidden="true">◆</span>`;

function action(label: string, run: () => void, className = '') {
  const button = html<HTMLButtonElement>`<button type="button" class="${className}">${label}</button>`;
  button.addEventListener('click', run);
  return button;
}
function notify(message: string) {
  notice = message;
  const status = root.querySelector<HTMLElement>('#inventory-status');
  if (status) status.textContent = message;
}
function reset(next: Contents) {
  contents = next;
  items = samplePack(next);
  selected = items[0]?.key;
  moving = undefined;
  notice = '';
  render();
}
function inspect(key: string, keepFocus = false) {
  selected = key;
  moving = undefined;
  root.querySelector('.inspection')?.replaceWith(details());
  for (const button of root.querySelectorAll<HTMLElement>('.pack-item')) {
    const current = button.dataset.key === key;
    button.setAttribute('aria-pressed', String(current));
    button.tabIndex = current ? 0 : -1;
    if (current && keepFocus) button.focus({ preventScroll: true });
  }
  updatePreview();
}
function details() {
  const item = items.find((entry) => entry.key === selected);
  if (!item)
    return html`<section class="inspection empty-inspection" aria-label="Selected item"><span class="section-label">Item details</span><p>Select an item to inspect it.</p><span class="muted">Your equipment and pack stay in place.</span></section>`;
  const isGear = !['iron', 'bone', 'health-potion', 'damaged-axe', 'damaged-helmet'].includes(
    item.item,
  );
  const move = action('Move', () => {
    moving = { key: item.key, x: item.x, y: item.y, keyboard: true };
    itemButton(item.key)?.focus();
    updatePreview();
    notify('Move with arrow keys · Enter to place · Esc to cancel');
  });
  const equip = action(
    isGear ? 'Equip' : item.item === 'health-potion' ? 'Use potion' : 'Inspect',
    () => {
      notify(
        isGear
          ? `${item.name} selected for equipment. This study previews layout and placement; game equipment is unchanged.`
          : item.effect + ' · Preview only; no resources spent.',
      );
    },
    'primary',
  );
  return html`<section class="inspection" aria-label="Selected item">
    <div class="detail-heading">${art(item.item)}<div><span class="section-label">${isGear ? 'Equipment' : 'Supplies'} · ${item.width} × ${item.height}</span><h3>${item.name}</h3></div></div>
    <p class="item-effect">${item.effect}</p>
    ${item.item === 'orchard-ring' ? html`<p class="comparison"><span>Maximum health</span><span>100 <span aria-hidden="true">→</span> <strong>110 <small>(+10)</small></strong></span></p>` : html`<p class="comparison"><span>${item.quantity > 1 ? 'Stack' : 'Carried'}</span><span>${item.quantity > 1 ? `${item.quantity} items` : 'One item'}</span></p>`}
    <div class="detail-actions">${equip}${move}</div>
  </section>`;
}
function kit() {
  const cells = Object.entries(names).map(([slot, name]) => {
    const id = equipped[slot];
    const button = action(
      '',
      () =>
        notify(
          `${name} · ${id ? 'Equipped' : 'Empty slot'}. This mockup keeps the comparison loadout fixed.`,
        ),
      `equipment-slot slot-${slot}${id ? '' : ' vacant'}`,
    );
    button.setAttribute('aria-label', `${name} · ${id ? 'Equipped' : 'Empty slot'}`);
    if (id) button.append(art(id));
    else button.append(html`<span>${name}</span>`);
    return button;
  });
  return html`<section class="kit-panel" aria-label="Equipment"><header class="section-heading"><h2>Your kit</h2><span class="muted">Lamplighter</span></header><div class="equipment-grid">${cells}</div><div class="kit-stats"><span>Health <strong>100</strong></span><span>Sword <strong>26</strong></span><span>Lantern <strong>28</strong></span></div></section>`;
}
function itemButton(key: string) {
  return [...root.querySelectorAll<HTMLButtonElement>('.pack-item')].find(
    (button) => button.dataset.key === key,
  );
}
function inventory() {
  const occupied = items.reduce((total, item) => total + item.width * item.height, 0);
  const controls = html`<div class="study-controls"><div class="approaches" role="group" aria-label="Inventory approach">${(
    Object.entries(layouts) as [Layout, (typeof layouts)[Layout]][]
  ).map(([key, value], index) => {
    const button = action(`${String.fromCharCode(65 + index)} · ${value.name}`, () => {
      layout = key;
      moving = undefined;
      render();
    });
    button.setAttribute('aria-pressed', String(layout === key));
    return button;
  })}</div><label class="contents-control">Pack contents <select aria-label="Pack contents"><option value="empty">Empty</option><option value="populated">Populated</option><option value="full">Full</option></select></label></div>`;
  const select = controls.querySelector('select')!;
  select.value = contents;
  select.addEventListener('change', () => reset(select.value as Contents));
  const tabs = html`<div class="narrow-tabs" role="group" aria-label="Inventory section">${[
    'kit',
    'pack',
  ].map((tab) => {
    const button = action(tab === 'kit' ? 'Equipment' : 'Pack', () => {
      narrowTab = tab;
      render();
    });
    button.setAttribute('aria-pressed', String(tab === narrowTab));
    return button;
  })}</div>`;
  const grid = html`<div class="pack-grid" role="group" aria-label="Pack · 12 columns by 16 rows"></div>`;
  for (let index = 0; index < columns * rows; index++)
    grid.append(html`<span class="pack-cell" aria-hidden="true"></span>`);
  for (const item of items) {
    const button = action(
      '',
      () => {
        if (moving?.keyboard) return;
        inspect(item.key);
      },
      'pack-item',
    );
    button.dataset.key = item.key;
    button.draggable = true;
    button.tabIndex = selected === item.key ? 0 : -1;
    button.setAttribute('aria-pressed', String(selected === item.key));
    button.setAttribute(
      'aria-label',
      `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''} · ${item.width} by ${item.height} cells`,
    );
    button.style.gridArea = `${item.y + 1} / ${item.x + 1} / span ${item.height} / span ${item.width}`;
    button.append(art(item.item));
    if (item.quantity > 1) button.append(html`<span class="quantity">${item.quantity}</span>`);
    button.addEventListener('dragstart', (event) => {
      selected = item.key;
      moving = { key: item.key, x: item.x, y: item.y, keyboard: false };
      event.dataTransfer!.setData('text/plain', item.key);
      event.dataTransfer!.effectAllowed = 'move';
      root.querySelector('.inspection')?.replaceWith(details());
      updatePreview();
    });
    button.addEventListener('dragend', () => {
      moving = undefined;
      updatePreview();
    });
    button.addEventListener('keydown', (event) => navigate(event, item));
    grid.append(button);
  }
  grid.append(html`<div class="placement-preview" aria-hidden="true" hidden></div>`);
  grid.addEventListener('dragover', (event) => {
    if (!moving || moving.keyboard) return;
    event.preventDefault();
    const rect = grid.getBoundingClientRect();
    moving.x = Math.floor((event.clientX - rect.left) / (rect.width / columns));
    moving.y = Math.floor((event.clientY - rect.top) / (rect.height / rows));
    const item = items.find((entry) => entry.key === moving!.key)!;
    event.dataTransfer!.dropEffect = fits(items, item, moving.x, moving.y) ? 'move' : 'none';
    updatePreview();
  });
  grid.addEventListener('drop', (event) => {
    event.preventDefault();
    commitMove();
  });
  const pack = html`<section class="pack-panel" aria-label="Backpack"><header class="section-heading"><div><h2>Your pack</h2><span class="pack-capacity">${occupied} / 192 cells · 12 × 16</span></div>${action(
    'Organize',
    () => {
      const result = organize(items);
      if (!result) {
        notify('Could not organize this arrangement. Move an item to make room.');
        return;
      }
      items = result;
      moving = undefined;
      notice = 'Pack organized. Your items have been kept.';
      render();
    },
    'quiet',
  )}</header><div class="pack-scroll" tabindex="0" aria-label="Scroll pack">${grid}</div><div class="pack-bottom"><span class="wallet">${art('gold')}<strong>248</strong> <span>Gold</span></span><span class="muted">Fixed orientation · Generous storage</span></div></section>`;
  const panel = html`<section class="inventory-window" aria-label="Inventory mockup"><header class="window-heading">${ornament()}<h1>Inventory</h1><span class="close-hint">Paused <kbd>I</kbd> <kbd>Esc</kbd></span></header>${tabs}<div class="inventory-body">${kit()}${pack}${details()}</div><footer class="inventory-footer"><span id="inventory-status" role="status">${notice || 'Select to inspect · Drag to arrange · M to move with keys'}</span><span class="footer-mark" aria-hidden="true">◆</span></footer></section>`;
  return html`<div class="inventory-study">${controls}<section class="scene approach-${layout} narrow-${narrowTab}" aria-label="${layouts[layout].name}"><div class="world-title" aria-hidden="true">Ruined Forge<span>The journey waits.</span></div>${panel}</section><footer class="study-caption"><div><strong>${layouts[layout].name}</strong><p>${layouts[layout].description}</p></div><span>Same items. Same 192 cells. Three ways to browse.</span></footer></div>`;
}
function updatePreview() {
  const preview = root.querySelector<HTMLElement>('.placement-preview');
  if (!preview) return;
  preview.hidden = !moving;
  for (const button of root.querySelectorAll<HTMLElement>('.pack-item'))
    button.classList.toggle('moving', button.dataset.key === moving?.key);
  if (!moving) return;
  const item = items.find((entry) => entry.key === moving!.key)!;
  // Clamp only the visual preview; validation still uses the requested position.
  preview.style.gridArea = `${Math.max(0, Math.min(rows - item.height, moving.y)) + 1} / ${Math.max(0, Math.min(columns - item.width, moving.x)) + 1} / span ${item.height} / span ${item.width}`;
  preview.classList.toggle('invalid', !fits(items, item, moving.x, moving.y));
  preview.classList.toggle('valid', fits(items, item, moving.x, moving.y));
}
function commitMove() {
  if (!moving) return;
  const item = items.find((entry) => entry.key === moving!.key)!;
  const key = item.key;
  if (!fits(items, item, moving.x, moving.y)) {
    notify('That space is blocked. Your item has not moved.');
    return;
  }
  item.x = moving.x;
  item.y = moving.y;
  moving = undefined;
  notice = `${item.name} placed.`;
  render();
  itemButton(key)?.focus({ preventScroll: true });
}
function navigate(event: KeyboardEvent, item: StudyItem) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (moving?.keyboard) {
    if (event.key === 'Escape') {
      event.preventDefault();
      moving = undefined;
      updatePreview();
      notify('Move cancelled. Your item has not moved.');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commitMove();
    } else if (directions[event.key]) {
      event.preventDefault();
      const [dx, dy] = directions[event.key]!;
      moving.x = Math.max(0, Math.min(columns - item.width, moving.x + dx));
      moving.y = Math.max(0, Math.min(rows - item.height, moving.y + dy));
      updatePreview();
      notify(
        `${item.name} · Column ${moving.x + 1}, row ${moving.y + 1} · ${fits(items, item, moving.x, moving.y) ? 'Space available' : 'Blocked'}`,
      );
      root.querySelector('.placement-preview')?.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (event.key.toLowerCase() === 'm') {
    event.preventDefault();
    moving = { key: item.key, x: item.x, y: item.y, keyboard: true };
    updatePreview();
    notify('Move with arrow keys · Enter to place · Esc to cancel');
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const target = event.key === 'Home' ? items[0] : items.at(-1);
    if (target) inspect(target.key, true);
    return;
  }
  if (!directions[event.key]) return;
  event.preventDefault();
  const [dx, dy] = directions[event.key]!;
  const candidates = items
    .filter((entry) => entry.key !== item.key)
    .map((entry) => {
      const x = entry.x + entry.width / 2 - item.x - item.width / 2;
      const y = entry.y + entry.height / 2 - item.y - item.height / 2;
      return { entry, along: dx ? x * dx : y * dy, across: Math.abs(dx ? y : x) };
    })
    .filter((value) => value.along > 0)
    .sort((a, b) => a.along + a.across * 3 - b.along - b.across * 3);
  if (candidates[0]) {
    inspect(candidates[0].entry.key, true);
    itemButton(candidates[0].entry.key)?.scrollIntoView({ block: 'nearest' });
  }
}

function settingsContent() {
  const category = (key: string, name: string) => {
    const button = action(name, () => {
      activeSettings = key;
      render();
    });
    button.setAttribute('aria-pressed', String(activeSettings === key));
    return button;
  };
  const range = (label: string, value: number) => {
    const row = html`<label class="setting-row range-row"><span>${label}</span><input type="range" min="0" max="100" value="${value}"><output>${value}%</output></label>`;
    row.querySelector('input')!.addEventListener('input', (event) => {
      row.querySelector('output')!.textContent = `${(event.target as HTMLInputElement).value}%`;
    });
    return row;
  };
  return html`<section class="concept-panel settings-concept"><header class="concept-heading">${ornament()}<h1>Settings</h1></header><div class="settings-body"><nav aria-label="Settings categories">${category('display', 'Display')}${category('sound', 'Sound')}${category('controls', 'Controls')}</nav><section class="settings-values">${
    activeSettings === 'display'
      ? html`<div class="settings-fields"><h2>Display</h2><label class="setting-row"><span>Camera distance</span><select><option>Close</option><option selected>Medium</option><option>Wide</option><option>Far</option></select></label><label class="setting-row"><span>Interface size</span><select><option>Small</option><option selected>Default</option><option>Large</option></select></label><label class="setting-row"><span>Render scale<small>Lower values improve performance.</small></span><select><option>100%</option><option>75%</option><option>50%</option></select></label>${range('Depth of field', 50)}<details><summary>Advanced visuals</summary><label class="setting-row"><span>Moving foliage</span><input type="checkbox" checked></label><label class="setting-row"><span>Smoke & embers</span><input type="checkbox" checked></label></details></div>`
      : activeSettings === 'sound'
        ? html`<div class="settings-fields"><h2>Sound</h2><label class="setting-row"><span>Mute</span><input type="checkbox"></label>${range('Master volume', 80)}${range('Sound effects', 80)}${range('Ambience', 65)}</div>`
        : html`<div class="settings-fields"><h2>Controls</h2><dl class="bindings">${[
            ['W A S D', 'Move'],
            ['Mouse', 'Aim'],
            ['LMB', 'Sword'],
            ['RMB', 'Lantern burst'],
            ['Shift', 'Dodge'],
            ['E', 'Interact'],
            ['I', 'Inventory'],
            ['Q', 'Health potion'],
            ['Esc', 'Pause / resume'],
          ].map(
            ([key, label]) => html`<div><dt>${label}</dt><dd><kbd>${key}</kbd></dd></div>`,
          )}</dl></div>`
  }</section></div><footer class="concept-footnote">Changes in this study are temporary.</footer></section>`;
}
function conceptContent() {
  if (concept === 'title')
    return html`<section class="title-concept">${art('ui-title', 'title-emblem')}<div class="title-actions">${action(
      'Continue journey',
      () => {
        concept = 'hud';
        render();
      },
      'primary',
    )}${action('New journey', () => {
      conceptMessage =
        'Replace saved journey? This is a design preview; no journey will be replaced.';
      render();
    })}${action('Settings', () => {
      concept = 'settings';
      render();
    })}${action('Controls', () => {
      concept = 'settings';
      activeSettings = 'controls';
      render();
    })}</div><p class="resume-location">Abandoned Orchard · Last checkpoint</p></section>`;
  if (concept === 'pause')
    return html`<section class="concept-panel pause-concept"><header class="concept-heading">${ornament()}<h1>Paused</h1></header><div class="pause-actions">${action(
      'Resume',
      () => {
        concept = 'hud';
        render();
      },
      'primary',
    )}${action('Settings', () => {
      concept = 'settings';
      render();
    })}${action('Controls', () => {
      concept = 'settings';
      activeSettings = 'controls';
      render();
    })}${action('Main menu', () => {
      concept = 'title';
      render();
    })}</div><details><summary>Journey options</summary><div class="journey-actions">${[
      'Save checkpoint',
      'Load checkpoint',
      'Reset encounter',
      'New journey',
    ].map((name) =>
      action(name, () => {
        conceptMessage = `${name} · Preview only. Your journey is unchanged.`;
        render();
      }),
    )}</div></details></section>`;
  if (concept === 'settings') return settingsContent();
  if (concept === 'forge')
    return html`<section class="concept-panel forge-concept"><header class="concept-heading">${ornament()}<h1>The Forge</h1><p>Inspect permanent kit improvements.</p></header><div class="forge-body"><div class="forge-art">${art('anvil')}${art(forgeChoice, 'forged-item')}</div><div class="forge-decision"><div class="forge-choices" role="group" aria-label="Forge choice">${[
      'sword',
      'lantern',
    ].map((id) => {
      const b = action('', () => {
        forgeChoice = id;
        forgeDone = false;
        render();
      });
      b.append(art(id), html`<span>${id === 'sword' ? 'Temper sword' : 'Rekindle lantern'}</span>`);
      b.setAttribute('aria-pressed', String(forgeChoice === id));
      return b;
    })}</div><h2>${forgeChoice === 'sword' ? 'A keener edge' : 'A brighter flame'}</h2><p class="forge-effect">${forgeChoice === 'sword' ? 'Physical damage' : 'Damage per enemy'} <strong>${forgeChoice === 'sword' ? '26 → 52' : '28 → 56'}</strong></p><dl class="cost-list"><div><dt>Gold</dt><dd>248 / 20</dd></div><div><dt>Iron</dt><dd>24 / 4</dd></div></dl>${action(
      forgeDone
        ? 'Improvement complete'
        : forgeChoice === 'sword'
          ? 'Temper sword'
          : 'Rekindle lantern',
      () => {
        forgeDone = true;
        conceptMessage = 'Upgrade preview complete. No materials spent.';
        render();
      },
      'primary',
    )}<p class="permanent-note">This choice is permanent. The other improvement becomes unavailable.</p></div></div></section>`;
  if (concept === 'campfire')
    return html`<section class="concept-panel campfire-concept"><header class="concept-heading">${ornament()}<h1>Orchard Campfire</h1></header>${art('ui-campfire', 'campfire-emblem')}<p class="rest-description">Restore health. Save your checkpoint.<br>Enemies return when you rest.</p>${action(
      'Rest',
      () => {
        conceptMessage = 'Rested · Health restored · Checkpoint saved (preview)';
        render();
      },
      'primary',
    )}<section class="travel-list"><h2>Travel</h2><div class="current-destination"><span>Abandoned Orchard</span><small>Here</small></div>${action(
      'Ruined Forge  →',
      () => {
        conceptMessage = 'Travel preview · Ruined Forge selected.';
        render();
      },
    )}${action('Desecrated Chapel  →', () => {
      conceptMessage = 'Travel preview · Desecrated Chapel selected.';
      render();
    })}</section></section>`;
  if (concept === 'loading')
    return html`<section class="loading-concept">${art('ui-title', 'loading-emblem')}<h1>The path awaits.</h1><p>Preparing the next area…</p><span class="loading-rule" aria-hidden="true"></span><small>Preparation feedback, without a fabricated percentage.</small></section>`;
  if (concept === 'recovery')
    return html`<section class="concept-panel recovery-concept"><header class="concept-heading">${ornament()}<h1>The path could not be opened.</h1></header><p>Your journey is safe. The next area could not be loaded.</p><div class="recovery-actions">${action(
      'Try again',
      () => {
        conceptMessage = 'Retry selected · Preview only.';
        render();
      },
      'primary',
    )}${action('Main menu', () => {
      concept = 'title';
      render();
    })}</div></section>`;
  return html`<div class="hud-concept"><div class="location-label">Abandoned Orchard<span>Lantern night</span></div><div class="game-shortcuts">${action(
    'Inventory  I',
    () => {
      screen = 'inventory';
      render();
    },
  )}${action('Menu  Esc', () => {
    concept = 'pause';
    render();
  })}</div><div class="loot-example">${art('orchard-ring')}<span>Orchard Ring</span><kbd>E</kbd></div><div class="hud-dock"><div class="health-orb"><span class="orb-fill"></span>${art('ui-health')}<strong>72 / 100</strong></div><div class="ability potion">${art('health-potion')}<span>8 <kbd>Q</kbd></span></div><div class="ability lantern">${art('lantern')}<span>Ready <kbd>RMB</kbd></span></div></div><div class="interaction-example"><kbd>E</kbd> Rest at campfire</div></div>`;
}
function concepts() {
  const options = [
    ['title', 'Title'],
    ['pause', 'Pause'],
    ['settings', 'Settings & help'],
    ['hud', 'HUD & loot'],
    ['forge', 'Forge'],
    ['campfire', 'Campfire'],
    ['loading', 'Loading'],
    ['recovery', 'Recovery'],
  ];
  return html`<div class="concept-study"><nav class="concept-tabs" aria-label="Interface concept">${options.map(
    ([key, label]) => {
      const b = action(label!, () => {
        concept = key!;
        conceptMessage = '';
        render();
      });
      b.setAttribute('aria-pressed', String(concept === key));
      return b;
    },
  )}</nav><section class="scene concept-scene concept-${concept}" aria-label="${options.find(([key]) => key === concept)?.[1]} concept">${conceptContent()}${conceptMessage ? html`<p class="concept-notice" role="status">${conceptMessage}</p>` : false}</section><footer class="study-caption"><div><strong>Quiet surfaces. Clear decisions.</strong><p>Warm ivory, aged brass, visible action names, and ornament with room to breathe.</p></div><span>Shared concept sheet · interactive screen studies</span></footer></div>`;
}
function render() {
  root.replaceChildren(screen === 'inventory' ? inventory() : concepts());
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-screen]'))
    button.setAttribute('aria-pressed', String(button.dataset.screen === screen));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-screen]'))
  button.addEventListener('click', () => {
    screen = button.dataset.screen!;
    moving = undefined;
    render();
  });
render();
