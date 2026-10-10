import {
  assetClosure,
  matchesAsset,
  loadAssetIndex,
  type AssetScope,
  type AssetFilter,
} from '../assets/asset-browser';
import { documentAssetRoots, usedAssetRoots } from '../content/asset-usage';
import { editorError } from './errors';
import { FrameScheduler } from '../frame-scheduler';
import { DraftPlaytest } from './playtest';
import { composeDraftGameplay, withGameplayDefaults } from '../content/draft-gameplay';
import { contentDefinitions } from '../content/game-content';
import { worldVisuals } from '../content/game-content';
import { SceneLibrary } from './library';
import { VisualAuthoring } from './visual-authoring';
import { CompositionTools } from './composition';
import { editorUI } from './ui';
import { EditorWorkspace, openDock } from './workspace';
import { emptyScene } from './default-scene';
import { resolveAuthoredScene } from '../content/world-art';
import {
  paletteEntry,
  sceneDesignProfiles,
  sceneCompositionFindings,
} from '../content/scene-design';
import * as T from 'three';
import { AssetRuntime } from '../assets/loader';
import type { Manifest } from '../assets/schema';
import { authoringCatalog } from '../assets/authoring-catalog';
import {
  parseSceneDocument,
  paletteKind,
  paletteClips,
  floorClips,
  type SceneDocument,
  type PaletteKind,
} from '../content/scene-document';
import { heightAt } from '../content/world';
import { applySceneryPreset } from '../content/scenery-presets';
import { EditorHistory, sceneItems } from './model';
import { EditorView } from './view';

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
      playtest: () => ReturnType<DraftPlaytest['state']>;
      dispose: () => void;
    };
  }
}
export function createEditorSession() {
  const lifetime = new AbortController();
  const automated = new URLSearchParams(location.search).has('automated');
  let closed = false;
  function assertActive() {
    lifetime.signal.throwIfAborted();
  }
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  document.getElementById('app')!.innerHTML = editorUI;
  const workspace = new EditorWorkspace();
  let composition: CompositionTools;
  let visualAuthoring: VisualAuthoring;
  let sceneLibrary: SceneLibrary;
  let playtest: DraftPlaytest;
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
  let assetIndex = new Map<string, Manifest>();
  let usedAssets = new Set<string>();
  let recoveryKey = '';
  let recoveryRoot = '';
  const recoveryPrefix =
    'lantern-scene-editor-recovery:' + location.origin + location.pathname + ':';
  type Recovery = {
    document: SceneDocument;
    revision: string | null;
    baseRevision: string;
    savedSnapshot: string;
    savedAt?: string;
  };
  let recovery: Recovery | undefined;
  function status(message: string, error = false) {
    if (closed) return;
    workspace.notify(message, error);
    $('status').classList.toggle('error', error);
    $('validation-errors').textContent = error ? 'Error: ' + message : '';
    $('validation-errors').hidden = !error;
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
          JSON.stringify({
            document: history.document,
            revision,
            baseRevision,
            savedSnapshot,
            savedAt: new Date().toISOString(),
          }),
        );
      } else localStorage.removeItem(recoveryKey);
    } catch {
      status('Local recovery is unavailable. Save your scene to preserve it.', true);
    }
  }
  function controls() {
    if (closed) return;
    const d = history.document,
      items = sceneItems(d),
      item = items.find((p) => p.placement.id === selected),
      p = item?.placement,
      locked = !!p && !!composition?.locked.has(p.id);
    $<HTMLInputElement>('name').value = d.name;
    $('live-badge').hidden = d.target !== 'live';
    $('foundation').hidden = false;
    $<HTMLSelectElement>('rig').value = d.look.rig;
    $<HTMLSelectElement>('look').value = d.look.look;
    $<HTMLSelectElement>('floor').value = d.floor.asset + '/' + (d.floor.clip ?? 'surface');
    $<HTMLInputElement>('width').value = String(d.floor.width);
    $<HTMLInputElement>('depth').value = String(d.floor.depth);
    $<HTMLFieldSetElement>('transform').disabled = busy || !p || locked;
    $('selected-name').textContent = p ? (locked ? 'Locked object' : '') : 'Select an object';
    for (const key of ['x', 'z', 'y', 'scale'] as const)
      $<HTMLInputElement>(key).value = p
        ? String(Number((p[key] ?? (key === 'scale' ? 1 : 0)).toFixed(3)))
        : '';
    $<HTMLInputElement>('mirror').checked = !!p?.mirror;
    const size = $<HTMLInputElement>('scale');
    size.min = '0.05';
    size.max = '20';
    size.disabled = false;
    $<HTMLInputElement>('x').disabled = false;
    $<HTMLInputElement>('z').disabled = false;
    const manifest = p ? palette.find((e) => e.asset === p.asset)?.manifest : undefined;
    $<HTMLInputElement>('mirror').disabled = false;
    const clipSelect = $<HTMLSelectElement>('clip'),
      headingSelect = $<HTMLSelectElement>('heading');
    clipSelect.replaceChildren();
    headingSelect.replaceChildren();
    for (const clip of manifest ? paletteClips(manifest) : [])
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
    $<HTMLInputElement>('rotation').value = String(
      Number((((p?.rotation ?? 0) * 180) / Math.PI).toFixed(3)),
    );
    $('rotation-label').hidden = false;
    $<HTMLInputElement>('y').disabled = item?.kind === 'decal';
    $<HTMLButtonElement>('undo').disabled = busy || !history.canUndo;
    $<HTMLButtonElement>('redo').disabled = busy || !history.canRedo;
    for (const key of ['delete', 'duplicate'])
      $<HTMLButtonElement>(key).disabled = busy || !p || locked;
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
      'play-from-here',
      'scene-library',
      'import-scene',
      'copy-scene',
      'tool',
      'snap-spacing',
      'preview-asset',
    ]) {
      const control = document.getElementById(key) as HTMLInputElement | null;
      if (control) control.disabled = busy;
    }
    $('save-state').textContent = busy ? 'Working…' : dirty() ? 'Unsaved' : 'Saved';
    const notes = sceneCompositionFindings(resolveAuthoredScene(d));
    $('composition-notes').hidden = notes.length === 0;
    $('composition-notes').textContent = notes.join('; ');
    view?.select(selected);
    view?.setGrid($<HTMLInputElement>('grid').checked);
    composition?.render();
    visualAuthoring?.render(busy, composition?.selection.size > 1);
    $('scene-summary-text').textContent = `${d.name} · ${items.length} objects`;
    workspace.refresh();
    sceneLibrary?.refresh();
    if (ready && $<HTMLSelectElement>('asset-scope').value === 'scene') showPalette();
  }
  function select(id: string | undefined) {
    selected = id;
    chosen = undefined;
    view?.clearPlacementGhost();
    $('asset-choice').hidden = true;
    if ($<HTMLSelectElement>('tool').value === 'place')
      $<HTMLSelectElement>('tool').value = 'select';
    controls();
  }
  function launch(work: Promise<unknown>) {
    work.catch((error) => status(editorError(error), true));
  }
  async function run(action: () => Promise<void>, restoring = false) {
    if (closed || busy) return;
    composition?.cancelGesture();
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
      status(editorError(error), true);
    } finally {
      if (!closed) {
        busy = false;
        controls();
      }
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
      const next = structuredClone(history.document);
      mutator(next);
      const valid = parseSceneDocument(next);
      resolveAuthoredScene(valid);
      if (valid.gameplay) composeDraftGameplay(valid, contentDefinitions, worldVisuals);
      try {
        await view.apply(valid);
        assertActive();
      } catch (error) {
        await view.apply(history.document);
        throw error;
      }
      history.change((d) => {
        for (const key of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[key];
        Object.assign(d, valid);
      });
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
    const corners = [
      [b.minX, b.minZ],
      [b.minX, b.maxZ],
      [b.maxX, b.minZ],
      [b.maxX, b.maxZ],
    ].map(([x, z]) => view.screen(new T.Vector3(x!, 0, z!)));
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
    const height = Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y));
    p.verticalSpan = Math.max(
      3,
      Math.min(
        100,
        p.verticalSpan * Math.max(width / (rect.width * 0.9), height / (rect.height * 0.9)),
      ),
    );
    p.resize();
    view.render();
  }
  async function api(id?: string) {
    const r = await fetch('/__lantern_editor' + (id ? '?id=' + encodeURIComponent(id) : ''), {
      signal: lifetime.signal,
    });
    const data = await r.json();
    assertActive();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  async function list() {
    const data = await api();
    token = data.token;
    baseRevision = data.baseRevision;
    recoveryRoot = recoveryPrefix + data.workspace;
    if (!recoveryKey) recoveryKey = recoveryRoot + ':untitled';
    const select = $<HTMLSelectElement>('scene');
    for (const option of [...select.options]) if (option.dataset.saved) option.remove();
    for (const scene of data.scenes as {
      id: string;
      name: string;
      target?: string;
      error?: string;
    }[]) {
      const o = new Option(
        scene.name +
          (scene.target === 'live' ? ' · LIVE' : ' · Draft') +
          (scene.error ? ' · invalid file' : ''),
        'file-' + scene.id,
      );
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
        d = parseSceneDocument(
          withGameplayDefaults(parseSceneDocument(data.document), contentDefinitions),
        );
        nextRevision = data.revision;
        nextBaseRevision = data.baseRevision;
        if (value.startsWith('copy-')) {
          d = { ...d, id: 'untitled', name: 'Copy of ' + d.name, target: 'draft' };
          nextRevision = null;
        } else nextSavedSnapshot = JSON.stringify(d);
      }
      const nextHistory = new EditorHistory(d);
      await view.apply(nextHistory.document);
      assertActive();
      history = nextHistory;
      recoveryKey = recoveryRoot + ':' + d.id;
      revision = nextRevision;
      baseRevision = nextBaseRevision;
      savedSnapshot = nextSavedSnapshot;
      selected = undefined;
      composition?.selection.clear();
      view.setGrid($<HTMLInputElement>('grid').checked);
      view.render();
      recover();
      fit();
      $('conflict').hidden = true;
      sceneLibrary?.remember();
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
        signal: lifetime.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lantern-Editor-Token': token },
        body: JSON.stringify({ document, revision: copyId ? null : revision, baseRevision }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) $('conflict').hidden = false;
        throw new Error(data.error);
      }
      localStorage.removeItem(recoveryKey);
      history.reidentify(data.document.id, data.document.target);
      recoveryKey = recoveryRoot + ':' + history.document.id;
      revision = data.revision;
      baseRevision = data.baseRevision;
      savedSnapshot = JSON.stringify(history.document);
      recover();
      $('conflict').hidden = true;
      await list();
      assertActive();
      sceneLibrary?.remember();
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
  $('copy-scene').onclick = () => {
    const document = {
      ...structuredClone(history.document),
      id: 'untitled',
      target: 'draft' as const,
      name: 'Copy of ' + history.document.name.slice(0, 72),
    };
    void importDocument(document).catch((e) => status(e.message, true));
  };
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
        const ids = composition.editable();
        const input = $<HTMLInputElement>(id);
        if (id !== 'mirror' && (!input.value.trim() || !Number.isFinite(value))) return;
        const temp = new EditorHistory(history.document);
        for (const target of ids) temp.transform(target, { [id]: value });
        history.change((d) => {
          d.objects = temp.document.objects;
        });
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
  $('duplicate').onclick = () => void composition?.duplicate();
  $('delete').onclick = () => void composition?.remove();
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
      f = m.frames.find((f) => f.id === Object.values(m.asset.clips[entry.clip]!)[0]!.frames[0])!;
    await drawFrame(entry, f, target);
  }
  async function drawFrame(
    entry: (typeof palette)[number],
    f: Manifest['frames'][number],
    target: HTMLCanvasElement,
  ) {
    const m = entry.manifest,
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
    workspace.refresh();
    const shown = new Set<string>();
    const filter = {
      search: $<HTMLInputElement>('search').value,
      type: $<HTMLSelectElement>('category').value as AssetFilter['type'],
      scope: $<HTMLSelectElement>('asset-scope').value as AssetScope,
      animated: $<HTMLInputElement>('asset-animated').checked,
    };
    const sceneAssets = assetClosure(documentAssetRoots(history.document), assetIndex);
    for (const [index, entry] of palette.entries())
      if (
        matchesAsset(entry.manifest, filter, usedAssets, sceneAssets) &&
        !shown.has(entry.asset) &&
        assetVisible(entry)
      ) {
        shown.add(entry.asset);
        const button = document.createElement('button');
        button.className = 'asset';
        button.title = entry.asset + '/' + entry.clip;
        button.classList.toggle('active', entry.asset === chosen?.asset);
        button.draggable = true;
        const c = document.createElement('canvas');
        c.width = 112;
        c.height = 80;
        c.dataset.index = String(index);
        c.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = (
          entry.manifest.asset.label ?? entry.asset.replace(/^(ink|library)-/, '')
        )
          .replaceAll('_', ' ')
          .replaceAll('-', ' ');
        const badge = document.createElement('span');
        badge.className = 'asset-status';
        badge.textContent =
          entry.kind === 'reference'
            ? 'Reference'
            : sceneAssets.has(entry.asset)
              ? 'In this scene'
              : usedAssets.has(entry.asset)
                ? 'In use'
                : 'Library';
        button.append(c, label, badge);
        button.onclick = () => {
          if (entry.kind === 'reference') {
            $('art-preview-label').textContent =
              `${entry.manifest.asset.label ?? entry.asset} · Reference artwork; this projection cannot be placed in a scene.`;
            $<HTMLDialogElement>('art-preview').showModal();
            launch(thumbnail(entry, $<HTMLCanvasElement>('art-preview-canvas')));
            return;
          }
          chooseAsset(entry);
          selected = undefined;
          composition.selection.clear();
          controls();
          workspace.refresh();
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

  const favorites = new Set<string>();
  let recent: string[] = [];
  try {
    JSON.parse(localStorage.getItem('lantern-editor-favorites') ?? '[]').forEach((id: string) =>
      favorites.add(id),
    );
    recent = JSON.parse(localStorage.getItem('lantern-editor-recent') ?? '[]');
  } catch {
    /* Disposable preferences. */
  }
  function rememberAsset(id: string) {
    recent = [id, ...recent.filter((v) => v !== id)].slice(0, 24);
    try {
      localStorage.setItem('lantern-editor-recent', JSON.stringify(recent));
    } catch {
      /* Disposable preferences. */
    }
  }
  function assetVisible(entry: (typeof palette)[number]) {
    const collection = $<HTMLSelectElement>('collection').value;
    return (
      collection === 'all' ||
      (collection === 'favorites' && favorites.has(entry.asset)) ||
      (collection === 'recent' && recent.includes(entry.asset)) ||
      (collection === 'ink' && entry.asset.startsWith('ink-')) ||
      (collection === 'library' && entry.asset.startsWith('library-'))
    );
  }
  function chooseAsset(entry: (typeof palette)[number]) {
    chosen = entry;
    $('favorite-asset').textContent = favorites.has(entry.asset) ? 'Unfavorite' : 'Favorite';
    $('asset-choice').hidden = false;
    $<HTMLSelectElement>('tool').value = 'place';
    openDock('artwork');
    const clips = $<HTMLSelectElement>('place-clip');
    clips.replaceChildren();
    for (const p of palette.filter((p) => p.asset === entry.asset))
      clips.add(new Option(p.clip.replaceAll('_', ' '), p.clip));
    clips.value = entry.clip;
    updatePlaceHeading();
    showPalette();
    workspace.refresh();
  }
  function updatePlaceHeading() {
    const headings = $<HTMLSelectElement>('place-heading');
    headings.replaceChildren();
    if (chosen)
      for (const h of Object.keys(chosen.manifest.asset.clips[chosen.clip]!))
        headings.add(
          new Option(
            (
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
            )[h] ?? h,
            h,
          ),
        );
    workspace.refresh();
  }
  $('place-clip').onchange = () => {
    if (chosen) {
      chosen = palette.find(
        (p) => p.asset === chosen!.asset && p.clip === $<HTMLSelectElement>('place-clip').value,
      );
      updatePlaceHeading();
    }
  };
  $('collection').onchange = showPalette;
  $('asset-scope').onchange = showPalette;
  $('asset-animated').onchange = showPalette;
  $('favorite-asset').onclick = () => {
    if (!chosen) return;
    if (favorites.has(chosen.asset)) favorites.delete(chosen.asset);
    else favorites.add(chosen.asset);
    try {
      localStorage.setItem('lantern-editor-favorites', JSON.stringify([...favorites]));
    } catch {
      /* Disposable preferences. */
    }
    $('favorite-asset').textContent = favorites.has(chosen.asset) ? 'Unfavorite' : 'Favorite';
    showPalette();
  };
  let previewEntry: (typeof palette)[number] | undefined,
    previewPlaying = true,
    previewTime = 0;
  $('preview-asset').onclick = () => {
    if (!chosen) return;
    previewEntry = chosen;
    previewTime = 0;
    $('art-preview-label').textContent = chosen.manifest.asset.label ?? chosen.asset;
    $('preview-scale').textContent =
      'Authored height: ' +
      (chosen.manifest.asset.canvas[1] / chosen.manifest.asset.density).toFixed(2) +
      ' units. Hero height: ' +
      (
        palette.find((p) => p.asset === 'ink-hero-current')!.manifest.asset.canvas[1] /
        palette.find((p) => p.asset === 'ink-hero-current')!.manifest.asset.density
      ).toFixed(2) +
      ' units.';
    $<HTMLDialogElement>('art-preview').showModal();
    launch(thumbnail(chosen, $<HTMLCanvasElement>('art-preview-canvas')));
  };
  $('preview-play').onclick = () => {
    previewPlaying = !previewPlaying;
    $('preview-play').textContent = previewPlaying ? 'Pause preview' : 'Play preview';
  };
  $('tool').onchange = () => {
    if ($<HTMLSelectElement>('tool').value === 'place') openDock('artwork');
    if ($<HTMLSelectElement>('tool').value === 'geometry') openDock('scene');
    if ($<HTMLSelectElement>('tool').value !== 'place') {
      chosen = undefined;
      view?.clearPlacementGhost();
      $('asset-choice').hidden = true;
    }
    workspace.refresh();
    composition?.positionHandles();
  };
  let marquee: { x: number; y: number; additive: boolean } | undefined;
  function startMarquee(e: PointerEvent) {
    marquee = { x: e.clientX, y: e.clientY, additive: e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
  }

  $('search').oninput = showPalette;
  $('category').onchange = showPalette;
  function snapped(n: number) {
    return composition?.snap(n) ?? n;
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
            heading: ($<HTMLSelectElement>('place-heading').value ||
              Object.keys(entry.manifest.asset.clips[entry.clip]!)[0]) as NonNullable<
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
      const repeat = $<HTMLInputElement>('repeat-placement').checked;
      const heading = $<HTMLSelectElement>('place-heading').value;
      composition.set(id);
      rememberAsset(entry.asset);
      if (repeat) {
        chooseAsset(entry);
        $<HTMLSelectElement>('place-heading').value = heading;
        openDock('artwork');
      }
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
    if (visualAuthoring?.pointerDown(e)) return;
    if (e.button !== 0 && e.button !== 2 && e.button !== 1) return;
    if (chosen && e.button === 0) {
      launch(place(chosen, e.clientX, e.clientY));
      return;
    }
    const item = e.button === 0 ? view.pick(e.clientX, e.clientY, history.document) : undefined,
      hero = $<HTMLSelectElement>('tool').value === 'hero' && e.button === 0;
    let mode: Drag['mode'] = hero ? 'hero' : e.button !== 0 ? 'pan' : 'object';
    if (mode === 'object') {
      if (!item) {
        if ($<HTMLSelectElement>('tool').value === 'select') startMarquee(e);
        return;
      }
      if (!composition.selection.has(item.placement.id) || e.shiftKey)
        composition.set(item.placement.id, e.shiftKey);
      if (e.shiftKey || composition.locked.has(item.placement.id)) return;
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
    if (marquee) {
      const box = $('marquee');
      box.hidden = false;
      Object.assign(box.style, {
        left: Math.min(marquee.x, e.clientX) + 'px',
        top: Math.min(marquee.y, e.clientY) + 'px',
        width: Math.abs(e.clientX - marquee.x) + 'px',
        height: Math.abs(e.clientY - marquee.y) + 'px',
      });
      return;
    }
    if (chosen && !drag && view.presentation) {
      const point = view.ground(e.clientX, e.clientY);
      if (point) {
        point.x = snapped(point.x);
        point.z = snapped(point.z);
        point.y = heightAt(view.sim!.areaDefinition, point.x, point.z);
        launch(
          view.placementGhost(
            chosen.asset,
            chosen.clip,
            $<HTMLSelectElement>('place-heading').value ||
              Object.keys(chosen.manifest.asset.clips[chosen.clip]!)[0]!,
            point,
          ),
        );
      }
    }
    if (!drag || !view.presentation) return;
    const point = view.ground(e.clientX, e.clientY, drag.height);
    if (!point) return;
    const dx = point.x - drag.start.x,
      dz = point.z - drag.start.z;
    if (drag.mode === 'pan') {
      const offset = view.presentation.center.clone().sub(drag.center);
      view.presentation.center
        .copy(drag.center)
        .sub(new T.Vector3(dx - offset.x, 0, dz - offset.z));
      view.render();
      return;
    }
    const axis = $<HTMLSelectElement>('axis').value;
    const next = new T.Vector3(
      axis === 'z' ? drag.x : snapped(drag.x + dx),
      0,
      axis === 'x' ? drag.z : snapped(drag.z + dz),
    );
    drag.next = next;
    drag.changed = Math.abs(next.x - drag.x) + Math.abs(next.z - drag.z) > 0.001;
    if (drag.mode === 'hero') view.hero(next);
    else {
      const items = sceneItems(history.document);
      for (const id of history.descendants(composition.editable())) {
        const p = items.find((p) => p.placement.id === id)?.placement;
        if (p) view.previewPosition(id, p.x + next.x - drag.x, p.z + next.z - drag.z);
      }
    }
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
          else
            history.transformMany(composition.editable(), { x: x - current.x, z: z - current.z });
        }
        await refresh();
      }),
    );
  }
  canvas.onpointerup = (e) => {
    if (visualAuthoring?.pointerUp(e)) return;
    if (marquee) {
      composition.rectangle(marquee, { x: e.clientX, y: e.clientY }, marquee.additive);
      marquee = undefined;
      $('marquee').hidden = true;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    finishDrag();
  };
  canvas.onpointercancel = (e) => {
    visualAuthoring?.pointerUp(e);
    marquee = undefined;
    $('marquee').hidden = true;
    finishDrag(true);
  };
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
  document.addEventListener(
    'keydown',
    (e) => {
      const text =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement;
      if ([...document.querySelectorAll<HTMLDialogElement>('dialog')].some((d) => d.open)) return;
      if (e.key === 'Escape') {
        composition.cancelGesture();
        finishDrag(true);
        composition.set(undefined);
        return;
      }
      if (text) return;
      if (e.key.toLowerCase() === 'f') {
        composition.focus();
        return;
      }
      if (['x', 'z'].includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey) {
        $<HTMLSelectElement>('axis').value = e.key.toLowerCase();
        return;
      }
      if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
        composition.editable().length
      ) {
        e.preventDefault();
        const spacing = Number($<HTMLInputElement>('snap-spacing').value);
        const step =
          (Number.isFinite(spacing) && spacing > 0 ? spacing : 0.5) * (e.shiftKey ? 10 : 1);
        void composition
          .edit(() =>
            history.transformMany(composition.editable(), {
              x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
              z: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
            }),
          )
          .catch(console.error);
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
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    'beforeunload',
    (e) => {
      recover();
      if (dirty() && !automated) {
        e.preventDefault();
        e.returnValue = '';
      }
    },
    { signal: lifetime.signal },
  );
  $('export-recovery').onclick = () => {
    const stored = localStorage.getItem(recoveryKey);
    if (stored === null) return;
    const url = URL.createObjectURL(new Blob([stored], { type: 'application/json' })),
      link = document.createElement('a');
    link.href = url;
    link.download = 'lantern-scene-recovery.json';
    link.click();
    URL.revokeObjectURL(url);
  };
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
      assertActive();
      history = nextHistory;
      revision = recovery.revision;
      savedSnapshot = recovery.savedSnapshot;
      selected = undefined;
      composition?.selection.clear();
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
  const resizeObserver = new ResizeObserver(() => {
    if (closed) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => view?.resize());
  });
  resizeObserver.observe(canvas.parentElement!);
  let last = 0;
  let frames: FrameScheduler | undefined;
  function animate(time: number) {
    if (!ready || busy) return;
    const ms = last ? Math.min(50, time - last) : 0;
    last = time;
    view.render(ms);
    composition?.positionHandles();
    visualAuthoring?.draw();
    if (previewEntry && previewPlaying && $<HTMLDialogElement>('art-preview').open) {
      previewTime += ms;
      const clip = Object.values(previewEntry.manifest.asset.clips[previewEntry.clip]!)[0]!;
      const total = clip.durationsMs.reduce((a, b) => a + b, 0);
      let position = clip.loop ? previewTime % total : Math.min(previewTime, total - 1);
      let index = 0;
      while (index < clip.frames.length - 1 && position >= clip.durationsMs[index]!) {
        position -= clip.durationsMs[index]!;
        index++;
      }
      const frame = previewEntry.manifest.frames.find((f) => f.id === clip.frames[index]);
      if (frame) launch(drawFrame(previewEntry, frame, $<HTMLCanvasElement>('art-preview-canvas')));
    }
  }
  function dispose() {
    if (closed) return;
    closed = true;
    ready = false;
    lifetime.abort();
    workspace.dispose();
    frames?.dispose();
    cancelAnimationFrame(resizeFrame);
    observer.disconnect();
    resizeObserver.disconnect();
    playtest?.dispose();
    composition?.dispose();
    sceneLibrary?.dispose();
    visualAuthoring?.dispose();
    view?.dispose();
  }
  window.addEventListener('pagehide', dispose, { signal: lifetime.signal });

  function recoveryEntries() {
    const entries: { key: string; name: string; time: string }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(recoveryRoot)) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key)!);
        entries.push({
          key,
          name: data.document?.name ?? 'Unreadable recovery',
          time: data.savedAt ?? 'Unknown time',
        });
      } catch {
        entries.push({ key, name: 'Unreadable recovery', time: 'Unknown time' });
      }
    }
    return entries.sort((a, b) => b.time.localeCompare(a.time));
  }
  function readRecovery(key: string) {
    recoveryKey = key;
    recovery = undefined;
    const stored = localStorage.getItem(key);
    if (!stored) return;
    $('recovery').hidden = false;
    try {
      const value = JSON.parse(stored);
      recovery = {
        document: parseSceneDocument(value.document),
        revision: value.revision,
        baseRevision: value.baseRevision,
        savedSnapshot: value.savedSnapshot
          ? JSON.stringify(parseSceneDocument(JSON.parse(value.savedSnapshot)))
          : '',
        savedAt: value.savedAt,
      };
      $<HTMLButtonElement>('restore').disabled = false;
    } catch {
      $<HTMLButtonElement>('restore').disabled = true;
      status(
        'Saved recovery uses an unreadable or older format. Download it before adapting or dismissing it.',
        true,
      );
    }
  }
  async function importDocument(document: SceneDocument) {
    if (dirty() && !confirm('Replace the current composition with this imported draft?')) return;
    recover();
    await run(async () => {
      const next = new EditorHistory(document);
      await view.apply(next.document);
      history = next;
      revision = null;
      savedSnapshot = '';
      recoveryKey = recoveryRoot + ':' + document.id;
      composition.set(undefined);
      recover();
      fit();
      status('Imported draft. Save As to create a scene file.');
    });
  }
  async function start() {
    await list();
    assertActive();
    try {
      const entries = recoveryEntries();
      if (entries[0]) readRecovery(entries[0].key);
    } catch {
      status('Local recovery is unavailable.', true);
    }
    assetCatalog = await authoringCatalog(lifetime.signal);
    assertActive();
    runtime = await AssetRuntime.open(assetCatalog);
    assertActive();
    view = new EditorView(canvas, runtime);
    composition = new CompositionTools({
      history: () => history,
      view: () => view,
      run,
      refresh,
      select,
      thumbnail: async (asset, clip, target) => {
        const entry = palette.find((p) => p.asset === asset && p.clip === clip);
        if (entry) await thumbnail(entry, target);
      },
    });
    visualAuthoring = new VisualAuthoring({
      history: () => history,
      view: () => view,
      selected: () => selected,
      locked: () =>
        !!selected && (composition.locked.has(selected) || composition.hidden.has(selected)),
      change,
      select: (id) => composition.set(id),
    });
    sceneLibrary = new SceneLibrary({
      history: () => history,
      view: () => view,
      selection: () => composition.editable(),
      open,
      import: importDocument,
      change,
      status,
      fragment: async (name, objects) => {
        await run(async () => {
          const r = await fetch('/__lantern_editor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Lantern-Editor-Token': token },
            body: JSON.stringify({
              action: 'fragment',
              fragment: { version: 1, name, objects },
              document: history.document,
              baseRevision,
            }),
            signal: lifetime.signal,
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          status('Fragment saved to authoring/fragments/' + data.id + '.json');
        });
      },
      select: (ids) => {
        composition.selection.clear();
        ids.forEach((id) => composition.selection.add(id));
        composition.set(ids.at(-1), false);
        ids.forEach((id) => composition.selection.add(id));
        controls();
      },
      recoveries: recoveryEntries,
      restore: (key) => {
        recover();
        readRecovery(key);
        $<HTMLButtonElement>('restore').click();
      },
    });
    playtest = new DraftPlaytest({
      document: () => history.document,
      compose: (snapshot) => composeDraftGameplay(snapshot, contentDefinitions, worldVisuals),
      catalog: () => assetCatalog,
      status,
    });
    assetIndex = await loadAssetIndex(runtime, lifetime.signal);
    usedAssets = assetClosure(usedAssetRoots(), assetIndex);
    const manifests = [...assetIndex.values()];
    assertActive();
    for (const m of manifests) {
      const kind = paletteKind(m) ?? 'reference';
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
    assertActive();
    fit();
    busy = false;
    controls();
    ready = true;
    if ($('recovery').hidden) status('');
    frames = new FrameScheduler(animate, () => (last = 0), automated);
  }
  // Development-only inspection supports browser acceptance without exposing a player bridge.
  window.sceneEditor = {
    ready: () => ready,
    state: () => ({ document: history.document, revision, dirty: dirty(), selected }),
    view: () => view,
    playtest: () => playtest.state(),
    dispose,
  };
  controls();
  void start().catch((error) => {
    if (!closed) {
      status('Editor startup failed: ' + editorError(error), true);
      view?.dispose();
    }
  });
  return window.sceneEditor;
}
