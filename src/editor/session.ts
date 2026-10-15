import { cleanupAll, CleanupFailure } from '../assets/cleanup';
import { EditorGestures, type GestureLease } from './gestures';
import { lightingRigs } from '../presentation/lighting-profiles';
import { cameraContract } from '../assets/camera-contract';
import { GroundAuthoring } from './ground-authoring';
import { resizeGroundInteraction } from '../content/ground-interaction';
import {
  assetClosure,
  assetLabel,
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
import { contentDefinitions, worldVisuals } from '../content/game-content';
import { SceneLibrary } from './library';
import { VisualAuthoring } from './visual-authoring';
import { CompositionTools } from './composition';
import { EditorConfirmation } from './confirmation';
import { libraryInventory } from './library-inventory';
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
  type SceneSnapshot,
  type PaletteKind,
} from '../content/scene-document';
import { heightAt } from '../content/world';
import { artworkFloorLayout } from '../content/floor-layout';
import { applySceneryPreset } from '../content/scenery-presets';
import { EditorHistory, sceneItems } from './model';
import { EditorDocument } from './document';
import { EditorProject, EditorConflict } from './project';
import { EditorView } from './view';
import { PreviewImages, type PreviewPlayback } from './preview-images';

declare global {
  interface Window {
    sceneEditor: {
      ready: () => boolean;
      state: () => {
        document: SceneSnapshot;
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
const headingNames: Record<string, string> = {
  d00: 'Down-left',
  d45: 'Down',
  d90: 'Down-right',
  d135: 'Right',
  d180: 'Up-right',
  d225: 'Up',
  d270: 'Up-left',
  d315: 'Left',
};

export function createEditorSession() {
  const lifetime = new AbortController();
  const gestures = new EditorGestures();
  const automated = new URLSearchParams(location.search).has('automated');
  let closed = false;
  function assertActive() {
    lifetime.signal.throwIfAborted();
  }
  const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  document.getElementById('app')!.innerHTML = editorUI;
  const workspace = new EditorWorkspace(() => composition?.selection.size ?? 0);
  const confirmation = new EditorConfirmation();
  let groundAuthoring: GroundAuthoring;
  let composition: CompositionTools;
  let visualAuthoring: VisualAuthoring;
  let sceneLibrary: SceneLibrary;
  let playtest: DraftPlaytest;
  const canvas = $<HTMLCanvasElement>('viewport');
  let runtime: AssetRuntime,
    view: EditorView,
    selected: string | undefined,
    busy = true,
    ready = false;
  const documents = new EditorDocument(
    emptyScene(),
    (document) => view.apply(document),
    (document) => {
      resolveAuthoredScene(document);
      if (document.gameplay) composeDraftGameplay(document, contentDefinitions, worldVisuals);
    },
    lifetime.signal,
  );
  let assetCatalog: Readonly<Record<string, string>> = {};
  let palette: {
      asset: string;
      clip: string;
      kind: PaletteKind;
      manifest: Manifest;
    }[] = [],
    chosen: (typeof palette)[number] | undefined;
  let assetIndex = new Map<string, Manifest>();
  let groundSignature = '';
  let groundLimit = 24;
  let usedAssets = new Set<string>();
  const project = new EditorProject(
    documents,
    (document) => parseSceneDocument(withGameplayDefaults(document, contentDefinitions)),
    lifetime.signal,
    'lantern-scene-editor-recovery:' + location.origin + location.pathname + ':',
    () => localStorage,
    () => status('Local recovery is unavailable. Save your scene to preserve it.', true),
  );
  function status(message: string, error = false) {
    if (closed) return;
    workspace.notify(message, error);
    $('status').classList.toggle('error', error);
    $('validation-errors').textContent = error ? 'Error: ' + message : '';
    $('validation-errors').hidden = !error;
  }
  function controls() {
    if (closed) return;
    const d = documents.history.document,
      items = sceneItems(d),
      item = items.find((p) => p.placement.id === selected),
      p = item?.placement,
      locked = !!p && !!composition?.locked.has(p.id);
    $<HTMLInputElement>('name').value = d.name;
    $('live-badge').hidden = d.target !== 'live';
    $('foundation').hidden = false;
    $<HTMLSelectElement>('rig').value = d.look.rig;
    $<HTMLSelectElement>('look').value = d.look.look;
    const sun = d.look.sun ?? {
      azimuthDeg: cameraContract.azimuthDeg + lightingRigs[d.look.rig].side,
      elevationDeg: lightingRigs[d.look.rig].elevation,
    };
    $<HTMLInputElement>('sun-azimuth').value = String(sun.azimuthDeg);
    $<HTMLInputElement>('sun-elevation').value = String(sun.elevationDeg);
    $<HTMLButtonElement>('sun-preset').disabled = busy || !d.look.sun;
    showGroundResults();
    $<HTMLSelectElement>('floor-layout').value = d.floor.layout ?? 'repeat';
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
            : (headingNames[heading] ?? heading),
          heading,
        ),
      );
    if (p) headingSelect.value = p.heading ?? 'd45';
    $<HTMLInputElement>('rotation').value = String(
      Number((((p?.rotation ?? 0) * 180) / Math.PI).toFixed(3)),
    );
    $('rotation-label').hidden = false;
    $<HTMLInputElement>('y').disabled = item?.kind === 'decal';
    $<HTMLButtonElement>('undo').disabled = busy || !documents.history.canUndo;
    $<HTMLButtonElement>('redo').disabled = busy || !documents.history.canRedo;
    for (const key of ['delete', 'duplicate'])
      $<HTMLButtonElement>(key).disabled = busy || !p || locked;
    for (const key of [
      'save',
      'save-as',
      'open',
      'name',
      'rig',
      'sun-azimuth',
      'sun-elevation',
      'look',
      'floor',
      'ground-search',
      'ground-high-res',
      'reset-game-zoom',
      'width',
      'depth',
      'fit',
      'play-from-here',
      'scene-library',
      'import-scene',
      'ground-kind',
      'tool',
      'snap-spacing',
      'preview-asset',
    ]) {
      const control = document.getElementById(key) as HTMLInputElement | null;
      if (control) control.disabled = busy;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('.ground-card'))
      button.disabled = busy;
    $('save-state').textContent = busy ? 'Working…' : project.dirty ? 'Unsaved' : 'Saved';
    const notes = sceneCompositionFindings(resolveAuthoredScene(d));
    $('composition-notes').hidden = notes.length === 0;
    $('composition-notes').textContent = notes.join('; ');
    view?.select(selected);
    view?.setGrid($<HTMLInputElement>('grid').checked);
    composition?.render();
    visualAuthoring?.render(busy, composition?.selection.size > 1);
    $('scene-summary-text').textContent = `${d.name} · ${items.length} objects`;
    $('scene-overview').textContent =
      `${items.length} ${items.length === 1 ? 'object' : 'objects'} · ${Number(d.floor.width.toFixed(2))} × ${Number(d.floor.depth.toFixed(2))} ground · ${lightingRigs[d.look.rig].label}`;
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
    gestures.cancel();
    if (project.recoveryPending && !restoring) {
      status('Restore or dismiss the previous recovery before editing.', true);
      controls();
      return;
    }
    busy = true;
    const resumeGestures = gestures.suspend();
    try {
      const pending = action();
      controls();
      await pending;
    } catch (error) {
      if (error instanceof EditorConflict) $('conflict').hidden = false;
      status(editorError(error), true);
    } finally {
      resumeGestures();
      if (!closed) {
        busy = false;
        controls();
      }
    }
  }
  function rendered() {
    view.setGrid($<HTMLInputElement>('grid').checked);
    view.render();
  }
  async function refresh() {
    await view.apply(documents.history.document);
    assertActive();
    rendered();
  }
  async function edit(work: (history: EditorHistory) => void, committed?: () => void) {
    await run(async () => {
      await project.edit(work);
      assertActive();
      rendered();
      committed?.();
    });
  }
  async function change(mutator: (d: SceneDocument) => void, committed?: () => void) {
    await edit(
      (history) => history.change(mutator),
      () => {
        status('Composition updated.');
        committed?.();
      },
    );
  }
  function fit() {
    const p = view.presentation;
    if (!p) return;
    const b = p.area.bounds;
    const floor = documents.history.document.floor;
    const artwork =
      floor.layout === 'artwork' ? artworkFloorLayout(floor.width, floor.depth) : undefined;
    p.center.set((b.minX + b.maxX) / 2, artwork ? 0 : 1.8, (b.minZ + b.maxZ) / 2);
    p.verticalSpan = Math.max(10, Math.min(50, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.85));
    p.resize();
    view.render();
    const corners = (
      artwork
        ? artwork.corners.map((p) => [p.x, p.z])
        : [
            [b.minX, b.minZ],
            [b.minX, b.maxZ],
            [b.maxX, b.minZ],
            [b.maxX, b.maxZ],
          ]
    ).map(([x, z]) => view.screen(new T.Vector3(x!, 0, z!)));
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
  async function list() {
    const scenes = await project.list();
    const select = $<HTMLSelectElement>('scene');
    for (const option of [...select.options]) if (option.dataset.saved) option.remove();
    for (const scene of scenes) {
      const o = new Option(
        scene.name +
          (scene.target === 'live' ? ' · LIVE' : '') +
          (scene.error ? ' · invalid file' : ''),
        'file-' + scene.id,
      );
      o.dataset.saved = 'true';
      select.add(o);
    }
  }
  async function open(value: string) {
    if (
      project.dirty &&
      !(await confirmation.ask('Discard unsaved edits and open another scene?', 'Discard edits'))
    )
      return;
    await run(async () => {
      setWalkingHero(false);
      await project.open(value);
      assertActive();
      showRecovery();
      const d = documents.history.document;
      selected = undefined;
      composition?.reset();
      await refresh();
      view.setGrid($<HTMLInputElement>('grid').checked);
      view.render();
      fit();
      $('conflict').hidden = true;
      sceneLibrary?.remember();
      status(
        d.target === 'live'
          ? 'Live room opened. Saving changes its scenery in the game.'
          : 'Scene opened.',
      );
    });
  }
  async function save(copyId?: string) {
    await run(async () => {
      await project.save(copyId);
      showRecovery();
      $('conflict').hidden = true;
      await list();
      assertActive();
      sceneLibrary?.remember();
      status(
        documents.history.document.target === 'live'
          ? 'Saved. The game now uses this scenery.'
          : 'Scene saved to authoring/scenes/' + documents.history.document.id + '.json',
      );
    });
  }
  function saveAs() {
    const input = $<HTMLInputElement>('file-id');
    input.value = documents.history.document.id.startsWith('live-')
      ? ''
      : documents.history.document.id === 'untitled'
        ? ''
        : documents.history.document.id + '-copy';
    $<HTMLDialogElement>('save-dialog').showModal();
    input.focus();
  }
  $('save-dialog').addEventListener('close', () => {
    if ($<HTMLDialogElement>('save-dialog').returnValue === 'save')
      launch(save($<HTMLInputElement>('file-id').value));
  });
  $('open').onclick = () => void open($<HTMLSelectElement>('scene').value);
  $('save').onclick = () => {
    if (project.revision === null) saveAs();
    else launch(save());
  };
  $('save-as').onclick = saveAs;
  $('conflict-copy').onclick = saveAs;
  $('reload').onclick = () => void open('file-' + documents.history.document.id);
  $('name').onchange = () =>
    void change((d) => {
      d.name = $<HTMLInputElement>('name').value;
    });
  for (const id of ['rig', 'look'])
    $(id).onchange = () =>
      void change((d) => {
        d.look = {
          ...d.look,
          rig: $<HTMLSelectElement>('rig').value as SceneDocument['look']['rig'],
          look: $<HTMLSelectElement>('look').value as SceneDocument['look']['look'],
        };
      });
  for (const id of ['sun-azimuth', 'sun-elevation'])
    $(id).onchange = async () => {
      const sun = {
        azimuthDeg: Number($<HTMLInputElement>('sun-azimuth').value),
        elevationDeg: Number($<HTMLInputElement>('sun-elevation').value),
      };
      const d = documents.history.document;
      const current = d.look.sun ?? {
        azimuthDeg: cameraContract.azimuthDeg + lightingRigs[d.look.rig].side,
        elevationDeg: lightingRigs[d.look.rig].elevation,
      };
      if (sun.azimuthDeg === current.azimuthDeg && sun.elevationDeg === current.elevationDeg)
        return;
      await change((d) => {
        d.look.sun = sun;
      });
    };
  $('sun-preset').onclick = () =>
    void change((d) => {
      delete d.look.sun;
    });
  function showGroundResults() {
    const query = $<HTMLInputElement>('ground-search').value.trim().toLowerCase(),
      highRes = $<HTMLInputElement>('ground-high-res').checked,
      floor = documents.history.document.floor,
      select = $<HTMLSelectElement>('floor');
    const options = [...assetIndex.values()].flatMap((manifest) => {
      const { id, label, canvas, imageRole, type, category } = manifest.asset;
      const kind = $<HTMLSelectElement>('ground-kind').value;
      if (kind === 'scene-painting' && imageRole !== 'scene-painting') return [];
      if (
        kind === 'material' &&
        (imageRole ||
          category === 'reference' ||
          manifest.asset.placement === 'reference' ||
          (type !== 'material' && category !== 'ground'))
      )
        return [];
      if (highRes && Math.max(...canvas) < 3840) return [];
      return floorClips(manifest)
        .filter((clip) => `${label ?? ''} ${id} ${clip}`.toLowerCase().includes(query))
        .map(
          (clip) =>
            new Option(`${label ?? id} / ${clip} · ${canvas[0]} × ${canvas[1]}`, id + '/' + clip),
        );
    });
    select.replaceChildren(...options);
    select.value = floor.asset + '/' + (floor.clip ?? 'surface');
    $('ground-results').textContent = options.length
      ? `${options.length} ground results`
      : 'No matching ground. Try another search or turn off High-res only.';
    const manifest = assetIndex.get(floor.asset);
    $('ground-current').textContent = manifest
      ? assetLabel(manifest)
      : floor.asset.replaceAll('-', ' ');
    $('ground-identity').textContent = `${floor.asset} / ${floor.clip ?? 'surface'}`;
    const signature = JSON.stringify([
      query,
      highRes,
      $<HTMLSelectElement>('ground-kind').value,
      floor.asset,
      floor.clip,
      assetIndex.size,
      groundLimit,
    ]);
    if (signature === groundSignature) return;
    groundSignature = signature;
    const current = palette.find(
      (p) => p.asset === floor.asset && p.clip === (floor.clip ?? 'surface'),
    );
    const previousPreview = $<HTMLCanvasElement>('ground-preview');
    const preview = previousPreview.cloneNode(false) as HTMLCanvasElement;
    previousPreview.replaceWith(preview);
    if (current) void thumbnail(current, preview).catch(() => {});
    const gallery = $('ground-thumbnails');
    groundObserver.disconnect();
    gallery.replaceChildren();
    for (const option of options.slice(0, groundLimit)) {
      const [asset, clip] = option.value.split('/');
      const entry = palette.find((p) => p.asset === asset && p.clip === clip);
      const button = document.createElement('button');
      button.className = 'ground-card';
      button.dataset.ground = option.value;
      button.setAttribute('aria-pressed', String(option.value === select.value));
      button.disabled = busy;
      const image = document.createElement('canvas');
      image.width = 144;
      image.height = 90;
      image.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      const artwork = assetIndex.get(asset!);
      label.textContent = artwork ? assetLabel(artwork) : asset!.replaceAll('-', ' ');
      button.title = option.text;
      button.append(image, label);
      button.onclick = () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change'));
      };
      gallery.append(button);
      if (entry) {
        image.dataset.index = String(palette.indexOf(entry));
        groundObserver.observe(image);
      }
    }
    $('more-grounds').hidden = options.length <= groundLimit;
  }
  $('more-grounds').onclick = () => {
    groundLimit += 24;
    showGroundResults();
  };
  $('ground-search').oninput = () => {
    groundLimit = 24;
    showGroundResults();
  };
  for (const id of ['ground-high-res', 'ground-kind'])
    $(id).onchange = () => {
      groundLimit = 24;
      showGroundResults();
    };
  for (const id of ['floor', 'floor-layout', 'width', 'depth'])
    $(id).onchange = () =>
      void change((d) => {
        const [asset, clip] =
          id === 'floor'
            ? $<HTMLSelectElement>('floor').value.split('/')
            : [d.floor.asset, d.floor.clip ?? 'surface'];
        if (!asset || !clip) return;
        const before = { ...d.floor };
        if (
          d.groundInteraction &&
          (asset !== d.floor.asset ||
            clip !== d.floor.clip ||
            (id === 'floor-layout' && $<HTMLSelectElement>('floor-layout').value !== 'artwork'))
        )
          throw new Error('Clear ground interaction before replacing its artwork or layout.');
        d.floor = {
          asset: asset!,
          clip: clip!,
          layout:
            id === 'floor'
              ? assetIndex.get(asset!)?.asset.imageRole
                ? 'artwork'
                : undefined
              : $<HTMLSelectElement>('floor-layout').value === 'artwork'
                ? 'artwork'
                : undefined,
          width: Number($<HTMLInputElement>('width').value),
          depth: Number($<HTMLInputElement>('depth').value),
        };
        const painting = assetIndex.get(asset!)?.asset;
        if (d.floor.layout === 'artwork' && painting) {
          const ratio = painting.canvas[0] / painting.canvas[1];
          if (id === 'depth') d.floor.width = d.floor.depth * ratio;
          else d.floor.depth = d.floor.width / ratio;
        }
        if (d.groundInteraction) resizeGroundInteraction(d.groundInteraction, before, d.floor);
        if (d.floor.layout === 'artwork' && d.look.shadeZones) {
          const old = artworkFloorLayout(before.width, before.depth),
            next = artworkFloorLayout(d.floor.width, d.floor.depth);
          for (const zone of d.look.shadeZones) {
            Object.assign(zone, next.world(old.uv(zone)));
            zone.radius *= d.floor.width / before.width;
          }
        }
      });
  for (const id of ['x', 'z', 'y', 'scale', 'rotation', 'mirror'])
    $(id).onchange = () =>
      void edit((history) => {
        if (!selected) return;
        const value =
          id === 'mirror'
            ? $<HTMLInputElement>(id).checked
            : Number($<HTMLInputElement>(id).value) * (id === 'rotation' ? Math.PI / 180 : 1);
        const ids = composition.editable();
        const input = $<HTMLInputElement>(id);
        if (id !== 'mirror' && (!input.value.trim() || !Number.isFinite(value))) return;
        history.transformEach(ids, { [id]: value });
      });
  $('undo').onclick = () => void edit((history) => history.undo());
  $('redo').onclick = () => void edit((history) => history.redo());
  $('duplicate').onclick = () => void composition?.duplicate();
  $('delete').onclick = () => void composition?.remove();
  $('fit').onclick = fit;
  $('reset-game-zoom').onclick = () => {
    if (!view.presentation) return;
    view.presentation.verticalSpan = cameraContract.verticalSpan;
    view.resize();
    view.render();
  };
  let walkingHero = false;
  const walkKeys = new Set<string>();
  const heldPointers = new Set<number>();
  function stopWalkKeys() {
    walkKeys.clear();
    view?.walkHero(0, 0, 0);
  }
  function setWalkingHero(enabled: boolean) {
    if (!ready || enabled === walkingHero || (enabled && busy)) return;
    stopWalkKeys();
    walkingHero = enabled;
    view.setHeroWalking(enabled);
  }
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      heldPointers.add(e.pointerId);
      stopWalkKeys();
    },
    { capture: true, signal: lifetime.signal },
  );
  for (const type of ['pointerup', 'pointercancel'] as const)
    window.addEventListener(type, (e) => heldPointers.delete(e.pointerId), {
      capture: true,
      signal: lifetime.signal,
    });
  canvas.addEventListener('blur', stopWalkKeys, { signal: lifetime.signal });
  window.addEventListener(
    'blur',
    () => {
      heldPointers.clear();
      stopWalkKeys();
    },
    { signal: lifetime.signal },
  );
  document.addEventListener('visibilitychange', stopWalkKeys, { signal: lifetime.signal });
  document.addEventListener(
    'keyup',
    (e) => {
      walkKeys.delete(e.code);
      if (!walkKeys.size) view?.walkHero(0, 0, 0);
    },
    { signal: lifetime.signal },
  );
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
  const images = new PreviewImages();
  async function thumbnail(
    entry: (typeof palette)[number],
    target: HTMLCanvasElement,
    playback?: PreviewPlayback,
  ) {
    const m = entry.manifest,
      f = m.frames.find((f) => f.id === Object.values(m.asset.clips[entry.clip]!)[0]!.frames[0])!;
    await drawFrame(entry, f, target, playback);
  }
  async function drawFrame(
    entry: (typeof palette)[number],
    f: Manifest['frames'][number],
    target: HTMLCanvasElement,
    playback?: PreviewPlayback,
  ) {
    const m = entry.manifest,
      page = m.pages.find((p) => p.id === f.page)!,
      preview = target.width <= 192 ? page.preview : undefined,
      src = preview
        ? '/' + preview.path
        : '/' + assetCatalog[entry.asset]!.replace(/manifest\.json$/, page.path);
    const paint = (image: HTMLImageElement) => {
      const ctx = target.getContext('2d')!,
        [x, y, w, h] = f.rect,
        ratio = Math.min(target.width / w, target.height / h);
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(
        image,
        x * (preview ? preview.width / page.width : 1),
        y * (preview ? preview.height / page.height : 1),
        w * (preview ? preview.width / page.width : 1),
        h * (preview ? preview.height / page.height : 1),
        (target.width - w * ratio) / 2,
        (target.height - h * ratio) / 2,
        w * ratio,
        h * ratio,
      );
    };
    await (playback ? playback.draw(src, paint) : images.draw(target, src, paint));
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
    { root: $('artwork-panel') },
  );
  const groundObserver = new IntersectionObserver(
    (entries) => {
      for (const item of entries)
        if (item.isIntersecting) {
          const target = item.target as HTMLCanvasElement;
          groundObserver.unobserve(target);
          const entry = palette[Number(target.dataset.index)];
          if (entry) void thumbnail(entry, target).catch(() => {});
        }
    },
    { root: $('scene-panel') },
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
    const sceneAssets = assetClosure(documentAssetRoots(documents.history.document), assetIndex);
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
        badge.textContent = sceneAssets.has(entry.asset)
          ? 'In this scene'
          : usedAssets.has(entry.asset)
            ? 'In use'
            : 'Library';
        button.append(c, label, badge);
        button.onclick = () => {
          chooseAsset(entry);
          selected = undefined;
          composition.selection.clear();
          controls();
          workspace.refresh();
        };
        button.ondragstart = (e) => {
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
        headings.add(new Option(headingNames[h] ?? h, h));
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
  let previewPlayback: PreviewPlayback | undefined;
  $('art-preview').addEventListener(
    'close',
    () => {
      if ($<HTMLDialogElement>('art-preview').open) return;
      previewPlayback?.dispose();
      previewPlayback = undefined;
      previewEntry = undefined;
    },
    { signal: lifetime.signal },
  );
  let previewEntry: (typeof palette)[number] | undefined,
    previewPlaying = true,
    previewTime = 0;
  $('preview-asset').onclick = () => {
    if (!chosen) return;
    previewPlayback?.dispose();
    previewPlayback = images.playback($<HTMLCanvasElement>('art-preview-canvas'));
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
    launch(thumbnail(chosen, $<HTMLCanvasElement>('art-preview-canvas'), previewPlayback));
  };
  $('preview-play').onclick = () => {
    previewPlaying = !previewPlaying;
    $('preview-play').textContent = previewPlaying ? 'Pause preview' : 'Play preview';
  };
  $('tool').onchange = () => {
    gestures.cancel();
    if ($<HTMLSelectElement>('tool').value === 'hero' && walkingHero) setWalkingHero(false);
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
  let marquee:
    { x: number; y: number; additive: boolean; pointer: number; lease: GestureLease } | undefined;
  function startMarquee(e: PointerEvent) {
    const lease = gestures.begin(canvas, e.pointerId, () => {
      marquee = undefined;
      $('marquee').hidden = true;
    });
    if (lease.active)
      marquee = { x: e.clientX, y: e.clientY, additive: e.shiftKey, pointer: e.pointerId, lease };
  }

  $('search').oninput = showPalette;
  $('category').onchange = showPalette;
  function snapped(n: number) {
    return composition?.snap(n) ?? n;
  }
  async function place(entry: (typeof palette)[number], x: number, y: number) {
    const point = view.ground(x, y);
    if (!point) return;
    const id = 'object-' + crypto.randomUUID();
    await edit(
      (history) =>
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
        ),
      () => {
        const repeat = $<HTMLInputElement>('repeat-placement').checked;
        const heading = $<HTMLSelectElement>('place-heading').value;
        composition.set(id);
        rememberAsset(entry.asset);
        if (repeat) {
          chooseAsset(entry);
          $<HTMLSelectElement>('place-heading').value = heading;
          openDock('artwork');
        }
        status('Placed ' + entry.clip + '.');
      },
    );
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
    lease: GestureLease;
    mode: 'pan' | 'object' | 'hero';
    start: T.Vector3;
    center: T.Vector3;
    x: number;
    z: number;
    height: number;
    ids: readonly string[];
    changed?: boolean;
    next?: T.Vector3;
  };
  let drag: Drag | undefined;
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onpointerdown = (e) => {
    if (busy || !view.presentation || project.recoveryPending) return;
    if (drag || marquee) return;
    canvas.focus();
    if (visualAuthoring?.pointerDown(e)) return;
    if (e.button !== 0 && e.button !== 2 && e.button !== 1) return;
    if (chosen && e.button === 0) {
      launch(place(chosen, e.clientX, e.clientY));
      return;
    }
    const item =
        e.button === 0 ? view.pick(e.clientX, e.clientY, documents.history.document) : undefined,
      hero = $<HTMLSelectElement>('tool').value === 'hero' && e.button === 0;
    if (hero) setWalkingHero(false);
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
    const root = hero ? documents.history.document.hero : (item?.placement ?? { x: 0, z: 0 }),
      height =
        mode === 'pan'
          ? 0
          : heightAt(view.sim!.areaDefinition, root.x, root.z) +
            (hero ? 0 : (item?.placement.y ?? 0)),
      start = view.ground(e.clientX, e.clientY, height);
    if (!start) return;
    const lease = gestures.begin(canvas, e.pointerId, () => {
      const previous = drag;
      drag = undefined;
      if (previous?.mode === 'hero') view.hero(documents.history.document.hero);
      else if (previous?.mode === 'object') view.clearTransformPreview();
      view.render();
    });
    if (!lease.active) return;
    drag = {
      lease,
      pointer: e.pointerId,
      mode,
      start,
      center: view.presentation.center.clone(),
      x: root.x,
      z: root.z,
      height,
      ids: composition.editable(),
    };
  };
  canvas.onpointermove = (e) => {
    if (marquee) {
      if (marquee.pointer !== e.pointerId) return;
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
    if (!drag || drag.pointer !== e.pointerId || !view.presentation) return;
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
      const items = sceneItems(documents.history.document);
      for (const id of documents.history.descendants(drag.ids)) {
        const p = items.find((p) => p.placement.id === id)?.placement;
        if (p) view.previewPosition(id, p.x + next.x - drag.x, p.z + next.z - drag.z);
      }
    }
    view.render();
  };
  function finishDrag() {
    const current = drag;
    drag = undefined;
    if (!current) return;
    if (!current.lease.finish()) return;
    if (current.mode === 'pan') return;
    launch(
      edit((history) => {
        if (current.changed && current.next) {
          const { x, z } = current.next;
          if (current.mode === 'hero')
            history.change((d) => {
              d.hero = { x, z };
            });
          else history.transformMany(current.ids, { x: x - current.x, z: z - current.z });
        }
      }),
    );
  }
  canvas.onpointerup = (e) => {
    if (visualAuthoring?.pointerUp(e)) return;
    if (marquee) {
      if (marquee.pointer !== e.pointerId) return;
      const current = marquee;
      marquee = undefined;
      if (!current.lease.finish()) return;
      composition.rectangle(current, { x: e.clientX, y: e.clientY }, current.additive);
      $('marquee').hidden = true;
      return;
    }
    if (drag?.pointer === e.pointerId) finishDrag();
  };
  canvas.onpointercancel = (e) => {
    if (drag?.pointer === e.pointerId || marquee?.pointer === e.pointerId) gestures.cancel();
    visualAuthoring?.pointerCancel(e);
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    if (busy || !view?.presentation) return;
    view.presentation.verticalSpan = Math.max(
      3,
      Math.min(
        100,
        view.presentation.verticalSpan *
          Math.exp(
            e.deltaY *
              (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1) *
              0.003,
          ),
      ),
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
        if (walkingHero) setWalkingHero(false);
        gestures.cancel();
        composition.set(undefined);
        return;
      }
      if (text || (e.target instanceof HTMLElement && e.target.isContentEditable)) return;
      if (
        !busy &&
        !drag &&
        !heldPointers.size &&
        e.target === canvas &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)
      ) {
        e.preventDefault();
        if (!walkingHero) setWalkingHero(true);
        walkKeys.add(e.code);
        return;
      }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        composition.focus();
        return;
      }
      if (['x', 'z'].includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        $<HTMLSelectElement>('axis').value = e.key.toLowerCase();
        return;
      }
      if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        composition.editable().length
      ) {
        e.preventDefault();
        const spacing = Number($<HTMLInputElement>('snap-spacing').value);
        const step =
          (Number.isFinite(spacing) && spacing > 0 ? spacing : 0.5) * (e.shiftKey ? 10 : 1);
        void composition
          .edit((history) =>
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
  window.addEventListener('beforeunload', () => project.recover(), { signal: lifetime.signal });
  $('export-recovery').onclick = () => {
    const stored = project.recoverySource();
    if (!stored) return;
    const url = URL.createObjectURL(new Blob([stored], { type: 'application/json' })),
      link = document.createElement('a');
    link.href = url;
    link.download = 'lantern-scene-recovery.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  $('dismiss-recovery').onclick = () => {
    project.dismissRecovery();
    $('recovery').hidden = true;
  };
  $('restore').onclick = () =>
    void run(async () => {
      if (!project.recoveryReadable) return;
      setWalkingHero(false);
      const changedFoundations = await project.restoreRecovery();
      assertActive();
      selected = undefined;
      composition?.reset();
      await refresh();
      view.setGrid($<HTMLInputElement>('grid').checked);
      view.render();
      fit();
      $('recovery').hidden = true;
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
    if (walkingHero) {
      const active = document.activeElement === canvas && !document.querySelector('dialog[open]');
      if (!active) stopWalkKeys();
      view.walkHero(
        Number(walkKeys.has('KeyD')) - Number(walkKeys.has('KeyA')),
        Number(walkKeys.has('KeyW')) - Number(walkKeys.has('KeyS')),
        ms,
      );
    }
    view.render(ms);
    composition?.positionHandles();
    visualAuthoring?.draw();
    groundAuthoring?.draw();
    if (
      previewEntry &&
      previewPlayback &&
      previewPlaying &&
      $<HTMLDialogElement>('art-preview').open
    ) {
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
      if (frame)
        launch(
          drawFrame(
            previewEntry,
            frame,
            $<HTMLCanvasElement>('art-preview-canvas'),
            previewPlayback,
          ),
        );
    }
  }
  function dispose() {
    if (closed) return;
    closed = true;
    ready = false;
    // Revoke session admission first, then attempt the entire dependency graph.
    // A tool or renderer failure must not strand observers or borrowed assets.
    cleanupAll([
      () => lifetime.abort(),
      () => gestures.dispose(),
      () => frames?.dispose(),
      () => cancelAnimationFrame(resizeFrame),
      () => observer.disconnect(),
      () => groundObserver.disconnect(),
      () => resizeObserver.disconnect(),
      () => workspace.dispose(),
      () => confirmation.dispose(),
      () => images.dispose(),
      () => playtest?.dispose(),
      () => composition?.dispose(),
      () => sceneLibrary?.dispose(),
      () => visualAuthoring?.dispose(),
      () => groundAuthoring?.dispose(),
      () => view?.dispose(),
      () => runtime?.dispose(),
    ]);
  }
  window.addEventListener('pagehide', dispose, { signal: lifetime.signal });

  function readRecovery(key: string) {
    project.readRecovery(key);
    showRecovery();
  }
  function showRecovery() {
    $('recovery').hidden = !project.recoveryPending;
    $<HTMLButtonElement>('restore').disabled = !project.recoveryReadable;
    if (project.recoveryPending && !project.recoveryReadable)
      status(
        'Saved recovery uses an unreadable or older format. Download it before adapting or dismissing it.',
        true,
      );
  }
  async function importDocument(document: SceneDocument) {
    if (
      project.dirty &&
      !(await confirmation.ask(
        'Replace the current composition with this imported scene?',
        'Replace composition',
      ))
    )
      return;
    await run(async () => {
      setWalkingHero(false);
      await project.import(document);
      assertActive();
      showRecovery();
      composition.reset();
      await refresh();
      composition.set(undefined);
      fit();
      status('Imported scene. Save As to create a scene file.');
    });
  }
  async function start() {
    await list();
    assertActive();
    try {
      const entries = project.recoveryEntries();
      if (entries[0]) readRecovery(entries[0].key);
    } catch {
      status('Local recovery is unavailable.', true);
    }
    assetCatalog = await authoringCatalog(lifetime.signal);
    assertActive();
    // Picking reads texture alpha on a 2D canvas, so editor delivery stays PNG.
    runtime = await AssetRuntime.open(
      assetCatalog,
      canvas,
      'lossless',
      'authoring',
      undefined,
      lifetime.signal,
    );
    if (closed) runtime.dispose();
    assertActive();
    view = new EditorView(canvas, runtime);
    composition = new CompositionTools({
      gestures,
      confirm: (message, action) => confirmation.ask(message, action),
      history: () => documents.history,
      view: () => view,
      run,
      refresh,
      edit,
      select,
      thumbnail: async (asset, clip, target) => {
        const entry = palette.find((p) => p.asset === asset && p.clip === clip);
        if (entry) await thumbnail(entry, target);
      },
    });
    visualAuthoring = new VisualAuthoring({
      gestures,
      history: () => documents.history,
      view: () => view,
      selected: () => selected,
      locked: () =>
        !!selected && (composition.locked.has(selected) || composition.hidden.has(selected)),
      change,
      select: (id) => composition.set(id),
    });
    sceneLibrary = new SceneLibrary({
      history: () => documents.history,
      view: () => view,
      selection: () => composition.editable(),
      open,
      import: importDocument,
      change,
      status,
      fragment: async (name, objects) =>
        await run(async () => {
          const data = await project.post({
            action: 'fragment',
            fragment: { version: 1, name, objects },
            document: documents.history.document,
          });
          status('Fragment saved to authoring/fragments/' + data.id + '.json');
        }),
      select: (ids) => {
        composition.selection.clear();
        ids.forEach((id) => composition.selection.add(id));
        composition.set(ids.at(-1), false);
        ids.forEach((id) => composition.selection.add(id));
        controls();
      },
      recoveries: () => project.recoveryEntries(),
      restore: (key) => {
        project.recover();
        readRecovery(key);
        $<HTMLButtonElement>('restore').click();
      },
    });
    playtest = new DraftPlaytest({
      document: () => documents.history.document,
      compose: (snapshot) => composeDraftGameplay(snapshot, contentDefinitions, worldVisuals),
      catalog: () => assetCatalog,
      manifest: (asset) => assetIndex.get(asset),
      status,
    });
    groundAuthoring = new GroundAuthoring(canvas, {
      gestures,
      document: () => documents.history.document,
      view: () => view,
      manifest: () => assetIndex.get(documents.history.document.floor.asset),
      change,
      status,
      request: async (selection, signal) => project.post({ action: 'segment', selection }, signal),
    });
    assetIndex = await loadAssetIndex(runtime, lifetime.signal);
    usedAssets = assetClosure(usedAssetRoots(), assetIndex);
    const manifests = [...assetIndex.values()];
    assertActive();
    for (const m of manifests) {
      const kind = paletteKind(m);
      if (kind)
        for (const clip of paletteClips(m))
          palette.push({ asset: m.asset.id, clip, kind, manifest: m });
    }
    palette.sort((a, b) => a.asset.localeCompare(b.asset) || a.clip.localeCompare(b.clip));
    showPalette();
    if (runtime.libraryInventory)
      await libraryInventory($('library-inventory'), lifetime.signal, (id) => {
        $<HTMLInputElement>('search').value = id;
        for (const field of ['asset-scope', 'category', 'collection'])
          $<HTMLSelectElement>(field).value = 'all';
        $<HTMLInputElement>('asset-animated').checked = false;
        showPalette();
      });
    await view.apply(documents.history.document);
    assertActive();
    fit();
    busy = false;
    controls();
    ready = true;
    if (!project.recoveryPending) status('');
    frames = new FrameScheduler(
      animate,
      () => (last = 0),
      automated,
      (error) => {
        cleanupAll([
          () => dispose(),
          () => {
            $('status').textContent = 'Editor stopped: ' + editorError(error);
            $('status').classList.add('error');
          },
        ]);
      },
    );
  }
  // Development-only inspection supports browser acceptance without exposing a player bridge.
  window.sceneEditor = {
    ready: () => ready,
    state: () => ({
      document: documents.history.document,
      revision: project.revision,
      dirty: project.dirty,
      selected,
    }),
    view: () => view,
    playtest: () => playtest.state(),
    dispose,
  };
  controls();
  void start().catch((error) => {
    if (!closed) {
      status('Editor startup failed: ' + editorError(error), true);
      try {
        dispose();
      } catch (cleanup) {
        // The startup rejection is already visible in status. Preserve both
        // failures without creating an unobserved rejection from this handler.
        console.error(
          new CleanupFailure([error, cleanup], 'Editor startup and cleanup failed', {
            cause: error,
          }),
        );
      }
    }
  });
  return window.sceneEditor;
}
