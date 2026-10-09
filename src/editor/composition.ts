import * as T from 'three';
import { EditorHistory, sceneItems } from './model';
import type { EditorView } from './view';
export type CompositionHost = {
  history: () => EditorHistory;
  view: () => EditorView;
  run: (work: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string | undefined) => void;
  thumbnail: (asset: string, clip: string, canvas: HTMLCanvasElement) => Promise<void>;
};
const element = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
export class CompositionTools {
  readonly selection = new Set<string>();
  readonly hidden = new Set<string>();
  readonly locked = new Set<string>();
  private tab: 'object' | 'scene' = 'scene';
  private observers: ResizeObserver[] = [];
  constructor(private host: CompositionHost) {
    for (const tab of ['object', 'scene'] as const)
      element(tab + '-tab').onclick = () => {
        this.tab = tab;
        this.render();
      };
    element('object-search').oninput = () => this.render();
    element('focus-selection').onclick = () => this.focus();
    element('shortcuts').onclick = () => element<HTMLDialogElement>('shortcut-dialog').showModal();
    element('reset-transform').onclick = () =>
      void this.edit(() => {
        this.host.history().change((d) => {
          for (const p of d.objects)
            if (this.selection.has(p.id)) {
              p.scale = 1;
              p.rotation = 0;
            }
        });
      });
    const main = document.querySelector('main')!;
    for (const side of ['palette', 'inspector']) {
      const panel = document.querySelector<HTMLElement>('aside.' + side)!;
      const key = 'lantern-editor-' + side;
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (saved.width) panel.style.width = saved.width;
        panel.classList.toggle('collapsed', !!saved.collapsed);
      } catch {
        /* Layout is disposable. */
      }
      const measure = () => {
        main.style.setProperty(
          '--' + side + '-width',
          panel.classList.contains('collapsed')
            ? '42px'
            : panel.style.width || (side === 'palette' ? '230px' : '280px'),
        );
        try {
          localStorage.setItem(
            key,
            JSON.stringify({
              width: panel.style.width,
              collapsed: panel.classList.contains('collapsed'),
            }),
          );
        } catch {
          /* Layout is disposable. */
        }
      };
      element('collapse-' + side).onclick = () => {
        panel.classList.toggle('collapsed');
        measure();
      };
      const observer = new ResizeObserver(measure);
      observer.observe(panel);
      this.observers.push(observer);
      measure();
    }
    for (const label of document.querySelectorAll<HTMLLabelElement>('#transform label')) {
      const input = label.querySelector<HTMLInputElement>('input[type="number"]');
      if (!input) continue;
      label.title = 'Drag this label to adjust; edit the field for an exact value';
      label.onpointerdown = (e) => {
        if (e.target !== label || input.disabled || input.closest('fieldset')?.disabled) return;
        e.preventDefault();
        label.setPointerCapture(e.pointerId);
        const start = Number(input.value),
          x = e.clientX,
          step = Number(input.step) || 0.1;
        label.onpointermove = (move) => {
          input.value = String(
            Math.round((start + ((move.clientX - x) / 8) * step) * 10000) / 10000,
          );
        };
        const finish = (event: PointerEvent) => {
          label.onpointermove = null;
          label.onpointerup = null;
          label.onpointercancel = null;
          if (label.hasPointerCapture(event.pointerId))
            label.releasePointerCapture(event.pointerId);
          if (event.type === 'pointercancel') input.value = String(start);
          else input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        label.onpointerup = finish;
        label.onpointercancel = finish;
      };
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-handle]')) {
      button.onpointerdown = (e) => {
        if (!this.selection.size) return;
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        const start = e.clientX;
        const finish = (end: PointerEvent) => {
          button.onpointerup = null;
          button.onpointercancel = null;
          button.onpointermove = null;
          if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
          if (end.type === 'pointercancel') return;
          const delta = (end.clientX - start) / 80;
          const field = button.dataset.handle!;
          const value =
            field === 'scale'
              ? Math.max(0.1, 1 + delta)
              : field === 'rotation'
                ? delta
                : this.snap(delta);
          void this.edit(() =>
            this.host.history().transformMany(this.editable(), { [field]: value }),
          ).catch(console.error);
        };
        button.onpointerup = finish;
        button.onpointercancel = finish;
        button.onpointermove = (move) => {
          button.title = 'Drag value: ' + ((move.clientX - start) / 80).toFixed(2);
        };
      };
    }
  }
  dispose() {
    this.observers.forEach((o) => o.disconnect());
  }
  snap(value: number) {
    const spacing = Number(element<HTMLInputElement>('snap-spacing').value);
    return element<HTMLInputElement>('snap').checked && spacing > 0 && Number.isFinite(spacing)
      ? Math.round(value / spacing) * spacing
      : value;
  }
  editable() {
    return [...this.selection].filter((id) => !this.locked.has(id) && !this.hidden.has(id));
  }
  set(id: string | undefined, additive = false) {
    if (!additive) this.selection.clear();
    if (id && !this.hidden.has(id)) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    if (this.selection.size) this.tab = 'object';
    this.host.select([...this.selection].at(-1));
  }
  rectangle(a: { x: number; y: number }, b: { x: number; y: number }, additive: boolean) {
    if (!additive) this.selection.clear();
    for (const item of sceneItems(this.host.history().document)) {
      const p = this.host
        .view()
        .screen(new T.Vector3(item.placement.x, item.placement.y ?? 0, item.placement.z));
      if (
        !this.hidden.has(item.placement.id) &&
        p.x >= Math.min(a.x, b.x) &&
        p.x <= Math.max(a.x, b.x) &&
        p.y >= Math.min(a.y, b.y) &&
        p.y <= Math.max(a.y, b.y)
      )
        this.selection.add(item.placement.id);
    }
    this.tab = this.selection.size ? 'object' : this.tab;
    this.host.select([...this.selection].at(-1));
  }
  async edit(work: () => void) {
    await this.host.run(async () => {
      work();
      await this.host.refresh();
    });
  }
  duplicate() {
    return this.edit(() => {
      const ids = this.host.history().duplicateMany(this.editable());
      this.selection.clear();
      ids.forEach((id) => this.selection.add(id));
      this.host.select(ids.at(-1));
    });
  }
  remove() {
    const selected = this.editable();
    const descendants = this.host.history().descendants(selected);
    const extra = descendants.filter((id) => !selected.includes(id));
    if (extra.length && !confirm(`Delete selection and ${extra.length} attached object(s)?`))
      return;
    return this.edit(() => {
      this.host.history().removeMany(selected);
      this.selection.clear();
      this.host.select(undefined);
    });
  }
  focus() {
    const view = this.host.view(),
      p = view.presentation;
    const items = sceneItems(this.host.history().document).filter((v) =>
      this.selection.has(v.placement.id),
    );
    if (!p || !items.length) return;
    p.center.set(
      items.reduce((v, p) => v + p.placement.x, 0) / items.length,
      1.8,
      items.reduce((v, p) => v + p.placement.z, 0) / items.length,
    );
    view.render();
  }
  render() {
    const items = sceneItems(this.host.history().document);
    for (const id of this.selection)
      if (!items.some((v) => v.placement.id === id)) this.selection.delete(id);
    for (const tab of ['object', 'scene'] as const) {
      element(tab + '-panel').hidden = tab !== this.tab;
      element(tab + '-tab').setAttribute('aria-selected', String(tab === this.tab));
    }
    element('selection-tools').hidden = !this.editable().length;
    if (this.selection.size > 1)
      element('selected-name').textContent =
        `${this.selection.size} objects selected · fields edit the last selected object; handles edit the group`;
    const filter = element<HTMLInputElement>('object-search').value.toLowerCase();
    const list = element('objects');
    list.replaceChildren();
    const depth = (id: string): number => {
      const p = this.host.history().document.objects.find((v) => v.id === id);
      return p?.mount ? 1 + depth(p.mount.to) : 0;
    };
    const ordered = [...items].sort((a, b) => {
      const root = (id: string): string =>
        this.host.history().document.objects.find((v) => v.id === id)?.mount
          ? root(this.host.history().document.objects.find((v) => v.id === id)!.mount!.to)
          : id;
      return (
        root(a.placement.id).localeCompare(root(b.placement.id)) ||
        depth(a.placement.id) - depth(b.placement.id)
      );
    });
    for (const { placement: p, locked } of ordered) {
      if (!`${p.id} ${p.asset} ${p.clip}`.toLowerCase().includes(filter)) continue;
      const row = document.createElement('div');
      row.className = 'object-row';
      row.setAttribute('role', 'listitem');
      row.style.paddingLeft = depth(p.id) * 12 + 'px';
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 56;
      thumbnail.height = 48;
      thumbnail.setAttribute('aria-hidden', 'true');
      const select = document.createElement('button');
      select.className = 'object-select';
      select.textContent = p.id.startsWith('object-')
        ? p.clip.replaceAll('_', ' ') + ' · ' + p.id.slice(-4)
        : p.id;
      select.title = p.asset + '/' + p.clip;
      select.classList.toggle('active', this.selection.has(p.id));
      select.onclick = (e) => this.set(p.id, e.shiftKey);
      row.append(thumbnail, select);
      for (const [label, set] of [
        ['Hide', this.hidden],
        ['Lock', this.locked],
      ] as const) {
        const button = document.createElement('button');
        button.textContent = set.has(p.id) ? (label === 'Hide' ? 'Show' : 'Unlock') : label;
        button.setAttribute('aria-label', button.textContent + ' ' + p.id);
        button.disabled = locked && label === 'Lock';
        button.onclick = () => {
          if (set.has(p.id)) set.delete(p.id);
          else set.add(p.id);
          this.render();
        };
        row.append(button);
      }
      list.append(row);
      void this.host.thumbnail(p.asset, p.clip, thumbnail).catch(() => {});
    }
    this.host.view()?.setEditingVisibility(this.hidden);
    this.host.view()?.selectMany([...this.selection]);
    const primary = [...this.selection].at(-1);
    if (primary && this.locked.has(primary))
      element<HTMLFieldSetElement>('transform').disabled = true;
  }
}
