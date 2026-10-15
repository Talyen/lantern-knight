import { groundPlacementPolicy } from '../content/scene-placement';
import { paintedEnvelopePolicy, spritePlacementEnvelope } from '../content/placement-envelope';
import { cleanupAll } from '../assets/cleanup';
import { moveSupported, effectiveRadius } from '../core/navigation';
import { actorVisuals } from '../content/visuals';
import * as T from 'three';
import { GamePresentation } from '../presentation/game-scene';
import { ActorSprite } from '../presentation/sprite';
import { resolveClip } from '../assets/schema';
import { resolveScene } from '../content/world-art';
import {
  validateSceneReferences,
  type SceneDocument,
  type SceneSnapshot,
} from '../content/scene-document';
import { ContentRegistry, heightAt } from '../content/world';
import { contentDefinitions } from '../content/game-content';
import { GameSession } from '../core/session';
import { EventHub } from '../core/events';
import {
  outward,
  screenMovement,
  constrainCamera,
  resizeCamera,
  walkablePoint,
} from '../presentation/camera';
import type { Simulation } from '../core/simulation';
import type { SimulationView } from '../core/simulation-view';
import { SceneAssets } from '../assets/scene-assets';
import type { AssetRuntime, PackLease, PackBatch } from '../assets/loader';
import { sceneItems } from './model';
class EditorPresentation extends GamePresentation {
  center = new T.Vector3();
  overlay = new T.Group();
  beforeRender = () => {};
  protected override renderFrame(sim: SimulationView, ms: number) {
    this.aim.visible = false;
    this.flare.visible = false;
    for (const v of this.actorPresentation.actors.values()) v.ring.visible = false;
    resizeCamera(this.camera, this.canvas.clientWidth, this.canvas.clientHeight, this.viewSpan);
    this.viewTarget.copy(this.center);
    constrainCamera(this.camera, this.viewTarget, sim.areaDefinition);
    this.cameraTarget.copy(this.viewTarget);
    this.camera.position.copy(this.viewTarget).addScaledVector(outward, 30);
    this.camera.lookAt(this.viewTarget);
    this.camera.updateMatrixWorld();
    this.beforeRender();
    super.renderFrame(sim, ms);
  }
  override get viewSpan() {
    return this.verticalSpan;
  }
}
export class EditorView {
  private renderer?: EditorPresentation;
  private simulation?: Simulation;
  private accepted = false;
  private warmed = false;
  get presentation() {
    return this.available ? this.renderer : undefined;
  }
  get sim() {
    return this.available ? this.simulation : undefined;
  }
  private get available() {
    return this.accepted && !this.applying && !this.closed;
  }
  private generation = 0;
  private readonly assets = new SceneAssets();
  private readonly packs = this.assets.packs;
  private grid?: T.GridHelper;
  private selection?: T.BoxHelper;
  private selections: T.BoxHelper[] = [];
  private hidden = new Set<string>();
  private ghost?: ActorSprite;
  private ghostPack?: PackLease;
  private ghostKey = '';
  private ghostRequest = 0;
  private ghostPoint = new T.Vector3();
  private placementCheck?: ReturnType<typeof groundPlacementPolicy>;
  private envelopeCheck?: ReturnType<typeof paintedEnvelopePolicy>;

  private rays = new T.Raycaster();
  private alpha = new WeakMap<T.Texture, { data: Uint8Array; width: number; height: number }>();
  private abort = new AbortController();
  private closed = false;
  private applying = false;
  private composition?: string;
  private animationPlaying = true;
  private transformPreview: {
    sprite: ActorSprite;
    position: T.Vector3;
    scale: T.Vector3;
    quaternion: T.Quaternion;
  }[] = [];
  private previewMatrices = new Map<
    string,
    { position: T.Vector3; scale: T.Vector3; quaternion: T.Quaternion }
  >();
  private appliedDocument?: SceneSnapshot;
  private walking?: { x: number; z: number; yaw: number; initialYaw: number; center: T.Vector3 };
  setHeroWalking(enabled: boolean) {
    if (!this.available || !this.simulation || !this.renderer) return;
    if (enabled && !this.walking) {
      const { x, z, yaw } = this.simulation.hero;
      this.walking = { x, z, yaw, initialYaw: yaw, center: this.renderer.center.clone() };
    } else if (!enabled && this.walking) {
      this.renderer.center.copy(this.walking.center);
      this.simulation.hero.yaw = this.walking.initialYaw;
      this.walking = undefined;
      this.simulation.hero.state = 'idle';
      if (this.appliedDocument) this.hero(this.appliedDocument.hero);
    }
    this.render();
  }
  walkHero(x: number, y: number, ms: number) {
    if (!this.available || !this.walking || !this.simulation) return;
    const move = screenMovement(x, y),
      hero = this.simulation.hero;
    hero.state = x || y ? 'walk' : 'idle';
    if (x || y) this.walking.yaw = Math.atan2(move.x, move.z);
    Object.assign(
      this.walking,
      moveSupported(
        this.simulation.areaDefinition,
        this.walking,
        {
          x: (move.x * hero.definition.speed * ms) / 1000,
          z: (move.z * hero.definition.speed * ms) / 1000,
        },
        effectiveRadius(hero.definition.radius),
      ),
    );
    this.hero(this.walking);
    hero.yaw = this.walking.yaw;
    if (x || y) this.renderer!.center.set(hero.x, hero.y, hero.z);
  }
  previewTransforms(document: SceneSnapshot) {
    if (!this.available || !this.appliedDocument || !this.simulation) return;
    const originals = new Map(
      sceneItems(this.appliedDocument).map((p) => [p.placement.id, p.placement]),
    );
    this.transformPreview = [];
    for (const { placement: p } of sceneItems(document)) {
      const original = originals.get(p.id),
        sprite = this.sprites().find((s) => s.id === p.id);
      if (!original || !sprite) continue;
      if (
        !this.previewMatrices.has(p.id) &&
        (['x', 'z', 'y', 'scale', 'rotation'] as const).every((key) => p[key] === original[key])
      )
        continue;
      let base = this.previewMatrices.get(p.id);
      if (!base) {
        base = {
          position: sprite.mesh.position.clone(),
          scale: sprite.mesh.scale.clone(),
          quaternion: sprite.mesh.quaternion.clone(),
        };
        this.previewMatrices.set(p.id, base);
      }
      const angle = (p.rotation ?? 0) - (original.rotation ?? 0);
      this.transformPreview.push({
        sprite,
        position: base.position
          .clone()
          .add(
            new T.Vector3(
              p.x - original.x,
              heightAt(this.simulation.areaDefinition, p.x, p.z) -
                heightAt(this.simulation.areaDefinition, original.x, original.z) +
                (p.y ?? 0) -
                (original.y ?? 0),
              p.z - original.z,
            ),
          ),
        scale: base.scale.clone().multiplyScalar((p.scale ?? 1) / (original.scale ?? 1)),
        quaternion: base.quaternion
          .clone()
          .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), angle)),
      });
    }
    this.render();
  }
  clearTransformPreview() {
    for (const sprite of this.sprites()) {
      const base = this.previewMatrices.get(sprite.id);
      if (!base) continue;
      sprite.mesh.position.copy(base.position);
      sprite.mesh.scale.copy(base.scale);
      sprite.mesh.quaternion.copy(base.quaternion);
    }
    this.previewMatrices.clear();
    this.transformPreview = [];
  }
  setAnimationPlaying(playing: boolean) {
    this.animationPlaying = playing;
    if (this.renderer?.roomPresentation.inkRoom)
      this.renderer.roomPresentation.inkRoom.playing = playing;
  }
  replayAnimations() {
    if (!this.available) return;
    this.renderer?.roomPresentation.inkRoom?.replay();
    this.render();
  }
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly runtime: AssetRuntime,
    private readonly createPresentation: (
      ...args: ConstructorParameters<typeof EditorPresentation>
    ) => EditorPresentation = (...args) => new EditorPresentation(...args),
  ) {}
  async apply(document: SceneSnapshot) {
    if (this.closed) throw new Error('Editor closed');
    if (this.applying) throw new Error('Scene update in progress');
    this.clearTransformPreview();
    const resolved = resolveScene(document);
    const art = this.hidden.size
      ? {
          ...resolved.visuals,
          props: resolved.visuals.props.filter((p) => !this.hidden.has(p.id)),
          decals: resolved.visuals.decals.filter((p) => !this.hidden.has(p.id)),
          graves: resolved.visuals.graves.filter((p) => !this.hidden.has(p.id)),
          resolvedFixtures: resolved.visuals.resolvedFixtures?.filter(
            (p) => !this.hidden.has(p.prop),
          ),
        }
      : resolved.visuals;
    const composition = JSON.stringify({
      ...document,
      editorHidden: [...this.hidden].sort(),
      hero: undefined,
      look: undefined,
    });
    if (composition === this.composition && this.renderer && this.simulation) {
      this.appliedDocument = document;
      this.positionHero(this.walking ?? document.hero);
      this.renderer.visualOverride = art;
      this.renderer.lookRenderer.setSettings({
        ...document.look,
        sun: document.look.sun,
        shadeZones: document.look.shadeZones,
      });
      return;
    }
    const ids = new Set(
      [
        'ink-hero-current',
        ...(document.gameplay?.spawns.map((p) => {
          const actor = contentDefinitions.actors.find((a) => a.id === p.actor);
          if (!actor) throw new Error('Unknown enemy ' + p.actor);
          return actorVisuals[actor.visual]!.asset;
        }) ?? []),
        ...resolved.assets,
        ...(document.base === 'flat' ? [] : ['fx-embers', 'fx-smoke', 'fx-splash', 'fx-ripple']),
      ].filter((id) => id in this.runtime.catalog),
    );
    let acquired: PackBatch | undefined;
    this.applying = true;
    try {
      acquired = await this.runtime.loadPacks(ids, this.abort.signal);
      if (this.closed) throw new Error('Editor closed');
      validateSceneReferences(
        document,
        new Map([...acquired.packs].map(([id, p]) => [id, p.manifest])),
      );
      const area = { ...resolved.area, exits: [], spawns: document.gameplay?.spawns ?? [] };
      const registry = new ContentRegistry({
        ...contentDefinitions,
        initialArea: area.id,
        areas: [area],
      });
      const installing = acquired;
      acquired = undefined; // SceneAssets owns both generations from this point.
      this.assets.install(installing, () => {
        // From the first mutation, neither generation is safe to expose until
        // rebuilding and asynchronous preparation have both succeeded.
        this.accepted = false;
        this.clearPlacementGhost();
        this.composition = undefined;
        this.simulation = new GameSession(registry, 142, area.id, ++this.generation).sim;
        this.positionHero(this.walking ?? document.hero);
        this.clearHelpers();
        if (!this.renderer) {
          this.renderer = this.createPresentation(
            this.canvas,
            this.packs,
            new EventHub(),
            this.simulation.areaDefinition,
            this.runtime.registration,
            art,
          );
          this.renderer.scene.add(this.renderer.overlay);
        } else {
          this.renderer.visualOverride = art;
          this.renderer.resetRoom(this.simulation.areaDefinition, art);
        }
        this.renderer.generation = this.simulation.generation;
        this.renderer.lookRenderer.setSettings({
          ...document.look,
          sun: document.look.sun,
          shadeZones: document.look.shadeZones,
        });
        const bounds = area.bounds;
        this.grid = new T.GridHelper(
          Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ),
          Math.ceil(Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)),
          0xb89958,
          0x526c6c,
        );
        this.grid.position.y = 0.03;
        this.renderer.overlay.add(this.grid);
      });
      const presentation = this.renderer!;
      if (!this.warmed) {
        await presentation.warm();
        if (this.closed) throw new Error('Editor closed');
        this.warmed = true;
      }
      await presentation.lookRenderer.prepare();
      if (this.closed) throw new Error('Editor closed');
      this.composition = composition;
      this.appliedDocument = document;
      this.accepted = true;
      this.placementCheck = groundPlacementPolicy(resolved.document, resolved.area);
      this.envelopeCheck = paintedEnvelopePolicy(resolved.document);
      this.setAnimationPlaying(this.animationPlaying);
    } catch (error) {
      acquired?.release();
      throw error;
    } finally {
      this.applying = false;
    }
  }
  hero(point: { x: number; z: number }) {
    if (!this.available) return;
    this.positionHero(point);
  }
  private positionHero(point: { x: number; z: number }) {
    if (!this.simulation) return;
    Object.assign(this.simulation.hero, {
      x: point.x,
      z: point.z,
      px: point.x,
      pz: point.z,
      y: heightAt(this.simulation.areaDefinition, point.x, point.z),
      py: heightAt(this.simulation.areaDefinition, point.x, point.z),
    });
  }
  render(ms = 0) {
    if (!this.available || !this.renderer || !this.simulation) return;
    this.renderer.beforeRender = () => {
      for (const { sprite, position, scale, quaternion } of this.transformPreview) {
        sprite.mesh.position.copy(position);
        sprite.mesh.scale.copy(scale);
        sprite.mesh.quaternion.copy(quaternion);
      }
      this.selection?.update();
      this.selections.forEach((s) => s.update());
      // Editing can hide a drawing, but must preserve animation/pickup visibility.
      for (const sprite of this.sprites())
        if (this.hidden.has(sprite.id)) sprite.mesh.visible = false;
    };
    this.renderer.update(this.simulation.view, 1, ms, this.simulation.hero);
  }
  screen(point: T.Vector3) {
    const p = point.clone().project(this.renderer!.camera),
      r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) * r.width) / 2, y: r.top + ((1 - p.y) * r.height) / 2 };
  }
  ray(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.rays.setFromCamera(
      new T.Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2),
      this.renderer!.camera,
    );
    return this.rays.ray;
  }
  ground(x: number, y: number, height?: number) {
    if (!this.available) return null;
    if (height === undefined)
      return walkablePoint(
        this.renderer!.camera,
        x,
        y,
        this.canvas.getBoundingClientRect(),
        this.simulation!.areaDefinition,
      );
    return this.ray(x, y).intersectPlane(
      new T.Plane(new T.Vector3(0, 1, 0), -height),
      new T.Vector3(),
    );
  }
  private sprites() {
    return (this.available ? this.renderer?.roomPresentation.inkRoom?.sprites : undefined) ?? [];
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
  pick(x: number, y: number, document: SceneSnapshot) {
    if (!this.available) return undefined;
    this.ray(x, y);
    const items = new Map(sceneItems(document).map((item) => [item.placement.id, item])),
      sprites = this.sprites().filter(
        (s) =>
          items.has(s.id) && !this.hidden.has(s.id) && s.mesh.visible && s.material.opacity > 0,
      );
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
    if (s && this.renderer) {
      this.selection = new T.BoxHelper(s.mesh, 0xe9bd65);
      this.renderer.overlay.add(this.selection);
    }
  }
  async placementGhost(asset: string, clip: string, heading: string, point: T.Vector3) {
    if (!this.available) return;
    this.ghostPoint.copy(point);
    const key = asset + '/' + clip + '/' + heading;
    if (this.ghostKey !== key) {
      const request = ++this.ghostRequest;
      this.ghostKey = key;
      this.ghost?.dispose();
      this.ghost = undefined;
      this.ghostPack?.release();
      this.ghostPack = undefined;
      let pack: PackLease;
      try {
        pack = await this.runtime.loadPack(asset, this.abort.signal);
      } catch (error) {
        if (request === this.ghostRequest) this.ghostKey = '';
        throw error;
      }
      if (!this.available || request !== this.ghostRequest) {
        pack.release();
        return;
      }
      try {
        const resolved = resolveClip(
          pack.manifest,
          clip,
          heading as NonNullable<SceneDocument['objects'][number]['heading']>,
        );
        this.ghost = new ActorSprite('editor-ghost', pack.manifest, pack.textures, resolved);
      } catch (error) {
        pack.release();
        this.ghostKey = '';
        throw error;
      }
      this.ghostPack = pack;
      this.ghost.material.transparent = true;
      this.ghost.material.opacity = 0.45;
      this.ghost.material.depthWrite = false;
      this.renderer?.overlay.add(this.ghost.mesh);
    }
    if (this.ghost && this.renderer) {
      const asset = this.ghost.manifest.asset;
      const issue =
        (asset.type === 'prop' || asset.type === 'character') && asset.placement !== 'ground'
          ? (this.placementCheck?.(this.ghostPoint, 0.3) ??
            this.envelopeCheck?.(
              this.ghostPoint,
              spritePlacementEnvelope(this.ghost.manifest, [clip]),
            ))
          : undefined;
      this.ghost.material.color.set(issue ? 0xe35f58 : 0xffffff);
      this.ghost.show(this.ghost.animator.frame, this.ghostPoint, this.renderer.camera);
      this.render();
    }
  }
  clearPlacementGhost() {
    this.ghostRequest++;
    this.ghostKey = '';
    const ghost = this.ghost,
      pack = this.ghostPack;
    this.ghost = undefined;
    this.ghostPack = undefined;
    cleanupAll([() => ghost?.dispose(), () => pack?.release()]);
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
      if (s && this.renderer) {
        const helper = new T.BoxHelper(s.mesh, 0xe9bd65);
        this.renderer.overlay.add(helper);
        this.selections.push(helper);
      }
    }
  }
  setGrid(visible: boolean) {
    if (this.grid) this.grid.visible = visible;
  }
  previewPosition(id: string, x: number, z: number) {
    const s = this.sprites().find((s) => s.id === id);
    if (!s || !this.simulation) return;
    let base = this.previewMatrices.get(id);
    if (!base) {
      base = {
        position: s.mesh.position.clone(),
        scale: s.mesh.scale.clone(),
        quaternion: s.mesh.quaternion.clone(),
      };
      this.previewMatrices.set(id, base);
    }
    const original =
      this.appliedDocument &&
      sceneItems(this.appliedDocument).find((p) => p.placement.id === id)?.placement;
    if (!original) return;
    const preview = {
      sprite: s,
      position: base.position
        .clone()
        .add(
          new T.Vector3(
            x - original.x,
            heightAt(this.simulation.areaDefinition, x, z) -
              heightAt(this.simulation.areaDefinition, original.x, original.z),
            z - original.z,
          ),
        ),
      scale: base.scale.clone(),
      quaternion: base.quaternion.clone(),
    };
    this.transformPreview = this.transformPreview.filter((p) => p.sprite !== s);
    this.transformPreview.push(preview);
  }
  private clearHelpers() {
    this.selectMany([]);
    if (this.grid) {
      this.grid.geometry.dispose();
      (this.grid.material as T.Material).dispose();
      this.grid.removeFromParent();
      this.grid = undefined;
    }
  }
  resize() {
    if (this.closed) return;
    this.renderer?.resize();
    this.render();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.accepted = false;
    cleanupAll([
      () => this.abort.abort(),
      () => this.clearPlacementGhost(),
      () => this.clearHelpers(),
      () => this.renderer?.dispose(),
      () => this.assets.dispose(),
    ]);
  }
}
