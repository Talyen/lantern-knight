import { overlayLine, clearOverlay } from '../presentation/overlay-lines';
import type { EditorSnapshot } from './document';
import { sceneBytesLimit } from '../content/scene-document';
import { editorError } from './errors';
import { readUntilAborted } from '../abort';
import {
  parseSceneDocument,
  parseSceneFragment,
  type SceneDocument,
  type SceneSnapshot,
} from '../content/scene-document';
import { EditorHistory, sceneItems } from './model';
import type { EditorView } from './view';
import * as T from 'three';
type Host = {
  history: () => EditorSnapshot;
  view: () => EditorView;
  selection: () => string[];
  open: (value: string) => Promise<void>;
  import: (document: SceneDocument) => Promise<void>;
  fragment: (name: string, objects: SceneDocument['objects']) => Promise<void>;
  change: (mutate: (d: SceneDocument) => void, committed?: () => void) => Promise<void>;
  select: (ids: string[]) => void;
  status: (message: string, error?: boolean) => void;
  recoveries: () => { key: string; name: string; time: string }[];
  restore: (key: string) => void;
};
const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
function recentScenes(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('lantern-editor-scenes') ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
export function patternPoints(
  d: SceneSnapshot,
  kind: 'scatter' | 'path',
  count: number,
  seed: number,
  radius: number,
  target: { pathIndex?: number; center?: { x: number; z: number } } = {},
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 50 ||
    (kind === 'scatter' && (!Number.isInteger(seed) || !Number.isFinite(radius) || radius <= 0))
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
      const center = target.center ?? d.hero;
      if (!Number.isFinite(center.x) || !Number.isFinite(center.z))
        throw new Error('Choose a finite scatter center');
      return { x: center.x + Math.cos(angle) * r, z: center.z + Math.sin(angle) * r };
    });
  const points = d.paths[target.pathIndex ?? 0]?.points;
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
  private loadSequence = 0;
  private preview = new T.Group();
  private points: { x: number; z: number }[] = [];
  private snapshot = '';
  private fragmentData: SceneDocument['objects'] = [];
  constructor(private host: Host) {
    $('scene-library').onclick = () =>
      void this.load().catch((e) => host.status(editorError(e), true));
    $('recovery-history').onclick = () =>
      void this.load('recovery').catch((e) => host.status(editorError(e), true));
    $('export-scene').onclick = () =>
      this.download(host.history().document, host.history().document.id + '.json');
    const input = $<HTMLInputElement>('import-scene');
    input.onchange = () => {
      const file = input.files?.[0];
      if (file)
        void (async () => {
          if (file.size > sceneBytesLimit) throw new Error('Scene exceeds 4 MiB');
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
    this.dialog = $<HTMLDialogElement>('scene-library-dialog');
    $('save-fragment').onclick = () =>
      void (async () => {
        const objects = host.history().fragment(host.selection());
        if (!objects.length) throw new Error('Select artwork first');
        const name = $<HTMLInputElement>('fragment-name').value.trim();
        if (!name) throw new Error('Name the fragment first');
        await host.fragment(name, objects);
        await this.load('arrangements');
      })().catch((e) => host.status(editorError(e), true));
    for (const id of [
      'pattern-kind',
      'pattern-path',
      'pattern-x',
      'pattern-z',
      'pattern-count',
      'pattern-seed',
      'pattern-radius',
    ])
      $(id).onchange = () => {
        this.clearPreview();
        this.refresh();
      };
    $('pattern-center').onclick = () => {
      const items = sceneItems(host.history().document).filter((p) =>
        host.selection().includes(p.placement.id),
      );
      if (!items.length) return;
      $<HTMLInputElement>('pattern-x').value = String(
        items.reduce((n, p) => n + p.placement.x, 0) / items.length,
      );
      $<HTMLInputElement>('pattern-z').value = String(
        items.reduce((n, p) => n + p.placement.z, 0) / items.length,
      );
      this.clearPreview();
    };
    $('arrangements').onclick = () =>
      void this.load('arrangements').catch((e) => host.status(editorError(e), true));
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
      const recent = recentScenes();
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
  async load(destination: 'scenes' | 'recovery' | 'arrangements' = 'scenes') {
    const request = ++this.loadSequence;
    const signal = this.lifetime.signal;
    const current = () => !signal.aborted && request === this.loadSequence;
    signal.throwIfAborted();
    const response = await readUntilAborted(fetch('/__lantern_editor', { signal }), signal);
    const data = await readUntilAborted(response.json(), signal);
    if (!current()) return;
    if (!response.ok) throw new Error(data.error);
    this.lifetime.signal.throwIfAborted();
    if (!this.dialog.open) this.dialog.showModal();
    $('library-title').textContent =
      destination === 'scenes'
        ? 'Open scene'
        : destination === 'recovery'
          ? 'Recovery history'
          : 'Reusable arrangements';
    for (const section of this.dialog.querySelectorAll<HTMLElement>('[data-library]'))
      section.hidden = section.dataset.library !== destination;
    const recent = recentScenes();
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
        b.textContent = `${scene.name} · ${scene.target === 'live' ? 'In game' : 'Saved scene'}${scene.error ? ' · Invalid file' : ''}`;
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
    if (!recoveries.children.length) recoveries.textContent = 'No recovery history is available.';
    if (destination !== 'arrangements') return;
    const r = await readUntilAborted(fetch('/__lantern_editor?fragments', { signal }), signal);
    const fragments = await readUntilAborted(r.json(), signal);
    if (!current()) return;
    if (!r.ok) throw new Error(fragments.error);
    const list = $('library-fragments');
    list.replaceChildren();
    for (const item of fragments.fragments as {
      id: string;
      fragment?: unknown;
      error?: string;
    }[]) {
      const b = document.createElement('button');
      if (item.error) {
        b.textContent = item.id + ' · Unavailable arrangement';
        b.title = item.error;
        b.disabled = true;
        list.append(b);
        continue;
      }
      const fragment = parseSceneFragment(item.fragment);
      b.textContent = fragment.name + ' · ' + fragment.objects.length + ' objects';
      b.onclick = () => {
        this.dialog.close();
        let inserted: string[] = [];
        void this.host
          .change(
            (d) => {
              const temp = new EditorHistory(d);
              inserted = temp.insertFragment(fragment.objects);
              Object.assign(d, temp.document);
            },
            () => this.host.select(inserted),
          )
          .catch((e) => this.host.status(editorError(e), true));
      };
      list.append(b);
    }
  }
  refresh() {
    const paths = $<HTMLSelectElement>('pattern-path');
    const selected = paths.value;
    paths.replaceChildren();
    this.host
      .history()
      .document.paths.forEach((_, i) => paths.add(new Option('Path ' + (i + 1), String(i))));
    if ([...paths.options].some((p) => p.value === selected)) paths.value = selected;
    const scatter = $<HTMLSelectElement>('pattern-kind').value === 'scatter';
    $('pattern-path-label').hidden = scatter;
    $('scatter-region').hidden = !scatter;
    $('pattern-radius').closest('label')!.hidden = !scatter;
    $('pattern-seed').closest('label')!.hidden = !scatter;
    $<HTMLButtonElement>('pattern-preview').disabled = !this.host.selection().length;
  }
  private patternSnapshot() {
    return JSON.stringify([
      this.host.history().document,
      this.host.selection(),
      ...[
        'pattern-kind',
        'pattern-path',
        'pattern-x',
        'pattern-z',
        'pattern-count',
        'pattern-seed',
        'pattern-radius',
      ].map((id) => $<HTMLInputElement>(id).value),
    ]);
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
      {
        pathIndex: Number($<HTMLSelectElement>('pattern-path').value),
        center: {
          x: Number($<HTMLInputElement>('pattern-x').value),
          z: Number($<HTMLInputElement>('pattern-z').value),
        },
      },
    );
    if (this.points.length * this.fragmentData.length + d.objects.length > 500)
      throw new Error('Pattern exceeds the 500-object scene limit');
    this.snapshot = this.patternSnapshot();
    const view = this.host.view();
    if (!view.presentation)
      throw new Error('Scene view is unavailable; reopen the scene to recover');
    view.presentation.overlay.add(this.preview);
    for (const p of this.points) {
      overlayLine(
        this.preview,
        [
          new T.Vector3(p.x - 0.2, 0.12, p.z),
          new T.Vector3(p.x + 0.2, 0.12, p.z),
          new T.Vector3(p.x, 0.12, p.z),
          new T.Vector3(p.x, 0.12, p.z - 0.2),
          new T.Vector3(p.x, 0.12, p.z + 0.2),
        ],
        0x77eebb,
      );
    }
    $<HTMLButtonElement>('pattern-apply').disabled = false;
    view.render();
    this.host.status(
      `Preview: ${this.points.length} copies. Green crosses mark arrangement centers.`,
    );
  }
  private async applyPattern() {
    if (this.snapshot !== this.patternSnapshot())
      throw new Error('Scene changed; preview the pattern again');
    const items = sceneItems(this.host.history().document).filter((p) =>
      this.fragmentData.some((v) => v.id === p.placement.id),
    );
    const cx = items.reduce((a, p) => a + p.placement.x, 0) / items.length,
      cz = items.reduce((a, p) => a + p.placement.z, 0) / items.length;
    const ids: string[] = [];
    await this.host.change(
      (d) => {
        const temp = new EditorHistory(d);
        for (const p of this.points)
          ids.push(...temp.insertFragment(this.fragmentData, p.x - cx, p.z - cz, true));
        Object.assign(d, temp.document);
      },
      () => {
        this.host.select(ids);
        this.clearPreview();
      },
    );
  }
  clearPreview() {
    clearOverlay(this.preview);
    this.points = [];
    this.snapshot = '';
    if (!this.lifetime.signal.aborted) this.host.view()?.render();
    $<HTMLButtonElement>('pattern-apply').disabled = true;
  }
  dispose() {
    this.lifetime.abort();
    this.clearPreview();
    this.preview.removeFromParent();
    this.dialog.remove();
  }
}
