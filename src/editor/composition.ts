import * as T from 'three';
import { heightAt } from '../content/world';
import { openDock } from './workspace';
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
  private cancelHandle: (() => void) | undefined;
  private thumbnails: IntersectionObserver;
  constructor(private host: CompositionHost) {
    this.thumbnails = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            const canvas = entry.target as HTMLCanvasElement;
            this.thumbnails.unobserve(canvas);
            void this.host
              .thumbnail(canvas.dataset.asset!, canvas.dataset.clip!, canvas)
              .catch(() => {});
          }
      },
      { root: element('objects') },
    );
    element('object-search').oninput = () => this.render();
    element('focus-selection').onclick = () => this.focus();
    element('shortcuts').onclick = () => element<HTMLDialogElement>('shortcut-dialog').showModal();
    element('reset-transform').onclick = () =>
      void this.edit(() => {
        this.host.history().change((d) => {
          for (const p of d.objects)
            if (this.editable().includes(p.id)) {
              p.scale = 1;
              p.rotation = 0;
            }
        });
      });
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
    for (const axis of ['x', 'z'] as const) {
      const button = document.createElement('button');
      button.textContent = 'Align ' + axis.toUpperCase();
      button.id = 'align-' + axis;
      button.onclick = () =>
        void this.edit(() => {
          const ids = this.editable(),
            items = sceneItems(this.host.history().document);
          const anchor = items.find((p) => p.placement.id === ids.at(-1))?.placement[axis];
          if (anchor === undefined) return;
          const temp = new EditorHistory(this.host.history().document);
          for (const id of ids) temp.transform(id, { [axis]: anchor });
          this.host.history().change((d) => {
            d.objects = temp.document.objects;
          });
        }).catch(console.error);
      element('alignment-tools').append(button);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-handle]')) {
      button.onpointerdown = (e) => {
        const ids = this.editable();
        if (
          e.button !== 0 ||
          !ids.length ||
          (element<HTMLButtonElement>('undo').disabled &&
            element('save-state').textContent === 'Working…')
        )
          return;
        e.preventDefault();
        const view = this.host.view();
        const original = structuredClone(this.host.history().document);
        const items = sceneItems(original).filter((p) => ids.includes(p.placement.id));
        const center = new T.Vector3(
          items.reduce((n, p) => n + p.placement.x, 0) / items.length,
          0,
          items.reduce((n, p) => n + p.placement.z, 0) / items.length,
        );
        const pivot = view.screen(center),
          start = view.ground(e.clientX, e.clientY);
        const field = button.dataset.handle!;
        let fields: { x?: number; z?: number; scale?: number; rotation?: number } = {};
        let changed = false;
        let validFields = fields;
        button.setPointerCapture(e.pointerId);
        const finish = (cancel: boolean) => {
          button.onpointermove = null;
          button.onpointerup = null;
          button.onpointercancel = null;
          button.onlostpointercapture = null;
          this.cancelHandle = undefined;
          if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
          view.clearTransformPreview();
          if (!cancel && changed)
            void this.edit(() => this.host.history().transformMany(ids, validFields)).catch(
              console.error,
            );
          else {
            view.render();
            this.positionHandles();
          }
        };
        this.cancelHandle = () => finish(true);
        button.onpointermove = (move) => {
          const point = view.ground(move.clientX, move.clientY);
          if (field === 'x' || field === 'z') {
            if (!point || !start) return;
            fields = { [field]: this.snap(point[field] - start[field]) };
          } else if (field === 'rotation') {
            fields = {
              rotation:
                Math.atan2(move.clientY - pivot.y, move.clientX - pivot.x) -
                Math.atan2(e.clientY - pivot.y, e.clientX - pivot.x),
            };
          } else {
            fields = {
              scale: Math.max(
                0.1,
                Math.hypot(move.clientX - pivot.x, move.clientY - pivot.y) /
                  Math.max(20, Math.hypot(e.clientX - pivot.x, e.clientY - pivot.y)),
              ),
            };
          }
          try {
            const temp = new EditorHistory(original);
            temp.transformMany(ids, fields);
            view.previewTransforms(temp.document);
            validFields = fields;
            changed = JSON.stringify(temp.document) !== JSON.stringify(original);
          } catch {
            /* Keep the last valid preview when a transform exceeds scene limits. */
          }
        };
        button.onpointerup = () => finish(false);
        button.onpointercancel = () => finish(true);
        button.onlostpointercapture = () => finish(true);
      };
    }
  }
  cancelGesture() {
    this.cancelHandle?.();
  }
  dispose() {
    this.cancelGesture();
    this.thumbnails.disconnect();
  }
  positionHandles() {
    const items = sceneItems(this.host.history().document).filter((p) =>
      this.editable().includes(p.placement.id),
    );
    const handles = element('transform-handles');
    handles.hidden =
      !items.length ||
      element<HTMLSelectElement>('tool').value !== 'select' ||
      document.body.classList.contains('focus-mode');
    const view = this.host.view();
    if (handles.hidden || !view.presentation) return;
    const p = view.screen(
      new T.Vector3(
        items.reduce((n, p) => n + p.placement.x, 0) / items.length,
        items.reduce(
          (n, p) =>
            n +
            heightAt(view.sim!.areaDefinition, p.placement.x, p.placement.z) +
            (p.placement.y ?? 0),
          0,
        ) / items.length,
        items.reduce((n, p) => n + p.placement.z, 0) / items.length,
      ),
    );
    const rect = view.canvas.getBoundingClientRect();
    handles.hidden = p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom;
    handles.style.left = Math.max(0, Math.min(rect.width - 120, p.x - rect.left - 25)) + 'px';
    handles.style.top = Math.max(40, Math.min(rect.height - 80, p.y - rect.top + 40 - 30)) + 'px';
  }

  snap(value: number) {
    const spacing = Number(element<HTMLInputElement>('snap-spacing').value);
    return element<HTMLInputElement>('snap').checked && spacing > 0 && Number.isFinite(spacing)
      ? Math.round(value / spacing) * spacing
      : value;
  }
  editable() {
    const hidden = new Set(this.host.history().descendants([...this.hidden]));
    return [...this.selection].filter(
      (id) =>
        !hidden.has(id) &&
        !this.host
          .history()
          .descendants([id])
          .some((child) => this.locked.has(child)),
    );
  }
  set(id: string | undefined, additive = false) {
    if (!additive) this.selection.clear();
    if (id && !this.hidden.has(id)) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    if (this.selection.size) openDock('object', false);
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
    if (this.selection.size) openDock('object', false);
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
    if (descendants.some((id) => this.locked.has(id)))
      return this.edit(() => {
        throw new Error('Unlock attached objects before deleting their support');
      });
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
    element('selection-tools').hidden = !this.editable().length;
    element('alignment-tools').hidden = this.editable().length < 2;
    if (this.selection.size > 1) {
      element('selected-name').textContent = `${this.selection.size} objects selected`;
      const selected = items
        .filter((p) => this.selection.has(p.placement.id))
        .map((p) => p.placement);
      for (const key of ['x', 'z', 'y', 'scale', 'rotation'] as const) {
        const values = selected.map((p) => p[key] ?? (key === 'scale' ? 1 : 0));
        const input = element<HTMLInputElement>(key);
        input.value = values.every((v) => v === values[0])
          ? String(Number((values[0]! * (key === 'rotation' ? 180 / Math.PI : 1)).toFixed(3)))
          : '';
        input.placeholder = 'Mixed';
      }
      for (const id of ['clip', 'heading'])
        element<HTMLSelectElement>(id).closest('label')!.hidden = true;
      element<HTMLInputElement>('y').disabled = items.some(
        (p) => this.selection.has(p.placement.id) && p.kind === 'decal',
      );
      element<HTMLInputElement>('mirror').indeterminate = !selected.every(
        (p) => !!p.mirror === !!selected[0]!.mirror,
      );
    } else element<HTMLInputElement>('mirror').indeterminate = false;
    const filter = element<HTMLInputElement>('object-search').value.toLowerCase();
    const list = element('objects');
    this.thumbnails.disconnect();
    list.replaceChildren();
    const documents = new Map(this.host.history().document.objects.map((p) => [p.id, p]));
    const depth = (id: string): number => {
      const p = documents.get(id);
      return p?.mount ? 1 + depth(p.mount.to) : 0;
    };
    const ordered: typeof items = [];
    const children = (parent: string | undefined) => {
      for (const item of items
        .filter((p) => documents.get(p.placement.id)?.mount?.to === parent)
        .sort((a, b) => a.placement.id.localeCompare(b.placement.id))) {
        ordered.push(item);
        children(item.placement.id);
      }
    };
    children(undefined);
    for (const { placement: p } of ordered) {
      if (
        !`${p.id} ${p.asset} ${p.clip} ${documents.get(p.id)?.label ?? ''}`
          .toLowerCase()
          .includes(filter)
      )
        continue;
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
      select.textContent =
        documents.get(p.id)?.label ??
        (p.id.startsWith('object-') ? p.clip.replaceAll('_', ' ') + ' · ' + p.id.slice(-4) : p.id);
      select.title = p.asset + '/' + p.clip;
      select.classList.toggle('active', this.selection.has(p.id));
      select.onclick = (e) => this.set(p.id, e.shiftKey);
      const focus = document.createElement('button');
      focus.textContent = '⌖';
      focus.className = 'object-action';
      focus.setAttribute('aria-label', 'Focus ' + p.id);
      focus.onclick = () => {
        this.set(p.id);
        this.focus();
      };
      row.append(thumbnail, select, focus);
      for (const [label, set] of [
        ['Hide', this.hidden],
        ['Lock', this.locked],
      ] as const) {
        const button = document.createElement('button');
        button.textContent = set.has(p.id) ? (label === 'Hide' ? 'Show' : 'Unlock') : label;
        button.className = 'object-action';
        button.classList.toggle('active', set.has(p.id));
        button.setAttribute('aria-label', button.textContent + ' ' + p.id);
        button.onclick = () => {
          if (set.has(p.id)) set.delete(p.id);
          else set.add(p.id);
          this.host.select([...this.selection].at(-1));
          if (label === 'Hide') void this.host.run(() => this.host.refresh()).catch(console.error);
        };
        row.append(button);
      }
      list.append(row);
      thumbnail.dataset.asset = p.asset;
      thumbnail.dataset.clip = p.clip;
      this.thumbnails.observe(thumbnail);
    }
    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = filter
        ? 'No objects match this search.'
        : 'Place artwork to start composing.';
      list.append(empty);
    }
    const hidden = new Set(this.host.history().descendants([...this.hidden]));
    this.host.view()?.setEditingVisibility(hidden);
    this.host.view()?.selectMany([...this.selection].filter((id) => !hidden.has(id)));
    this.positionHandles();
    const primary = [...this.selection].at(-1);
    if (primary && (this.locked.has(primary) || this.hidden.has(primary)))
      element<HTMLFieldSetElement>('transform').disabled = true;
  }
}
