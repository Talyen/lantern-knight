import { cleanupAll, cleanupAfterFailure, DisposalScope } from '../assets/cleanup';
import { radialTexture } from './radial-texture';
import { defaultLook } from './lighting-profiles';
import { heroLanternPosition } from './hero-lantern';
import { GroundOcclusion } from './ground-occlusion';
import { imageDimensions } from '../assets/texture-delivery';
import type { PresentationLifecycle, PresentationPreparation } from './lifecycle';
import { RoomPresentation } from './room-presentation';
import { ActorPresentation } from './actor-presentation';
import type { PreparedRegistration } from '../assets/registration';
import * as T from 'three';
import { BitmapTexture } from './bitmap-texture';
import { verifiedBitmap } from '../assets/bitmap';
import { cameraContract as contract } from '../assets/camera-contract';
import { makeCamera, resizeCamera, constrainCamera, drawingBufferSize, outward } from './camera';
import { HEADINGS } from '../content/headings';
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
import type { SimulationView } from '../core/simulation-view';
import {
  defaultVisualEffects,
  type VisualEffects,
  type WeatherState,
} from '../content/visual-effects';
import { SceneVisualEffects } from './scene-visual-effects';
import { CombatFeedback } from './combat-feedback';
import { SceneLightingRenderer } from './scene-lighting-renderer';
export class GamePresentation implements PresentationLifecycle {
  static prepare(canvas: HTMLCanvasElement): PresentationPreparation<GamePresentation> {
    const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false });
    let closed = false,
      transferred = false;
    return {
      create: (...args) => {
        if (closed || transferred) throw new Error('presentation preparation unavailable');
        transferred = true;
        return new GamePresentation(...args, renderer);
      },
      prepareTexture: (texture) => {
        if (closed) throw new Error('presentation preparation disposed');
        GamePresentation.uploadTexture(renderer, texture);
      },
      dispose: () => {
        if (closed) return;
        closed = true;
        if (!transferred) renderer.dispose();
      },
    };
  }
  private static uploadTexture(renderer: T.WebGLRenderer, texture: T.Texture) {
    const dimensions = imageDimensions(texture.image);
    if (renderer.capabilities.maxTextureSize < Math.max(dimensions.width, dimensions.height))
      throw new Error('GPU maximum texture size below atlas dimensions');
    if (texture.generateMipmaps)
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    renderer.initTexture(texture);
  }
  protected readonly resources = new DisposalScope();
  groundOcclusion?: GroundOcclusion;
  readonly roomPresentation: RoomPresentation;
  readonly actorPresentation: ActorPresentation;
  lookRenderer: SceneLightingRenderer;
  get depthOfField() {
    return this.lookRenderer.settings.depthOfField;
  }
  get footstepActors(): ReadonlySet<string> {
    return new Set(
      [...this.actorPresentation.actors]
        .filter(([, visual]) =>
          visual.sprite.animator.clip.notifies.some((n) => n.kind === 'footstep'),
        )
        .map(([id]) => id),
    );
  }
  visualEffects = defaultVisualEffects();
  sceneEffects: SceneVisualEffects;
  readonly combatFeedback: CombatFeedback;
  renderer: T.WebGLRenderer;
  camera = makeCamera(16 / 9);
  scene = new T.Scene();
  aim: T.Mesh;
  flareLight = new T.PointLight(0xffbb65, 0, 7, 1.4);
  light = new T.PointLight(0xf7b862, 8, 9, 1.4);
  debug = false;
  background = 'dark';
  private readonly motionQuery =
    typeof window === 'undefined'
      ? undefined
      : window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private reducedMotion = this.motionQuery?.matches ?? false;
  animationTreatment: AnimationTreatment = 'guarded';
  stabilized = true;
  rigidSword = true;
  walkTiming: WalkTiming = 'weighted';
  animationFlow: AnimationFlow | undefined;
  private readonly flow = new BitmapTexture(
    (signal) =>
      verifiedBitmap(
        '/animation/flow.png',
        {
          hash: this.registration.animation.sha256,
          width: this.registration.animation.width,
          height: this.registration.animation.height,
        },
        fetch,
        signal,
      ),
    (texture) => {
      texture.flipY = false;
      texture.generateMipmaps = false;
      texture.minFilter = T.LinearFilter;
      texture.magFilter = T.LinearFilter;
      texture.needsUpdate = true;
      this.renderer.initTexture(texture);
    },
  );
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
  private flarePrimer: T.Mesh | undefined;
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
    imageRequest: typeof fetch = globalThis.fetch.bind(globalThis),
    preparedRenderer?: T.WebGLRenderer,
  ) {
    this.area = initialArea;
    try {
      this.renderer =
        preparedRenderer ??
        new T.WebGLRenderer({
          canvas,
          antialias: false,
          alpha: false,
        });
      this.resources.own(this.renderer);
      this.resources.own(this.flow);
      const motionQuery = this.motionQuery;
      if (motionQuery) {
        const onMotionChange = () => {
          this.reducedMotion = motionQuery.matches;
        };
        motionQuery.addEventListener('change', onMotionChange);
        this.resources.defer(() => motionQuery.removeEventListener('change', onMotionChange));
      }
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.setPixelRatio(contract.pixelRatioCap);
      this.renderer.setClearColor(0x151923);
      if (
        this.renderer.capabilities.maxTextureSize <
        Math.max(
          ...[...this.textures.values()].map((t) =>
            Math.max(imageDimensions(t.image).width, imageDimensions(t.image).height),
          ),
        )
      )
        throw new Error('GPU maximum texture size below compiled atlas dimensions');
      this.scene.add(new T.HemisphereLight(0xc5d4e1, 0x392b30, 2));
      const sun = new T.DirectionalLight(0xe9d2ac, 2);
      sun.position.set(-4, 8, 3);
      this.scene.add(sun, this.light, this.flareLight);
      this.shadowTexture = this.resources.own(radialTexture(2, 0.9, 0.75));
      this.roomPresentation = new RoomPresentation(
        packs,
        this.camera,
        this.shadowTexture,
        registration,
      );
      this.resources.defer(() => this.disposeRoom());
      this.actorPresentation = new ActorPresentation(
        this.roomPresentation.room,
        packs,
        this.camera,
        this.shadowTexture,
        registration,
      );
      this.scene.add(this.roomPresentation.room);
      this.flare = new T.Mesh(
        this.resources.own(
          new T.RingGeometry(tuning.ability.range * 0.94, tuning.ability.range, 64, 2),
        ),
        this.resources.own(
          new T.MeshBasicMaterial({
            color: 0xf4c575,
            transparent: true,
            opacity: 0.35,
            depthTest: true,
            depthWrite: false,
            side: T.DoubleSide,
          }),
        ),
      );
      this.flare.rotation.x = -Math.PI / 2;
      this.flare.frustumCulled = false;
      this.scene.add(this.flare);
      const aimGeo = this.resources.own(new T.RingGeometry(0.16, 0.19, 32)),
        aimMat = this.resources.own(
          new T.MeshBasicMaterial({
            color: 0xe5bd77,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          }),
        );
      this.aim = new T.Mesh(aimGeo, aimMat);
      this.aim.rotation.x = -Math.PI / 2;
      this.scene.add(this.aim);
      this.buildRoom();
      this.resize();
      this.sceneEffects = this.resources.own(new SceneVisualEffects(this.packs, this.camera));
      this.lookRenderer = new SceneLightingRenderer(
        {
          renderer: this.renderer,
          scene: this.scene,
          camera: this.camera,
          packs: this.packs,
          imageRequest,
        },
        this.roomPresentation,
        this.actorPresentation,
        this.sceneEffects,
      );
      this.resources.own(this.lookRenderer);
      this.lookRenderer.setSettings({
        ...(this.visuals?.look ?? { rig: defaultLook.rig, look: defaultLook.look }),
        sun: this.visuals?.look ? this.visuals.look.sun : defaultLook.sun,
        shadeZones: this.visuals?.look?.shadeZones,
      });
      this.scene.add(this.sceneEffects.group);
      this.combatFeedback = this.resources.own(
        new CombatFeedback(this.packs, this.camera, this.events),
      );
      this.scene.add(this.combatFeedback.group);
    } catch (error) {
      cleanupAfterFailure(error, () => this.dispose());
    }
  }
  buildRoom() {
    this.roomPresentation.buildRoom(this.area, this.visuals);
    const ground = this.visuals?.groundInteraction,
      floor = this.visuals?.editorFloor;
    if (ground && floor)
      this.groundOcclusion = new GroundOcclusion(
        ground,
        floor.width,
        floor.depth,
        this.renderer.capabilities.maxTextureSize,
      );
  }
  disposeRoom() {
    const ground = this.groundOcclusion;
    this.groundOcclusion = undefined;
    cleanupAll([
      () => ground?.dispose(),
      () => this.roomPresentation.disposeScenery(),
      () => this.actorPresentation?.dispose(),
      () => this.roomPresentation.disposeResources(),
    ]);
  }
  prepareAssets(ids?: ReadonlySet<string>, signal?: AbortSignal) {
    return this.lookRenderer.prepare(ids, signal);
  }
  resetRoom(area: AreaDefinition, visuals: WorldVisualDefinition | undefined) {
    this.visualOverride = visuals;
    this.sceneEffects.reset();
    this.combatFeedback.reset();
    this.lookRenderer.resetRoom();
    this.disposeRoom();
    this.area = area;
    this.buildRoom();
    this.lookRenderer.setSettings({
      ...(this.visuals?.look ?? { rig: defaultLook.rig, look: defaultLook.look }),
      sun: this.visuals?.look ? this.visuals.look.sun : defaultLook.sun,
      shadeZones: this.visuals?.look?.shadeZones,
    });
    if (this.flarePrimer) this.primeFlare();
  }
  getClip(id: string, dir: (typeof HEADINGS)[number], manifest = this.manifest): Clip {
    return this.actorPresentation.getClip(id, dir, manifest, this.walkTiming);
  }
  protected framingZ = 3;
  get viewSpan() {
    return compositionSpan({ x: 0, z: this.framingZ }, this.verticalSpan, this.visuals);
  }
  update(sim: SimulationView, alpha: number, ms: number, aim: { x: number; z: number }) {
    if (this.disposed) return;
    if (this.generation !== sim.generation) {
      this.resetRoom(sim.areaDefinition, this.visuals);
      this.generation = sim.generation;
    }
    this.roomPresentation.room.visible = true;
    this.updateCamera(sim, alpha);
    if (this.flarePrimer?.parent)
      this.flarePrimer.position
        .copy(this.camera.position)
        .addScaledVector(outward, this.camera.far * 4);
    // Gameplay uses authored library animation. This geometry is a debug guide only.
    this.flare.visible = this.debug;
    const origin = [sim.hero.x, sim.hero.y, sim.hero.z] as const;
    this.flare.position.set(origin[0]!, origin[1]! + 0.06, origin[2]!);
    this.flare.rotation.z = 0;
    this.flare.scale.setScalar(1);
    (this.flare.material as T.MeshBasicMaterial).opacity = 0.12;
    if (this.flare.visible) {
      const points = this.flare.geometry.getAttribute('position'),
        a = this.flare.rotation.z,
        c = Math.cos(a),
        s = Math.sin(a);
      for (let i = 0; i < points.count; i++) {
        const x = points.getX(i),
          y = points.getY(i),
          wx = origin[0] + x * c - y * s,
          wz = origin[2] - x * s - y * c;
        points.setZ(i, heightAt(sim.areaDefinition, wx, wz) - origin[1]);
      }
      points.needsUpdate = true;
    }
    this.renderer.setClearColor(this.background === 'light' ? 0xd1c9b4 : 0x151923);
    this.aim.visible = true;
    this.aim.scale.setScalar(
      sim.hero.pendingAction
        ? this.reducedMotion
          ? 1.2
          : 1.15 + Math.sin(sim.tick * 0.3) * 0.1
        : 1,
    );
    (this.aim.material as T.MeshBasicMaterial).color.set(
      sim.hero.pendingAction ? 0xf2e4bb : 0xe5bd77,
    );
    this.aim.position.set(aim.x, heightAt(sim.areaDefinition, aim.x, aim.z) + 0.035, aim.z);
    const events = this.actorPresentation.update(sim, alpha, ms, {
      walkTiming: this.walkTiming,
      stabilized: this.stabilized,
      rigidSword: this.rigidSword,
      animationTreatment: this.animationTreatment,
      animationFlow: this.animationFlow,
      debug: this.debug,
    });
    if (this.groundOcclusion)
      for (const actor of sim.actors) {
        const visual = this.actorPresentation.actors.get(actor.id);
        if (visual) {
          this.groundOcclusion.attach(visual.sprite, actor.kind);
          this.groundOcclusion.attachShadow(visual.shadow.material);
          this.groundOcclusion.update(
            visual.sprite,
            actor.px + (actor.x - actor.px) * alpha,
            actor.pz + (actor.z - actor.pz) * alpha,
          );
        }
      }
    const heroSprite = this.actorPresentation.actors.get(sim.hero.id)?.sprite;
    const hasLantern = heroSprite && heroLanternPosition(heroSprite, this.light.position);
    this.light.intensity = hasLantern ? 8 : 0;
    this.roomPresentation.inkRoom?.update(sim, alpha, true, ms);
    if (this.groundOcclusion) this.roomPresentation.inkRoom?.occlude(this.groundOcclusion);
    if (this.groundOcclusion)
      for (const drop of sim.drops) {
        const sprite = this.roomPresentation.inkRoom?.effects.get('drop-' + drop.id);
        if (sprite) {
          this.groundOcclusion.attach(sprite, 'drop');
          this.groundOcclusion.update(sprite, drop.x, drop.z);
        }
      }
    this.sceneEffects.update(
      sim.areaDefinition,
      sim.generation,
      this.roomPresentation.inkRoom?.sprites ?? [],
      ms,
      this.visualEffects,
      this.visuals,
    );
    this.combatFeedback.update(sim, alpha, heroSprite, this.actorPresentation.actors);
    this.flareLight.position.copy(this.combatFeedback.flareLight.position);
    this.flareLight.intensity = this.combatFeedback.flareLight.power * 4;
    this.flareLight.distance = this.combatFeedback.flareLight.range;
    // A render-only impulse never enters follow framing or pointer projection.
    const cameraKick = this.combatFeedback.cameraKick.clone();
    this.camera.position.add(cameraKick);
    this.camera.updateMatrixWorld();
    try {
      this.renderFrame(sim, ms);
    } finally {
      this.camera.position.sub(cameraKick);
      this.camera.updateMatrixWorld();
    }
    // Observers may dispose or replace the room. Publish only after every
    // borrower has finished touching this frame's resources.
    if (!this.disposed && this.generation === sim.generation) this.events.publish(events);
  }
  setVisualEffects(options: Partial<VisualEffects>) {
    this.visualEffects = { ...this.visualEffects, ...options };
  }
  setWeather(state: WeatherState | null) {
    this.sceneEffects.setWeather(state);
  }
  private updateCamera(sim: SimulationView, alpha: number) {
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
      constrainCamera(this.camera, this.viewTarget, sim.areaDefinition, {
        position: this.cameraTarget,
        height: contract.heroHeight * tuning.heroVisualScale,
      });
      this.camera.position.copy(this.viewTarget).addScaledVector(outward, 30);
      this.camera.lookAt(this.viewTarget);
      this.camera.updateMatrixWorld();
    }
  }
  setDepthOfField(value: number) {
    if (!Number.isFinite(value)) return;
    this.lookRenderer.setSettings({ depthOfField: value });
  }
  protected renderFrame(sim: SimulationView, ms: number) {
    const contacts = this.roomPresentation.inkRoom?.contactShadows;
    contacts?.update();
    if (contacts) this.groundOcclusion?.attachShadow(contacts.mesh.material);
    this.roomPresentation.surround.update(
      this.camera,
      this.viewTarget,
      this.lookRenderer.settings,
      this.visualEffects.palette,
    );
    this.lookRenderer.render(sim, ms, {
      visuals: this.visuals,
      visualEffects: this.visualEffects,
      groundOcclusion: this.groundOcclusion,
      cameraTarget: this.cameraTarget,
      viewSpan: this.viewSpan,
      transientLight: this.combatFeedback.flareLight,
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
      Math.max(
        ...[...pack.textures.values()].map((t) =>
          Math.max(imageDimensions(t.image).width, imageDimensions(t.image).height),
        ),
      )
    )
      throw new Error('GPU maximum texture size below atlas dimensions');
    for (const texture of pack.textures.values()) {
      GamePresentation.uploadTexture(this.renderer, texture);
    }
  }
  async loadAnimationFlow() {
    const texture = await this.flow.load();
    if (this.disposed) throw new Error('presentation disposed');
    this.animationFlow = { texture, ...this.registration.animation };
  }
  private primeFlare() {
    if (this.disposed) return;
    if (!this.flarePrimer) {
      const beauty = this.flare.material as T.Material,
        primer = new T.Mesh(this.flare.geometry, beauty);
      primer.frustumCulled = false;
      primer.onAfterRender = (_renderer, _scene, _camera, _geometry, material) => {
        if (material === beauty) primer.removeFromParent();
      };
      this.flarePrimer = primer;
      this.resources.defer(() => primer.removeFromParent());
    }
    this.flarePrimer.position
      .copy(this.camera.position)
      .addScaledVector(outward, this.camera.far * 4);
    this.scene.add(this.flarePrimer);
  }
  async warm() {
    await this.lookRenderer.prepare();
    if (this.disposed) throw new Error('presentation disposed');
    this.combatFeedback.prepare();
    this.primeFlare();
    for (const pack of this.packs.values()) this.warmPack(pack);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) throw new Error('presentation disposed');
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
    const textures = [
      ...new Set([...this.packs.values()].flatMap((pack) => [...pack.textures.values()])),
    ];
    const delivered = textures.map((t) => t.userData.delivery).filter(Boolean);
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
      transientLight: this.combatFeedback.flareLight,
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
        (delivered.length === textures.length
          ? delivered.reduce((s, p) => s + p.gpuBytes, 0)
          : [...pages.values()].reduce(
              (s, p) => s + Math.ceil(p.rgbaBytes * (p.mipmaps ? 4 / 3 : 1)),
              0,
            )) +
        (this.animationFlow
          ? this.registration.animation.width * this.registration.animation.height * 4
          : 0),
      fileBytes:
        (delivered.length === textures.length
          ? delivered.reduce((s, p) => s + p.bytes, 0)
          : [...pages.values()].reduce((s, p) => s + p.bytes, 0)) +
        (this.animationFlow ? this.registration.animation.bytes : 0),
      actors: this.actorPresentation.actors.size,
      imageDelivery: delivered,
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
    this.resources.dispose();
  }
}
