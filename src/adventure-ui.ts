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
  let working = false;
  let message = '';
  function isOpen() {
    return panel?.open ?? false;
  }
  function closeAdventure(app: Application) {
    if (disposed || !panel?.open || working) return;
    panel.close();
    fire = undefined;
    app.pause(false);
    app.canvas.focus();
  }
  function button(label: string, action: () => void) {
    const element = document.createElement('button');
    element.textContent = label;
    element.addEventListener('click', action, { signal });
    element.disabled = working;
    return element;
  }
  function text(tag: string, value: string) {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  }
  function draw(app: Application) {
    if (disposed) return;
    const focused = panel.contains(document.activeElement)
      ? document.activeElement?.textContent
      : undefined;
    panel.replaceChildren();
    const report = (action: () => void) => {
      if (disposed) return;
      try {
        action();
        message = '';
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
        draw(app);
        try {
          await action();
          message = '';
        } catch (error) {
          void app.audio.play('ui-deny', { world: false }).catch(() => {});
          message = (error as Error).message;
        } finally {
          working = false;
          draw(app);
        }
      });
    panel.append(text('h2', fire ? app.session.fire(fire).definition.name : 'Inventory'));
    if (fire) {
      const key = fire;
      panel.append(
        text(
          'p',
          'Rest restores health and resets enemies. Collected loot stays yours. Potions do not refill.',
        ),
        button('Rest', () =>
          run(async () => {
            await app.rest(key);
            app.hooks.status('Rested · health restored');
          }),
        ),
      );
      panel.append(text('h3', 'Travel'));
      for (const destination of app.session.discovered) {
        const { area, definition } = app.session.fire(destination);
        const current = destination === key;
        const b = button(
          `${app.registry.area(area).name} · ${definition.name}${current ? ' · Here' : ''}`,
          () =>
            run(async () => {
              await app.travel(destination);
              fire = destination;
            }),
        );
        b.disabled = current || working;
        panel.append(b);
      }
      if (app.session.discovered.size === 1)
        panel.append(text('p', 'Discover another campfire to unlock more destinations.'));
    } else {
      panel.append(
        text(
          'p',
          `${app.session.inventory.gold ?? 0} Gold · ${app.sim.hero.health} / ${app.sim.maxHealth} health`,
        ),
      );
      const columns = document.createElement('div');
      columns.className = 'inventory-columns';
      const gear = document.createElement('section');
      gear.append(text('h3', 'Equipment'));
      for (const slot of equipmentSlots) {
        const id = app.session.equipment[slot];
        const row = document.createElement('div');
        row.className = 'inventory-row';
        row.append(text('span', `${slotNames[slot]}: ${id ? items[id]!.name : 'Empty'}`));
        if (id)
          row.append(
            button('Unequip', () => report(() => app.changeInventory('unequip', undefined, slot))),
          );
        gear.append(row);
      }
      const bag = document.createElement('section');
      bag.append(text('h3', 'Carried items'));
      for (const [id, count] of Object.entries(app.session.inventory)) {
        if (count <= 0 || id === 'gold') continue;
        const item = items[id]!;
        const row = document.createElement('div');
        row.className = 'inventory-row ' + item.kind;
        row.append(text('strong', `${item.name} ×${count}`));
        if (item.maxHealth)
          row.append(text('p', `+${item.maxHealth} maximum health · does not heal on equip`));
        if (item.kind === 'potion')
          row.append(text('p', 'Q · Restore 40 health during play. Rest does not refill potions.'));
        if (item.salvage) {
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
            button('Salvage stack', () => report(() => app.changeInventory('salvage', id))),
          );
        }
        for (const slot of item.slots ?? [])
          row.append(
            button('Equip · ' + slotNames[slot], () =>
              report(() => app.changeInventory('equip', id, slot)),
            ),
          );
        bag.append(row);
      }
      bag.append(
        button('Salvage all damaged equipment', () => report(() => app.changeInventory('salvage'))),
      );
      columns.append(gear, bag);
      panel.append(columns);
    }
    if (message) {
      const feedback = text('p', message);
      feedback.setAttribute('role', 'status');
      panel.append(feedback);
    }
    panel.append(button('Return to game', () => closeAdventure(app)));
    if (panel.open)
      (
        Array.from(panel.querySelectorAll('button')).find(
          (b) => !b.disabled && b.textContent === focused,
        ) ?? panel.querySelector<HTMLButtonElement>('button:not(:disabled)')
      )?.focus();
  }

  panel = document.createElement('dialog');
  panel.className = 'adventure-panel';
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
      try {
        if (event.code === 'KeyI') {
          if (app.sim.inCombat) throw new Error('Finish combat before opening inventory');
          fire = undefined;
        } else {
          fire = app.interact();
          if (!fire) return;
        }
        app.pause(true);
        root.querySelector<HTMLDialogElement>('#modal')?.close();
        draw(app);
        panel!.showModal();
      } catch (error) {
        void app.audio.play('ui-deny', { world: false }).catch(() => {});
        app.hooks.status((error as Error).message, true);
      }
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
  return { isOpen };
}
