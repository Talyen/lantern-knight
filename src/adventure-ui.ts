import { html } from './dom';
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
  let forgeDetails = false;
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
  function forge() {
    const owned = app.session.forgeUpgrade;
    const current = kitAttributes(owned);
    if (owned)
      return html`<div class="adventure-content forge-content forge-complete">
        <span class="adventure-eyebrow">Your permanent improvement</span>
        <h3>${forgeChoices[owned].name} complete</h3>
        <p class="forge-result">${owned === 'sword' ? 'A sharper edge for the road ahead.' : 'A brighter flame against the dark.'}</p>
        <dl class="kit-attributes"><div><dt>Edge</dt><dd>${current.edge}%</dd></div><div><dt>Ember</dt><dd>${current.ember}%</dd></div></dl>
        <p>Your permanent kit is strengthened. Kept through rest, death and save/resume.</p>
        <p>This workshop temper has been used. A second purchase is unavailable.</p>
        <p>The northern street leads to Desecrated Chapel. Rest at a campfire before setting out.</p>
      </div>`;
    const affordable = Object.entries(forgeCost).every(
      ([id, amount]) => (app.session.inventory[id] ?? 0) >= amount,
    );
    const costs = Object.entries(forgeCost).map(([id, amount]) => {
      const have = app.session.inventory[id] ?? 0;
      return html`<div class="forge-cost${have < amount ? ' insufficient' : ''}"><dt>${items[id]!.name}</dt><dd>${have} / ${amount}<span>${have < amount ? `Need ${amount - have} more` : 'Ready'}</span></dd></div>`;
    });
    const burnTicks = Math.floor(tuning.ability.burnDuration / tuning.ability.burnCadence);
    const lanternDamage = (ember: number) =>
      scaledDamage(tuning.ability.damage, ember) +
      burnTicks * scaledDamage(tuning.ability.burnDamage, ember);
    const options = (['sword', 'lantern'] as const).map((upgrade) => {
      const next = kitAttributes(upgrade);
      const select = button(
        forgeChoices[upgrade].name,
        `choose-${upgrade}`,
        () => {
          choice = upgrade;
          message = '';
          draw();
          panel
            .querySelector<HTMLButtonElement>('[data-action="confirm-upgrade"]')
            ?.focus({ preventScroll: true });
        },
        working || !affordable,
      );
      select.setAttribute('aria-pressed', String(choice === upgrade));
      return html`<section class="forge-option${choice === upgrade ? ' selected' : ''}">
        <div class="forge-option-heading"><h3>${forgeChoices[upgrade].name}</h3>${choice === upgrade && html`<span class="forge-selection">Selected</span>`}</div>
        <p class="forge-playstyle">${upgrade === 'sword' ? 'Stronger single strikes.' : 'Burn a group over time.'}</p>
        <div class="forge-damage"><span>${upgrade === 'sword' ? 'Sword damage' : 'Total lantern damage'}</span><strong>${upgrade === 'sword' ? `${scaledDamage(tuning.attack.damage, current.edge)} → ${scaledDamage(tuning.attack.damage, next.edge)}` : `${lanternDamage(current.ember)} → ${lanternDamage(next.ember)}`}</strong><span>${upgrade === 'sword' ? 'per strike' : 'per enemy'}</span></div>

        ${select}
      </section>`;
    });
    const details = html<HTMLDetailsElement>`<details class="forge-details"><summary data-action="forge-details">Damage & timing details</summary><div><p>One clean sword hit fells a thrall immediately. One Flare burns the whole group; thralls fall after the full Burn.</p><p>Sword damage ${scaledDamage(tuning.attack.damage, current.edge)} → ${scaledDamage(tuning.attack.damage, 200)}. Attack timing stays the same.</p><p>Total lantern damage ${lanternDamage(current.ember)} → ${lanternDamage(200)} per enemy.</p><p>Initial hit ${scaledDamage(tuning.ability.damage, current.ember)} → ${scaledDamage(tuning.ability.damage, 200)} · Burn ${scaledDamage(tuning.ability.burnDamage, current.ember)} → ${scaledDamage(tuning.ability.burnDamage, 200)} per tick (${burnTicks} ticks over ${tuning.ability.burnDuration / tuning.tickHz}s).</p><p>The ${tuning.ability.cooldown / tuning.tickHz}s cooldown and ${tuning.ability.stun / tuning.tickHz}s stagger stay the same.</p></div></details>`;
    details.open = forgeDetails;
    details.addEventListener(
      'toggle',
      () => {
        if (details.isConnected) forgeDetails = details.open;
      },
      { signal },
    );
    return html`<div class="adventure-content forge-content">
      <div class="forge-intro"><p>One workshop temper. One permanent improvement.</p><span class="section-note">Owned / required</span></div>
      <dl class="forge-costs" aria-label="Upgrade cost · owned / required">${costs}</dl>
      <div class="forge-options">${options}</div>
      ${!affordable && html`<p class="forge-shortfall">Requires 20 Gold, 4 Iron and 1 Workshop Temper. Recover the temper from the guarded forge cache.</p>`}
      ${details}
    </div>`;
  }
  function forgeDecision(bench: string) {
    const selectedChoice = choice;
    if (app.session.forgeUpgrade) return false;
    return html`<section class="forge-decision" aria-label="Confirm permanent improvement"><div><strong>${selectedChoice ? `Confirm ${forgeChoices[selectedChoice].name}?` : 'Sword or lantern?'}</strong><p>${selectedChoice ? 'Spends 20 Gold · 4 Iron · 1 Workshop Temper. This choice cannot be changed.' : 'Compare both improvements, then select one above.'}</p></div>${
      selectedChoice &&
      html`<div class="decision-actions">${button('Back to choices', 'cancel-upgrade', () => {
        choice = undefined;
        message = '';
        messageError = false;
        draw();
        panel
          .querySelector<HTMLButtonElement>(`[data-action="choose-${selectedChoice}"]`)
          ?.focus({ preventScroll: true });
      })}${button('Confirm upgrade', 'confirm-upgrade', () =>
        run(async () => {
          await app.purchaseForgeUpgrade(bench, selectedChoice);
          if (disposed) return;
          choice = undefined;
          message = `${forgeChoices[selectedChoice].name} complete. Your upgrade is permanent.`;
        }),
      )}</div>`
    }</section>`;
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
      <section class="campfire-rest"><span class="adventure-eyebrow">Campfire</span>
        <h3>Take a breath.</h3><p class="campfire-health">${app.sim.hero.health} / ${app.sim.maxHealth} health</p>
        <p>Rest restores health and resets enemies. Collected loot stays yours. Potions do not refill.</p>
        ${button('Rest', 'rest', () =>
          run(async () => {
            await app.rest(key);
            if (disposed) return;
            message = 'Health restored. Your journey continues from this campfire.';
            app.hooks.status('Rested · health restored');
          }),
        )}
      </section>
      <section class="campfire-travel"><h3>Travel</h3><p>Return to a campfire you have discovered.</p>
        ${destinations}${app.session.discovered.size === 1 && html`<p class="adventure-empty">Discover another campfire to unlock more destinations.</p>`}
      </section>
    </div>`;
  }
  function navigateItems(event: KeyboardEvent, columns: number) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const group = event.currentTarget as HTMLElement;
    const controls = [...group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = controls.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? controls.length - 1
          : event.key === 'ArrowRight'
            ? index + 1
            : event.key === 'ArrowLeft'
              ? index - 1
              : event.key === 'ArrowDown'
                ? index + columns
                : event.key === 'ArrowUp'
                  ? index - columns
                  : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const target = controls[Math.max(0, Math.min(controls.length - 1, next))];
    target?.focus();
    target?.click();
  }
  function inventory() {
    const equipment = app.session.equipment;
    const carried = Object.entries(app.session.inventory).flatMap(([id, count]) => {
      const spare = count - equipmentSlots.filter((slot) => equipment[slot] === id).length;
      return spare > 0 && id !== 'gold' ? [{ id, count: spare, item: items[id]! }] : [];
    });
    const groupOrder = (item: (typeof carried)[number]['item']) =>
      item.kind === 'gear' ? 0 : item.salvage ? 2 : 1;
    carried.sort(
      (a, b) => groupOrder(a.item) - groupOrder(b.item) || a.item.name.localeCompare(b.item.name),
    );
    if (!carried.length) inventoryView = 'kit';
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
      control.className = `inventory-slot${id ? ' occupied' : ''}`;
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
      control.append(
        html`<span class="inventory-slot-name">${slotNames[slot]}</span>`,
        html`<strong>${id ? (items[id]!.name === slotNames[slot] ? 'Equipped' : items[id]!.name) : 'Empty slot'}</strong>`,
      );
      return control;
    });
    const groups = (['Equipment', 'Supplies', 'Salvage'] as const).map((group) => {
      const entries = carried.filter(({ item }) =>
        group === 'Equipment'
          ? item.kind === 'gear'
          : group === 'Salvage'
            ? !!item.salvage
            : item.kind !== 'gear' && !item.salvage,
      );
      if (!entries.length) return false;
      return html`<section class="pack-group"><h4>${group}</h4>${entries.map(
        ({ id, count, item }) => {
          const control = button('', `item-${id}`, () => selectItem(id));
          control.className = 'inventory-row';
          control.tabIndex = (
            selected?.kind === 'pack' ? selected.id === id : carried[0]?.id === id
          )
            ? 0
            : -1;
          control.setAttribute(
            'aria-pressed',
            String(selected?.kind === 'pack' && selected.id === id),
          );
          control.append(
            html`<span><strong>${item.name} ×${count}</strong><span class="inventory-item-kind">${item.maxHealth ? `+${item.maxHealth} maximum health` : item.salvage ? 'Convert to materials' : item.kind === 'potion' ? 'Restore 40 health' : item.kind === 'gear' ? 'Equipment' : id === 'workshop-temper' ? 'Permanent forge improvement' : 'Crafting material'}</span></span>`,
            html`<span class="item-arrow" aria-hidden="true">→</span>`,
          );
          return control;
        },
      )}</section>`;
    });
    const attributes = kitAttributes(app.session.forgeUpgrade);
    const tabs = (['kit', 'pack'] as const).map((view) => {
      const control = button(view === 'kit' ? 'Your kit' : 'Your pack', `show-${view}`, () => {
        inventoryView = view;
        draw();
      });
      control.setAttribute('aria-pressed', String(inventoryView === view));
      return control;
    });
    const content = html`<div class="adventure-content inventory-content inventory-view-${inventoryView}">
      <div class="inventory-summary"><span>${app.sim.hero.health} / ${app.sim.maxHealth} health</span><span>${app.session.inventory.gold ?? 0} Gold</span><span>${app.session.inventory['health-potion'] ?? 0} potions</span><span>Edge ${attributes.edge}% · Ember ${attributes.ember}%</span></div>
      <div class="inventory-tabs" role="group" aria-label="Browse inventory">${tabs}</div>
      <div class="inventory-columns">
        <section class="inventory-equipment"><div class="section-heading"><h3>Your kit</h3><span>${equipmentSlots.filter((slot) => equipment[slot]).length} / ${equipmentSlots.length}</span></div><div class="equipment-grid" role="group" aria-label="Equipment slots · use arrow keys to choose">${gear}</div></section>
        <section class="inventory-bag"><div class="section-heading"><h3>Your pack</h3><span>${carried.length} ${carried.length === 1 ? 'stack' : 'stacks'}</span></div><div class="pack-items" data-scroll="pack" role="group" aria-label="Carried items · use arrow keys to choose">${carried.length ? groups : html`<p class="adventure-empty">No spare items yet. Equipment and supplies you collect will appear here.</p>`}</div></section>
        ${inventoryDetail()}
      </div>
    </div>`;
    content
      .querySelector('.equipment-grid')!
      .addEventListener('keydown', (event) => navigateItems(event as KeyboardEvent, 2), { signal });
    content
      .querySelector('.pack-items')!
      .addEventListener('keydown', (event) => navigateItems(event as KeyboardEvent, 1), { signal });
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
      return html`<section class="inventory-detail" aria-label="Selected item"><span class="adventure-eyebrow">${equippedSlot ? slotNames[equippedSlot] : 'Equipment'}</span><h3>Room for something new.</h3><p>Select equipment in your pack to compare it with your kit.</p></section>`;
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
          { signal },
        );
        actions.push(html`<label class="equip-destination">Equip to${select}</label>`);
      }
      const control = button(
        'Equip · ' + slotNames[targetSlot],
        'equip',
        () =>
          report(() => {
            app.changeInventory({ kind: 'equip', item: id, slot: targetSlot });
            selected = { kind: 'slot', slot: targetSlot };
            inventoryView = 'kit';
          }, `${item.name} equipped.`),
        working || app.session.equipment[targetSlot] === id,
      );
      control.className = 'primary-action';
      actions.push(control);
    }
    const allSalvage: Record<string, number> = {};
    if (item.salvage) {
      for (const [ownedId, count] of Object.entries(app.session.inventory))
        for (const [material, amount] of Object.entries(items[ownedId]!.salvage ?? {}))
          allSalvage[material] = (allSalvage[material] ?? 0) + count * amount;
      const control = button('Salvage stack', 'salvage', () =>
        report(() => app.changeInventory({ kind: 'salvage', item: id }), `${item.name} salvaged.`),
      );
      control.className = 'primary-action';
      actions.push(
        control,
        button('Salvage all damaged equipment', 'salvage-all', () =>
          report(() => app.changeInventory({ kind: 'salvage' }), 'All damaged equipment salvaged.'),
        ),
      );
    }
    return html`<section class="inventory-detail" aria-label="Selected item"><div class="item-description" data-scroll="detail"><span class="adventure-eyebrow">${equippedSlot ? `Equipped · ${slotNames[equippedSlot]}` : item.kind === 'gear' ? 'Equipment in your pack' : item.kind === 'salvage' ? 'Salvage only' : 'Supplies'}</span><h3>${item.name}</h3>
      ${slots && html`<div class="equipment-comparison">${item.maxHealth || (replacedId && items[replacedId]!.maxHealth) ? html`<div class="item-comparison"><span>${equippedSlot ? 'Maximum health after unequipping' : 'Maximum health after equipping'}</span><strong>${app.sim.maxHealth} → ${projectedHealth}</strong></div>` : false}<p>${equippedSlot ? 'Returns this item to your pack.' : `Replaces ${replacedId ? items[replacedId]!.name : 'an empty slot'}.`}</p><p class="section-note">${item.maxHealth ? `+${item.maxHealth} maximum health · does not heal on equip.` : id === 'sword' || id === 'lantern' ? 'Forge improvements belong to your permanent kit.' : 'No stat change.'}</p></div>`}
      ${id === 'sword' && html`<div class="item-comparison"><span>Sword damage per strike</span><strong>${scaledDamage(tuning.attack.damage, kitAttributes(app.session.forgeUpgrade).edge)}</strong></div>`}
      ${id === 'lantern' && html`<div><div class="item-comparison"><span>Total lantern damage per enemy</span><strong>${scaledDamage(tuning.ability.damage, kitAttributes(app.session.forgeUpgrade).ember) + Math.floor(tuning.ability.burnDuration / tuning.ability.burnCadence) * scaledDamage(tuning.ability.burnDamage, kitAttributes(app.session.forgeUpgrade).ember)}</strong></div><p>Lantern burst · ${tuning.ability.cooldown / tuning.tickHz}s recharge.</p></div>`}
      ${item.kind === 'potion' && html`<div><div class="item-comparison"><span>Health restored</span><strong>40</strong></div><p>Press Q during play to drink a potion. Rest does not refill your supply.</p></div>`}
      ${item.kind === 'material' && html`<p>${id === 'workshop-temper' ? 'Bring this to the forge workbench for one permanent sword or lantern improvement.' : 'Collected material. Kept in your pack for the road ahead.'}</p>`}
      ${
        item.salvage &&
        html`<div><div class="salvage-yield"><span>Salvage this stack into</span><strong>${Object.entries(
          item.salvage,
        )
          .map(
            ([material, amount]) =>
              `${amount * (app.session.inventory[id] ?? 0)} ${items[material]!.name}`,
          )
          .join(
            ' · ',
          )}</strong></div><p>Damaged equipment cannot be equipped.</p><p class="section-note">All damaged equipment → ${Object.entries(
          allSalvage,
        )
          .map(([material, amount]) => `${amount} ${items[material]!.name}`)
          .join(' · ')}.</p></div>`
      }
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
    const back = button('Return to game', 'return', close);
    back.className = 'adventure-close';
    back.title = 'Return to game · Esc';
    panel.setAttribute('aria-busy', String(working));
    panel.setAttribute('aria-label', title);
    panel.replaceChildren(
      html`<header class="adventure-header"><div><p class="adventure-eyebrow">${fire ? 'A moment of shelter' : workbench ? 'A lasting choice' : 'Ready for the road'}</p><h2>${title}</h2></div>${back}</header>`,
      content,
      ...(workbench
        ? [forgeDecision(workbench)].filter((node): node is HTMLElement => !!node)
        : []),
      html`<footer class="adventure-footer">
        ${message ? html`<p class="adventure-feedback${messageError ? ' error' : ''}" role="${messageError ? 'alert' : 'status'}">${message}</p>` : html`<p>${working ? (workbench ? 'Saving your upgrade…' : 'Preparing your journey…') : 'The world waits while you prepare.'}</p>`}
        ${!working && html`<span class="adventure-key-hint">${!fire && !workbench ? 'Arrows · Select · ' : ''}Esc · Return to game</span>`}
      </footer>`,
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
      forgeDetails = false;
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
