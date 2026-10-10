import type { PresentationLifecycle } from './lifecycle';
import { RoomPresentation } from './room-presentation';
import { ActorPresentation } from './actor-presentation';
import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
import { verifiedBitmap } from '../assets/bitmap';
import {
  contract,
  makeCamera,
  resizeCamera,
  drawingBufferSize,
  HEADINGS,
  outward,
} from '../core/camera';
import { setCutoutOpacity } from './sprite';
import type { WalkTiming } from '../core/locomotion-timing';
import type { AnimationTreatment } from '../core/animation-treatment';
import type { AnimationFlow } from './animation-blend-shader';
import {
  type WorldVisualDefinition,
  compositionPoint,
  compositionSpan,
  compositionHeight,
} from '../content/world-visuals';
import type { Clip } from '../assets/schema';
import { tuning } from '../content/gameplay';
import { heightAt, type AreaDefinition } from '../content/world';
import { pageIdentity, type AssetPack } from '../assets/loader';
import { EventHub } from '../core/events';
import type { Actor, Simulation } from '../core/simulation';
import {
  defaultVisualEffects,
  type VisualEffects,
  type WeatherState,
} from '../content/visual-effects';
import { SceneVisualEffects } from './scene-visual-effects';
import { CombatFeedback } from './combat-feedback';
import { SceneLightingRenderer } from './scene-lighting-renderer';
export class GamePresentation implements PresentationLifecycle {
  readonly roomPresentation: RoomPresentation;
  readonly actorPresentation: ActorPresentation;
  lookRenderer: SceneLightingRenderer;
  get depthOfField() {
    return this.lookRenderer.settings.depthOfField;
  }
  visualEffects = defaultVisualEffects();
  sceneEffects: SceneVisualEffects;
  readonly combatFeedback: CombatFeedback;
  renderer: T.WebGLRenderer;
  camera = makeCamera(16 / 9);
  scene = new T.Scene();
  aim: T.Mesh;
  light = new T.PointLight(0xf7b862, 5, 5, 2);
  debug = false;
  background = 'dark';
  animationTreatment: AnimationTreatment = 'guarded';
  stabilized = true;
  rigidSword = true;
  walkTiming: WalkTiming = 'weighted';
  animationFlow: AnimationFlow | undefined;
  private flowBitmap: ImageBitmap | undefined;
  protected disposed = false;
  shadowTexture: T.CanvasTexture;
  cameraTarget = new T.Vector3();
  viewTarget = new T.Vector3();
  requestedRenderScale = contract.renderScale;
  effectivePixelRatio = 1;
  verticalSpan = contract.verticalSpan;
  area: AreaDefinition;
  generation = -1;
  flare: T.Mesh;
  get visuals() {
    return this.visualOverride;
  }
  get manifest() {
    return this.packs.get('ink-hero-current')!.manifest;
  }
  get textures() {
    return this.packs.get('ink-hero-current')!.textures;
  }
  constructor(
    public canvas: HTMLCanvasElement,
    public packs: ReadonlyMap<string, AssetPack>,
    public events: EventHub,
    initialArea: AreaDefinition,
    readonly registration: PreparedRegistration,
    public visualOverride?: WorldVisualDefinition,
  ) {
    this.area = initialArea;
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setPixelRatio(contract.pixelRatioCap);
    this.renderer.setClearColor(0x151923);
    if (
      this.renderer.capabilities.maxTextureSize <
      Math.max(...this.manifest.pages.map((p) => Math.max(p.width, p.height)))
    )
      throw new Error('GPU maximum texture size below compiled atlas dimensions');
    this.scene.add(new T.HemisphereLight(0xc5d4e1, 0x392b30, 2));
    const sun = new T.DirectionalLight(0xe9d2ac, 2);
    sun.position.set(-4, 8, 3);
    this.scene.add(sun, this.light);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const ctx = shadowCanvas.getContext('2d')!,
      gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.shadowTexture = new T.CanvasTexture(shadowCanvas);
    this.shadowTexture.generateMipmaps = false;
    this.roomPresentation = new RoomPresentation(
      packs,
      this.camera,
      this.shadowTexture,
      registration,
    );
    this.actorPresentation = new ActorPresentation(
      this.roomPresentation.room,
      packs,
      this.camera,
      this.shadowTexture,
      registration,
      events,
    );
    this.scene.add(this.roomPresentation.room);
    this.flare = new T.Mesh(
      new T.RingGeometry(
        0.02,
        tuning.ability.range,
        48,
        6,
        -tuning.ability.halfAngle,
        tuning.ability.halfAngle * 2,
      ),
      new T.MeshBasicMaterial({
        color: 0xf4c575,
        transparent: true,
        opacity: 0.35,
        depthTest: true,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    this.flare.rotation.x = -Math.PI / 2;
    this.flare.frustumCulled = false;
    this.scene.add(this.flare);
    const aimGeo = new T.RingGeometry(0.16, 0.19, 32),
      aimMat = new T.MeshBasicMaterial({
        color: 0xe5bd77,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
    this.aim = new T.Mesh(aimGeo, aimMat);
    this.aim.rotation.x = -Math.PI / 2;
    this.scene.add(this.aim);
    this.buildRoom();
    this.resize();
    this.sceneEffects = new SceneVisualEffects(this.packs, this.camera);
    this.lookRenderer = new SceneLightingRenderer(
      { renderer: this.renderer, scene: this.scene, camera: this.camera, packs: this.packs },
      this.roomPresentation,
      this.actorPresentation,
      this.sceneEffects,
    );
    if (this.visuals?.look) this.lookRenderer.setSettings(this.visuals.look);
    this.scene.add(this.sceneEffects.group);
    this.combatFeedback = new CombatFeedback(this.packs, this.camera, this.events);
    this.scene.add(this.combatFeedback.group);
  }
  buildRoom() {
    this.roomPresentation.buildRoom(this.area, this.visuals);
  }
  disposeRoom() {
    this.roomPresentation.disposeScenery();
    this.actorPresentation.dispose();
    this.roomPresentation.disposeResources();
  }
  prepareAssets(ids?: ReadonlySet<string>) {
    return this.lookRenderer.prepare(ids);
  }
  resetRoom(area: AreaDefinition, visuals: WorldVisualDefinition | undefined) {
    this.visualOverride = visuals;
    this.sceneEffects.reset();
    this.combatFeedback.reset();
    this.lookRenderer.resetRoom();
    this.disposeRoom();
    this.area = area;
    this.buildRoom();
    if (this.visuals?.look) this.lookRenderer.setSettings(this.visuals.look);
  }
  createVisual(a: Actor, generation: number) {
    return this.actorPresentation.createVisual(a, generation);
  }
  getClip(id: string, dir: (typeof HEADINGS)[number], manifest = this.manifest): Clip {
    return this.actorPresentation.getClip(id, dir, manifest, this.walkTiming);
  }
  protected framingZ = 3;
  get viewSpan() {
    return compositionSpan({ x: 0, z: this.framingZ }, this.verticalSpan, this.visuals);
  }
  update(sim: Simulation, alpha: number, ms: number, aim: { x: number; z: number }) {
    if (this.generation !== sim.generation) {
      this.resetRoom(sim.areaDefinition, this.visuals);
      this.generation = sim.generation;
    }
    this.roomPresentation.room.visible = true;
    this.updateCamera(sim, alpha);
    this.flare.visible =
      (!this.roomPresentation.inkRoom || this.debug) &&
      ((sim.hero.state === 'ability' && sim.hero.age >= tuning.ability.windup) || this.debug);
    this.flare.position.set(sim.hero.x, sim.hero.y + 0.06, sim.hero.z);
    this.flare.rotation.z =
      (sim.hero.state === 'ability' ? sim.hero.yaw : sim.hero.aim) - Math.PI / 2;
    this.flare.scale.setScalar(1);
    (this.flare.material as T.MeshBasicMaterial).opacity =
      sim.hero.state === 'ability'
        ? Math.max(0, 1 - sim.hero.age / tuning.ability.total) * 0.6
        : 0.12;
    if (this.flare.visible) {
      const points = this.flare.geometry.getAttribute('position'),
        a = this.flare.rotation.z,
        c = Math.cos(a),
        s = Math.sin(a);
      for (let i = 0; i < points.count; i++) {
        const x = points.getX(i),
          y = points.getY(i),
          wx = sim.hero.x + x * c - y * s,
          wz = sim.hero.z - x * s - y * c;
        points.setZ(i, heightAt(sim.areaDefinition, wx, wz) - sim.hero.y);
      }
      points.needsUpdate = true;
    }
    this.renderer.setClearColor(this.background === 'light' ? 0xd1c9b4 : 0x151923);
    this.aim.visible = true;
    this.aim.position.set(aim.x, heightAt(sim.areaDefinition, aim.x, aim.z) + 0.035, aim.z);
    this.actorPresentation.update(sim, alpha, ms, {
      walkTiming: this.walkTiming,
      stabilized: this.stabilized,
      rigidSword: this.rigidSword,
      animationTreatment: this.animationTreatment,
      animationFlow: this.animationFlow,
      debug: this.debug,
      illustrated: !!this.roomPresentation.inkRoom,
    });
    this.light.position.set(sim.hero.x - 0.25, sim.hero.y + 0.85, sim.hero.z);
    this.light.intensity = sim.hero.state === 'ability' ? 14 : 5;
    for (const m of this.roomPresentation.fadeMeshes) {
      const p = m.userData.foot as { x: number; y: number; z: number },
        delta = new T.Vector3(sim.hero.x - p.x, sim.hero.y - p.y, sim.hero.z - p.z);
      const fade = delta.length() < 1.65 && delta.dot(outward) < 0;
      setCutoutOpacity(m.material, fade ? 0.38 : 1);
    }
    this.roomPresentation.inkRoom?.update(sim, alpha, true, ms);
    for (const pickup of sim.areaDefinition.pickups ?? []) {
      const sprite = this.roomPresentation.inkRoom?.sprites.find((p) => p.id === pickup.object);
      if (sprite) sprite.mesh.visible = !sim.collectedPickups.has(pickup.id);
    }
    this.sceneEffects.update(
      sim.areaDefinition,
      sim.generation,
      this.roomPresentation.inkRoom?.sprites ?? [],
      ms,
      this.visualEffects,
      this.visuals,
    );
    this.combatFeedback.update(sim);
    this.renderFrame(sim, ms);
  }
  setVisualEffects(options: Partial<VisualEffects>) {
    this.visualEffects = { ...this.visualEffects, ...options };
  }
  setWeather(state: WeatherState | null) {
    this.sceneEffects.setWeather(state);
  }
  private updateCamera(sim: Simulation, alpha: number) {
    if (tuning.cameraFollow) {
      const hero = sim.hero,
        x = hero.px + (hero.x - hero.px) * alpha,
        z = hero.pz + (hero.z - hero.pz) * alpha;
      this.framingZ = z;
      if (Math.abs(this.camera.top * 2 - this.viewSpan) > 1e-8)
        resizeCamera(this.camera, this.canvas.clientWidth, this.canvas.clientHeight, this.viewSpan);
      this.cameraTarget.set(x, heightAt(sim.areaDefinition, x, z), z);
      const framed = compositionPoint(
        { x, z },
        {
          halfWidth: (this.camera.right - this.camera.left) / 2,
          halfHeight: (this.camera.top - this.camera.bottom) / 2,
        },
        this.visuals,
      );
      this.viewTarget.set(
        framed.x,
        heightAt(sim.areaDefinition, framed.x, framed.z) +
          compositionHeight({ x, z }, this.visuals),
        framed.z,
      );
      this.camera.position.copy(this.viewTarget).addScaledVector(outward, 30);
      this.camera.lookAt(this.viewTarget);
      this.camera.updateMatrixWorld();
    }
  }
  setDepthOfField(value: number) {
    if (!Number.isFinite(value)) return;
    this.lookRenderer.setSettings({ depthOfField: value });
  }
  protected renderFrame(sim: Simulation, ms: number) {
    this.roomPresentation.surround.update(
      this.camera,
      this.viewTarget,
      this.lookRenderer.settings,
      this.visualEffects.palette,
    );
    this.lookRenderer.render(sim, ms, {
      visuals: this.visuals,
      visualEffects: this.visualEffects,
      cameraTarget: this.cameraTarget,
      viewSpan: this.viewSpan,
    });
  }
  resize(scale = contract.renderScale) {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const buffer = drawingBufferSize(width, height, devicePixelRatio, scale);
    this.requestedRenderScale = scale;
    this.effectivePixelRatio = buffer.pixelRatio;
    this.renderer.setPixelRatio(buffer.pixelRatio);
    this.renderer.setSize(width * scale, height * scale, false);
    resizeCamera(this.camera, width, height, this.viewSpan);
  }
  warmPack(pack: AssetPack) {
    if (
      this.renderer.capabilities.maxTextureSize <
      Math.max(...pack.manifest.pages.map((p) => Math.max(p.width, p.height)))
    )
      throw new Error('GPU maximum texture size below atlas dimensions');
    for (const texture of pack.textures.values()) {
      if (texture.generateMipmaps)
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.renderer.initTexture(texture);
    }
  }
  async loadAnimationFlow() {
    const animationFlowData = this.registration.animation;
    const bitmap = await verifiedBitmap('/animation/flow.png', {
      hash: animationFlowData.sha256,
      width: animationFlowData.width,
      height: animationFlowData.height,
    });
    if (this.disposed) {
      bitmap.close();
      throw new Error('presentation disposed');
    }
    const texture = new T.Texture(bitmap);
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    this.flowBitmap = bitmap;
    this.animationFlow = { texture, ...animationFlowData };
    this.renderer.initTexture(texture);
  }
  async warm() {
    await this.lookRenderer.prepare();
    if (this.disposed) throw new Error('presentation disposed');
    for (const pack of this.packs.values()) this.warmPack(pack);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.roomPresentation.surround.update(
      this.camera,
      this.viewTarget,
      this.lookRenderer.settings,
      this.visualEffects.palette,
    );
    await this.renderer.compileAsync(this.roomPresentation.surround.scene, this.camera);
    if (this.disposed) throw new Error('presentation disposed');
    this.roomPresentation.surround.render(this.renderer, this.camera, this.scene);
  }
  stats() {
    const pages = new Map(
      [...this.packs.values()].flatMap((pack) =>
        pack.manifest.pages.map((page) => [pageIdentity(page), page] as const),
      ),
    );
    const size = this.renderer.getDrawingBufferSize(new T.Vector2());
    return {
      buffer: size.toArray(),
      logical: [this.canvas.clientWidth, this.canvas.clientHeight],
      devicePixelRatio,
      effectivePixelRatio: this.effectivePixelRatio,
      nativeDisplayPixels: [
        Math.round(this.canvas.clientWidth * devicePixelRatio),
        Math.round(this.canvas.clientHeight * devicePixelRatio),
      ],
      verticalSpan: this.verticalSpan,
      viewSpan: this.viewSpan,
      area: this.area.id,
      generation: this.generation,
      renderScale: this.requestedRenderScale,
      animationTreatment: this.animationTreatment,
      stabilized: this.stabilized,
      walkTiming: this.walkTiming,
      rigidSword: this.rigidSword,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      objects: { ...this.renderer.info.memory },
      surfaceTextureBytes: 0,
      atlasBytes:
        [...pages.values()].reduce(
          (s, p) => s + Math.ceil(p.rgbaBytes * (p.mipmaps ? 4 / 3 : 1)),
          0,
        ) +
        (this.animationFlow
          ? this.registration.animation.width * this.registration.animation.height * 4
          : 0),
      fileBytes:
        [...pages.values()].reduce((s, p) => s + p.bytes, 0) +
        (this.animationFlow ? this.registration.animation.bytes : 0),
      actors: this.actorPresentation.actors.size,
      surround: this.roomPresentation.surround.stats(),
      webgl: this.renderer.getContext().getParameter(this.renderer.getContext().VERSION),
      gpu: this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')
        ? this.renderer
            .getContext()
            .getParameter(
              this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')!
                .UNMASKED_RENDERER_WEBGL,
            )
        : 'unavailable',
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.combatFeedback.dispose();
    this.sceneEffects?.dispose();
    this.lookRenderer?.dispose();
    this.disposeRoom();
    for (const m of [this.aim, this.flare]) {
      m.geometry.dispose();
      (m.material as T.Material).dispose();
    }
    this.animationFlow?.texture.dispose();
    this.flowBitmap?.close();
    this.shadowTexture.dispose();
    this.renderer.dispose();
  }
}
