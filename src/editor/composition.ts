import { html } from '../dom';
import type { EditorGestures, GestureLease } from './gestures';
import * as T from 'three';
import { heightAt } from '../content/world';
import { openDock } from './workspace';
import { EditorHistory, sceneItems } from './model';
import type { EditorView } from './view';
import type { EditorSnapshot } from './document';
export type CompositionHost = {
  gestures: EditorGestures;
  confirm: (message: string, action: string) => Promise<boolean>;
  history: () => EditorSnapshot;
  edit: (work: (history: EditorHistory) => void, committed?: () => void) => Promise<void>;
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
  private gesture?: GestureLease;
  private lifetime = new AbortController();
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
      { root: element('objects-panel') },
    );
    element('object-search').oninput = () => this.render();
    element('focus-selection').onclick = () => this.focus();
    element('shortcuts').onclick = () => element<HTMLDialogElement>('shortcut-dialog').showModal();
    element('reset-transform').onclick = () =>
      void this.edit((history) =>
        history.change((d) => {
          const editable = new Set(this.editable());
          for (const p of d.objects)
            if (editable.has(p.id)) {
              p.scale = 1;
              p.rotation = 0;
            }
        }),
      );
    for (const label of document.querySelectorAll<HTMLLabelElement>('#transform label')) {
      const input = label.querySelector<HTMLInputElement>('input[type="number"]');
      if (!input) continue;
      label.title = 'Drag this label to adjust; edit the field for an exact value';
      label.onpointerdown = (e) => {
        if (
          e.button !== 0 ||
          e.target !== label ||
          input.disabled ||
          input.closest('fieldset')?.disabled
        )
          return;
        e.preventDefault();
        this.cancelGesture();
        const original = input.value,
          start = Number(original),
          x = e.clientX,
          step = Number(input.step) || 0.1;
        label.onpointermove = (move) => {
          if (move.pointerId !== e.pointerId) return;
          input.value = String(
            Math.round((start + ((move.clientX - x) / 8) * step) * 10000) / 10000,
          );
        };
        const finish = (cancel: boolean) => {
          label.onpointermove = null;
          label.onpointerup = null;
          label.onpointercancel = null;
          label.onlostpointercapture = null;
          if (!cancel && !lease.finish()) return;
          this.gesture = undefined;
          if (cancel) input.value = original;
          else input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const lease = this.host.gestures.begin(label, e.pointerId, () => finish(true));
        this.gesture = lease;
        if (!lease.active) {
          finish(true);
          return;
        }
        label.onpointerup = (event) => {
          if (event.pointerId === e.pointerId) finish(false);
        };
        label.onpointercancel = (event) => {
          if (event.pointerId === e.pointerId) lease.cancel();
        };
      };
    }
    for (const axis of ['x', 'z'] as const) {
      const button = element('align-' + axis);
      button.onclick = () =>
        void this.edit((history) => {
          const ids = this.editable(),
            items = sceneItems(this.host.history().document);
          const anchor = items.find((p) => p.placement.id === ids.at(-1))?.placement[axis];
          if (anchor === undefined) return;
          history.transformEach(ids, { [axis]: anchor });
        }).catch(console.error);
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
        this.cancelGesture();
        const view = this.host.view();
        if (!view.presentation) return;
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
        const finish = (cancel: boolean) => {
          button.onpointermove = null;
          button.onpointerup = null;
          button.onpointercancel = null;
          button.onlostpointercapture = null;
          if (!cancel && !lease.finish()) return;
          this.gesture = undefined;
          view.clearTransformPreview();
          if (!cancel && changed)
            void this.edit((history) => history.transformMany(ids, validFields)).catch(
              console.error,
            );
          else {
            view.render();
            this.positionHandles();
          }
        };
        const lease = this.host.gestures.begin(button, e.pointerId, () => finish(true));
        this.gesture = lease;
        if (!lease.active) {
          finish(true);
          return;
        }
        button.onpointermove = (move) => {
          if (move.pointerId !== e.pointerId) return;
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
            const temp = EditorHistory.create(original);
            temp.transformMany(ids, fields);
            view.previewTransforms(temp.document);
            validFields = fields;
            changed = JSON.stringify(temp.document) !== JSON.stringify(original);
          } catch {
            /* Keep the last valid preview when a transform exceeds scene limits. */
          }
        };
        button.onpointerup = (event) => {
          if (event.pointerId === e.pointerId) finish(false);
        };
        button.onpointercancel = (event) => {
          if (event.pointerId === e.pointerId) lease.cancel();
        };
      };
    }
  }
  cancelGesture() {
    this.gesture?.cancel();
  }
  reset() {
    this.cancelGesture();
    this.selection.clear();
    this.hidden.clear();
    this.locked.clear();
    this.host.view().setEditingVisibility(this.hidden);
  }
  dispose() {
    this.cancelGesture();
    this.lifetime.abort();
    this.thumbnails.disconnect();
  }
  positionHandles() {
    const items = sceneItems(this.host.history().document).filter((p) =>
      this.editable().includes(p.placement.id),
    );
    const handles = element('transform-handles');
    const view = this.host.view();
    handles.hidden =
      !view.presentation ||
      !items.length ||
      element<HTMLSelectElement>('tool').value !== 'select' ||
      document.body.classList.contains('focus-mode');
    if (handles.hidden) return;
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
    const history = this.host.history(),
      hidden = new Set(history.descendants([...this.hidden])),
      objects = new Map(history.document.objects.map((object) => [object.id, object])),
      locked = new Set(this.locked);
    // A locked attachment also protects every support that would move it.
    for (const id of locked) {
      const parent = objects.get(id)?.mount?.to;
      if (parent) locked.add(parent);
    }
    return [...this.selection].filter(
      (id) => objects.has(id) && !hidden.has(id) && !locked.has(id),
    );
  }
  set(id: string | undefined, additive = false) {
    if (!additive) this.selection.clear();
    if (
      id &&
      !this.host
        .history()
        .descendants([...this.hidden])
        .includes(id)
    ) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    if (this.selection.size) openDock('object', false);
    this.host.select([...this.selection].at(-1));
  }
  rectangle(a: { x: number; y: number }, b: { x: number; y: number }, additive: boolean) {
    if (!additive) this.selection.clear();
    const hidden = new Set(this.host.history().descendants([...this.hidden]));
    for (const item of sceneItems(this.host.history().document)) {
      const p = this.host
        .view()
        .screen(
          new T.Vector3(
            item.placement.x,
            heightAt(this.host.view().sim!.areaDefinition, item.placement.x, item.placement.z) +
              (item.placement.y ?? 0),
            item.placement.z,
          ),
        );
      if (
        !hidden.has(item.placement.id) &&
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
  edit(work: (history: EditorHistory) => void, committed?: () => void) {
    return this.host.edit(work, committed);
  }
  duplicate() {
    let ids: string[] = [];
    return this.edit(
      (history) => {
        ids = history.duplicateMany(this.editable());
      },
      () => {
        this.selection.clear();
        ids.forEach((id) => this.selection.add(id));
        this.host.select(ids.at(-1));
      },
    );
  }
  async remove() {
    const document = this.host.history().document;
    const selected = this.editable();
    const descendants = this.host.history().descendants(selected);
    if (descendants.some((id) => this.locked.has(id)))
      return this.edit(() => {
        throw new Error('Unlock attached objects before deleting their support');
      });
    const extra = descendants.filter((id) => !selected.includes(id));
    if (
      extra.length &&
      !(await this.host.confirm(
        `Delete selection and ${extra.length} attached object(s)?`,
        'Delete objects',
      ))
    )
      return;
    if (this.lifetime.signal.aborted || this.host.history().document !== document) return;
    return this.edit(
      (history) => history.removeMany(selected),
      () => {
        this.selection.clear();
        this.host.select(undefined);
      },
    );
  }
  focus() {
    const view = this.host.view(),
      p = view.presentation;
    const items = sceneItems(this.host.history().document).filter((v) =>
      this.selection.has(v.placement.id),
    );
    if (!p || !items.length || !view.sim) return;
    view.setGameCamera(false);
    p.center.set(
      items.reduce((v, p) => v + p.placement.x, 0) / items.length,
      items.reduce(
        (v, p) =>
          v +
          heightAt(view.sim!.areaDefinition, p.placement.x, p.placement.z) +
          (p.placement.y ?? 0),
        0,
      ) /
        items.length +
        1.8,
      items.reduce((v, p) => v + p.placement.z, 0) / items.length,
    );
    view.render();
  }
  render() {
    const items = sceneItems(this.host.history().document);
    for (const id of this.selection)
      if (!items.some((v) => v.placement.id === id)) this.selection.delete(id);
    const editable = this.editable();
    element('selection-tools').hidden = !editable.length;
    element('alignment-tools').hidden = editable.length < 2;
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
      const thumbnail = html<HTMLCanvasElement>`<canvas width="56" height="48" aria-hidden="true" data-asset="${p.asset}" data-clip="${p.clip}"></canvas>`;
      const name =
        documents.get(p.id)?.label ??
        (p.id.startsWith('object-') ? p.clip.replaceAll('_', ' ') + ' · ' + p.id.slice(-4) : p.id);
      const select = html<HTMLButtonElement>`<button class="object-select${this.selection.has(p.id) ? ' active' : ''}" title="${p.asset}/${p.clip}">${name}</button>`;
      select.onclick = (e) => this.set(p.id, e.shiftKey);
      const focus = html<HTMLButtonElement>`<button class="object-action" aria-label="Focus ${p.id}">⌖</button>`;
      focus.onclick = () => {
        this.set(p.id);
        this.focus();
      };
      const row = html`<div class="object-row" role="listitem" style="padding-left: ${depth(p.id) * 12}px">${thumbnail}${select}${focus}</div>`;
      for (const [label, set] of [
        ['Hide', this.hidden],
        ['Lock', this.locked],
      ] as const) {
        const action = set.has(p.id) ? (label === 'Hide' ? 'Show' : 'Unlock') : label;
        const button = html<HTMLButtonElement>`<button class="object-action${set.has(p.id) ? ' active' : ''}" aria-label="${action} ${p.id}">${action}</button>`;
        button.onclick = () => {
          if (set.has(p.id)) set.delete(p.id);
          else set.add(p.id);
          this.host.select([...this.selection].at(-1));
          if (label === 'Hide') void this.host.run(() => this.host.refresh()).catch(console.error);
        };
        row.append(button);
      }
      list.append(row);
      this.thumbnails.observe(thumbnail);
    }
    if (!list.children.length)
      list.append(
        html`<p class="empty-state">${filter ? 'No objects match this search.' : 'Place artwork to start composing.'}</p>`,
      );
    const hidden = new Set(this.host.history().descendants([...this.hidden]));
    this.host.view()?.setEditingVisibility(hidden);
    this.host.view()?.selectMany([...this.selection].filter((id) => !hidden.has(id)));
    this.positionHandles();
    const primary = [...this.selection].at(-1);
    if (primary && !editable.includes(primary))
      element<HTMLFieldSetElement>('transform').disabled = true;
  }
}
