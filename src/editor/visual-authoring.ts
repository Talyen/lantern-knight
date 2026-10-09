import * as T from 'three';
import { contentDefinitions } from '../content/game-content';
import { type SceneDocument, type SceneObject } from '../content/scene-document';
import { sceneItems, type EditorHistory } from './model';
import type { EditorView } from './view';
import {
  sceneCompositionFindings,
  sceneDesignProfiles,
  paletteEntry,
} from '../content/scene-design';
import { resolveAuthoredScene, resolveScene } from '../content/world-art';
import { localOffset } from '../content/scenery-presets';
import { heightAt } from '../content/world';
type Data = string | number | boolean | Data[] | { [key: string]: Data | undefined };
type Host = {
  history: () => EditorHistory;
  view: () => EditorView;
  selected: () => string | undefined;
  locked?: () => boolean;
  change: (mutate: (d: SceneDocument) => void) => Promise<void>;
  select: (id: string) => void;
};
const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const point = { x: 0, z: 0 },
  bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
const templates = {
  spawns: { id: 'enemy', actor: 'skeleton', x: 2, z: 0 },
  exits: {
    id: 'exit',
    trigger: { minX: -1, maxX: 1, minZ: -3, maxZ: -2 },
    destination: 'flat',
    entry: 'start',
    requiresClear: false,
    marker: { x: 0, z: -2.5 },
  },
  pickups: { id: 'pickup', object: '', kind: 'health', amount: 25, radius: 0.5, x: 0, z: 0 },
  paths: {
    points: [
      { x: -2, z: 0 },
      { x: 2, z: 0 },
    ],
    width: 1,
  },
  walls: { id: 'wall', from: { x: -2, z: 2 }, to: { x: 2, z: 2 }, height: 2, thickness: 0.2 },
  graves: { id: 'grave', x: 0, z: 0, width: 1, length: 2, age: 'old' },
  rainShelters: bounds,
  overlaps: { a: '', b: '', region: bounds, reason: 'Intentional overlap' },
};
const optional = {
  gameplay: { spawns: [], exits: [], pickups: [] },
  geometry: {
    bounds,
    surface: { kind: 'flat', height: 0 },
    baselineEntry: 'start',
    entries: [{ id: 'start', ...point }],
  },
  weather: { rain: 0, wind: { x: 0, z: 0 } },
  rainBounds: bounds,
  interior: bounds,
  surround: {
    anchor: point,
    color: 0x223333,
    ground: [
      { x: -10, z: -10 },
      { x: 10, z: -10 },
      { x: 10, z: 10 },
      { x: -10, z: 10 },
    ],
    layers: [],
  },
};
const choices: Record<string, string[]> = {
  shadow: ['none', 'contact', 'cast'],
  role: ['ground', 'upright', 'attachment'],
  age: ['kept', 'old', 'damaged'],
  axis: ['x', 'z'],
  cutout: ['wall', 'wall-x', 'wall-z', 'boundary-x', 'boundary-z', 'fence'],
  marker: ['gravestone', 'memorial', 'fallen-marker'],
};
function read(root: unknown, path: readonly (string | number)[]): Data | undefined {
  let value = root as Data;
  for (const key of path) value = (value as Record<string, Data>)[key]!;
  return value;
}
function write(root: unknown, path: readonly (string | number)[], value: Data | undefined) {
  let target = root as Record<string, Data | undefined>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, Data | undefined>;
  if (value === undefined) delete target[path.at(-1)!];
  else target[path.at(-1)!] = value;
}
export class VisualAuthoring {
  private group = new T.Group();
  private handles: { path: (string | number)[]; point: { x: number; z: number }; label: string }[] =
    [];
  private key = '';
  private fields: HTMLElement;
  private objectFields: HTMLElement;
  private drag: { path: (string | number)[]; pointer: number } | undefined;
  constructor(private host: Host) {
    this.fields = document.createElement('section');
    this.fields.id = 'visual-fields';
    $('scene-panel').append(this.fields);
    this.objectFields = document.createElement('section');
    this.objectFields.id = 'object-appearance';
    $('object-panel').append(this.objectFields);
    const overlays = document.createElement('fieldset');
    overlays.id = 'overlays';
    overlays.innerHTML =
      '<legend>Viewport overlays</legend>' +
      ['camera', 'bounds', 'collision', 'entries', 'zones', 'lights', 'shelters', 'gameplay']
        .map((id) => `<label><input type="checkbox" data-overlay="${id}"> ${id}</label>`)
        .join('');
    $('scene-panel').prepend(overlays);
    overlays.onchange = () => {
      this.key = '';
      this.draw();
    };
  }
  private commit(path: (string | number)[], value: Data | undefined) {
    void this.host.change((d) => write(d, path, value)).catch(console.error);
  }
  private button(label: string, action: () => void) {
    const b = document.createElement('button');
    b.textContent = label;
    b.type = 'button';
    b.onclick = action;
    return b;
  }
  private form(value: Data, path: (string | number)[], parent: HTMLElement, label: string) {
    if (typeof value === 'object') {
      const details = document.createElement('details');
      details.open = path.length < 2;
      details.dataset.section = path.join('.');
      const summary = document.createElement('summary');
      summary.textContent = label;
      details.append(summary);
      parent.append(details);
      if (Array.isArray(value)) {
        const tuple = ['offset', 'socket', 'footprint'].includes(String(path.at(-1)));
        value.forEach((v, i) => {
          const row = document.createElement('div');
          details.append(row);
          this.form(v, [...path, i], row, `${label} ${i + 1}`);
          if (!tuple)
            row.append(
              this.button('Remove ' + label, () => {
                const next = structuredClone(read(this.host.history().document, path) as Data[]);
                next.splice(i, 1);
                this.commit(path, next);
              }),
            );
        });
        if (!tuple)
          details.append(
            this.button('Add ' + label, () => {
              const next = structuredClone(read(this.host.history().document, path) as Data[]);
              const field = String(path.at(-1));
              const base =
                value[0] ??
                (templates as Record<string, Data>)[field] ??
                (field === 'propOrder'
                  ? (this.host.history().document.objects[0]?.id ?? 'object')
                  : field === 'layers'
                    ? {
                        asset: 'ink-blackwood-woodland',
                        clip: 'woodland',
                        scale: 1,
                        base: 0,
                        parallax: 0.1,
                        tint: 0xffffff,
                        detail: 0,
                      }
                    : field === 'entries'
                      ? { id: 'entry', x: 0, z: 0 }
                      : field === 'points' || field === 'ground'
                        ? point
                        : field === 'widths'
                          ? 1
                          : '');
              const item = structuredClone(base);
              if (item && typeof item === 'object' && !Array.isArray(item) && 'id' in item)
                item.id = field.replace(/s$/, '') + '-' + crypto.randomUUID();
              if (field === 'pickups' && typeof item === 'object' && !Array.isArray(item)) {
                const selected =
                  this.host
                    .history()
                    .document.objects.find(
                      (p) => p.id === this.host.selected() && p.kind !== 'decal',
                    ) ?? this.host.history().document.objects.find((p) => p.kind !== 'decal');
                if (!selected) throw new Error('Place pickup artwork first');
                (item as Record<string, Data>).object = selected.id;
                item.x = selected.x ?? 0;
                item.z = selected.z ?? 0;
              }
              if (field === 'exits' && typeof item === 'object' && !Array.isArray(item)) {
                (item as Record<string, Data>).destination = resolveScene(
                  this.host.history().document,
                ).area.id;
                (item as Record<string, Data>).entry =
                  this.host.history().document.geometry?.baselineEntry ?? 'start';
              }
              next.push(item);
              this.commit(path, next);
            }),
          );
      } else
        for (const [name, child] of Object.entries(value))
          if (child !== undefined) this.form(child, [...path, name], details, name);
      return;
    }
    const row = document.createElement('label');
    row.textContent = label.replace(/([A-Z])/g, ' $1');
    const field = String(path.at(-1));
    const options =
      field === 'actor'
        ? contentDefinitions.actors.filter((p) => p.kind === 'enemy').map((p) => p.id)
        : field === 'object'
          ? this.host
              .history()
              .document.objects.filter((p) => p.kind !== 'decal')
              .map((p) => p.id)
          : choices[field];
    const input = options ? document.createElement('select') : document.createElement('input');
    if (input instanceof HTMLSelectElement)
      for (const choice of options!) input.add(new Option(choice, choice));
    if (input instanceof HTMLInputElement) {
      input.type =
        typeof value === 'boolean'
          ? 'checkbox'
          : typeof value === 'number'
            ? ['color', 'tint'].includes(field)
              ? 'color'
              : 'number'
            : 'text';
      input.step = 'any';
      if (typeof value === 'boolean') input.checked = value;
    }
    input.value =
      input instanceof HTMLInputElement && input.type === 'color'
        ? '#' + Number(value).toString(16).padStart(6, '0')
        : String(value);
    input.dataset.field = path.join('.');
    input.onchange = () =>
      this.commit(
        path,
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : input instanceof HTMLInputElement && input.type === 'color'
            ? parseInt(input.value.slice(1), 16)
            : typeof value === 'number'
              ? Number(input.value)
              : input.value,
      );
    row.append(input);
    parent.append(row);
  }
  render(busy = false) {
    const d = this.host.history().document;
    const focused = document.activeElement;
    const field = focused instanceof HTMLElement ? focused.dataset.field : undefined;
    const expanded = new Map(
      [
        ...document.querySelectorAll<HTMLDetailsElement>(
          '#visual-fields details,#object-appearance details',
        ),
      ].map((v) => [v.dataset.section, v.open]),
    );
    this.fields.replaceChildren();
    const header = document.createElement('h2');
    header.textContent = 'Scene authoring';
    this.fields.append(header);
    for (const key of [
      'camera',
      'geometry',
      'gameplay',
      'paths',
      'walls',
      'graves',
      'surround',
      'weather',
      'rainBounds',
      'rainShelters',
      'interior',
      'propOrder',
      'overlaps',
    ] as const) {
      const value = d[key] as Data | undefined;
      if (value !== undefined) {
        this.form(value, [key], this.fields, key);
        if (key in optional)
          this.fields.append(this.button('Remove ' + key, () => this.commit([key], undefined)));
      } else
        this.fields.append(
          this.button('Add ' + key, () =>
            this.commit([key], structuredClone(optional[key as keyof typeof optional])),
          ),
        );
    }
    // Surface alternatives have different valid fields and change atomically.
    if (d.geometry) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Surface type');
      for (const kind of ['flat', 'ramp', 'stairs']) select.add(new Option(kind, kind));
      select.value = d.geometry.surface.kind;
      select.onchange = () =>
        this.commit(
          ['geometry', 'surface'],
          select.value === 'flat'
            ? { kind: 'flat', height: 0 }
            : {
                kind: select.value,
                axis: 'z',
                start: -2,
                end: 2,
                startHeight: 0,
                endHeight: 1,
                ...(select.value === 'stairs' ? { steps: 3 } : {}),
              },
        );
      this.fields.prepend(select);
    }
    this.objectFields.replaceChildren();
    const index = d.objects.findIndex((p) => p.id === this.host.selected());
    if (index >= 0) this.objectForm(d.objects[index]!, index);
    for (const details of document.querySelectorAll<HTMLDetailsElement>(
      '#visual-fields details,#object-appearance details',
    ))
      if (expanded.has(details.dataset.section))
        details.open = expanded.get(details.dataset.section)!;
    if (field) document.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
    const findings = sceneCompositionFindings(resolveAuthoredScene(d));
    const notes = $('composition-notes');
    notes.replaceChildren();
    notes.hidden = !findings.length;
    for (const finding of findings) {
      const object = sceneItems(d).find((p) => finding.includes(p.placement.id));
      const b = this.button('Advice: ' + finding, () => {
        if (object) this.host.select(object.placement.id);
        else this.showAdviceRegions();
      });
      notes.append(b);
    }
    for (const input of this.fields.querySelectorAll<HTMLInputElement>('input,select,button'))
      input.disabled = busy;
    for (const input of this.objectFields.querySelectorAll<HTMLInputElement>('input,select,button'))
      input.disabled = busy || !!this.host.locked?.();
    this.key = '';
    this.draw();
  }
  private showAdviceRegions() {
    for (const id of ['bounds', 'zones'])
      $<HTMLInputElement>('overlays').querySelector<HTMLInputElement>(
        `[data-overlay="${id}"]`,
      )!.checked = true;
    this.key = '';
    this.draw();
  }
  private objectForm(p: SceneObject, index: number) {
    const path = ['objects', index];
    this.form(
      p.label ?? p.clip.replaceAll('_', ' '),
      [...path, 'label'],
      this.objectFields,
      'Name',
    );
    for (const [key, fallback] of Object.entries({
      tint: 0xffffff,
      opacity: 1,
      shadow: 'contact',
      fade: false,
    }))
      this.form(
        (p as unknown as Record<string, Data>)[key] ?? fallback,
        [...path, key],
        this.objectFields,
        key,
      );
    if (p.footprint)
      this.form(
        p.footprint as Data,
        [...path, 'footprint'],
        this.objectFields,
        'Collision footprint',
      );
    else if (p.kind !== 'decal')
      this.objectFields.append(
        this.button('Add collision footprint', () =>
          this.commit([...path, 'footprint'], [0.5, 0.5]),
        ),
      );
    if (p.footprint)
      this.objectFields.append(
        this.button('Remove collision footprint', () =>
          this.commit([...path, 'footprint'], undefined),
        ),
      );
    if (p.kind === 'decal') return;
    const attach = document.createElement('select');
    attach.setAttribute('aria-label', 'Attachment support');
    attach.add(new Option('Free object', ''));
    const descendants = new Set(this.host.history().descendants([p.id]));
    for (const item of sceneItems(this.host.history().document))
      if (!descendants.has(item.placement.id))
        attach.add(new Option(item.placement.id, item.placement.id));
    attach.value = p.mount?.to ?? '';
    attach.onchange = () => {
      void this.host
        .change((d) => {
          const object = d.objects[index]!,
            items = sceneItems(d),
            world = items.find((v) => v.placement.id === p.id)!.placement;
          if (!attach.value) {
            delete object.mount;
            object.role = 'upright';
            object.x = world.x;
            object.z = world.z;
            object.y = world.y;
          } else {
            const support = items.find((v) => v.placement.id === attach.value)!.placement;
            object.role = 'attachment';
            object.mount = {
              to: attach.value,
              offset: localOffset(support, [
                world.x - support.x,
                (world.y ?? 0) - (support.y ?? 0),
                world.z - support.z,
              ]),
            };
            delete object.x;
            delete object.y;
            delete object.z;
          }
        })
        .catch(console.error);
    };
    this.objectFields.append(attach);
    if (p.mount) {
      const support = sceneItems(this.host.history().document).find(
        (v) => v.placement.id === p.mount!.to,
      )?.placement;
      const sockets = support ? paletteEntry(support)?.sockets : undefined;
      if (sockets) {
        const socket = document.createElement('select');
        socket.setAttribute('aria-label', 'Attachment socket');
        socket.add(new Option('Custom offset', ''));
        for (const [name, s] of Object.entries(sockets))
          if (s.accepts.includes(p.asset + ':' + p.clip)) socket.add(new Option(name, name));
        socket.value = p.mount.socket ?? '';
        socket.onchange = () => {
          if (socket.value) {
            const setting = sockets[socket.value]!;
            void this.host
              .change((d) => {
                d.objects[index]!.mount!.socket = socket.value;
                d.objects[index]!.mount!.offset = [...setting.offset];
              })
              .catch(console.error);
          }
        };
        this.objectFields.append(socket);
      }
    }
    if (p.mount) this.form(p.mount as Data, [...path, 'mount'], this.objectFields, 'Attachment');
    if (p.fixture) {
      this.form(p.fixture as Data, [...path, 'fixture'], this.objectFields, 'Light fixture');
      if (!p.fixture.flame)
        this.objectFields.append(
          this.button('Add flame artwork', () =>
            this.commit([...path, 'fixture', 'flame'], {
              asset: 'ink-ambient',
              clip: 'lamp_flame',
              offset: [0, 0.5, 0],
              scale: 0.4,
              phase: 0,
              depthOffset: 0.01,
              decorative: true,
            }),
          ),
        );
      this.objectFields.append(
        this.button('Remove light', () => this.commit([...path, 'fixture'], undefined)),
      );
    } else
      this.objectFields.append(
        this.button('Add light', () =>
          this.commit([...path, 'fixture'], {
            id: p.id + '-flame',
            socket: [0, 0.5, 0],
            power: 1,
            range: 3,
            phase: 0,
            smoke: false,
            embersScale: 0.3,
          }),
        ),
      );
  }
  draw() {
    const view = this.host.view(),
      presentation = view?.presentation;
    if (!presentation) return;
    const enabled = [...document.querySelectorAll<HTMLInputElement>('[data-overlay]:checked')].map(
      (p) => p.dataset.overlay!,
    );
    const d = this.host.history().document,
      key = JSON.stringify([d, enabled, $<HTMLSelectElement>('tool').value]);
    if (key === this.key) return;
    this.key = key;
    for (const child of [...this.group.children]) {
      const line = child as T.Line;
      line.geometry.dispose();
      (line.material as T.Material).dispose();
      this.group.remove(child);
    }
    presentation.overlay.add(this.group);
    this.handles = [];
    const geometry = $<HTMLSelectElement>('tool').value === 'geometry';
    const line = (points: { x: number; z: number }[], color: number, closed = true) => {
      if (!points.length) return;
      const list = closed ? [...points, points[0]!] : points;
      const vertices = list.map(
        (p) => new T.Vector3(p.x, heightAt(view.sim!.areaDefinition, p.x, p.z) + 0.06, p.z),
      );
      const mesh = new T.Line(
        new T.BufferGeometry().setFromPoints(vertices),
        new T.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.8 }),
      );
      mesh.renderOrder = 100;
      this.group.add(mesh);
    };
    const handle = (path: (string | number)[], p: { x: number; z: number }, label: string) => {
      this.handles.push({ path, point: p, label });
      line(
        [
          { x: p.x - 0.1, z: p.z },
          { x: p.x + 0.1, z: p.z },
        ],
        0xffffff,
        false,
      );
      line(
        [
          { x: p.x, z: p.z - 0.1 },
          { x: p.x, z: p.z + 0.1 },
        ],
        0xffffff,
        false,
      );
    };
    const box = (b: typeof bounds, color: number) =>
      line(
        [
          { x: b.minX, z: b.minZ },
          { x: b.maxX, z: b.minZ },
          { x: b.maxX, z: b.maxZ },
          { x: b.minX, z: b.maxZ },
        ],
        color,
      );
    if (enabled.includes('camera') || geometry) box(d.camera.bounds, 0x66cfff);
    if (enabled.includes('bounds') || geometry)
      box(d.geometry?.bounds ?? view.sim!.areaDefinition.bounds, 0xffd46c);
    if (geometry)
      for (const [path, b] of [
        [['camera', 'bounds'], d.camera.bounds],
        [['geometry', 'bounds'], d.geometry?.bounds],
      ] as const)
        if (b) {
          handle([...path, 'min'], { x: b.minX, z: b.minZ }, 'minimum bounds');
          handle([...path, 'max'], { x: b.maxX, z: b.maxZ }, 'maximum bounds');
        }
    if (enabled.includes('zones') && d.profile !== 'study')
      for (const zone of Object.values(sceneDesignProfiles[d.profile].zones))
        box(zone.bounds, zone.kind === 'clear' ? 0x99ffaa : 0xaa99dd);
    if (enabled.includes('collision'))
      for (const item of sceneItems(d)) {
        const p = item.placement;
        if (p.footprint)
          box(
            {
              minX: p.x - p.footprint[0] / 2,
              maxX: p.x + p.footprint[0] / 2,
              minZ: p.z - p.footprint[1] / 2,
              maxZ: p.z + p.footprint[1] / 2,
            },
            0xff7777,
          );
      }
    if (enabled.includes('entries') || geometry)
      d.geometry?.entries.forEach((p, i) => handle(['geometry', 'entries', i], p, 'Entry ' + p.id));
    if (geometry || enabled.includes('gameplay')) {
      d.gameplay?.spawns.forEach((p, i) => handle(['gameplay', 'spawns', i], p, 'Enemy ' + p.id));
      d.gameplay?.pickups.forEach((p, i) =>
        handle(['gameplay', 'pickups', i], p, 'Pickup ' + p.id),
      );
      d.gameplay?.exits.forEach((p) => box(p.trigger, 0x66ffaa));
    }
    if (geometry) {
      d.paths.forEach((p, i) => {
        line(p.points, 0x77ddaa, false);
        p.points.forEach((p, j) => handle(['paths', i, 'points', j], p, 'Path point'));
      });
      d.walls.forEach((p, i) => {
        line([p.from, p.to], 0xffaaaa, false);
        handle(['walls', i, 'from'], p.from, 'Wall start');
        handle(['walls', i, 'to'], p.to, 'Wall end');
      });
      if (d.surround) {
        line(d.surround.ground, 0xaa99dd);
        d.surround.ground.forEach((p, i) => handle(['surround', 'ground', i], p, 'Surround point'));
      }
    }
    if (enabled.includes('shelters')) for (const b of d.rainShelters ?? []) box(b, 0x99bbff);
    if (enabled.includes('lights'))
      for (const item of sceneItems(d)) {
        const p = item.placement;
        if (p.fixture)
          line(
            Array.from({ length: 32 }, (_, i) => ({
              x: p.x + Math.cos((i * Math.PI) / 16) * p.fixture!.range,
              z: p.z + Math.sin((i * Math.PI) / 16) * p.fixture!.range,
            })),
            0xffcc66,
          );
      }
    view.render();
  }
  pointerDown(e: PointerEvent) {
    if ($<HTMLSelectElement>('tool').value !== 'geometry' || e.button !== 0) return false;
    this.draw();
    const view = this.host.view();
    const candidates = this.handles
      .map((h) => {
        const s = view.screen(
          new T.Vector3(
            h.point.x,
            heightAt(view.sim!.areaDefinition, h.point.x, h.point.z),
            h.point.z,
          ),
        );
        return { h, d: Math.hypot(e.clientX - s.x, e.clientY - s.y) };
      })
      .sort((a, b) => a.d - b.d);
    if (candidates[0] && candidates[0].d < 18) {
      this.drag = { path: candidates[0].h.path, pointer: e.pointerId };
      view.canvas.setPointerCapture(e.pointerId);
      return true;
    }
    return true;
  }
  pointerUp(e: PointerEvent) {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = undefined;
    if (this.host.view().canvas.hasPointerCapture(e.pointerId))
      this.host.view().canvas.releasePointerCapture(e.pointerId);
    const point = this.host.view().ground(e.clientX, e.clientY);
    if (!point || e.type === 'pointercancel') return true;
    const path = drag.path;
    if (path.at(-1) === 'min' || path.at(-1) === 'max') {
      const axis = path.at(-1)!;
      const base = path.slice(0, -1);
      void this.host
        .change((d) => {
          write(d, [...base, axis + 'X'], point.x);
          write(d, [...base, axis + 'Z'], point.z);
        })
        .catch(console.error);
    } else
      void this.host
        .change((d) => {
          write(d, [...path, 'x'], point.x);
          write(d, [...path, 'z'], point.z);
        })
        .catch(console.error);
    return true;
  }
  dispose() {
    for (const child of this.group.children) {
      const line = child as T.Line;
      line.geometry.dispose();
      (line.material as T.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
