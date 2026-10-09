import * as T from 'three';
import { GamePresentation } from '../presentation/game-scene';
import { ActorSprite } from '../presentation/sprite';
import { resolveClip } from '../assets/schema';
import { sceneAssets, resolveAuthoredScene } from '../content/world-art';
import { validateSceneReferences, type SceneDocument } from '../content/scene-document';
import { ContentRegistry, heightAt, type AreaDefinition } from '../content/world';
import { contentDefinitions, content } from '../content/game-content';
import { GameSession } from '../core/session';
import { EventHub } from '../core/events';
import { outward } from '../core/camera';
import type { Simulation } from '../core/simulation';
import type { AssetRuntime, PackLease } from '../assets/loader';
import { sceneItems } from './model';
class EditorPresentation extends GamePresentation {
  center = new T.Vector3();
  overlay = new T.Group();
  protected override renderFrame(sim: Simulation, ms: number) {
    this.aim.visible = false;
    this.flare.visible = false;
    this.slash.visible = false;
    for (const v of this.actorPresentation.actors.values()) v.ring.visible = false;
    this.viewTarget.copy(this.center);
    this.cameraTarget.copy(this.center);
    this.camera.position.copy(this.center).addScaledVector(outward, 30);
    this.camera.lookAt(this.center);
    this.camera.updateMatrixWorld();
    super.renderFrame(sim, ms);
  }
  override get viewSpan() {
    return this.verticalSpan;
  }
}
export class EditorView {
  presentation?: EditorPresentation;
  sim?: Simulation;
  private generation = 0;
  private packs = new Map<string, PackLease>();
  private proxies: ActorSprite[] = [];
  private grid?: T.GridHelper;
  private selection?: T.BoxHelper;
  private selections: T.BoxHelper[] = [];
  private hidden = new Set<string>();
  private ghost?: ActorSprite;
  private ghostPack?: PackLease;
  private ghostKey = '';
  private ghostRequest = 0;

  private rays = new T.Raycaster();
  private alpha = new WeakMap<T.Texture, { data: Uint8Array; width: number; height: number }>();
  private abort = new AbortController();
  private closed = false;
  private composition?: string;
  private animationPlaying = true;
  setAnimationPlaying(playing: boolean) {
    this.animationPlaying = playing;
    if (this.presentation?.roomPresentation.inkRoom)
      this.presentation.roomPresentation.inkRoom.playing = playing;
  }
  replayAnimations() {
    this.presentation?.roomPresentation.inkRoom?.replay();
    this.render();
  }
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly runtime: AssetRuntime,
  ) {}
  async apply(document: SceneDocument) {
    if (this.closed) throw new Error('Editor closed');
    const art = resolveAuthoredScene(document);
    const composition = JSON.stringify({
      ...document,
      name: undefined,
      hero: undefined,
      look: undefined,
    });
    if (composition === this.composition && this.presentation && this.sim) {
      this.hero(document.hero);
      if (document.base === 'flat') this.sim.areaDefinition.name = document.name;
      this.presentation.visualOverride = art;
      this.presentation.lookRenderer.setSettings(document.look);
      return;
    }
    const ids = new Set(
      [
        'ink-hero-current',
        ...sceneAssets(art),
        ...(document.base === 'flat' ? [] : ['fx-embers', 'fx-smoke', 'fx-splash', 'fx-ripple']),
      ].filter((id) => id in this.runtime.catalog),
    );
    const acquired: PackLease[] = [];
    try {
      for (const id of ids)
        if (!this.packs.has(id)) {
          const pack = await this.runtime.loadPack(id, this.abort.signal);
          acquired.push(pack);
          this.packs.set(id, pack);
        }
      if (this.closed) throw new Error('Editor closed');
      validateSceneReferences(
        document,
        new Map([...this.packs].map(([id, p]) => [id, p.manifest])),
      );
      let area: AreaDefinition;
      if (document.base === 'flat') {
        const f = document.floor!;
        area = {
          id: 'editor-flat',
          name: document.name,
          subtitle: 'Scene composition',
          bounds: { minX: -f.width / 2, maxX: f.width / 2, minZ: -f.depth / 2, maxZ: f.depth / 2 },
          surface: { kind: 'flat', height: 0 },
          seedOffset: 0,
          baselineEntry: 'start',
          entries: [{ id: 'start', x: 0, z: 0 }],
          spawns: [],
          exits: [],
          props: [],
          floorColor: 0x344b4e,
        };
      } else
        area = {
          ...content.area(document.base),
          ...document.geometry!,
          spawns: [],
          exits: [],
          props: [],
        };
      const registry = new ContentRegistry({
        ...contentDefinitions,
        initialArea: area.id,
        areas: [area],
      });
      this.composition = undefined;
      this.sim = new GameSession(registry, 142, area.id, ++this.generation).sim;
      this.hero(document.hero);
      this.clearHelpers();
      if (!this.presentation) {
        this.presentation = new EditorPresentation(
          this.canvas,
          this.packs,
          new EventHub(),
          area,
          this.runtime.registration,
          art,
        );
        this.presentation.scene.add(this.presentation.overlay);
        await this.presentation.warm();
      } else {
        this.presentation.visualOverride = art;
        this.presentation.resetRoom(area, art);
      }
      this.presentation.generation = this.sim.generation;
      this.presentation.lookRenderer.setSettings(document.look);
      // The graveyard bakes overlays into its floor shader. Invisible, matching
      // top-down cards provide selection without introducing a second visual layer.
      if (document.base === 'court')
        for (const p of art.decals.filter((p) => p.asset === 'ink-graveyard-overlays')) {
          const pack = this.packs.get(p.asset)!,
            s = new ActorSprite(
              p.id,
              pack.manifest,
              pack.textures,
              resolveClip(pack.manifest, p.clip, 'd45'),
            );
          s.show(
            s.animator.frame,
            new T.Vector3(p.x, heightAt(area, p.x, p.z) + 0.018, p.z),
            this.presentation.camera,
          );
          s.mesh.scale.set((p.scale ?? 1) * (p.mirror ? -1 : 1), p.scale ?? 1, p.scale ?? 1);
          s.mesh.rotateZ(p.rotation ?? 0);
          this.proxies.push(s);
        }
      const bounds = area.bounds;
      this.grid = new T.GridHelper(
        Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ),
        Math.ceil(Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)),
        0xb89958,
        0x526c6c,
      );
      this.grid.position.y = 0.03;
      this.presentation.overlay.add(this.grid);
      for (const [id, pack] of this.packs)
        if (!ids.has(id)) {
          pack.release();
          this.packs.delete(id);
        }
      await this.presentation.lookRenderer.prepare();
      this.composition = composition;
      this.setAnimationPlaying(this.animationPlaying);
    } catch (error) {
      for (const p of acquired) {
        p.release();
        this.packs.delete(p.manifest.asset.id);
      }
      throw error;
    }
  }
  hero(point: { x: number; z: number }) {
    if (!this.sim) return;
    Object.assign(this.sim.hero, {
      ...point,
      px: point.x,
      pz: point.z,
      y: heightAt(this.sim.areaDefinition, point.x, point.z),
      py: heightAt(this.sim.areaDefinition, point.x, point.z),
    });
  }
  render(ms = 0) {
    if (!this.presentation || !this.sim) return;
    this.presentation.update(this.sim, 1, ms, this.sim.hero);
    this.selection?.update();
    this.selections.forEach((s) => s.update());
    this.setEditingVisibility(this.hidden);
  }
  screen(point: T.Vector3) {
    const p = point.clone().project(this.presentation!.camera),
      r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) * r.width) / 2, y: r.top + ((1 - p.y) * r.height) / 2 };
  }
  ray(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.rays.setFromCamera(
      new T.Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2),
      this.presentation!.camera,
    );
    return this.rays.ray;
  }
  ground(x: number, y: number, height = 0) {
    return this.ray(x, y).intersectPlane(
      new T.Plane(new T.Vector3(0, 1, 0), -height),
      new T.Vector3(),
    );
  }
  private sprites() {
    return [...(this.presentation?.roomPresentation.inkRoom?.sprites ?? []), ...this.proxies];
  }
  private opaque(s: ActorSprite, uv: T.Vector2) {
    const texture = s.material.map!;
    let sample = this.alpha.get(texture);
    if (!sample) {
      const image = texture.image as ImageBitmap,
        c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, c.width, c.height).data,
        data = new Uint8Array(c.width * c.height);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]!;
      sample = { data, width: c.width, height: c.height };
      this.alpha.set(texture, sample);
    }
    const x = Math.min(sample.width - 1, Math.max(0, Math.floor(uv.x * sample.width))),
      y = Math.min(sample.height - 1, Math.max(0, Math.floor(uv.y * sample.height)));
    return sample.data[y * sample.width + x]! > 32;
  }
  pick(x: number, y: number, document: SceneDocument) {
    this.ray(x, y);
    const items = new Map(sceneItems(document).map((item) => [item.placement.id, item])),
      sprites = this.sprites().filter((s) => items.has(s.id) && !this.hidden.has(s.id));
    for (const s of sprites) s.mesh.updateMatrixWorld(true);
    const hits = this.rays.intersectObjects(
      sprites.map((s) => s.mesh),
      false,
    );
    for (const hit of hits) {
      const s = sprites.find((s) => s.mesh === hit.object)!;
      if (hit.uv && this.opaque(s, hit.uv)) return items.get(s.id);
    }
    return undefined;
  }
  select(id: string | undefined) {
    if (this.selection) {
      this.selection.geometry.dispose();
      (this.selection.material as T.Material).dispose();
      this.selection.removeFromParent();
      this.selection = undefined;
    }
    const s = this.sprites().find((s) => s.id === id);
    if (s && this.presentation) {
      this.selection = new T.BoxHelper(s.mesh, 0xe9bd65);
      this.presentation.overlay.add(this.selection);
    }
  }
  async placementGhost(asset: string, clip: string, heading: string, point: T.Vector3) {
    const key = asset + '/' + clip + '/' + heading;
    if (this.ghostKey !== key) {
      const request = ++this.ghostRequest;
      this.ghostKey = key;
      this.ghost?.dispose();
      this.ghost = undefined;
      this.ghostPack?.release();
      this.ghostPack = undefined;
      const pack = await this.runtime.loadPack(asset, this.abort.signal);
      if (this.closed || request !== this.ghostRequest) {
        pack.release();
        return;
      }
      this.ghostPack = pack;
      this.ghost = new ActorSprite(
        'editor-ghost',
        pack.manifest,
        pack.textures,
        resolveClip(
          pack.manifest,
          clip,
          heading as NonNullable<SceneDocument['objects'][number]['heading']>,
        ),
      );
      this.ghost.material.transparent = true;
      this.ghost.material.opacity = 0.45;
      this.ghost.material.depthWrite = false;
      this.presentation?.overlay.add(this.ghost.mesh);
    }
    if (this.ghost && this.presentation) {
      this.ghost.show(this.ghost.animator.frame, point, this.presentation.camera);
      this.render();
    }
  }
  clearPlacementGhost() {
    this.ghostRequest++;
    this.ghostKey = '';
    this.ghost?.dispose();
    this.ghost = undefined;
    this.ghostPack?.release();
    this.ghostPack = undefined;
  }
  setEditingVisibility(ids: ReadonlySet<string>) {
    this.hidden = new Set(ids);
    for (const s of this.sprites()) s.mesh.visible = !ids.has(s.id);
  }
  selectMany(ids: readonly string[]) {
    for (const helper of this.selections) {
      helper.geometry.dispose();
      (helper.material as T.Material).dispose();
      helper.removeFromParent();
    }
    this.selections = [];
    this.select(undefined);
    for (const id of ids) {
      const s = this.sprites().find((s) => s.id === id);
      if (s && this.presentation) {
        const helper = new T.BoxHelper(s.mesh, 0xe9bd65);
        this.presentation.overlay.add(helper);
        this.selections.push(helper);
      }
    }
  }
  setGrid(visible: boolean) {
    if (this.grid) this.grid.visible = visible;
  }
  previewPosition(id: string, x: number, z: number) {
    const s = this.sprites().find((s) => s.id === id);
    if (s) {
      s.mesh.position.x = x;
      s.mesh.position.z = z;
    }
  }
  private clearHelpers() {
    this.proxies.forEach((s) => s.dispose());
    this.proxies = [];
    this.selectMany([]);
    if (this.grid) {
      this.grid.geometry.dispose();
      (this.grid.material as T.Material).dispose();
      this.grid.removeFromParent();
      this.grid = undefined;
    }
  }
  resize() {
    this.presentation?.resize();
  }
  dispose() {
    this.closed = true;
    this.abort.abort();
    this.clearPlacementGhost();
    this.clearHelpers();
    this.presentation?.dispose();
    for (const pack of this.packs.values()) pack.release();
    this.packs.clear();
  }
}
