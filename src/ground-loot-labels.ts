import { html } from './dom';
import { Vector3 } from 'three';
import { items } from './content/items';
import { heightAt } from './content/world';
import type { Application } from './application';

export class GroundLootLabels {
  private labels = new Map<string, { button: HTMLButtonElement; width: number }>();
  private point = new Vector3();
  private generation = -1;
  private hovered?: string;
  private focused?: string;
  private highlight() {
    const visible = (id: string | undefined) => {
      const button = id && this.labels.get(id)?.button;
      return button && !button.hidden && !this.root.hidden ? id : undefined;
    };
    this.app.highlightedDrop = visible(this.focused) ?? visible(this.hovered);
  }
  constructor(
    private root: HTMLElement,
    private app: Application,
    private signal: AbortSignal,
  ) {}
  update(visible: boolean) {
    this.root.hidden = !visible;
    if (!visible) {
      this.hovered = this.focused = undefined;
      this.app.highlightedDrop = undefined;
      return;
    }
    if (this.generation !== this.app.sim.generation) {
      for (const { button } of this.labels.values()) button.remove();
      this.labels.clear();
      this.hovered = this.focused = undefined;
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
        if (this.hovered === id) this.hovered = undefined;
        if (this.focused === id) this.focused = undefined;
        if (this.app.highlightedDrop === id) this.app.highlightedDrop = undefined;
      }
    const occupied: { x: number; y: number; width: number }[] = [];
    for (const drop of [...sim.drops].sort((a, b) => a.id.localeCompare(b.id))) {
      const reward = drop.rewards[0]!;
      let label = this.labels.get(drop.id);
      if (!label) {
        const name = `${items[reward.item]!.name}${reward.amount > 1 ? ` ×${reward.amount}` : ''}`;
        const button = html<HTMLButtonElement>`<button type="button" class="ground-loot-label" data-kind="${items[reward.item]!.kind}" data-drop="${drop.id}" aria-label="Collect ${name}">${name}</button>`;
        button.addEventListener(
          'pointerenter',
          () => {
            this.hovered = drop.id;
            this.highlight();
          },
          { signal: this.signal },
        );
        button.addEventListener(
          'pointerleave',
          () => {
            if (this.hovered === drop.id) this.hovered = undefined;
            this.highlight();
          },
          { signal: this.signal },
        );
        button.addEventListener(
          'focus',
          () => {
            this.focused = drop.id;
            this.highlight();
          },
          { signal: this.signal },
        );
        button.addEventListener(
          'blur',
          () => {
            if (this.focused === drop.id) this.focused = undefined;
            this.highlight();
          },
          { signal: this.signal },
        );
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
      if (!onScreen) {
        if (this.app.highlightedDrop === drop.id) this.app.highlightedDrop = undefined;
        continue;
      }
      const clampX = (x: number) =>
        Math.max(label.width / 2 + 5, Math.min(width - label.width / 2 - 5, x));
      const clampY = (y: number) => Math.max(15, Math.min(height - 15, y));
      const anchorX = clampX(((this.point.x + 1) * width) / 2),
        anchorY = clampY(((1 - this.point.y) * height) / 2);
      const columns = [anchorX],
        rows = [anchorY];
      for (let offset = label.width + 6; offset < width + label.width; offset += label.width + 6)
        columns.push(clampX(anchorX - offset), clampX(anchorX + offset));
      for (let offset = 25; offset < height + 25; offset += 25)
        rows.push(clampY(anchorY - offset), clampY(anchorY + offset));
      let x = anchorX,
        y = anchorY;
      // Exhaust the visible rows before moving sideways. A crowded stack must
      // use spare columns rather than push its buttons below the clipped layer.
      search: for (const column of columns)
        for (const row of rows)
          if (
            !occupied.some(
              (p) =>
                Math.abs(p.x - column) < (p.width + label.width) / 2 + 6 &&
                Math.abs(p.y - row) < 25,
            )
          ) {
            x = column;
            y = row;
            break search;
          }
      occupied.push({ x, y, width: label.width });
      label.button.style.left = `${x}px`;
      label.button.style.top = `${y}px`;
    }
    this.highlight();
  }
}
