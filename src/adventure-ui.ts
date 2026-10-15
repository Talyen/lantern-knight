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
  let panel: HTMLDialogElement;
  let fire: string | undefined;
  let workbench: string | undefined;
  let choice: ForgeUpgrade | undefined;
  let working = false;
  let message = '';
  let focusedAction = 'return';
  function isOpen() {
    return panel?.open ?? false;
  }
  function closeAdventure(app: Application) {
    if (disposed || !panel?.open || working) return;
    panel.close();
    fire = undefined;
    workbench = undefined;
    choice = undefined;
    app.pause(false);
    app.canvas.focus();
  }
  function button(label: string, key: string, action: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.dataset.action = key;
    element.addEventListener('click', action, { signal });
    element.disabled = working;
    return element;
  }
  function text(tag: string, value: string, className = '') {
    const el = document.createElement(tag);
    el.textContent = value;
    el.className = className;
    return el;
  }
  function draw(app: Application) {
    if (disposed) return;
    if (panel.contains(document.activeElement))
      focusedAction = (document.activeElement as HTMLElement)?.dataset.action ?? focusedAction;
    const scrollTop = panel.querySelector('.adventure-content')?.scrollTop ?? 0;
    panel.replaceChildren();
    panel.setAttribute('aria-busy', String(working));
    const report = (action: () => void, confirmation: string) => {
      if (disposed || working) return;
      try {
        action();
        message = confirmation;
        draw(app);
      } catch (error) {
        void app.audio.play('ui-deny', { world: false }).catch(() => {});
        message = (error as Error).message;
        draw(app);
      }
    };
    const run = (action: () => Promise<void>) =>
      app.safe(async () => {
        if (disposed || working) return;
        working = true;
        message = '';
        draw(app);
        try {
          await action();
        } catch (error) {
          if (disposed) return;
          void app.audio.play('ui-deny', { world: false }).catch(() => {});
          message = workbench
            ? `${(error as Error).message}. Nothing was spent. Try again.`
            : (error as Error).message;
        } finally {
          working = false;
          draw(app);
        }
      });
    const title = fire
      ? app.session.fire(fire).definition.name
      : workbench
        ? 'Forge workbench'
        : 'Inventory';
    panel.setAttribute('aria-label', title);
    const header = document.createElement('header');
    header.className = 'adventure-header';
    const heading = document.createElement('div');
    heading.append(
      text(
        'p',
        fire ? 'A moment of shelter' : workbench ? 'A lasting choice' : 'Ready for the road',
        'adventure-eyebrow',
      ),
      text('h2', title),
    );
    const close = button('Return to game', 'return', () => closeAdventure(app));
    close.className = 'adventure-close';
    close.title = 'Return to game · Esc';
    header.append(heading, close);
    const content = document.createElement('div');
    content.className = 'adventure-content';
    panel.append(header, content);
    if (workbench) {
      const bench = workbench;
      const owned = app.session.forgeUpgrade;
      const current = kitAttributes(owned);
      content.classList.add('forge-content');
      const summary = document.createElement('div');
      summary.className = 'inventory-summary';
      for (const [item, amount] of Object.entries(forgeCost))
        summary.append(
          text(
            'span',
            `${app.session.inventory[item] ?? 0} ${items[item]!.name}${owned ? '' : ` · need ${amount}`}`,
          ),
        );
      content.append(summary);
      if (owned) {
        content.append(
          text('h3', forgeChoices[owned].name + ' complete'),
          text('p', 'Your permanent kit is strengthened. This workshop temper has been used.'),
          text('p', `Edge ${current.edge}% · Ember ${current.ember}%`, 'forge-result'),
          text('p', 'Kept through rest, death and save/resume. A second purchase is unavailable.'),
        );
      } else {
        content.append(
          text(
            'p',
            'One workshop temper. One permanent improvement. Choose your sword or lantern.',
          ),
        );
        const options = document.createElement('div');
        options.className = 'forge-options';
        for (const upgrade of ['sword', 'lantern'] as const) {
          if (choice && choice !== upgrade) continue;
          const next = kitAttributes(upgrade);
          const option = document.createElement('section');
          option.className = 'forge-option';
          option.append(
            text('span', `${forgeChoices[upgrade].attribute} 100% → 115%`, 'adventure-eyebrow'),
            text('h3', forgeChoices[upgrade].name),
            text(
              'p',
              upgrade === 'sword'
                ? `Sword damage ${scaledDamage(tuning.attack.damage, current.edge)} → ${scaledDamage(tuning.attack.damage, next.edge)}`
                : `Lantern hit ${scaledDamage(tuning.ability.damage, current.ember)} → ${scaledDamage(tuning.ability.damage, next.ember)} · Burn ${scaledDamage(tuning.ability.burnDamage, current.ember)} → ${scaledDamage(tuning.ability.burnDamage, next.ember)} per tick (3 ticks)`,
              'forge-result',
            ),
            text(
              'p',
              upgrade === 'sword'
                ? 'Lantern damage stays the same.'
                : 'Sword damage stays the same.',
            ),
            text('p', 'Cost: 20 Gold · 4 Iron · 1 Workshop Temper'),
          );
          if (!choice) {
            const select = button(forgeChoices[upgrade].name, `choose-${upgrade}`, () => {
              choice = upgrade;
              draw(app);
              panel.querySelector<HTMLButtonElement>('[data-action="confirm-upgrade"]')?.focus();
            });
            select.disabled =
              working ||
              Object.entries(forgeCost).some(
                ([id, amount]) => (app.session.inventory[id] ?? 0) < amount,
              );
            option.append(select);
          }
          options.append(option);
        }
        content.append(options);
        if (choice) {
          const selected = choice;
          content.append(
            text('h3', `Confirm ${forgeChoices[selected].name}?`),
            text('p', 'This uses your only workshop temper. The choice cannot be changed.'),
            button('Confirm upgrade', 'confirm-upgrade', () =>
              run(async () => {
                await app.purchaseForgeUpgrade(bench, selected);
                if (disposed) return;
                choice = undefined;
                message = `${forgeChoices[selected].name} complete. Your upgrade is permanent.`;
              }),
            ),
            button('Back to choices', 'cancel-upgrade', () => {
              choice = undefined;
              draw(app);
              panel.querySelector<HTMLButtonElement>(`[data-action="choose-${selected}"]`)?.focus();
            }),
          );
        } else if (
          Object.entries(forgeCost).some(
            ([id, amount]) => (app.session.inventory[id] ?? 0) < amount,
          )
        ) {
          content.append(
            text(
              'p',
              'Requires 20 Gold, 4 Iron and 1 Workshop Temper. Recover the temper from the guarded forge cache.',
              'adventure-empty',
            ),
          );
        }
      }
    } else if (fire) {
      const key = fire;
      content.classList.add('campfire-content');
      const rest = document.createElement('section');
      rest.className = 'campfire-rest';
      rest.append(
        text('span', 'Campfire', 'adventure-eyebrow'),
        text('h3', 'Take a breath.'),
        text('p', `${app.sim.hero.health} / ${app.sim.maxHealth} health`, 'campfire-health'),
        text(
          'p',
          'Rest restores health and resets enemies. Collected loot stays yours. Potions do not refill.',
        ),
        button('Rest', 'rest', () =>
          run(async () => {
            await app.rest(key);
            if (disposed) return;
            message = 'Health restored. Your journey continues from this campfire.';
            app.hooks.status('Rested · health restored');
          }),
        ),
      );
      const travel = document.createElement('section');
      travel.className = 'campfire-travel';
      travel.append(text('h3', 'Travel'), text('p', 'Return to a campfire you have discovered.'));
      for (const destination of app.session.discovered) {
        const { area, definition } = app.session.fire(destination);
        const current = destination === key;
        const b = button(
          `${app.registry.area(area).name} · ${definition.name}${current ? ' · Here' : ''}`,
          `travel-${destination}`,
          () =>
            run(async () => {
              await app.travel(destination);
              if (disposed) return;
              fire = destination;
              message = `Arrived at ${definition.name}.`;
            }),
        );
        b.disabled = current || working;
        b.className = 'campfire-destination';
        if (current) b.classList.add('current');
        travel.append(b);
      }
      if (app.session.discovered.size === 1)
        travel.append(
          text('p', 'Discover another campfire to unlock more destinations.', 'adventure-empty'),
        );
      content.append(rest, travel);
    } else {
      const summary = document.createElement('div');
      summary.className = 'inventory-summary';
      summary.append(
        text('span', `${app.session.inventory.gold ?? 0} Gold`),
        text('span', `${app.sim.hero.health} / ${app.sim.maxHealth} health`),
        text('span', `${app.session.inventory['health-potion'] ?? 0} potions`),
      );
      const columns = document.createElement('div');
      columns.className = 'inventory-columns';
      const gear = document.createElement('section');
      gear.className = 'inventory-equipment';
      gear.append(
        text('h3', 'Equipment'),
        text('p', 'What you take into the dark.', 'section-note'),
      );
      for (const slot of equipmentSlots) {
        const id = app.session.equipment[slot];
        const row = document.createElement('div');
        row.className = `inventory-slot${id ? ' occupied' : ''}`;
        const details = document.createElement('div');
        details.append(
          text('span', slotNames[slot], 'inventory-slot-name'),
          text('strong', id ? items[id]!.name : 'Empty slot'),
        );
        row.append(details);
        if (id)
          row.append(
            button('Unequip', `unequip-${slot}`, () =>
              report(
                () => app.changeInventory('unequip', undefined, slot),
                `${items[id]!.name} unequipped.`,
              ),
            ),
          );
        gear.append(row);
      }
      const bag = document.createElement('section');
      bag.className = 'inventory-bag';
      bag.append(
        text('h3', 'Carried items'),
        text('p', 'Equipment, supplies, and things worth keeping.', 'section-note'),
      );
      let itemCount = 0;
      let damaged = false;
      for (const [id, count] of Object.entries(app.session.inventory)) {
        if (count <= 0 || id === 'gold') continue;
        const item = items[id]!;
        const equipped = equipmentSlots.filter((slot) => app.session.equipment[slot] === id);
        const carried = count - equipped.length;
        if (carried === 0) continue;
        itemCount++;
        const row = document.createElement('div');
        row.className = 'inventory-row ' + item.kind;
        row.append(
          text('span', item.kind === 'gear' ? 'Equipment' : item.kind, 'inventory-item-kind'),
          text('strong', `${item.name} ×${carried}`),
        );
        if (equipped.length)
          row.append(text('p', `Equipped · ${equipped.map((slot) => slotNames[slot]).join(', ')}`));
        if (item.maxHealth)
          row.append(text('p', `+${item.maxHealth} maximum health · does not heal on equip`));
        if (item.kind === 'potion')
          row.append(text('p', 'Q · Restore 40 health during play. Rest does not refill potions.'));
        if (item.kind === 'material')
          row.append(
            text(
              'p',
              id === 'workshop-temper'
                ? 'One permanent sword or lantern improvement at the forge workbench.'
                : 'Collected material. Kept in your pack.',
            ),
          );
        if (item.salvage) {
          damaged = true;
          row.append(
            text(
              'p',
              'Salvage only → ' +
                Object.entries(item.salvage)
                  .map(([material, amount]) => `${amount * count} ${items[material]!.name}`)
                  .join(', '),
            ),
          );
          row.append(
            button('Salvage stack', `salvage-${id}`, () =>
              report(() => app.changeInventory('salvage', id), `${item.name} salvaged.`),
            ),
          );
        }
        for (const slot of item.slots ?? []) {
          const equip = button('Equip · ' + slotNames[slot], `equip-${id}-${slot}`, () =>
            report(() => app.changeInventory('equip', id, slot), `${item.name} equipped.`),
          );
          equip.disabled = working || equipped.length >= count || equipped.includes(slot);
          if (equipped.includes(slot)) equip.title = 'Already equipped in this slot';
          else if (equipped.length >= count) equip.title = 'Unequip a copy before moving it here';
          row.append(equip);
        }
        bag.append(row);
      }
      if (!itemCount)
        bag.append(
          text(
            'p',
            'No spare equipment or supplies. Explore and collect loot to fill your pack.',
            'adventure-empty',
          ),
        );
      if (damaged)
        bag.append(
          button('Salvage all damaged equipment', 'salvage-all', () =>
            report(() => app.changeInventory('salvage'), 'All damaged equipment salvaged.'),
          ),
        );
      const attributes = kitAttributes(app.session.forgeUpgrade);
      summary.append(
        text(
          'span',
          `Vitality ${app.sim.maxHealth} · Edge ${attributes.edge}% · Ember ${attributes.ember}%`,
        ),
      );
      columns.append(gear, bag);
      content.append(summary, columns);
    }
    const footer = document.createElement('footer');
    footer.className = 'adventure-footer';
    if (message) {
      const feedback = text('p', message, 'adventure-feedback');
      feedback.setAttribute('role', 'status');
      footer.append(feedback);
    } else {
      footer.append(
        text(
          'p',
          working
            ? workbench
              ? 'Saving your upgrade…'
              : 'Preparing your journey…'
            : 'The world waits while you prepare.',
        ),
      );
    }
    if (!working) footer.append(text('span', 'Esc · Return to game', 'adventure-key-hint'));
    panel.append(footer);
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
        fire = undefined;
        workbench = undefined;
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
      draw(app);
      panel.showModal();
    } catch (error) {
      void app.audio.play('ui-deny', { world: false }).catch(() => {});
      app.hooks.status((error as Error).message, true);
    }
  }

  panel = document.createElement('dialog');
  panel.className = 'adventure-panel';
  panel.tabIndex = -1;
  panel.setAttribute('aria-label', 'Inventory and campfire');
  root.append(panel);
  panel.addEventListener(
    'cancel',
    (e) => {
      e.preventDefault();
      closeAdventure(app);
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
      if (panel?.open) {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (['Escape', 'KeyI', 'KeyE', 'KeyQ'].includes(event.code)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!event.repeat && (event.code === 'Escape' || event.code === 'KeyI'))
            closeAdventure(app);
        }
        return;
      }
      if (app.paused || app.busy || !app.roomReady || event.repeat) return;
      if (event.code !== 'KeyI' && event.code !== 'KeyE') return;
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
  return { isOpen, openInventory };
}
