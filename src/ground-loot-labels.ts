import { Vector3 } from 'three';
import { items } from './content/items';
import { heightAt } from './content/world';
import type { Application } from './application';

export class GroundLootLabels {
  private labels = new Map<string, { button: HTMLButtonElement; width: number }>();
  private point = new Vector3();
  private generation = -1;
  constructor(
    private root: HTMLElement,
    private app: Application,
    private signal: AbortSignal,
  ) {}
  update(visible: boolean) {
    this.root.hidden = !visible;
    if (!visible) {
      this.app.highlightedDrop = undefined;
      return;
    }
    if (this.generation !== this.app.sim.generation) {
      for (const { button } of this.labels.values()) button.remove();
      this.labels.clear();
      this.app.highlightedDrop = undefined;
      this.generation = this.app.sim.generation;
    }
    const sim = this.app.sim,
      width = this.root.clientWidth,
      height = this.root.clientHeight;
    const live = new Set(sim.drops.map((d) => d.id));
    for (const [id, label] of this.labels)
      if (!live.has(id)) {
        label.button.remove();
        this.labels.delete(id);
        if (this.app.highlightedDrop === id) this.app.highlightedDrop = undefined;
      }
    const occupied: { x: number; y: number; width: number }[] = [];
    for (const drop of [...sim.drops].sort((a, b) => a.id.localeCompare(b.id))) {
      const reward = drop.rewards[0]!;
      let label = this.labels.get(drop.id);
      if (!label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ground-loot-label';
        button.dataset.kind = items[reward.item]!.kind;
        button.dataset.drop = drop.id;
        button.textContent = `${items[reward.item]!.name}${reward.amount > 1 ? ` ×${reward.amount}` : ''}`;
        button.setAttribute('aria-label', `Collect ${button.textContent}`);
        let hovered = false;
        const highlight = () => {
          if (hovered || document.activeElement === button) this.app.highlightedDrop = drop.id;
          else if (this.app.highlightedDrop === drop.id) this.app.highlightedDrop = undefined;
        };
        button.addEventListener(
          'pointerenter',
          () => {
            hovered = true;
            highlight();
          },
          { signal: this.signal },
        );
        button.addEventListener(
          'pointerleave',
          () => {
            hovered = false;
            highlight();
          },
          { signal: this.signal },
        );
        button.addEventListener('focus', highlight, { signal: this.signal });
        button.addEventListener('blur', highlight, { signal: this.signal });
        button.addEventListener(
          'click',
          (event) => {
            event.stopPropagation();
            this.app.safe(async () => this.app.requestPickup(drop.id));
            this.root.parentElement?.querySelector('canvas')?.focus();
          },
          { signal: this.signal },
        );
        this.root.append(button);
        label = { button, width: button.offsetWidth };
        this.labels.set(drop.id, label);
      }
      this.point
        .set(drop.x, heightAt(sim.areaDefinition, drop.x, drop.z) + 0.35, drop.z)
        .project(this.app.presentation.camera);
      const onScreen =
        Math.abs(this.point.x) <= 1 && Math.abs(this.point.y) <= 1 && Math.abs(this.point.z) <= 1;
      label.button.hidden = !onScreen;
      if (!onScreen) continue;
      const x = Math.max(
        label.width / 2 + 5,
        Math.min(width - label.width / 2 - 5, ((this.point.x + 1) * width) / 2),
      );
      let y = Math.max(15, Math.min(height - 15, ((1 - this.point.y) * height) / 2));
      while (
        occupied.some(
          (p) => Math.abs(p.x - x) < (p.width + label.width) / 2 + 6 && Math.abs(p.y - y) < 25,
        )
      )
        y -= 25;
      if (y < 15) {
        y = 15;
        while (
          occupied.some(
            (p) => Math.abs(p.x - x) < (p.width + label.width) / 2 + 6 && Math.abs(p.y - y) < 25,
          )
        )
          y += 25;
      }
      occupied.push({ x, y, width: label.width });
      label.button.style.left = `${x}px`;
      label.button.style.top = `${y}px`;
    }
  }
}
