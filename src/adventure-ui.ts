import { html } from './dom';
import { bindPackPlacement } from './inventory-placement';
import { packColumns, packRows } from './core/pack';
import { createItemArtwork } from './item-art';
import {
  upgrades,
  upgradeIds,
  upgradeOffer,
  type UpgradeRanks,
  kitAttributes,
  scaledDamage,
  type UpgradeId,
} from './content/progression';
import { tuning } from './content/gameplay';
import type { Application } from './application';
import { equipmentSlots, items, type EquipmentSlot } from './content/items';
import { createPlayerIcon } from './player-icons';
const slotNames: Record<EquipmentSlot, string> = {
  body: 'Body',
  gloves: 'Gloves',
  belt: 'Belt',
  boots: 'Boots',
  ring1: 'Ring 1',
  ring2: 'Ring 2',
  amulet: 'Amulet',
  trinket: 'Trinket',
  sword: 'Sword',
  lantern: 'Lantern',
};
export function bindAdventureUI(app: Application, root: HTMLElement, signal: AbortSignal) {
  let disposed = false;
  let drawing = new AbortController();
  let drawSignal = signal;
  let placement: ReturnType<typeof bindPackPlacement> | undefined;
  const panel = html<HTMLDialogElement>`<dialog class="adventure-panel gothic-panel" tabindex="-1" aria-label="Inventory and campfire"></dialog>`;
  let fire: string | undefined;
  let showingUpgrades = false;
  let choice: UpgradeId | undefined;
  let working = false;
  let message = '';
  let messageError = false;
  let selected: { kind: 'pack'; id: string } | { kind: 'slot'; slot: EquipmentSlot } | undefined;
  let equipTo: EquipmentSlot | undefined;
  let detailVisible = false;
  let inventoryView: 'kit' | 'pack' = 'pack';
  const artwork = createItemArtwork(app.runtime, signal);
  let focusedAction = 'return';
  const deny = () => void app.audio.play('ui-deny', { world: false }).catch(() => {});
  function close() {
    if (disposed || !panel.open || working) return;
    placement?.cancel();
    panel.close();
    fire = choice = undefined;
    showingUpgrades = false;
    app.pause(false);
    app.canvas.focus();
  }
  function button(label: string, key: string, action: () => void, disabled = working) {
    const element = html<HTMLButtonElement>`<button type="button" data-action="${key}">${label}</button>`;
    element.addEventListener('click', action, { signal: drawSignal });
    element.disabled = disabled;
    if (key === 'confirm-upgrade') element.className = 'primary-action';
    if (key === 'rest') {
      element.setAttribute('aria-label', 'Rest');
      element.dataset.tip = 'Rest · Restore health · Save checkpoint · Reset enemies';
      element.append(createPlayerIcon('fire'), document.createTextNode(' Rest'));
    }
    return element;
  }
  function report(action: () => void, confirmation: string) {
    if (disposed || working) return;
    try {
      action();
      message = confirmation;
      messageError = false;
    } catch (error) {
      deny();
      message = (error as Error).message;
      messageError = true;
    }
    draw();
  }
  function run(action: () => Promise<void>) {
    app.safe(async () => {
      if (disposed || working) return;
      working = true;
      message = '';
      messageError = false;
      draw();
      try {
        await action();
      } catch (error) {
        if (disposed) return;
        deny();
        messageError = true;
        message = showingUpgrades
          ? `${(error as Error).message}. Nothing was spent. Try again.`
          : (error as Error).message;
      } finally {
        working = false;
        draw();
      }
    });
  }
  function damage(upgrade: UpgradeId, ranks: Readonly<UpgradeRanks>) {
    const attributes = kitAttributes(ranks);
    return upgrade === 'sword'
      ? scaledDamage(tuning.attack.damage, attributes.edge)
      : scaledDamage(tuning.ability.damage, attributes.ember) +
          Math.floor(tuning.ability.burnDuration / tuning.ability.burnCadence) *
            scaledDamage(tuning.ability.burnDamage, attributes.ember);
  }
  function material(id: string, amount: number, insufficient = false, owned?: number) {
    const label = `${owned === undefined ? amount : `${owned} / ${amount}`} ${items[id]!.name}${insufficient ? ' · insufficient' : ''}`;
    return html`<span class="material-cost${insufficient ? ' insufficient' : ''}" role="img" aria-label="${label}">${artwork(id)}<span>${items[id]!.name} <strong>${owned === undefined ? amount : `${owned} / ${amount}`}</strong>${insufficient ? html`<small>More needed</small>` : false}</span></span>`;
  }
  function improvements() {
    const active = choice ?? 'sword';
    const ranks = app.session.upgrades;
    const offer = upgradeOffer(active, ranks, app.session.inventory);
    const nextRanks = { ...ranks, [active]: offer.rank + 1 };
    const reason = !offer.next
      ? offer.reason
      : !fire
        ? 'Visit any campfire to purchase.'
        : offer.reason;
    const options = upgradeIds.map((id) => {
      const option = upgradeOffer(id, ranks, app.session.inventory);
      const select = button('', `choose-${id}`, () => {
        choice = id;
        message = '';
        messageError = false;
        draw();
      });
      select.className = 'upgrade-option';
      select.setAttribute('aria-label', `${upgrades[id].name} I`);
      select.setAttribute('aria-pressed', String(active === id));
      select.append(
        artwork(id),
        html`<span>${upgrades[id].name} I<small>${option.rank ? 'Rank I owned' : 'Not improved'}</small></span>`,
      );
      return select;
    });
    const confirm = button(
      working ? 'Saving…' : !offer.next ? 'Complete' : 'Confirm upgrade',
      'confirm-upgrade',
      () => {
        if (!fire || !offer.next || reason) return;
        const source = fire;
        run(async () => {
          await app.purchaseUpgrade(source, active);
          if (disposed) return;
          message = `${upgrades[active].name} I complete.`;
        });
      },
      working || !!reason,
    );
    confirm.setAttribute(
      'aria-description',
      reason ??
        Object.entries(offer.next!.cost)
          .map(
            ([id, amount]) =>
              `${items[id]!.name}: ${app.session.inventory[id] ?? 0} available, ${amount} required`,
          )
          .join('. '),
    );
    const attributes = kitAttributes(offer.next ? nextRanks : ranks);
    return html`<div class="adventure-content upgrade-content">
      <section class="upgrade-kit" aria-label="Permanent kit improvements">
        <div class="upgrade-options" role="group" aria-label="Choose an improvement">${options}</div>
        <p>Permanent improvements at every campfire. Both paths can be earned.</p>
      </section>
      <section class="upgrade-work" aria-label="Selected improvement">
        <h3>${upgrades[active].name} I</h3>
        <p>${offer.rank ? 'Rank I owned · Maximum rank reached' : 'Rank 0 → I'}</p>
        <p class="upgrade-damage">${active === 'sword' ? 'Sword damage' : 'Lantern damage per enemy'} <strong>${damage(active, ranks)}${offer.next ? ` → ${damage(active, nextRanks)}` : ''}</strong></p>
        <details><summary>Damage breakdown</summary><p>${active === 'sword' ? `Sweep and lunge: ${scaledDamage(tuning.attack.damage, attributes.edge)} damage per impact.` : `Initial hit ${scaledDamage(tuning.ability.damage, attributes.ember)} + ${Math.floor(tuning.ability.burnDuration / tuning.ability.burnCadence)} Burn ticks of ${scaledDamage(tuning.ability.burnDamage, attributes.ember)} damage over three seconds.`}</p><p>Attack timing, lantern radius, four-second cooldown and half-second stagger stay the same.</p></details>
        ${offer.next && html`<div class="upgrade-costs" aria-label="Upgrade cost">${Object.entries(offer.next.cost).map(([id, amount]) => material(id, amount, (app.session.inventory[id] ?? 0) < amount, app.session.inventory[id] ?? 0))}</div>`}
        <div class="upgrade-decision">${confirm}<p>${reason ?? 'Spend the displayed materials to permanently improve your kit. Enemies and health stay as they are.'}</p></div>
      </section>
    </div>`;
  }
  function campfire(key: string) {
    const destinations = [...app.session.discovered].map((destination) => {
      const { area, definition } = app.session.fire(destination);
      const current = destination === key;
      const name = app.registry.area(area).name;
      if (current)
        return html`<div class="campfire-destination current" aria-current="location" aria-label="${name} · Here" data-tip="Current campfire">${createPlayerIcon('waypoint')}<span>${name}</span></div>`;
      const travel = button(
        name,
        `travel-${destination}`,
        () =>
          run(async () => {
            await app.travel(destination);
            if (disposed) return;
            fire = destination;
            message = `Arrived at ${definition.name}.`;
          }),
        working,
      );
      travel.className = 'campfire-destination';
      travel.setAttribute('aria-label', `${name} · ${definition.name}`);
      travel.prepend(createPlayerIcon('waypoint'));
      return travel;
    });
    return html`<div class="adventure-content campfire-content">
      <section class="campfire-rest"><div class="campfire-emblem" aria-hidden="true">${artwork('ui-campfire')}</div>${app.sim.hero.health < app.sim.maxHealth && html`<p class="campfire-health">${createPlayerIcon('heart')}${app.sim.hero.health} / ${app.sim.maxHealth}</p>`}

        ${button('', 'rest', () =>
          run(async () => {
            await app.rest(key);
            if (disposed) return;
            message = 'Health restored. Your journey continues from this campfire.';
            app.hooks.status('Rested · health restored');
          }),
        )}
      </section>
      <p class="rest-consequences">Restore health · Save checkpoint · Reset enemies</p>
      <section class="campfire-travel" aria-label="Travel"><h3>Travel</h3>
        ${destinations}${destinations.length === 1 ? html`<p class="empty-travel">Discover another campfire to travel.</p>` : false}
      </section>
    </div>`;
  }
  function navigateItems(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const group = event.currentTarget as HTMLElement;
    const controls = [...group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const origin = event.target as HTMLButtonElement;
    if (!controls.includes(origin)) return;
    let target: HTMLButtonElement | undefined;
    if (event.key === 'Home') target = controls[0];
    else if (event.key === 'End') target = controls.at(-1);
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const from = origin.getBoundingClientRect();
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      let best = Infinity;
      for (const candidate of controls) {
        if (candidate === origin) continue;
        const to = candidate.getBoundingClientRect();
        const dx = (to.left + to.right - from.left - from.right) / 2;
        const dy = (to.top + to.bottom - from.top - from.bottom) / 2;
        const along = (horizontal ? dx : dy) * sign;
        // Tall equipment and multi-cell pack items should navigate along their
        // occupied row/column, rather than jumping toward a nearer item center.
        const crossCenter = horizontal
          ? (from.top + from.bottom) / 2
          : (from.left + from.right) / 2;
        const across = Math.max(
          0,
          (horizontal ? to.top : to.left) - crossCenter,
          crossCenter - (horizontal ? to.bottom : to.right),
        );
        const score = along + across * 10;
        if (along > 1 && score < best) {
          best = score;
          target = candidate;
        }
      }
    } else return;
    event.preventDefault();
    event.stopPropagation();
    target?.focus();
    target?.click();
  }
  function inventory() {
    const equipment = app.session.equipment;
    const carried = app.session.pack.map((entry) => ({
      ...entry,
      id: entry.key,
      count: entry.quantity,
      definition: items[entry.item]!,
    }));
    const selectedId = selected?.kind === 'pack' ? selected.id : undefined;
    if (selectedId && !carried.some((entry) => entry.id === selectedId)) selected = undefined;
    const firstGear = carried.find((entry) => entry.definition.kind === 'gear');
    selected ??= firstGear ? { kind: 'pack', id: firstGear.id } : { kind: 'slot', slot: 'sword' };
    const selectItem = (id: string) => {
      if (!messageError) message = '';
      selected = { kind: 'pack', id };
      detailVisible = true;
      inventoryView = 'pack';
      const slots = items[carried.find((entry) => entry.id === id)!.item]!.slots;
      equipTo = slots?.find((slot) => !equipment[slot]) ?? slots?.[0];
      panel.querySelector('.item-description')?.scrollTo(0, 0);
      draw();
    };
    const kitSlots: readonly EquipmentSlot[] = [
      'sword',
      'lantern',
      ...equipmentSlots.filter((slot) => slot !== 'sword' && slot !== 'lantern'),
    ];
    const gear = kitSlots.map((slot) => {
      const id = equipment[slot];
      const control = button('', `slot-${slot}`, () => {
        if (!messageError) message = '';
        selected = { kind: 'slot', slot };
        detailVisible = true;
        inventoryView = 'kit';
        panel.querySelector('.item-description')?.scrollTo(0, 0);
        draw();
      });
      control.className = `inventory-slot slot-${slot}${id ? ' occupied' : ''}`;
      control.tabIndex = (selected?.kind === 'slot' ? selected.slot === slot : slot === 'sword')
        ? 0
        : -1;
      control.setAttribute(
        'aria-pressed',
        String(selected?.kind === 'slot' && selected.slot === slot),
      );
      control.setAttribute(
        'aria-label',
        `${slotNames[slot]} · ${id ? items[id]!.name : 'Empty slot'}`,
      );
      control.dataset.tip = `${slotNames[slot]} · ${id ? items[id]!.name : 'Empty slot'}`;
      control.append(
        artwork(
          id ??
            (
              {
                body: 'leather-armor',
                ring1: 'orchard-ring',
                ring2: 'orchard-ring',
                amulet: 'amulet',
                trinket: 'trinket',
              } as Partial<Record<EquipmentSlot, string>>
            )[slot] ??
            slot,
        ),
      );
      control.append(
        html`<span class="visually-hidden">${slotNames[slot]} ${id ? items[id]!.name : 'Empty slot'}</span>`,
      );
      return control;
    });
    const bag = carried.map(({ id, count, item: itemId, definition: item, x, y }) => {
      const control = button('', `item-${id}`, () => selectItem(id));
      control.className = 'inventory-row';
      control.dataset.entry = id;
      control.dataset.tip = `${item.name}${count > 1 ? ` ×${count}` : ''}`;
      control.dataset.item = itemId;
      const [width, height] = item.footprint;
      control.style.gridArea = `${y + 1} / ${x + 1} / span ${height} / span ${width}`;
      control.tabIndex = (selected?.kind === 'pack' ? selected.id === id : carried[0]?.id === id)
        ? 0
        : -1;

      control.setAttribute('aria-label', `${item.name} ×${count}`);
      control.setAttribute('aria-pressed', String(selected?.kind === 'pack' && selected.id === id));
      control.append(
        artwork(itemId),
        html`<span class="visually-hidden">${item.name} ×${count}</span>`,
      );
      if (count > 1) control.append(html`<span class="item-count">${count}</span>`);
      return control;
    });
    const empty = Array.from(
      { length: packColumns * packRows },
      () => html`<span class="bag-empty" aria-hidden="true"></span>`,
    );
    const tabs = (['kit', 'pack'] as const).map((view) => {
      const control = button(view === 'kit' ? 'Your kit' : 'Your pack', `show-${view}`, () => {
        inventoryView = view;
        draw();
      });
      control.setAttribute('aria-pressed', String(inventoryView === view));
      control.setAttribute('aria-label', view === 'kit' ? 'Your kit' : 'Your pack');
      control.dataset.tip = view === 'kit' ? 'Equipment' : 'Pack';
      return control;
    });
    const content = html`<div class="adventure-content inventory-content inventory-view-${inventoryView}">
      <div class="inventory-tabs" role="group" aria-label="Browse inventory">${tabs}</div>
      <div class="inventory-columns">
        <section class="inventory-equipment" aria-label="Equipment"><h3>Your kit</h3><div class="equipment-grid" role="group" aria-label="Equipment slots">${gear}</div></section>
        <section class="inventory-bag" aria-label="Carried items"><header class="pack-heading"><div><h3>Your pack</h3><span>${carried.reduce((sum, entry) => sum + entry.definition.footprint[0] * entry.definition.footprint[1], 0)} / 192 cells · 12 × 16</span></div>${button('Organize', 'organize', () => report(() => app.changeInventory({ kind: 'organize' }), 'Pack organized.'))}</header><div class="pack-scroll" data-scroll="pack"><div class="pack-items" role="group" aria-label="Carried items">${empty}${bag}</div></div><div class="inventory-gold">${material('gold', app.session.inventory.gold ?? 0)}</div></section>${inventoryDetail()}
      </div>
    </div>`;
    content
      .querySelector('.equipment-grid')!
      .addEventListener('keydown', (event) => navigateItems(event as KeyboardEvent), {
        signal: drawSignal,
      });
    content
      .querySelector('.pack-items')!
      .addEventListener('keydown', (event) => navigateItems(event as KeyboardEvent), {
        signal: drawSignal,
      });
    placement = bindPackPlacement(
      content.querySelector<HTMLElement>('.pack-items')!,
      app.session.pack,
      (entry, x, y) => {
        focusedAction = `item-${entry}`;
        report(() => app.changeInventory({ kind: 'move', entry, x, y }), 'Item placed.');
      },
      (key) => {
        selected = { kind: 'pack', id: key };
        detailVisible = true;
        panel.querySelector('.inventory-detail')?.replaceWith(inventoryDetail());
      },
      (text) => {
        message = text;
        const feedback = panel.querySelector<HTMLElement>('.adventure-feedback');
        if (feedback) feedback.textContent = text;
      },
      drawSignal,
    );
    return content;
  }
  function inventoryDetail() {
    const equippedSlot = selected?.kind === 'slot' ? selected.slot : undefined;
    const entryKey = selected?.kind === 'pack' ? selected.id : undefined;
    const packEntry = app.session.pack.find((entry) => entry.key === entryKey);
    const id = packEntry?.item ?? (equippedSlot ? app.session.equipment[equippedSlot] : undefined);
    if (!id || !detailVisible)
      return html`<section class="inventory-detail empty-detail" aria-label="Selected item"><p>Select an item to inspect it.</p><span>Equipment and pack stay in place.</span></section>`;
    const item = items[id]!;
    const slots = item.slots;
    if (slots && (!equipTo || !slots.includes(equipTo)))
      equipTo = slots.find((slot) => !app.session.equipment[slot]) ?? slots[0];
    const targetSlot = equippedSlot ?? equipTo;
    const replacedId = targetSlot ? app.session.equipment[targetSlot] : undefined;
    const projectedHealth =
      app.sim.maxHealth -
      (replacedId ? (items[replacedId]!.maxHealth ?? 0) : 0) +
      (equippedSlot ? 0 : (item.maxHealth ?? 0));
    const actions: HTMLElement[] = [];
    if (equippedSlot) {
      const control = button('Unequip', 'unequip', () =>
        report(
          () => app.changeInventory({ kind: 'unequip', slot: equippedSlot }),
          `${item.name} unequipped.`,
        ),
      );
      actions.push(control);
    } else if (slots && targetSlot) {
      if (slots.length > 1) {
        const select = html<HTMLSelectElement>`<select data-action="equip-slot" aria-label="Equip to">${slots.map((slot) => html`<option value="${slot}">${slotNames[slot]} · ${app.session.equipment[slot] ? items[app.session.equipment[slot]!]!.name : 'Empty slot'}</option>`)}</select>`;
        select.value = targetSlot;
        select.disabled = working;
        select.addEventListener(
          'change',
          () => {
            equipTo = select.value as EquipmentSlot;
            draw();
          },
          { signal: drawSignal },
        );
        actions.push(html`<label class="equip-destination">Equip to${select}</label>`);
      }
      const control = button(
        'Equip',
        'equip',
        () =>
          report(() => {
            app.changeInventory({
              kind: 'equip',
              item: id,
              slot: targetSlot,
              entry: selected?.kind === 'pack' ? selected.id : undefined,
            });
            selected = { kind: 'slot', slot: targetSlot };
            inventoryView = 'kit';
          }, `${item.name} equipped.`),
        working || app.session.equipment[targetSlot] === id,
      );
      control.className = 'primary-action';
      actions.push(control);
    }
    if (selected?.kind === 'pack') {
      const key = selected.id;
      actions.push(button('Move', 'move-item', () => placement?.start(key)));
    }
    if (item.salvage) {
      const control = button('Salvage', 'salvage', () =>
        report(() => app.changeInventory({ kind: 'salvage', item: id }), `${item.name} salvaged.`),
      );
      control.className = 'primary-action';
      actions.push(
        control,
        button('Salvage all', 'salvage-all', () =>
          report(() => app.changeInventory({ kind: 'salvage' }), 'Damaged equipment salvaged.'),
        ),
      );
    }
    const dismiss = button('×', 'dismiss-detail', () => {
      detailVisible = false;
      focusedAction = selected?.kind === 'slot' ? `slot-${selected.slot}` : `item-${selected?.id}`;
      panel
        .querySelector<HTMLButtonElement>(`[data-action="${focusedAction}"]`)
        ?.focus({ preventScroll: true });
      draw();
    });
    dismiss.className = 'detail-close';
    dismiss.setAttribute('aria-label', 'Close item details');
    return html`<section class="inventory-detail" aria-label="Selected item">${dismiss}<div class="item-description" data-scroll="detail"><h3>${item.name}</h3>
      <p class="item-kind">${equippedSlot ? 'Equipped' : packEntry && packEntry.quantity > 1 ? `Count ${packEntry.quantity}` : 'Carried'} · ${item.footprint[0]} × ${item.footprint[1]} cells</p>
      ${item.kind === 'material' && html`<p class="item-effect">Upgrade material</p>`}
      ${slots && (item.maxHealth || (replacedId && items[replacedId]!.maxHealth)) ? html`<p class="item-comparison">Maximum health <strong>${app.sim.maxHealth} → ${projectedHealth} <small>(${projectedHealth - app.sim.maxHealth >= 0 ? '+' : ''}${projectedHealth - app.sim.maxHealth})</small></strong></p>` : false}
      ${id === 'sword' && html`<p class="item-effect">Damage ${damage('sword', app.session.upgrades)}</p>`}
      ${id === 'lantern' && html`<p class="item-effect">Damage ${damage('lantern', app.session.upgrades)} per enemy</p>`}
      ${item.kind === 'potion' && html`<p class="item-effect">Restores 40 health</p>`}
      ${!equippedSlot && replacedId && replacedId !== id && html`<p class="item-replaces">Replaces ${items[replacedId]!.name}</p>`}
      ${item.salvage && html`<div class="salvage-yield" aria-label="Salvage yield">${Object.entries(item.salvage).map(([materialId, amount]) => material(materialId, amount * (app.session.inventory[id] ?? 0)))}</div>`}
      </div><div class="item-actions">${actions}</div></section>`;
  }

  function draw() {
    if (disposed) return;
    if (panel.contains(document.activeElement))
      focusedAction = (document.activeElement as HTMLElement)?.dataset.action ?? focusedAction;
    const scrollTop = panel.querySelector('.adventure-content')?.scrollTop ?? 0;
    const scrolls = new Map(
      [...panel.querySelectorAll<HTMLElement>('[data-scroll]')].map((el) => [
        el.dataset.scroll,
        el.scrollTop,
      ]),
    );
    drawing.abort();
    drawing = new AbortController();
    drawSignal = AbortSignal.any([signal, drawing.signal]);
    const title = showingUpgrades
      ? 'Upgrade kit'
      : fire
        ? app.session.fire(fire).definition.name
        : 'Inventory';
    const content = showingUpgrades ? improvements() : fire ? campfire(fire) : inventory();
    panel.classList.toggle('is-inventory', !showingUpgrades && !fire);
    panel.classList.toggle('is-upgrades', showingUpgrades);
    panel.classList.toggle('is-campfire', !showingUpgrades && !!fire);
    const navigation = button(
      showingUpgrades ? (fire ? 'Back to campfire' : 'Back to inventory') : 'Upgrade kit',
      'upgrade-kit',
      () => {
        placement?.cancel();
        showingUpgrades = !showingUpgrades;
        message = '';
        messageError = false;
        draw();
      },
    );
    navigation.className = 'adventure-navigation';
    const back = button('', 'return', close);
    back.append(artwork('ui-close', 'control-icon'));
    back.setAttribute('aria-label', 'Return to game');
    back.className = 'adventure-close';
    panel.setAttribute('aria-busy', String(working));
    panel.setAttribute('aria-label', title);
    const header = html`<header class="adventure-header"><h2>${title}</h2>${navigation}${back}</header>`;

    panel.replaceChildren(
      header,
      content,
      html`<footer class="adventure-footer${messageError || working ? ' visible' : ''}"><p class="adventure-feedback${messageError ? ' error' : ''}" role="${messageError ? 'alert' : 'status'}">${message || (working ? 'Working…' : !showingUpgrades && !fire ? 'Select to inspect · Drag to arrange · M to move with keys' : '')}</p></footer>`,
    );
    content.scrollTop = scrollTop;
    for (const el of panel.querySelectorAll<HTMLElement>('[data-scroll]'))
      el.scrollTop = scrolls.get(el.dataset.scroll) ?? 0;
    if (panel.open && working) panel.focus({ preventScroll: true });
    else if (panel.open)
      (
        Array.from(panel.querySelectorAll<HTMLElement>('[data-action]')).find(
          (b) => !b.matches(':disabled') && b.dataset.action === focusedAction,
        ) ??
        panel.querySelector<HTMLButtonElement>(
          '.inventory-slot[aria-pressed="true"], .inventory-row[aria-pressed="true"]',
        ) ??
        panel.querySelector<HTMLButtonElement>('[data-action="return"]:not(:disabled)')
      )?.focus({ preventScroll: true });
  }
  function openInventory() {
    open(false);
    if (!disposed && !panel.open && !app.paused) app.canvas.focus();
  }
  function open(interact: boolean) {
    if (disposed || panel.open || app.paused || app.busy || !app.roomReady) return;
    try {
      if (!interact) {
        if (app.sim.inCombat) throw new Error('Finish combat before opening inventory');
        fire = undefined;
      } else {
        const target = app.interact();
        if (!target) return;
        fire = target.kind === 'campfire' ? target.id : undefined;
      }
      showingUpgrades = false;
      choice = undefined;
      selected = undefined;
      equipTo = undefined;
      detailVisible = false;
      inventoryView = 'pack';
      message = '';
      messageError = false;
      focusedAction = 'return';
      app.pause(true);
      root.querySelector<HTMLDialogElement>('#modal')?.close();
      draw();
      panel.showModal();
    } catch (error) {
      deny();
      app.hooks.status((error as Error).message, true);
    }
  }
  root.append(panel);
  panel.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      close();
    },
    { signal: drawSignal },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target as HTMLElement)?.closest?.('input,select,textarea') ||
        (event.target as HTMLElement)?.isContentEditable ||
        (!panel.open &&
          (event.target as Element)?.closest?.('button,a[href],summary,[role=button]') &&
          !(event.code === 'KeyE' && (event.target as Element)?.closest?.('.ground-loot-label')))
      )
        return;
      if (panel.open) {
        if (event.code === 'Escape' && placement?.moving) {
          event.preventDefault();
          event.stopImmediatePropagation();
          placement.cancel();
          message = 'Move cancelled.';
          const feedback = panel.querySelector<HTMLElement>('.adventure-feedback');
          if (feedback) feedback.textContent = message;
          return;
        }
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (['Escape', 'KeyI', 'KeyE', 'KeyQ'].includes(event.code)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!event.repeat && (event.code === 'Escape' || event.code === 'KeyI')) close();
        }
        return;
      }
      if (
        app.paused ||
        app.busy ||
        !app.roomReady ||
        event.repeat ||
        (event.code !== 'KeyI' && event.code !== 'KeyE')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      open(event.code === 'KeyE');
    },
    { capture: true, signal },
  );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    drawing.abort();
    panel.close();
    panel.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return { isOpen: () => panel.open, openInventory };
}
