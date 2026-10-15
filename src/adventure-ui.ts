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
  body: 'Body · Leather / Cloth',
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
    return element;
  }
  function report(action: () => void, confirmation: string) {
    if (disposed || working) return;
    try {
      action();
      message = confirmation;
    } catch (error) {
      deny();
      message = (error as Error).message;
    }
    draw();
  }
  function run(action: () => Promise<void>) {
    app.safe(async () => {
      if (disposed || working) return;
      working = true;
      message = '';
      draw();
      try {
        await action();
      } catch (error) {
        if (disposed) return;
        deny();
        message = workbench
          ? `${(error as Error).message}. Nothing was spent. Try again.`
          : (error as Error).message;
      } finally {
        working = false;
        draw();
      }
    });
  }
  function forge(bench: string) {
    const owned = app.session.forgeUpgrade;
    const current = kitAttributes(owned);
    const summary = html`<div class="inventory-summary">${Object.entries(forgeCost).map(
      ([item, amount]) =>
        html`<span>${app.session.inventory[item] ?? 0} ${items[item]!.name}${owned ? '' : ` · need ${amount}`}</span>`,
    )}</div>`;
    if (owned)
      return html`<div class="adventure-content forge-content">${summary}
        <h3>${forgeChoices[owned].name} complete</h3>
        <p>Your permanent kit is strengthened. This workshop temper has been used.</p>
        <p class="forge-result">Edge ${current.edge}% · Ember ${current.ember}%</p>
        <p>Kept through rest, death and save/resume. A second purchase is unavailable.</p>
      </div>`;
    const affordable = Object.entries(forgeCost).every(
      ([id, amount]) => (app.session.inventory[id] ?? 0) >= amount,
    );
    const options = (['sword', 'lantern'] as const)
      .filter((upgrade) => !choice || choice === upgrade)
      .map((upgrade) => {
        const next = kitAttributes(upgrade);
        const select =
          !choice &&
          button(
            forgeChoices[upgrade].name,
            `choose-${upgrade}`,
            () => {
              choice = upgrade;
              draw();
              panel.querySelector<HTMLButtonElement>('[data-action="confirm-upgrade"]')?.focus();
            },
            working || !affordable,
          );
        return html`<section class="forge-option">
          <span class="adventure-eyebrow">${forgeChoices[upgrade].attribute} 100% → 115%</span>
          <h3>${forgeChoices[upgrade].name}</h3>
          <p class="forge-result">${
            upgrade === 'sword'
              ? `Sword damage ${scaledDamage(tuning.attack.damage, current.edge)} → ${scaledDamage(tuning.attack.damage, next.edge)}`
              : `Lantern hit ${scaledDamage(tuning.ability.damage, current.ember)} → ${scaledDamage(tuning.ability.damage, next.ember)} · Burn ${scaledDamage(tuning.ability.burnDamage, current.ember)} → ${scaledDamage(tuning.ability.burnDamage, next.ember)} per tick (3 ticks)`
          }</p>
          <p>${upgrade === 'sword' ? 'Lantern damage stays the same.' : 'Sword damage stays the same.'}</p>
          <p>Cost: 20 Gold · 4 Iron · 1 Workshop Temper</p>${select}
        </section>`;
      });
    const selected = choice;
    return html`<div class="adventure-content forge-content">${summary}
      <p>One workshop temper. One permanent improvement. Choose your sword or lantern.</p>
      <div class="forge-options">${options}</div>
      ${
        selected
          ? html`<section>
        <h3>Confirm ${forgeChoices[selected].name}?</h3>
        <p>This uses your only workshop temper. The choice cannot be changed.</p>
        ${button('Confirm upgrade', 'confirm-upgrade', () =>
          run(async () => {
            await app.purchaseForgeUpgrade(bench, selected);
            if (disposed) return;
            choice = undefined;
            message = `${forgeChoices[selected].name} complete. Your upgrade is permanent.`;
          }),
        )}
        ${button('Back to choices', 'cancel-upgrade', () => {
          choice = undefined;
          draw();
          panel.querySelector<HTMLButtonElement>(`[data-action="choose-${selected}"]`)?.focus();
        })}
      </section>`
          : !affordable &&
            html`<p class="adventure-empty">Requires 20 Gold, 4 Iron and 1 Workshop Temper. Recover the temper from the guarded forge cache.</p>`
      }
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
  function inventory() {
    const gear = equipmentSlots.map((slot) => {
      const id = app.session.equipment[slot];
      return html`<div class="inventory-slot${id ? ' occupied' : ''}">
        <div><span class="inventory-slot-name">${slotNames[slot]}</span><strong>${id ? items[id]!.name : 'Empty slot'}</strong></div>
        ${
          id &&
          button('Unequip', `unequip-${slot}`, () =>
            report(
              () => app.changeInventory('unequip', undefined, slot),
              `${items[id]!.name} unequipped.`,
            ),
          )
        }
      </div>`;
    });
    let damaged = false;
    const bag = Object.entries(app.session.inventory).flatMap(([id, count]) => {
      if (count <= 0 || id === 'gold') return [];
      const item = items[id]!;
      const equipped = equipmentSlots.filter((slot) => app.session.equipment[slot] === id);
      const carried = count - equipped.length;
      if (carried === 0) return [];
      damaged ||= !!item.salvage;
      const actions = (item.slots ?? []).map((slot) => {
        const equip = button(
          'Equip · ' + slotNames[slot],
          `equip-${id}-${slot}`,
          () => report(() => app.changeInventory('equip', id, slot), `${item.name} equipped.`),
          working || equipped.length >= count || equipped.includes(slot),
        );
        if (equipped.includes(slot)) equip.title = 'Already equipped in this slot';
        else if (equipped.length >= count) equip.title = 'Unequip a copy before moving it here';
        return equip;
      });
      return html`<div class="inventory-row ${item.kind}">
        <span class="inventory-item-kind">${item.kind === 'gear' ? 'Equipment' : item.kind}</span><strong>${item.name} ×${carried}</strong>
        ${equipped.length > 0 && html`<p>Equipped · ${equipped.map((slot) => slotNames[slot]).join(', ')}</p>`}
        ${!!item.maxHealth && html`<p>+${item.maxHealth} maximum health · does not heal on equip</p>`}
        ${item.kind === 'potion' && html`<p>Q · Restore 40 health during play. Rest does not refill potions.</p>`}
        ${item.kind === 'material' && html`<p>${id === 'workshop-temper' ? 'One permanent sword or lantern improvement at the forge workbench.' : 'Collected material. Kept in your pack.'}</p>`}
        ${
          item.salvage &&
          html`<section><p>Salvage only → ${Object.entries(item.salvage)
            .map(([material, amount]) => `${amount * count} ${items[material]!.name}`)
            .join(', ')}</p>
          ${button('Salvage stack', `salvage-${id}`, () => report(() => app.changeInventory('salvage', id), `${item.name} salvaged.`))}</section>`
        }
        ${actions}
      </div>`;
    });
    const attributes = kitAttributes(app.session.forgeUpgrade);
    return html`<div class="adventure-content">
      <div class="inventory-summary"><span>${app.session.inventory.gold ?? 0} Gold</span><span>${app.sim.hero.health} / ${app.sim.maxHealth} health</span><span>${app.session.inventory['health-potion'] ?? 0} potions</span>
        <span>Vitality ${app.sim.maxHealth} · Edge ${attributes.edge}% · Ember ${attributes.ember}%</span>
      </div>
      <div class="inventory-columns">
        <section class="inventory-equipment"><h3>Equipment</h3><p class="section-note">What you take into the dark.</p>${gear}</section>
        <section class="inventory-bag"><h3>Carried items</h3><p class="section-note">Equipment, supplies, and things worth keeping.</p>
          ${bag.length ? bag : html`<p class="adventure-empty">No spare equipment or supplies. Explore and collect loot to fill your pack.</p>`}
          ${damaged && button('Salvage all damaged equipment', 'salvage-all', () => report(() => app.changeInventory('salvage'), 'All damaged equipment salvaged.'))}
        </section>
      </div>
    </div>`;
  }
  function draw() {
    if (disposed) return;
    if (panel.contains(document.activeElement))
      focusedAction = (document.activeElement as HTMLElement)?.dataset.action ?? focusedAction;
    const scrollTop = panel.querySelector('.adventure-content')?.scrollTop ?? 0;
    const title = fire
      ? app.session.fire(fire).definition.name
      : workbench
        ? 'Forge workbench'
        : 'Inventory';
    const content = workbench ? forge(workbench) : fire ? campfire(fire) : inventory();
    const back = button('Return to game', 'return', close);
    back.className = 'adventure-close';
    back.title = 'Return to game · Esc';
    panel.setAttribute('aria-busy', String(working));
    panel.setAttribute('aria-label', title);
    panel.replaceChildren(
      html`<header class="adventure-header"><div><p class="adventure-eyebrow">${fire ? 'A moment of shelter' : workbench ? 'A lasting choice' : 'Ready for the road'}</p><h2>${title}</h2></div>${back}</header>`,
      content,
      html`<footer class="adventure-footer">
        ${message ? html`<p class="adventure-feedback" role="status">${message}</p>` : html`<p>${working ? (workbench ? 'Saving your upgrade…' : 'Preparing your journey…') : 'The world waits while you prepare.'}</p>`}
        ${!working && html`<span class="adventure-key-hint">Esc · Return to game</span>`}
      </footer>`,
    );
    content.scrollTop = scrollTop;
    if (panel.open && working) panel.focus({ preventScroll: true });
    else if (panel.open)
      (
        Array.from(panel.querySelectorAll('button')).find(
          (b) => !b.disabled && b.dataset.action === focusedAction,
        ) ?? panel.querySelector<HTMLButtonElement>('[data-action="return"]:not(:disabled)')
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
      message = '';
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
          (event.target as Element)?.closest?.('button,a[href],summary,[role=button]'))
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
