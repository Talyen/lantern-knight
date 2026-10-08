import { RoomPresentation } from './room-presentation';
import { ActorPresentation } from './actor-presentation';
import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
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
  worldVisuals,
  type WorldVisualDefinition,
  compositionPoint,
  compositionSpan,
  compositionHeight,
} from '../content/world-art';
import type { Clip } from '../assets/schema';
import { attackDefinition, tuning } from '../content/gameplay';
import { content, heightAt, type AreaDefinition } from '../content/world';
import { pageIdentity, type PackLease } from '../assets/loader';
import { EventHub } from '../core/events';
import type { Actor, Simulation } from '../core/simulation';
import {
  defaultVisualEffects,
  type VisualEffects,
  type WeatherState,
} from '../content/visual-effects';
import { SceneVisualEffects } from './scene-visual-effects';
import { SceneLightingRenderer } from './scene-lighting-renderer';
export type Mode = 'encounter' | 'calibration' | 'animation' | 'occlusion' | 'lighting';
export class GamePresentation {
  private roomPresentation: RoomPresentation;
  private actorPresentation: ActorPresentation;
  get surround() {
    return this.roomPresentation.surround;
  }
  get room() {
    return this.roomPresentation.room;
  }
  get inkRoom() {
    return this.roomPresentation.inkRoom;
  }
  get roomOwned() {
    return this.roomPresentation.roomOwned;
  }
  get fadeMeshes() {
    return this.roomPresentation.fadeMeshes;
  }
  get actors() {
    return this.actorPresentation.actors;
  }
  lookRenderer: SceneLightingRenderer;
  depthOfField = 0;
  visualEffects = defaultVisualEffects();
  sceneEffects: SceneVisualEffects;
  renderer: T.WebGLRenderer;
  camera = makeCamera(16 / 9);
  scene = new T.Scene();
  mode: Mode = 'encounter';
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
  area: AreaDefinition = content.area('court');
  generation = -1;
  effectTag = '';
  flare: T.Mesh;
  slash: T.Mesh;
  get visuals() {
    return this.visualOverride ?? worldVisuals[this.area.id];
  }
  get manifest() {
    return this.packs.get('ink-hero-current')!.manifest;
  }
  get textures() {
    return this.packs.get('ink-hero-current')!.textures;
  }
  constructor(
    public canvas: HTMLCanvasElement,
    public packs: Map<string, PackLease>,
    public events: EventHub,
    initialArea: AreaDefinition,
    readonly registration: PreparedRegistration,
    public visualOverride?: WorldVisualDefinition,
  ) {
    this.area = initialArea;
    this.roomPresentation = new RoomPresentation(this);
    this.actorPresentation = new ActorPresentation(this);
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
    this.scene.add(sun, this.light, this.room);
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
    this.slash = new T.Mesh(
      new T.RingGeometry(1.1, 1.25, 24, 1, -tuning.attack.halfAngle, tuning.attack.halfAngle * 2),
      new T.MeshBasicMaterial({
        color: 0xfbe5b8,
        transparent: true,
        opacity: 0.7,
        depthTest: true,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    this.slash.rotation.x = -Math.PI / 2;
    this.scene.add(this.flare, this.slash);
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
    this.lookRenderer = new SceneLightingRenderer(this);
    if (this.visuals?.look) this.lookRenderer.setSettings(this.visuals.look);
    this.sceneEffects = new SceneVisualEffects(this.packs, this.camera);
    this.scene.add(this.sceneEffects.group);
  }
  ownedMesh(geometry: T.BufferGeometry, material: T.Material) {
    return this.roomPresentation.ownedMesh(geometry, material);
  }
  buildRoom() {
    this.roomPresentation.buildRoom();
  }
  disposeRoom() {
    this.roomPresentation.disposeScenery();
    this.actorPresentation.dispose();
    this.roomPresentation.disposeResources();
  }
  resetRoom(area: AreaDefinition = this.area) {
    this.sceneEffects.reset();
    this.lookRenderer.resetRoom();
    this.disposeRoom();
    this.area = area;
    this.buildRoom();
    if (this.visuals?.look) this.lookRenderer.setSettings(this.visuals.look);
    this.effectTag = '';
  }
  createVisual(a: Actor, generation: number) {
    return this.actorPresentation.createVisual(a, generation);
  }
  getClip(id: string, dir: (typeof HEADINGS)[number], manifest = this.manifest): Clip {
    return this.actorPresentation.getClip(id, dir, manifest);
  }
  protected framingZ = 3;
  get viewSpan() {
    return compositionSpan(this.area.id, { x: 0, z: this.framingZ }, this.verticalSpan);
  }
  update(sim: Simulation, alpha: number, ms: number, aim: { x: number; z: number }) {
    if (this.generation !== sim.generation) {
      this.resetRoom(sim.areaDefinition);
      this.generation = sim.generation;
    }
    this.room.visible = true;
    this.updateCamera(sim, alpha);
    const swing = attackDefinition(sim.hero);
    this.flare.visible =
      (!this.inkRoom || this.debug) &&
      ((sim.hero.state === 'ability' && sim.hero.age >= tuning.ability.windup) || this.debug);
    this.slash.visible =
      !this.inkRoom &&
      sim.hero.attackKind === 'sweep' &&
      sim.hero.state === 'attack' &&
      sim.hero.age >= swing.windup &&
      sim.hero.age < swing.activeEnd;
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
    const effectTag = sim.hero.attackKind;
    if (effectTag !== this.effectTag) {
      this.slash.geometry.dispose();
      this.slash.geometry = new T.RingGeometry(
        swing.range - 0.16,
        swing.range,
        24,
        1,
        -swing.halfAngle,
        swing.halfAngle * 2,
      );
      this.effectTag = effectTag;
    }
    this.slash.position.set(sim.hero.x, sim.hero.y + 0.25, sim.hero.z);
    this.slash.rotation.z = sim.hero.yaw - Math.PI / 2;
    this.renderer.setClearColor(this.background === 'light' ? 0xd1c9b4 : 0x151923);
    this.aim.visible = true;
    this.aim.position.set(aim.x, heightAt(sim.areaDefinition, aim.x, aim.z) + 0.035, aim.z);
    this.actorPresentation.update(sim, alpha, ms);
    this.light.position.set(sim.hero.x - 0.25, sim.hero.y + 0.85, sim.hero.z);
    this.light.intensity = sim.hero.state === 'ability' ? 14 : 5;
    for (const m of this.fadeMeshes) {
      const p = m.userData.foot as { x: number; y: number; z: number },
        delta = new T.Vector3(sim.hero.x - p.x, sim.hero.y - p.y, sim.hero.z - p.z);
      const fade = delta.length() < 1.65 && delta.dot(outward) < 0;
      setCutoutOpacity(m.material, fade ? 0.38 : 1);
    }
    this.inkRoom?.update(sim, alpha, true, ms);
    this.sceneEffects.update(
      sim.areaDefinition,
      sim.generation,
      this.inkRoom?.sprites ?? [],
      ms,
      this.visualEffects,
    );
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
        sim.area,
        { x, z },
        {
          halfWidth: (this.camera.right - this.camera.left) / 2,
          halfHeight: (this.camera.top - this.camera.bottom) / 2,
        },
      );
      this.viewTarget.set(
        framed.x,
        heightAt(sim.areaDefinition, framed.x, framed.z) + compositionHeight(sim.area, { x, z }),
        framed.z,
      );
      this.camera.position.copy(this.viewTarget).addScaledVector(outward, 30);
      this.camera.lookAt(this.viewTarget);
      this.camera.updateMatrixWorld();
    }
  }
  setDepthOfField(value: number) {
    if (!Number.isFinite(value)) return;
    this.depthOfField = Math.max(0, Math.min(1, value));
    this.lookRenderer.setSettings({ depthOfField: this.depthOfField });
  }
  protected renderFrame(sim: Simulation, ms: number) {
    this.surround.update(
      this.camera,
      this.viewTarget,
      this.lookRenderer.settings,
      this.visualEffects.palette,
    );
    this.lookRenderer.render(sim, ms);
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
  warmPack(pack: PackLease) {
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
    const response = await fetch('/animation/flow.png');
    if (!response.ok) throw new Error('walk motion fields unavailable');
    const bytes = await response.arrayBuffer(),
      digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
    if (digest !== animationFlowData.sha256) throw new Error('walk motion field hash differs');
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    if (bitmap.width !== animationFlowData.width || bitmap.height !== animationFlowData.height) {
      bitmap.close();
      throw new Error('walk motion field dimensions differ');
    }
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
    this.surround.update(
      this.camera,
      this.viewTarget,
      this.lookRenderer.settings,
      this.visualEffects.palette,
    );
    await this.renderer.compileAsync(this.surround.scene, this.camera);
    if (this.disposed) throw new Error('presentation disposed');
    this.surround.render(this.renderer, this.camera, this.scene);
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
      surfaceTextureBytes: this.inkRoom?.architecture?.textureBytes ?? 0,
      atlasBytes:
        (this.inkRoom?.architecture?.textureBytes ?? 0) +
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
      actors: this.actors.size,
      surround: this.surround.stats(),
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
    this.sceneEffects?.dispose();
    this.lookRenderer?.dispose();
    this.disposeRoom();
    for (const m of [this.aim, this.flare, this.slash]) {
      m.geometry.dispose();
      (m.material as T.Material).dispose();
    }
    this.animationFlow?.texture.dispose();
    this.flowBitmap?.close();
    this.shadowTexture.dispose();
    this.renderer.dispose();
  }
}
