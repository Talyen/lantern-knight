import { html } from './dom';
import { createItemArtwork } from './item-art';
import { forgeArtwork, forgeAnvilArtwork, interfaceFrameArtwork } from './content/item-art';
import {
  forgeChoices,
  forgeCost,
  kitAttributes,
  scaledDamage,
  type ForgeUpgrade,
} from './content/progression';
import { tuning } from './content/gameplay';
import type { Application } from './application';
import { equipmentSlots, items, type EquipmentSlot } from './content/items';
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
  const panel = html<HTMLDialogElement>`<dialog class="adventure-panel" tabindex="-1" aria-label="Inventory and campfire"></dialog>`;
  let fire: string | undefined;
  let workbench: string | undefined;
  let choice: ForgeUpgrade | undefined;
  let working = false;
  let message = '';
  let messageError = false;
  let selected: { kind: 'pack'; id: string } | { kind: 'slot'; slot: EquipmentSlot } | undefined;
  let equipTo: EquipmentSlot | undefined;
  let inventoryView: 'kit' | 'pack' = 'pack';
  const artwork = createItemArtwork(app.runtime, signal);
  let focusedAction = 'return';
  const deny = () => void app.audio.play('ui-deny', { world: false }).catch(() => {});
  function close() {
    if (disposed || !panel.open || working) return;
    panel.close();
    fire = workbench = choice = undefined;
    app.pause(false);
    app.canvas.focus();
  }
  function button(label: string, key: string, action: () => void, disabled = working) {
    const element = html<HTMLButtonElement>`<button type="button" data-action="${key}">${label}</button>`;
    element.addEventListener('click', action, { signal });
    element.disabled = disabled;
    if (key === 'confirm-upgrade') element.className = 'primary-action';
    if (key === 'rest') element.title = 'Restore health and reset enemies';
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
        message = workbench
          ? `${(error as Error).message}. Nothing was spent. Try again.`
          : (error as Error).message;
      } finally {
        working = false;
        draw();
      }
    });
  }
  function damage(upgrade: ForgeUpgrade, improved: boolean) {
    const attributes = kitAttributes(improved ? upgrade : undefined);
    return upgrade === 'sword'
      ? scaledDamage(tuning.attack.damage, attributes.edge)
      : scaledDamage(tuning.ability.damage, attributes.ember) +
          Math.floor(tuning.ability.burnDuration / tuning.ability.burnCadence) *
            scaledDamage(tuning.ability.burnDamage, attributes.ember);
  }
  function material(id: string, amount: number, insufficient = false) {
    return html`<span class="material-cost${insufficient ? ' insufficient' : ''}" title="${items[id]!.name}" aria-label="${amount} ${items[id]!.name}${insufficient ? ' · insufficient' : ''}">${artwork(id)}<span>${amount}</span></span>`;
  }
  function forge() {
    const owned = app.session.forgeUpgrade;
    const active = owned ?? choice ?? 'sword';
    const affordable = Object.entries(forgeCost).every(
      ([id, amount]) => (app.session.inventory[id] ?? 0) >= amount,
    );
    const options = (['sword', 'lantern'] as const).map((upgrade) => {
      const select = button(
        '',
        `choose-${upgrade}`,
        () => {
          choice = upgrade;
          message = '';
          messageError = false;
          draw();
          panel
            .querySelector<HTMLButtonElement>('[data-action="confirm-upgrade"]')
            ?.focus({ preventScroll: true });
        },
        working || !!owned,
      );
      select.className = 'forge-option';
      select.setAttribute('aria-label', forgeChoices[upgrade].name);
      select.setAttribute('aria-pressed', String(active === upgrade));
      select.append(artwork(upgrade));
      return select;
    });
    const confirm = button(
      owned ? 'Complete' : working ? 'Saving…' : active === 'sword' ? 'Temper' : 'Rekindle',
      'confirm-upgrade',
      () => {
        if (!workbench || owned) return;
        const bench = workbench;
        const upgrade = active;
        run(async () => {
          await app.purchaseForgeUpgrade(bench, upgrade);
          if (disposed) return;
          choice = undefined;
          message = `${forgeChoices[upgrade].name} complete.`;
        });
      },
      working || !affordable || !!owned,
    );
    confirm.setAttribute('aria-label', 'Confirm upgrade');
    return html`<div class="adventure-content forge-content">
      <div class="forge-illustration" aria-hidden="true">${artwork(forgeArtwork, 'forge-scene')}${artwork(forgeAnvilArtwork, 'forge-anvil')}${artwork(active, 'forge-featured-item')}</div>
      <section class="forge-work" aria-label="Forge improvement">
        <div class="forge-options" role="group" aria-label="Choose an improvement">${owned ? artwork(owned) : options}</div>
        <h3>${forgeChoices[active].name}</h3>
        <p class="forge-damage">${active === 'sword' ? 'Damage' : 'Damage per enemy'} <strong>${owned ? damage(active, true) : `${damage(active, false)} → ${damage(active, true)}`}</strong></p>
        ${!owned && html`<div class="forge-costs" aria-label="Upgrade cost">${Object.entries(forgeCost).map(([id, amount]) => material(id, amount, (app.session.inventory[id] ?? 0) < amount))}</div>`}
        <div class="forge-decision">${confirm}${!owned && html`<span class="permanent-choice">Permanent</span>`}</div>
      </section>
    </div>`;
  }
  function campfire(key: string) {
    const destinations = [...app.session.discovered].map((destination) => {
      const { area, definition } = app.session.fire(destination);
      const current = destination === key;
      const travel = button(
        `${app.registry.area(area).name} · ${definition.name}${current ? ' · Here' : ''}`,
        `travel-${destination}`,
        () =>
          run(async () => {
            await app.travel(destination);
            if (disposed) return;
            fire = destination;
            message = `Arrived at ${definition.name}.`;
          }),
        current || working,
      );
      travel.className = `campfire-destination${current ? ' current' : ''}`;
      return travel;
    });
    return html`<div class="adventure-content campfire-content">
      <section class="campfire-rest"><h3>Rest</h3><p class="campfire-health">${app.sim.hero.health} / ${app.sim.maxHealth} health</p>

        ${button('Rest', 'rest', () =>
          run(async () => {
            await app.rest(key);
            if (disposed) return;
            message = 'Health restored. Your journey continues from this campfire.';
            app.hooks.status('Rested · health restored');
          }),
        )}
      </section>
      <section class="campfire-travel"><h3>Travel</h3>
        ${destinations}
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
        const across = Math.abs(horizontal ? dy : dx);
        const score = along + across * 2;
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
    const carried = Object.entries(app.session.inventory).flatMap(([id, count]) => {
      const spare = count - equipmentSlots.filter((slot) => equipment[slot] === id).length;
      return spare > 0 && id !== 'gold' ? [{ id, count: spare, item: items[id]! }] : [];
    });
    const order = { gear: 0, potion: 1, currency: 2, material: 2, salvage: 3 };
    carried.sort(
      (a, b) => order[a.item.kind] - order[b.item.kind] || a.item.name.localeCompare(b.item.name),
    );
    const selectedId = selected?.kind === 'pack' ? selected.id : undefined;
    if (selectedId && !carried.some((entry) => entry.id === selectedId)) selected = undefined;
    const firstGear = carried.find((entry) => entry.item.kind === 'gear');
    selected ??= firstGear ? { kind: 'pack', id: firstGear.id } : { kind: 'slot', slot: 'sword' };
    const selectItem = (id: string) => {
      selected = { kind: 'pack', id };
      inventoryView = 'pack';
      const slots = items[id]!.slots;
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
        selected = { kind: 'slot', slot };
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
      control.title = `${slotNames[slot]} · ${id ? items[id]!.name : 'Empty slot'}`;
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
    const bag = carried.map(({ id, count, item }) => {
      const control = button('', `item-${id}`, () => selectItem(id));
      control.className = 'inventory-row';
      control.tabIndex = (selected?.kind === 'pack' ? selected.id === id : carried[0]?.id === id)
        ? 0
        : -1;
      control.title = `${item.name} ×${count}`;
      control.setAttribute('aria-label', `${item.name} ×${count}`);
      control.setAttribute('aria-pressed', String(selected?.kind === 'pack' && selected.id === id));
      control.append(
        artwork(id),
        html`<span class="visually-hidden">${item.name} ×${count}</span>`,
      );
      if (count > 1) control.append(html`<span class="item-count">${count}</span>`);
      return control;
    });
    const empty = Array.from(
      { length: Math.max(0, 18 - bag.length) },
      () => html`<span class="bag-empty" aria-hidden="true"></span>`,
    );
    const tabs = (['kit', 'pack'] as const).map((view) => {
      const control = button(view === 'kit' ? 'Your kit' : 'Your pack', `show-${view}`, () => {
        inventoryView = view;
        draw();
      });
      control.setAttribute('aria-pressed', String(inventoryView === view));
      return control;
    });
    const content = html`<div class="adventure-content inventory-content inventory-view-${inventoryView}">
      <div class="inventory-tabs" role="group" aria-label="Browse inventory">${tabs}</div>
      <div class="inventory-columns">
        <section class="inventory-equipment" aria-label="Equipment"><div class="equipment-grid" role="group" aria-label="Equipment slots">${gear}</div></section>
        <section class="inventory-bag" aria-label="Carried items"><div class="pack-items" data-scroll="pack" role="group" aria-label="Carried items">${bag}${empty}</div><div class="inventory-gold">${material('gold', app.session.inventory.gold ?? 0)}</div></section>${inventoryDetail()}
      </div>
    </div>`;
    content
      .querySelector('.equipment-grid')!
      .addEventListener('keydown', (event) => navigateItems(event as KeyboardEvent), { signal });
    content
      .querySelector('.pack-items')!
      .addEventListener('keydown', (event) => navigateItems(event as KeyboardEvent), { signal });
    return content;
  }
  function inventoryDetail() {
    const equippedSlot = selected?.kind === 'slot' ? selected.slot : undefined;
    const id =
      selected?.kind === 'pack'
        ? selected.id
        : equippedSlot
          ? app.session.equipment[equippedSlot]
          : undefined;
    if (!id)
      return html`<section class="inventory-detail empty-detail" aria-label="Selected item"></section>`;
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
          () => app.changeInventory('unequip', undefined, equippedSlot),
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
          { signal },
        );
        actions.push(html`<label class="equip-destination">Equip to${select}</label>`);
      }
      const control = button(
        'Equip',
        'equip',
        () =>
          report(() => {
            app.changeInventory('equip', id, targetSlot);
            selected = { kind: 'slot', slot: targetSlot };
            inventoryView = 'kit';
          }, `${item.name} equipped.`),
        working || app.session.equipment[targetSlot] === id,
      );
      control.className = 'primary-action';
      actions.push(control);
    }
    if (item.salvage) {
      const control = button('Salvage', 'salvage', () =>
        report(() => app.changeInventory('salvage', id), `${item.name} salvaged.`),
      );
      control.className = 'primary-action';
      actions.push(
        control,
        button('Salvage all', 'salvage-all', () =>
          report(() => app.changeInventory('salvage'), 'Damaged equipment salvaged.'),
        ),
      );
    }
    return html`<section class="inventory-detail" aria-label="Selected item"><div class="item-description" data-scroll="detail"><h3>${item.name}</h3>
      ${slots && (item.maxHealth || (replacedId && items[replacedId]!.maxHealth)) ? html`<p class="item-comparison">Health <strong>${app.sim.maxHealth} → ${projectedHealth}</strong></p>` : false}
      ${id === 'sword' && html`<p class="item-effect">Damage ${damage('sword', app.session.forgeUpgrade === 'sword')}</p>`}
      ${id === 'lantern' && html`<p class="item-effect">Damage ${damage('lantern', app.session.forgeUpgrade === 'lantern')} per enemy</p>`}
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
    const title = fire
      ? app.session.fire(fire).definition.name
      : workbench
        ? 'Forge workbench'
        : 'Inventory';
    const content = workbench ? forge() : fire ? campfire(fire) : inventory();
    panel.classList.toggle('is-inventory', !workbench && !fire);
    panel.classList.toggle('is-forge', !!workbench);
    const back = button('×', 'return', close);
    back.setAttribute('aria-label', 'Return to game');
    back.className = 'adventure-close';
    back.title = 'Return to game · Esc';
    panel.setAttribute('aria-busy', String(working));
    panel.setAttribute('aria-label', title);
    panel.replaceChildren(
      artwork(interfaceFrameArtwork, 'interface-frame'),
      html`<header class="adventure-header"><h2>${workbench ? 'Forge' : title}</h2>${back}</header>`,
      content,
      html`<footer class="adventure-footer${messageError || working ? ' visible' : ''}"><p class="adventure-feedback${messageError ? ' error' : ''}" role="${messageError ? 'alert' : 'status'}">${message || (working ? 'Saving…' : '')}</p></footer>`,
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
        fire = workbench = undefined;
      } else {
        const target = app.interact();
        if (!target) return;
        fire = target.kind === 'campfire' ? target.id : undefined;
        workbench = target.kind === 'workbench' ? target.id : undefined;
      }
      choice = undefined;
      selected = undefined;
      equipTo = undefined;
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
    { signal },
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
    panel.close();
    panel.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return { isOpen: () => panel.open, openInventory };
}
