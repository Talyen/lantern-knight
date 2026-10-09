import { resolveAuthoredScene } from './content/world-art';
import {
  paletteEntry,
  sceneDesignProfiles,
  sceneCompositionFindings,
} from './content/scene-design';
import './editor.css';
import * as T from 'three';
import { AssetRuntime } from './assets/loader';
import type { Manifest } from './assets/schema';
import { authoringCatalog } from './assets/authoring-catalog';
import {
  emptyScene,
  parseSceneDocument,
  paletteKind,
  paletteClips,
  floorClips,
  type SceneDocument,
  type PaletteKind,
} from './content/scene-document';
import { heightAt } from './content/world';
import { applySceneryPreset } from './content/scenery-presets';
import { EditorHistory, sceneItems } from './editor/model';
import { EditorView } from './editor/view';
const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
document.getElementById('app')!.innerHTML = `
<header><div class="brand">LANTERN KNIGHT <span>Scene editor</span></div><label>Scene <select id="scene"><option value="new">New flat scene</option><option value="copy-court">Copy of Graveyard Approach</option><option value="copy-upper-landing">Copy of Ruined Chapel</option><option value="live-court">Edit Live: Graveyard Approach</option><option value="live-upper-landing">Edit Live: Ruined Chapel</option></select></label><button id="open">Open</button><input id="name" aria-label="Scene name" maxlength="80"><button id="save">Save</button><button id="save-as">Save As</button><span id="save-state">Unsaved</span></header>
<div id="recovery" class="notice" hidden>Unsaved work is available. <button id="restore">Restore recovery</button><button id="dismiss-recovery">Dismiss</button></div>
<div id="conflict" class="notice" hidden>The file changed outside this editor. Your edits are preserved. <button id="reload">Reload from disk</button><button id="conflict-copy">Save a separate copy</button></div>
<main><aside class="palette"><h2>Artwork</h2><input id="search" type="search" placeholder="Search scenery…" aria-label="Search artwork"><select id="category" aria-label="Artwork category"><option value="all">All artwork</option><option value="prop">Upright scenery</option><option value="animated">Animated artwork</option><option value="pickup">Pickups</option><option value="decal">Ground details</option><option value="character">Characters</option><option value="effect">Effects</option><option value="reference">References</option></select><p class="hint">Drag a thumbnail into the scene, or select it and click the ground.</p><div id="assets"></div></aside>
<section class="viewport"><div class="toolbar"><button id="undo">Undo</button><button id="redo">Redo</button><button id="duplicate">Duplicate</button><button id="delete">Delete</button><label><input id="grid" type="checkbox"> Grid &amp; snap</label><label><input id="hero-tool" type="checkbox"> Move hero</label><button id="fit">Fit scene</button><button id="play-animation">Pause animations</button><button id="replay-animation">Replay animations</button><span id="live-badge" hidden>EDITING LIVE SCENE</span></div><canvas id="viewport" tabindex="0" aria-label="Scene composition"></canvas><div class="viewport-help">Drag to move · Right-drag to pan · Scroll to zoom · Esc to deselect</div><p id="composition-notes" aria-label="Composition notes" hidden></p><p id="status" role="status" aria-live="polite">Loading prepared artwork…</p></section>
<aside class="inspector"><h2>Scene</h2><label>Lighting<select id="rig"><option value="golden">Golden hour</option><option value="silver">Silver hour</option></select></label><label>Look<select id="look"><option value="diorama">HD-2D diorama</option><option value="ink">Atmospheric ink</option><option value="cinematic">Dark cinematic</option></select></label><fieldset id="foundation"><legend>Flat foundation</legend><label>Ground<select id="floor"></select></label><label>Width<input id="width" type="number" min="2" max="100" step="1"></label><label>Depth<input id="depth" type="number" min="2" max="100" step="1"></label></fieldset><h2>Selected object</h2><p id="selected-name">Select an object</p><fieldset id="transform" disabled><label>Clip<select id="clip"></select></label><label>Facing<select id="heading"></select></label><label>X<input id="x" type="number" step=".1"></label><label>Z<input id="z" type="number" step=".1"></label><label>Height offset<input id="y" type="number" step=".1"></label><label>Size<input id="scale" type="number" min=".05" max="20" step=".05"></label><label id="rotation-label">Rotation (degrees)<input id="rotation" type="number" min="-360" max="360" step="5"></label><label><input id="mirror" type="checkbox"> Mirror</label></fieldset><h2>Objects</h2><p class="hint">Terrain, architecture, paths, and attached fixtures are locked.</p><div id="objects" role="list" aria-label="Scene objects"></div></aside></main>
<dialog id="art-preview"><p id="art-preview-label"></p><canvas id="art-preview-canvas" width="960" height="720" style="max-width:100%;height:auto"></canvas><form method="dialog"><button>Close</button></form></dialog><dialog id="save-dialog"><form method="dialog"><h2>Save scene copy</h2><label>File name<input id="file-id" required pattern="[a-z](?:[a-z0-9]|-){0,63}" maxlength="64" placeholder="my-forest-scene"></label><p>Use lowercase letters, numbers and hyphens. Copies are authoring drafts.</p><div><button value="cancel">Cancel</button><button id="confirm-save" value="save">Save copy</button></div></form></dialog>`;
const canvas = $<HTMLCanvasElement>('viewport');
let runtime: AssetRuntime,
  view: EditorView,
  history = new EditorHistory(emptyScene()),
  selected: string | undefined,
  revision: string | null = null,
  baseRevision = '',
  token = '',
  savedSnapshot = '',
  busy = true,
  ready = false;
let assetCatalog: Readonly<Record<string, string>> = {};
let palette: {
    asset: string;
    clip: string;
    kind: PaletteKind | 'reference';
    manifest: Manifest;
  }[] = [],
  chosen: (typeof palette)[number] | undefined;
let recoveryKey = '';
const recoveryPrefix = 'lantern-scene-editor-recovery:' + location.origin + location.pathname + ':';
type Recovery = {
  document: SceneDocument;
  revision: string | null;
  baseRevision: string;
  savedSnapshot: string;
};
let recovery: Recovery | undefined;
function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function dirty() {
  return JSON.stringify(history.document) !== savedSnapshot;
}
function recover() {
  if (!$('recovery').hidden || !recoveryKey) return;
  try {
    if (dirty()) {
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({ document: history.document, revision, baseRevision, savedSnapshot }),
      );
    } else localStorage.removeItem(recoveryKey);
  } catch {
    status('Local recovery is unavailable. Save your scene to preserve it.', true);
  }
}
function controls() {
  if (palette.length) showPalette();
  const d = history.document,
    items = sceneItems(d),
    item = items.find((p) => p.placement.id === selected),
    p = item?.placement;
  $<HTMLInputElement>('name').value = d.name;
  $('live-badge').hidden = d.target !== 'live';
  $('foundation').hidden = d.base !== 'flat';
  $<HTMLSelectElement>('rig').value = d.look.rig;
  $<HTMLSelectElement>('look').value = d.look.look;
  if (d.floor) {
    $<HTMLSelectElement>('floor').value = d.floor.asset + '/' + d.floor.clip;
    $<HTMLInputElement>('width').value = String(d.floor.width);
    $<HTMLInputElement>('depth').value = String(d.floor.depth);
  }
  $<HTMLFieldSetElement>('transform').disabled = busy || !p || !!item?.locked;
  $('selected-name').textContent = p
    ? `${p.id}${item?.locked ? ' · locked fixture' : ''}`
    : 'Select an object';
  for (const key of ['x', 'z', 'y', 'scale'] as const)
    $<HTMLInputElement>(key).value = p ? String(p[key] ?? (key === 'scale' ? 1 : 0)) : '';
  $<HTMLInputElement>('mirror').checked = !!p?.mirror;
  const curated = p && d.profile !== 'study' ? paletteEntry(p) : undefined;
  const fixedAttachment = !!p?.mount && d.profile !== 'study';
  const size = $<HTMLInputElement>('scale');
  size.min = String(fixedAttachment ? 1 : (curated?.scale[0] ?? 0.05));
  size.max = String(fixedAttachment ? 1 : (curated?.scale[1] ?? 20));
  size.disabled = fixedAttachment || (!!curated && curated.scale[0] === curated.scale[1]);
  $<HTMLInputElement>('x').disabled = !!p?.mount && d.profile !== 'study';
  $<HTMLInputElement>('z').disabled = !!p?.mount && d.profile !== 'study';
  const manifest = p ? palette.find((e) => e.asset === p.asset)?.manifest : undefined;
  $<HTMLInputElement>('mirror').disabled =
    (d.profile !== 'study' && !curated?.mirror) ||
    manifest?.asset.mirroring === false ||
    (manifest?.asset.type === 'character' && manifest.asset.mirroring !== true);
  const clipSelect = $<HTMLSelectElement>('clip'),
    headingSelect = $<HTMLSelectElement>('heading');
  clipSelect.replaceChildren();
  headingSelect.replaceChildren();
  for (const clip of manifest ? paletteClips(manifest) : [])
    if (
      d.profile === 'study' ||
      paletteEntry({ asset: manifest!.asset.id, clip })?.profiles.includes(d.profile)
    )
      clipSelect.add(new Option(clip, clip));
  if (p) clipSelect.value = p.clip;
  for (const heading of Object.keys(manifest?.asset.clips[p?.clip ?? ''] ?? {}))
    headingSelect.add(
      new Option(
        manifest?.asset.viewMode === 'fixed-authored'
          ? 'Authored view'
          : ((
              {
                d00: 'Down-left',
                d45: 'Down',
                d90: 'Down-right',
                d135: 'Right',
                d180: 'Up-right',
                d225: 'Up',
                d270: 'Up-left',
                d315: 'Left',
              } as Record<string, string>
            )[heading] ?? heading),
        heading,
      ),
    );
  if (p) headingSelect.value = p.heading ?? 'd45';
  $<HTMLInputElement>('rotation').value = String(((p?.rotation ?? 0) * 180) / Math.PI);
  $('rotation-label').hidden = item?.kind !== 'decal';
  $<HTMLInputElement>('y').disabled = d.profile !== 'study' || item?.kind === 'decal';
  $<HTMLButtonElement>('undo').disabled = busy || !history.canUndo;
  $<HTMLButtonElement>('redo').disabled = busy || !history.canRedo;
  for (const key of ['delete', 'duplicate'])
    $<HTMLButtonElement>(key).disabled = busy || !p || !!item?.locked;
  for (const key of [
    'save',
    'save-as',
    'open',
    'name',
    'rig',
    'look',
    'floor',
    'width',
    'depth',
    'fit',
  ])
    $<HTMLInputElement>(key).disabled = busy;
  $('save-state').textContent = busy ? 'Working…' : dirty() ? 'Unsaved' : 'Saved';
  $('objects').replaceChildren();
  for (const item of items) {
    const b = document.createElement('button');
    b.textContent = `${item.locked ? '🔒 ' : ''}${item.placement.id}`;
    b.classList.toggle('active', item.placement.id === selected);
    b.setAttribute('role', 'listitem');
    b.onclick = () => select(item.placement.id);
    $('objects').append(b);
  }
  const notes = sceneCompositionFindings(resolveAuthoredScene(d));
  $('composition-notes').hidden = notes.length === 0;
  $('composition-notes').textContent =
    notes.slice(0, 3).join('; ') + (notes.length > 3 ? `; ${notes.length - 3} more notes` : '');
  view?.select(selected);
  view?.setGrid($<HTMLInputElement>('grid').checked);
}
function select(id: string | undefined) {
  selected = id;
  chosen = undefined;
  controls();
}
function launch(work: Promise<unknown>) {
  work.catch((error) => status(error instanceof Error ? error.message : String(error), true));
}
async function run(action: () => Promise<void>, restoring = false) {
  if (busy) return;
  if (!$('recovery').hidden && !restoring) {
    status('Restore or dismiss the previous recovery before editing.', true);
    controls();
    return;
  }
  busy = true;
  try {
    const pending = action();
    controls();
    await pending;
  } catch (error) {
    status((error as Error).message, true);
  } finally {
    busy = false;
    controls();
  }
}
async function refresh() {
  recover();
  await view.apply(history.document);
  view.setGrid($<HTMLInputElement>('grid').checked);
  view.render();
}
async function change(mutator: (d: SceneDocument) => void) {
  await run(async () => {
    history.change(mutator);
    await refresh();
    status('Composition updated.');
  });
}
function fit() {
  const p = view.presentation;
  if (!p) return;
  const b = p.area.bounds;
  p.center.set((b.minX + b.maxX) / 2, 1.8, (b.minZ + b.maxZ) / 2);
  p.verticalSpan = Math.max(10, Math.min(50, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.85));
  p.resize();
  view.render();
}
async function api(id?: string) {
  const r = await fetch('/__lantern_editor' + (id ? '?id=' + encodeURIComponent(id) : ''));
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
async function list() {
  const data = await api();
  token = data.token;
  baseRevision = data.baseRevision;
  recoveryKey = recoveryPrefix + data.workspace;
  const select = $<HTMLSelectElement>('scene');
  for (const option of [...select.options]) if (option.dataset.saved) option.remove();
  for (const scene of data.scenes as {
    id: string;
    name: string;
    target?: string;
    error?: string;
  }[]) {
    if (scene.id.startsWith('live-')) continue;
    const o = new Option(scene.name + (scene.error ? ' · invalid file' : ''), 'file-' + scene.id);
    o.dataset.saved = 'true';
    select.add(o);
  }
}
async function open(value: string) {
  if (dirty() && !confirm('Discard unsaved edits and open another scene?')) return;
  await run(async () => {
    let d: SceneDocument,
      nextRevision: string | null = null,
      nextBaseRevision = baseRevision,
      nextSavedSnapshot = '';
    if (value === 'new') {
      d = emptyScene();
    } else {
      const id = value.startsWith('file-')
        ? value.slice(5)
        : value.startsWith('copy-')
          ? 'live-' + value.slice(5)
          : value;
      const data = await api(id);
      if (!data.document) throw new Error('Scene file is unavailable');
      d = parseSceneDocument(data.document);
      nextRevision = data.revision;
      nextBaseRevision = data.baseRevision;
      if (value.startsWith('copy-')) {
        d = { ...d, id: 'untitled', name: 'Copy of ' + d.name, target: 'draft' };
        nextRevision = null;
      } else nextSavedSnapshot = JSON.stringify(d);
    }
    const nextHistory = new EditorHistory(d);
    await view.apply(nextHistory.document);
    history = nextHistory;
    revision = nextRevision;
    baseRevision = nextBaseRevision;
    savedSnapshot = nextSavedSnapshot;
    selected = undefined;
    view.setGrid($<HTMLInputElement>('grid').checked);
    view.render();
    recover();
    fit();
    $('conflict').hidden = true;
    status(
      d.target === 'live'
        ? 'Live room opened. Saving changes its scenery in the game.'
        : 'Draft opened.',
    );
  });
}
async function save(copyId?: string) {
  await run(async () => {
    const document = copyId
      ? { ...history.document, id: copyId, target: 'draft' as const }
      : history.document;
    if (copyId) parseSceneDocument(document);
    const r = await fetch('/__lantern_editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lantern-Editor-Token': token },
      body: JSON.stringify({ document, revision: copyId ? null : revision, baseRevision }),
    });
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 409) $('conflict').hidden = false;
      throw new Error(data.error);
    }
    history.reidentify(data.document.id, data.document.target);
    revision = data.revision;
    baseRevision = data.baseRevision;
    savedSnapshot = JSON.stringify(history.document);
    recover();
    $('conflict').hidden = true;
    await list();
    status(
      history.document.target === 'live'
        ? 'Saved. The game now uses this scenery.'
        : 'Draft saved to authoring/scenes/' + history.document.id + '.json',
    );
  });
}
function saveAs() {
  const input = $<HTMLInputElement>('file-id');
  input.value = history.document.id.startsWith('live-')
    ? ''
    : history.document.id === 'untitled'
      ? ''
      : history.document.id + '-copy';
  $<HTMLDialogElement>('save-dialog').showModal();
  input.focus();
}
$('save-dialog').addEventListener('close', () => {
  if ($<HTMLDialogElement>('save-dialog').returnValue === 'save')
    launch(save($<HTMLInputElement>('file-id').value));
});
$('open').onclick = () => void open($<HTMLSelectElement>('scene').value);
$('save').onclick = () => {
  if (revision === null) saveAs();
  else launch(save());
};
$('save-as').onclick = saveAs;
$('conflict-copy').onclick = saveAs;
$('reload').onclick = () => void open('file-' + history.document.id);
$('name').onchange = () =>
  void change((d) => {
    d.name = $<HTMLInputElement>('name').value;
  });
for (const id of ['rig', 'look'])
  $(id).onchange = () =>
    void change((d) => {
      d.look = {
        rig: $<HTMLSelectElement>('rig').value as SceneDocument['look']['rig'],
        look: $<HTMLSelectElement>('look').value as SceneDocument['look']['look'],
      };
    });
for (const id of ['floor', 'width', 'depth'])
  $(id).onchange = () =>
    void change((d) => {
      if (!d.floor) return;
      const [asset, clip] = $<HTMLSelectElement>('floor').value.split('/');
      d.floor = {
        asset: asset!,
        clip: clip!,
        width: Number($<HTMLInputElement>('width').value),
        depth: Number($<HTMLInputElement>('depth').value),
      };
    });
for (const id of ['x', 'z', 'y', 'scale', 'rotation', 'mirror'])
  $(id).onchange = () =>
    void run(async () => {
      if (!selected) return;
      const value =
        id === 'mirror'
          ? $<HTMLInputElement>(id).checked
          : Number($<HTMLInputElement>(id).value) * (id === 'rotation' ? Math.PI / 180 : 1);
      history.transform(selected, { [id]: value });
      await refresh();
    });
$('undo').onclick = () =>
  void run(async () => {
    history.undo();
    await refresh();
  });
$('redo').onclick = () =>
  void run(async () => {
    history.redo();
    await refresh();
  });
$('duplicate').onclick = () =>
  void run(async () => {
    if (selected) {
      selected = history.duplicate(selected);
      await refresh();
    }
  });
$('delete').onclick = () =>
  void run(async () => {
    if (selected) {
      history.remove(selected);
      selected = undefined;
      await refresh();
    }
  });
$('fit').onclick = fit;
let animationPlaying = true;
$('play-animation').onclick = () => {
  animationPlaying = !animationPlaying;
  view?.setAnimationPlaying(animationPlaying);
  $('play-animation').textContent = animationPlaying ? 'Pause animations' : 'Play animations';
};
$('replay-animation').onclick = () => view?.replayAnimations();
$('clip').onchange = () =>
  void change((d) => {
    const p = d.objects.find((p) => p.id === selected);
    if (!p) return;
    p.clip = $<HTMLSelectElement>('clip').value;
    const m = palette.find((e) => e.asset === p.asset)!.manifest;
    if (!m.asset.clips[p.clip]?.[p.heading ?? 'd45'])
      p.heading = Object.keys(m.asset.clips[p.clip]!)[0] as NonNullable<typeof p.heading>;
  });
$('heading').onchange = () =>
  void change((d) => {
    const p = d.objects.find((p) => p.id === selected);
    if (p) p.heading = $<HTMLSelectElement>('heading').value as NonNullable<typeof p.heading>;
  });
$('grid').onchange = () => view?.setGrid($<HTMLInputElement>('grid').checked);
const images = new Map<string, Promise<HTMLImageElement>>();
async function thumbnail(entry: (typeof palette)[number], target: HTMLCanvasElement) {
  const m = entry.manifest,
    f = m.frames.find((f) => f.id === Object.values(m.asset.clips[entry.clip]!)[0]!.frames[0])!,
    page = m.pages.find((p) => p.id === f.page)!,
    src = '/' + assetCatalog[entry.asset]!.replace(/manifest\.json$/, page.path);
  let promise = images.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    images.set(src, promise);
    if (images.size > 48) images.delete(images.keys().next().value!);
  }
  const image = await promise;
  if (!target.isConnected) return;
  const ctx = target.getContext('2d')!,
    [x, y, w, h] = f.rect,
    ratio = Math.min(target.width / w, target.height / h);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(
    image,
    x,
    y,
    w,
    h,
    (target.width - w * ratio) / 2,
    (target.height - h * ratio) / 2,
    w * ratio,
    h * ratio,
  );
}
const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        const c = e.target as HTMLCanvasElement,
          entry = palette[Number(c.dataset.index)]!;
        observer.unobserve(c);
        void thumbnail(entry, c).catch(() => {});
      }
  },
  { root: $('assets') },
);
function showPalette() {
  observer.disconnect();
  $('assets').replaceChildren();
  const search = $<HTMLInputElement>('search').value.toLowerCase(),
    kind = $<HTMLSelectElement>('category').value;
  for (const [index, entry] of palette.entries())
    if (
      (history.document.profile === 'study' ||
        paletteEntry(entry)?.profiles.includes(history.document.profile)) &&
      (kind === 'all' ||
        kind === entry.kind ||
        (kind === 'pickup' && entry.manifest.asset.category === 'pickup') ||
        (kind === 'animated' &&
          Object.values(entry.manifest.asset.clips[entry.clip]!).some(
            (c) => c && c.frames.length > 1,
          ))) &&
      `${entry.manifest.asset.label ?? ''} ${entry.asset} ${entry.clip}`
        .toLowerCase()
        .includes(search)
    ) {
      const button = document.createElement('button');
      button.className = 'asset';
      button.title = entry.asset + '/' + entry.clip;
      button.draggable = true;
      const c = document.createElement('canvas');
      c.width = 112;
      c.height = 80;
      c.dataset.index = String(index);
      c.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = `${entry.manifest.asset.label ?? entry.asset} · ${entry.clip.replaceAll('_', ' ')} · ${entry.asset.startsWith('library-') ? 'TEST' : 'study'}`;
      button.append(c, label);
      button.onclick = () => {
        if (entry.kind === 'reference') {
          $('art-preview-label').textContent =
            `${entry.manifest.asset.label ?? entry.asset} · Reference artwork; this projection cannot be placed in a scene.`;
          $<HTMLDialogElement>('art-preview').showModal();
          launch(thumbnail(entry, $<HTMLCanvasElement>('art-preview-canvas')));
          return;
        }
        chosen = entry;
        selected = undefined;
        controls();
        status('Click the ground to place ' + entry.clip + '.');
      };
      button.ondragstart = (e) => {
        if (entry.kind === 'reference') {
          e.preventDefault();
          return;
        }
        e.dataTransfer!.setData('application/x-lantern-asset', String(index));
        e.dataTransfer!.effectAllowed = 'copy';
      };
      $('assets').append(button);
      observer.observe(c);
    }
}
$('search').oninput = showPalette;
$('category').onchange = showPalette;
function snapped(n: number) {
  return $<HTMLInputElement>('grid').checked ? Math.round(n * 2) / 2 : n;
}
async function place(entry: (typeof palette)[number], x: number, y: number) {
  if (entry.kind === 'reference') return;
  const point = view.ground(x, y);
  if (!point) return;
  await run(async () => {
    const id = 'object-' + crypto.randomUUID();
    history.change((d) =>
      d.objects.push(
        applySceneryPreset({
          id,
          kind: entry.kind as PaletteKind,
          asset: entry.asset,
          clip: entry.clip,
          heading: Object.keys(entry.manifest.asset.clips[entry.clip]!)[0] as NonNullable<
            SceneDocument['objects'][number]['heading']
          >,
          x: snapped(point.x),
          z: snapped(point.z),
          scale: 1,
          zone:
            d.profile === 'study'
              ? undefined
              : Object.entries(sceneDesignProfiles[d.profile].zones).find(
                  ([, v]) =>
                    (v.kind !== 'clear' || paletteEntry(entry)?.category === 'ground-panel') &&
                    point.x >= v.bounds.minX &&
                    point.x <= v.bounds.maxX &&
                    point.z >= v.bounds.minZ &&
                    point.z <= v.bounds.maxZ,
                )?.[0],
        }),
      ),
    );
    selected = id;
    chosen = undefined;
    await refresh();
    status('Placed ' + entry.clip + '.');
  });
}
canvas.ondragover = (e) => {
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
};
canvas.ondrop = (e) => {
  e.preventDefault();
  const value = e.dataTransfer!.getData('application/x-lantern-asset');
  if (value === '') return;
  const entry = palette[Number(value)];
  if (entry && !busy) launch(place(entry, e.clientX, e.clientY));
};
type Drag = {
  pointer: number;
  mode: 'pan' | 'object' | 'hero';
  start: T.Vector3;
  center: T.Vector3;
  x: number;
  z: number;
  height: number;
  id?: string;
  changed?: boolean;
  next?: T.Vector3;
};
let drag: Drag | undefined;
canvas.oncontextmenu = (e) => e.preventDefault();
canvas.onpointerdown = (e) => {
  if (busy || !view.presentation || !$('recovery').hidden) return;
  canvas.focus();
  if (e.button !== 0 && e.button !== 2 && e.button !== 1) return;
  if (chosen && e.button === 0) {
    launch(place(chosen, e.clientX, e.clientY));
    return;
  }
  const item = e.button === 0 ? view.pick(e.clientX, e.clientY, history.document) : undefined,
    hero = $<HTMLInputElement>('hero-tool').checked && e.button === 0;
  let mode: Drag['mode'] = hero ? 'hero' : e.button !== 0 ? 'pan' : 'object';
  if (mode === 'object') {
    select(item?.placement.id);
    if (!item || item.locked) return;
  }
  const root = hero ? history.document.hero : (item?.placement ?? { x: 0, z: 0 }),
    height =
      mode === 'pan'
        ? 0
        : heightAt(view.sim!.areaDefinition, root.x, root.z) +
          (hero ? 0 : (item?.placement.y ?? 0)),
    start = view.ground(e.clientX, e.clientY, height);
  if (!start) return;
  drag = {
    pointer: e.pointerId,
    mode,
    start,
    center: view.presentation.center.clone(),
    x: root.x,
    z: root.z,
    height,
    id: item?.placement.id,
  };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag || !view.presentation) return;
  const point = view.ground(e.clientX, e.clientY, drag.height);
  if (!point) return;
  const dx = point.x - drag.start.x,
    dz = point.z - drag.start.z;
  if (drag.mode === 'pan') {
    const offset = view.presentation.center.clone().sub(drag.center);
    view.presentation.center.copy(drag.center).sub(new T.Vector3(dx - offset.x, 0, dz - offset.z));
    view.render();
    return;
  }
  const next = new T.Vector3(snapped(drag.x + dx), 0, snapped(drag.z + dz));
  drag.next = next;
  drag.changed = Math.abs(next.x - drag.x) + Math.abs(next.z - drag.z) > 0.001;
  if (drag.mode === 'hero') view.hero(next);
  else view.previewPosition(drag.id!, next.x, next.z);
  view.render();
};
function finishDrag(cancel = false) {
  const current = drag;
  drag = undefined;
  if (!current) return;
  if (canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer);
  if (current.mode === 'pan') return;
  launch(
    run(async () => {
      if (!cancel && current.changed && current.next) {
        const { x, z } = current.next;
        if (current.mode === 'hero')
          history.change((d) => {
            d.hero = { x, z };
          });
        else history.transform(current.id!, { x, z });
      }
      await refresh();
    }),
  );
}
canvas.onpointerup = () => finishDrag();
canvas.onpointercancel = () => finishDrag(true);
canvas.onlostpointercapture = () => {
  if (drag) finishDrag(true);
};
canvas.onwheel = (e) => {
  e.preventDefault();
  if (busy || !view?.presentation) return;
  view.presentation.verticalSpan = Math.max(
    3,
    Math.min(100, view.presentation.verticalSpan * Math.exp(e.deltaY * 0.001)),
  );
  view.resize();
  view.render();
};
document.addEventListener('keydown', (e) => {
  const text =
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement;
  if (text || $<HTMLDialogElement>('save-dialog').open) return;
  if (e.key === 'Escape') {
    finishDrag(true);
    select(undefined);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    $('save').click();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    $(e.shiftKey ? 'redo' : 'undo').click();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    $('duplicate').click();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    $('delete').click();
  }
});
window.addEventListener('beforeunload', (e) => {
  recover();
  if (dirty() && !new URLSearchParams(location.search).has('automated')) {
    e.preventDefault();
    e.returnValue = '';
  }
});
$('dismiss-recovery').onclick = () => {
  recovery = undefined;
  localStorage.removeItem(recoveryKey);
  $('recovery').hidden = true;
};
$('restore').onclick = () =>
  void run(async () => {
    if (!recovery) return;
    const nextHistory = new EditorHistory(recovery.document),
      changedFoundations = recovery.baseRevision !== baseRevision;
    await view.apply(nextHistory.document);
    history = nextHistory;
    revision = recovery.revision;
    savedSnapshot = recovery.savedSnapshot;
    selected = undefined;
    view.setGrid($<HTMLInputElement>('grid').checked);
    view.render();
    fit();
    $('recovery').hidden = true;
    recovery = undefined;
    recover();
    status(
      changedFoundations
        ? 'Recovery restored against updated foundations. Review the composition before saving.'
        : 'Recovery restored.',
    );
  }, true);
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => view?.resize());
}).observe(canvas.parentElement!);
let last = 0,
  frame = 0;
function animate(time: number) {
  frame = requestAnimationFrame(animate);
  if (!ready || busy) return;
  if (
    !new URLSearchParams(location.search).has('automated') &&
    (document.hidden || !document.hasFocus()) &&
    time - last < 1000
  )
    return;
  const ms = last ? Math.min(50, time - last) : 0;
  last = time;
  view.render(ms);
}
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frame);
  observer.disconnect();
  view?.dispose();
});
async function start() {
  await list();
  try {
    const stored = localStorage.getItem(recoveryKey);
    if (stored) {
      const value = JSON.parse(stored);
      recovery = {
        document: parseSceneDocument(value.document),
        revision: value.revision,
        baseRevision: value.baseRevision,
        savedSnapshot: value.savedSnapshot
          ? JSON.stringify(parseSceneDocument(JSON.parse(value.savedSnapshot)))
          : '',
      };
      $('recovery').hidden = false;
    }
  } catch {
    $('recovery').hidden = false;
    $<HTMLButtonElement>('restore').disabled = true;
    status('Saved recovery could not be read; dismiss it explicitly to start a new scene.', true);
  }
  assetCatalog = await authoringCatalog();
  runtime = await AssetRuntime.open(assetCatalog);
  view = new EditorView(canvas, runtime);
  const manifests = await Promise.all(Object.keys(assetCatalog).map((id) => runtime.manifest(id)));
  for (const m of manifests) {
    const kind = paletteKind(m) ?? (m.asset.placement === 'reference' ? 'reference' : undefined);
    if (kind)
      for (const clip of paletteClips(m))
        palette.push({ asset: m.asset.id, clip, kind, manifest: m });
    for (const clip of floorClips(m))
      $<HTMLSelectElement>('floor').add(
        new Option(m.asset.id + ' / ' + clip, m.asset.id + '/' + clip),
      );
  }
  palette.sort((a, b) => a.asset.localeCompare(b.asset) || a.clip.localeCompare(b.clip));
  showPalette();
  await view.apply(history.document);
  fit();
  busy = false;
  controls();
  ready = true;
  if ($('recovery').hidden) status('Ready. Drag artwork into the scene.');
  frame = requestAnimationFrame(animate);
}
// Development-only inspection supports browser acceptance without exposing a player bridge.
declare global {
  interface Window {
    sceneEditor: {
      ready: () => boolean;
      state: () => {
        document: SceneDocument;
        revision: string | null;
        dirty: boolean;
        selected: string | undefined;
      };
      view: () => EditorView;
      dispose: () => void;
    };
  }
}
window.sceneEditor = {
  ready: () => ready,
  state: () => ({ document: history.document, revision, dirty: dirty(), selected }),
  view: () => view,
  dispose: () => view.dispose(),
};
controls();
void start().catch((error) => status('Editor startup failed: ' + error.message, true));
