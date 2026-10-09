import { editorError } from './errors';
import {
  parseSceneDocument,
  parseSceneFragment,
  type SceneDocument,
} from '../content/scene-document';
import { EditorHistory, sceneItems } from './model';
import type { EditorView } from './view';
import * as T from 'three';
type Host = {
  history: () => EditorHistory;
  view: () => EditorView;
  selection: () => string[];
  open: (value: string) => Promise<void>;
  import: (document: SceneDocument) => Promise<void>;
  fragment: (name: string, objects: SceneDocument['objects']) => Promise<void>;
  change: (mutate: (d: SceneDocument) => void) => Promise<void>;
  select: (ids: string[]) => void;
  status: (message: string, error?: boolean) => void;
  recoveries: () => { key: string; name: string; time: string }[];
  restore: (key: string) => void;
};
const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
export function patternPoints(
  d: SceneDocument,
  kind: 'scatter' | 'path',
  count: number,
  seed: number,
  radius: number,
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 50 ||
    !Number.isInteger(seed) ||
    !Number.isFinite(radius) ||
    radius <= 0
  )
    throw new Error('Use 1–50 copies, an integer seed and a positive radius');
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  if (kind === 'scatter')
    return Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2,
        r = Math.sqrt(random()) * radius;
      return { x: d.hero.x + Math.cos(angle) * r, z: d.hero.z + Math.sin(angle) * r };
    });
  const points = d.paths[0]?.points;
  if (!points || points.length < 2) throw new Error('Create a path with at least two points first');
  const segments = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i]!.x, p.z - points[i]!.z));
  const length = segments.reduce((a, b) => a + b, 0);
  if (!length) throw new Error('Path has no length');
  return Array.from({ length: count }, (_, i) => {
    let distance = count === 1 ? length / 2 : (i * length) / (count - 1),
      segment = 0;
    while (segment < segments.length - 1 && distance > segments[segment]!) {
      distance -= segments[segment]!;
      segment++;
    }
    const a = points[segment]!,
      b = points[segment + 1]!,
      t = segments[segment] ? distance / segments[segment]! : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  });
}
export class SceneLibrary {
  private dialog: HTMLDialogElement;
  private lifetime = new AbortController();
  private preview = new T.Group();
  private points: { x: number; z: number }[] = [];
  private snapshot = '';
  private fragmentData: SceneDocument['objects'] = [];
  constructor(private host: Host) {
    const toolbar = document.querySelector('.toolbar')!;
    const button = document.createElement('button');
    button.id = 'scene-library';
    button.textContent = 'Scene library';
    button.onclick = () => void this.load().catch((e) => host.status(editorError(e), true));
    toolbar.append(button);
    const exportButton = document.createElement('button');
    exportButton.textContent = 'Export JSON';
    exportButton.id = 'export-scene';
    exportButton.onclick = () =>
      this.download(host.history().document, host.history().document.id + '.json');
    toolbar.append(exportButton);
    const importLabel = document.createElement('label');
    importLabel.textContent = 'Import JSON';
    const input = document.createElement('input');
    input.id = 'import-scene';
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file)
        void (async () => {
          if (file.size > 65536) throw new Error('Scene exceeds 64 KiB');
          const d = parseSceneDocument(JSON.parse(await file.text()));
          await host.import({
            ...d,
            id: 'untitled',
            target: 'draft',
            name: 'Imported ' + d.name.slice(0, 71),
          });
        })().catch((e) => host.status(editorError(e), true));
      input.value = '';
    };
    importLabel.append(input);
    toolbar.append(importLabel);
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'scene-library-dialog';
    this.dialog.innerHTML =
      '<h2>Scene library</h2><input id="library-search" type="search" aria-label="Search scenes" placeholder="Search scenes"><h3>Scenes</h3><div id="library-scenes"></div><h3>Recovery</h3><div id="library-recovery"></div><h3>Reusable fragments</h3><input id="fragment-name" aria-label="Fragment name" placeholder="Arrangement name" maxlength="80"><button id="save-fragment">Save selection as fragment</button><div id="library-fragments"></div><form method="dialog"><button>Close</button></form>';
    document.body.append(this.dialog);
    $('save-fragment').onclick = () =>
      void (async () => {
        const objects = host.history().fragment(host.selection());
        if (!objects.length) throw new Error('Select artwork first');
        const name = $<HTMLInputElement>('fragment-name').value.trim();
        if (!name) throw new Error('Name the fragment first');
        await host.fragment(name, objects);
        await this.load();
      })().catch((e) => host.status(editorError(e), true));
    const pattern = document.createElement('fieldset');
    pattern.id = 'pattern-tools';
    pattern.innerHTML =
      '<legend>Repeat selection</legend><label>Pattern<select id="pattern-kind"><option value="path">Along first path</option><option value="scatter">Scatter around hero</option></select></label><label>Copies<input id="pattern-count" type="number" min="1" max="50" value="5"></label><label>Seed<input id="pattern-seed" type="number" value="142"></label><label>Scatter radius<input id="pattern-radius" type="number" min=".1" step=".1" value="3"></label><button id="pattern-preview">Preview pattern</button><button id="pattern-apply" disabled>Apply pattern</button><button id="pattern-cancel">Cancel preview</button>';
    $('scene-panel').append(pattern);
    $('pattern-preview').onclick = () => {
      try {
        this.previewPattern();
      } catch (e) {
        host.status(editorError(e), true);
      }
    };
    $('pattern-cancel').onclick = () => this.clearPreview();
    $('pattern-apply').onclick = () =>
      void this.applyPattern().catch((e) => host.status(editorError(e), true));
  }
  private download(value: unknown, name: string) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
  remember() {
    const d = this.host.history().document;
    try {
      const recent = JSON.parse(localStorage.getItem('lantern-editor-scenes') ?? '[]') as string[];
      localStorage.setItem(
        'lantern-editor-scenes',
        JSON.stringify([d.id, ...recent.filter((p) => p !== d.id)].slice(0, 20)),
      );
      localStorage.setItem(
        'lantern-editor-scene-thumbnail:' + d.id,
        this.host.view().canvas.toDataURL('image/webp', 0.4),
      );
    } catch {
      /* Thumbnails are disposable. */
    }
  }
  async load() {
    const response = await fetch('/__lantern_editor', { signal: this.lifetime.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    this.lifetime.signal.throwIfAborted();
    if (!this.dialog.open) this.dialog.showModal();
    let recent: string[] = [];
    try {
      recent = JSON.parse(localStorage.getItem('lantern-editor-scenes') ?? '[]');
    } catch {
      /* Disposable metadata. */
    }
    const scenes = data.scenes as { id: string; name: string; target: string; error?: string }[];
    const render = () => {
      const list = $('library-scenes');
      list.replaceChildren();
      const search = $<HTMLInputElement>('library-search').value.toLowerCase();
      for (const scene of [...scenes].sort((a, b) => {
        const ai = recent.indexOf(a.id),
          bi = recent.indexOf(b.id);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.name.localeCompare(b.name);
      })) {
        if (!`${scene.name} ${scene.id}`.toLowerCase().includes(search)) continue;
        const b = document.createElement('button');
        b.className = 'scene-card';
        b.textContent = `${scene.name} · ${scene.target === 'live' ? 'LIVE' : 'Draft'}${scene.error ? ' · Invalid file' : ''}`;
        b.disabled = !!scene.error;
        try {
          const src = localStorage.getItem('lantern-editor-scene-thumbnail:' + scene.id);
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            b.prepend(img);
          }
        } catch {
          /* Disposable preview. */
        }
        b.onclick = () => {
          this.dialog.close();
          void this.host
            .open('file-' + scene.id)
            .catch((e) => this.host.status(editorError(e), true));
        };
        list.append(b);
      }
    };
    $('library-search').oninput = render;
    render();
    const recoveries = $('library-recovery');
    recoveries.replaceChildren();
    for (const recovery of this.host.recoveries()) {
      const b = document.createElement('button');
      b.textContent = recovery.name + ' · ' + recovery.time;
      b.onclick = () => {
        this.dialog.close();
        this.host.restore(recovery.key);
      };
      recoveries.append(b);
    }
    const r = await fetch('/__lantern_editor?fragments', { signal: this.lifetime.signal });
    const fragments = await r.json();
    if (!r.ok) throw new Error(fragments.error);
    const list = $('library-fragments');
    list.replaceChildren();
    for (const item of fragments.fragments as { id: string; fragment: unknown }[]) {
      const fragment = parseSceneFragment(item.fragment),
        b = document.createElement('button');
      b.textContent = fragment.name + ' · ' + fragment.objects.length + ' objects';
      b.onclick = () => {
        this.dialog.close();
        let inserted: string[] = [];
        void this.host
          .change((d) => {
            const temp = new EditorHistory(d);
            inserted = temp.insertFragment(fragment.objects);
            d.objects = temp.document.objects;
          })
          .then(() => this.host.select(inserted))
          .catch((e) => this.host.status(editorError(e), true));
      };
      list.append(b);
    }
  }
  private previewPattern() {
    this.clearPreview();
    const d = this.host.history().document;
    this.fragmentData = this.host.history().fragment(this.host.selection());
    if (!this.fragmentData.length) throw new Error('Select an arrangement first');
    this.points = patternPoints(
      d,
      $<HTMLSelectElement>('pattern-kind').value as 'scatter' | 'path',
      Number($<HTMLInputElement>('pattern-count').value),
      Number($<HTMLInputElement>('pattern-seed').value),
      Number($<HTMLInputElement>('pattern-radius').value),
    );
    if (this.points.length * this.fragmentData.length + d.objects.length > 500)
      throw new Error('Pattern exceeds the 500-object scene limit');
    this.snapshot = JSON.stringify(d);
    const view = this.host.view();
    view.presentation!.overlay.add(this.preview);
    for (const p of this.points) {
      const mesh = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(p.x - 0.2, 0.12, p.z),
          new T.Vector3(p.x + 0.2, 0.12, p.z),
          new T.Vector3(p.x, 0.12, p.z),
          new T.Vector3(p.x, 0.12, p.z - 0.2),
          new T.Vector3(p.x, 0.12, p.z + 0.2),
        ]),
        new T.LineBasicMaterial({ color: 0x77eebb, depthTest: false }),
      );
      this.preview.add(mesh);
    }
    $<HTMLButtonElement>('pattern-apply').disabled = false;
    view.render();
    this.host.status(
      `Preview: ${this.points.length} copies. Green crosses mark arrangement centers.`,
    );
  }
  private async applyPattern() {
    if (this.snapshot !== JSON.stringify(this.host.history().document))
      throw new Error('Scene changed; preview the pattern again');
    const items = sceneItems(this.host.history().document).filter((p) =>
      this.fragmentData.some((v) => v.id === p.placement.id),
    );
    const cx = items.reduce((a, p) => a + p.placement.x, 0) / items.length,
      cz = items.reduce((a, p) => a + p.placement.z, 0) / items.length;
    const ids: string[] = [];
    await this.host.change((d) => {
      const temp = new EditorHistory(d);
      for (const p of this.points)
        ids.push(...temp.insertFragment(this.fragmentData, p.x - cx, p.z - cz));
      d.objects = temp.document.objects;
    });
    this.host.select(ids);
    this.clearPreview();
  }
  clearPreview() {
    for (const child of [...this.preview.children]) {
      const line = child as T.Line;
      line.geometry.dispose();
      (line.material as T.Material).dispose();
      this.preview.remove(child);
    }
    this.points = [];
    this.snapshot = '';
    $<HTMLButtonElement>('pattern-apply').disabled = true;
  }
  dispose() {
    this.lifetime.abort();
    this.clearPreview();
    this.preview.removeFromParent();
    this.dialog.remove();
  }
}
