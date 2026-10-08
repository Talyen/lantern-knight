import * as T from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  PredicationMode,
  EffectAttribute,
} from 'postprocessing';
import { ActorSprite } from './sprite';
import { IllustratedLighting } from './illustrated-lighting';
import { lightFlicker } from '../content/visual-effects';
import { IllustratedRain } from './illustrated-rain';
import { FoliageWind } from './foliage-wind';
import { inPuddle } from './playground-surfaces';
import { PlaygroundShafts } from './playground-shafts';
import { GroundMist } from './ground-mist';
import { defaultLook } from './lighting-profiles';
import { sampleMaterial, SilhouetteOutline } from './playground-materials';
import {
  makeCamera,
  resizeCamera,
  drawingBufferSize,
  selectAuthoredDirection,
  right,
  outward,
  contract,
} from '../core/camera';
import { resolveClip, type Clip } from '../assets/schema';
import { frameAt, clipDuration } from '../core/animation';
import type { PackLease } from '../assets/loader';
import type { Simulation } from '../core/simulation';
import { effectsArea, activeEffect, type PlaygroundSettings } from '../content/effects-playground';

type Animated = { sprite: ActorSprite; clip: Clip; foot: T.Vector3; phase: number };
type Lamp = {
  body: ActorSprite;
  flame: Animated;
  position: T.Vector3;
  light: T.PointLight;
  socket: T.Vector3;
  smoke: Animated;
  embers: Animated;
};
class SpatialAA extends SMAAEffect {
  constructor() {
    super({
      preset: SMAAPreset.HIGH,
      edgeDetectionMode: EdgeDetectionMode.COLOR,
      predicationMode: PredicationMode.DISABLED,
    });
    this.setAttributes(EffectAttribute.CONVOLUTION);
  }
}

export class EffectsPlayground {
  readonly renderer: T.WebGLRenderer;
  readonly camera = makeCamera(16 / 9);
  readonly scene = new T.Scene();
  readonly lighting = new IllustratedLighting();
  private composer: EffectComposer;
  private bloom: BloomEffect;
  private glowPass: EffectPass;
  private hemi = new T.HemisphereLight(0xc9d4d2, 0x59615c, 1.2);
  private key = new T.DirectionalLight(0xe5ddd0, 1.5);
  private owned: { dispose: () => void }[] = [];
  private sprites: ActorSprite[] = [];
  private lamps: Lamp[] = [];
  private rain: IllustratedRain;
  private mist = new GroundMist();
  private contacts: { mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>; sprite: ActorSprite }[] =
    [];
  private winds: FoliageWind[] = [];
  private contactTexture: T.CanvasTexture;
  private stone = sampleMaterial('stone');
  private wood = sampleMaterial('wood');
  private outlines: SilhouetteOutline[] = [];
  private shafts = new PlaygroundShafts();
  private motes: T.Points;
  private hero: ActorSprite;
  private target: ActorSprite;
  private uniformTime = new T.Uniform(0);
  private heroClip = '';
  private shadowMapSize = 1024;
  time = 0;
  private disposed = false;
  constructor(
    readonly canvas: HTMLCanvasElement,
    private packs: Map<string, PackLease>,
    emitters: Record<string, number[]>,
  ) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: false });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor(0x1b2428);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    const fallback = new T.DepthTexture(1, 1, T.UnsignedIntType);
    fallback.compareFunction = T.LessEqualCompare;
    fallback.needsUpdate = true;
    this.lighting.common.inkShadowMap.value = fallback;
    this.owned.push(fallback);
    this.scene.add(this.hemi, this.key, this.key.target);
    this.key.position.set(-5, 9, 4);
    this.key.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    this.key.shadow.camera.left = this.key.shadow.camera.bottom = -10;
    this.key.shadow.camera.right = this.key.shadow.camera.top = 10;
    this.key.shadow.camera.far = 30;
    this.key.shadow.bias = -0.0004;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: T.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({
      intensity: 0.2,
      luminanceThreshold: 1,
      luminanceSmoothing: 0.15,
      mipmapBlur: true,
      resolutionScale: 0.5,
    });
    this.glowPass = new EffectPass(this.camera, this.bloom);
    this.composer.addPass(this.glowPass);
    this.composer.addPass(
      new EffectPass(this.camera, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })),
    );
    this.composer.addPass(new EffectPass(this.camera, new SpatialAA()));
    this.contactTexture = this.softContactTexture();
    this.owned.push(this.contactTexture);
    this.mesh(new T.PlaneGeometry(16, 16), this.stone.material).rotation.x = -Math.PI / 2;
    const wood = this.mesh(new T.PlaneGeometry(3.2, 3.5), this.wood.material);
    wood.rotation.x = -Math.PI / 2;
    wood.position.set(-3.5, 0.008, -0.8);
    this.owned.push(...this.stone.textures, ...this.wood.textures);
    const floor = this.scene.children.find((o) => o instanceof T.Mesh)! as T.Mesh;
    floor.receiveShadow = wood.receiveShadow = true;
    for (const mesh of [floor, wood]) {
      const uv = mesh.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++)
        uv.setXY(
          i,
          uv.getX(i) * (mesh === floor ? 8 : 1.6),
          uv.getY(i) * (mesh === floor ? 8 : 1.75),
        );
    }
    for (const [x, z, w, d] of [
      [-4.65, -1, 1.4, 2.9],
      [-2.35, -1, 1.4, 2.9],
      [-3.5, -2, 0.9, 0.9],
      [-3.5, 0, 0.9, 0.9],
    ]) {
      const roof = this.mesh(
        new T.BoxGeometry(w!, 0.14, d!),
        new T.MeshStandardMaterial({
          color: 0x4a5554,
          roughness: 0.85,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
      );
      roof.position.set(x!, 2.6, z!);
      roof.castShadow = true;
    }
    this.prop('shelter-pillar', 'pillar', -4, -1.5, 0.8);
    this.prop('plinth', 'offering-table', 2, 1, 0.5);
    this.prop('back-arch', 'arch', 0.3, -4.8, 0.8);
    this.prop('tree', 'tree', -6, 1.5, 0.7, true);
    this.prop('fern', 'fern', 4, 2, 1.3, true);
    this.prop('tomb', 'tomb', 4, -3, 0.7);
    this.prop('stone', 'gravestone', -1.4, -2.8, 0.8);
    this.hero = this.sprite('hero', 'ink-hero-current', 'idle', new T.Vector3(0, 0, 3));
    this.target = this.sprite('target', 'ink-skeleton', 'rest', new T.Vector3(2.8, 0, -0.7));
    this.outlines = [
      new SilhouetteOutline(this.hero.mesh),
      new SilhouetteOutline(this.target.mesh),
    ];
    this.outlines.forEach((o) => this.scene.add(o.mesh));
    for (const [i, [id, x, z]] of (
      [
        ['watch', -1.9, 1.3],
        ['brazier', 2.5, -2],
        ['votive', -3.6, -1.7],
      ] as const
    ).entries()) {
      const position = new T.Vector3(x, 0.16, z),
        socket = position.clone().add(new T.Vector3().fromArray(emitters[id]!));
      const body = this.sprite(`lamp-${id}`, `fx-${id}-body`, 'show', position),
        flame = this.animation(
          `flame-${id}`,
          `fx-${id}-flame`,
          position.clone().addScaledVector(outward, 0.015),
          i * 0.61,
        );
      const light = new T.PointLight(0xffbe71, 3, 6, 2);
      light.position.copy(socket);
      this.scene.add(light);
      const smoke = this.animation(`smoke-${id}`, 'fx-smoke', socket.clone(), i * 0.63),
        embers = this.animation(`embers-${id}`, 'fx-embers', socket.clone(), i * 0.47);
      this.lamps.push({ body, flame, position, light, socket, smoke, embers });
    }
    this.rain = new IllustratedRain(packs);
    this.scene.add(this.rain.group, this.shafts.group);
    this.mist.setArea(effectsArea);
    this.scene.add(this.mist.group);
    const positions = Array.from({ length: 90 }, (_, i) => [
      Math.sin(i * 12.9) * 6,
      0.4 + (i % 9) * 0.2,
      Math.cos(i * 4.1) * 6,
    ]).flat();
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { time: this.uniformTime },
      vertexShader:
        'uniform float time;void main(){vec3 p=position;p.x+=sin(time*.4+position.z)*.2;p.y+=sin(time*.6+position.x)*.12;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=2.;}',
      fragmentShader:
        'void main(){float a=1.-smoothstep(.1,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.5,.4,.23,a*.4);}',
    });
    this.motes = new T.Points(geometry, material);
    this.scene.add(this.motes);
    this.owned.push(geometry, material);
    this.resize();
  }
  private mesh<M extends T.Material>(geometry: T.BufferGeometry, material: M) {
    const mesh = new T.Mesh(geometry, material);
    this.scene.add(mesh);
    this.owned.push(geometry, material);
    return mesh;
  }
  private sprite(id: string, asset: string, clip: string, foot: T.Vector3) {
    const pack = this.packs.get(asset)!;
    if (!pack) throw new Error(`playground pack missing: ${asset}`);
    const s = new ActorSprite(
      id,
      pack.manifest,
      pack.textures,
      resolveClip(pack.manifest, clip, 'd45'),
    );
    s.show(s.animator.frame, foot, this.camera);
    this.sprites.push(s);
    this.scene.add(s.mesh);
    if (s.manifest.asset.type !== 'effect' && !['back-arch', 'lamp-votive'].includes(id)) {
      const sizes: Record<string, [number, number]> = {
          hero: [0.62, 0.34],
          target: [0.54, 0.3],
          tree: [0.85, 0.5],
          tomb: [1.4, 0.75],
          stone: [0.55, 0.34],
          plinth: [0.75, 0.46],
        },
        size = sizes[id] ?? [0.35, 0.24];
      const shadow = this.mesh(
        new T.PlaneGeometry(...size),
        new T.MeshBasicMaterial({
          map: this.contactTexture,
          color: 0x182125,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.copy(foot).y = 0.008;
      this.contacts.push({ mesh: shadow, sprite: s });
    }

    return s;
  }
  private prop(id: string, clip: string, x: number, z: number, scale: number, wind = false) {
    const s = this.sprite(id, 'ink-scenery', clip, new T.Vector3(x, 0, z));
    s.mesh.scale.setScalar(scale);
    if (wind) this.winds.push(new FoliageWind(s, this.winds.length * 0.8));
  }
  private softContactTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const c = canvas.getContext('2d')!,
      g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,.7)');
    g.addColorStop(0.35, 'rgba(255,255,255,.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(canvas);
    t.generateMipmaps = false;
    return t;
  }
  private animation(id: string, asset: string, foot: T.Vector3, phase: number): Animated {
    const s = this.sprite(id, asset, 'show', foot);
    return { sprite: s, clip: resolveClip(s.manifest, 'show', 'd45'), foot, phase };
  }
  private animate(a: Animated, time: number, playing = true) {
    const duration = clipDuration(a.clip),
      ms = playing ? ((time + a.phase) * 1000) % duration : 0;
    a.sprite.show(frameAt(a.clip, ms), a.foot, this.camera);
  }
  async prepare() {
    await this.lighting.normals.load();
    if (this.disposed) throw new Error('playground disposed');
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) throw new Error('playground disposed');
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    const size = drawingBufferSize(w, h, devicePixelRatio);
    this.renderer.setPixelRatio(size.pixelRatio);
    this.renderer.setSize(w, h, false);
    resizeCamera(this.camera, w, h, 9);
    this.composer.setSize(w, h);
  }
  draw(sim: Simulation, alpha: number, ms: number, settings: PlaygroundSettings) {
    if (this.disposed) return;
    this.time += settings.paused ? 0 : ms / 1000;
    this.uniformTime.value = this.time;
    const on = (key: Parameters<typeof activeEffect>[1]) => activeEffect(settings, key),
      rich = settings.treatment === 'rich',
      strength = rich ? 1.7 : 1;
    this.key.castShadow = true;
    this.hemi.color.set(on('palette') ? 0xb8cde3 : 0xc9d4d2);
    this.hemi.groundColor.set(on('palette') ? 0x49465c : 0x59615c);
    this.key.color.set(on('palette') ? 0xffdaa0 : 0xe5ddd0);
    this.lighting.configure(
      { ...defaultLook, shadows: false, atmosphere: on('atmosphere') },
      new T.Vector3(),
    );
    this.lighting.common.inkShadowEnabled.value = 0;
    this.lighting.restoreLightColors();
    if (!on('palette')) this.lighting.neutralPalette();
    const hero = sim.hero,
      foot = new T.Vector3(
        hero.px + (hero.x - hero.px) * alpha,
        0,
        hero.pz + (hero.z - hero.pz) * alpha,
      ),
      clip = hero.state === 'walk' ? 'walk' : 'idle';
    const heading = selectAuthoredDirection(hero.yaw),
      tag = clip + ':' + heading;
    if (tag !== this.heroClip) {
      const prior = this.hero.animator.time,
        keep = this.heroClip.startsWith(clip + ':');
      this.hero.animator.start(resolveClip(this.hero.manifest, clip, heading));
      if (keep) this.hero.animator.seek(prior);
      this.heroClip = tag;
    }
    if (!settings.paused) this.hero.animator.advance(ms);
    this.hero.show(this.hero.animator.frame, foot, this.camera);
    for (const { mesh, sprite } of this.contacts) {
      const height = Math.max(0, sprite.mesh.position.y);
      mesh.position.set(sprite.mesh.position.x, 0.008, sprite.mesh.position.z);
      mesh.visible = on('contact') && sprite.mesh.visible;
      mesh.material.opacity = 0.22 * Math.exp(-height * 2) * sprite.material.opacity;
    }
    this.winds.forEach((w) => w.update(this.time, on('wind'), 0.012 * strength));
    for (const lamp of this.lamps) {
      lamp.smoke.foot
        .copy(lamp.socket)
        .addScaledVector(
          right,
          on('wind') ? Math.sin(this.time * 0.7 + lamp.flame.phase) * 0.1 : 0,
        );
      this.animate(lamp.flame, this.time, on('livingLights'));
      this.animate(lamp.smoke, this.time);
      this.animate(lamp.embers, this.time);
      lamp.smoke.sprite.mesh.visible = lamp.embers.sprite.mesh.visible = on('smoke');
      const phase = lamp.flame.phase,
        flicker = lightFlicker(this.time, phase);
      lamp.light.intensity = on('livingLights') ? 6 * strength * flicker : 2.6;
      lamp.flame.sprite.material.color
        .setRGB(1, 1, 1)
        .multiplyScalar(on('livingLights') ? 3 * strength * flicker : 1.3);
    }
    const lights = this.lighting.common;
    lights.inkLightPower.value.fill(0);
    this.lamps.forEach((lamp, i) => {
      lights.inkLightPosition.value[i]!.copy(lamp.socket);
      lights.inkLightPower.value[i] = lamp.light.intensity * 0.16;
    });
    lights.inkLightPosition.value[3]!.copy(foot).y = 0.85;
    lights.inkLightPower.value[3] = hero.state === 'ability' ? 2 : 0;
    for (const s of this.sprites)
      if (s.manifest.asset.type !== 'effect') {
        this.lighting.sprite(s);
        if (!on('surfaceDepth'))
          for (const m of [s.material, s.edgeMaterial])
            if (m) this.lighting.attach(m).inkHasNormal.value = 0;
      }
    for (const sample of [this.stone, this.wood]) {
      sample.material.normalScale.setScalar(on('surfaceDepth') ? 0.75 * strength : 0);
      sample.uniforms.labTime.value = this.time;
      sample.uniforms.labWet.value = on('wetness') ? 1 : 0;
      sample.uniforms.labRain.value = on('rain') ? 1 : 0;
      sample.uniforms.labRelief.value = on('relief') ? strength : 0;
      sample.uniforms.labView.value.copy(outward);
      this.lamps.forEach((l, i) => {
        sample.uniforms.labLights.value[i]!.copy(l.socket);
        sample.uniforms.labPower.value[i] = l.light.intensity * 0.15;
      });
    }
    this.rain.update(this.time, { rain: 1, wind: { x: 0.22, z: 0.08 } }, on('rain'), this.camera, {
      bounds: { minX: -5.5, maxX: 5.5, minZ: -4.5, maxZ: 5.5 },
      shelters: [{ minX: -5.4, maxX: -1.65, minZ: -2.5, maxZ: 0.5 }],
      height: () => 0,
      puddle: (x, z) => on('wetness') && inPuddle(x, z),
    });
    const impacts = this.rain.stats().impacts;
    for (const sample of [this.stone, this.wood]) {
      sample.uniforms.labImpactCount.value = impacts.length;
      impacts.forEach((p, i) => sample.uniforms.labImpacts.value[i]!.set(p.x, p.z, p.age));
    }
    this.mist.group.visible = this.motes.visible = on('atmosphere');
    this.mist.update(this.time, 0xa8b7bd, 0.09 * strength, new T.Vector3());
    this.shafts.update(this.renderer, this.scene, this.camera, this.time, on('shafts'), strength);
    this.outlines.forEach((o) => {
      o.mesh.visible = on('outlines') && o.source.visible;
      o.update(
        ((this.camera.top - this.camera.bottom) / this.canvas.clientHeight) *
          settings.outline.thickness,
        Math.tan((contract.elevationDeg * Math.PI) / 180),
        settings.outline.opacity,
        settings.outline.color,
      );
    });
    this.glowPass.enabled = on('bloom');
    this.bloom.intensity = on('bloom') ? (rich ? 0.48 : 0.22) : 0;
    this.composer.render(ms / 1000);
  }
  diagnostics() {
    this.scene.updateMatrixWorld(true);
    return {
      glError: this.renderer.getContext().getError(),
      sprites: this.sprites.slice(0, 12).map((s) => ({
        id: s.id,
        visible: s.mesh.visible,
        opacity: s.material.opacity,
        colorWrite: s.material.colorWrite,
        map: !!s.material.map,
        foot: s.mesh.position.toArray(),
        corner: new T.Vector3()
          .fromBufferAttribute(s.geometry.getAttribute('position'), 0)
          .applyMatrix4(s.mesh.matrixWorld)
          .toArray(),
      })),
    };
  }
  stats() {
    return {
      time: this.time,
      buffer: [this.canvas.width, this.canvas.height],
      objects: { ...this.renderer.info.memory },
      calls: this.renderer.info.render.calls,
      sprites: this.sprites.length,
      lamps: this.lamps.length,
      rain: this.rain.stats(),
      antiAliasing: 'SMAA 1x High',
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.rain.dispose();
    this.shafts.dispose();
    this.composer.dispose();
    this.lighting.dispose();
    this.mist.dispose();
    this.outlines.forEach((o) => o.dispose());
    this.sprites.forEach((s) => s.dispose());
    this.owned.forEach((o) => o.dispose());
    this.key.shadow.dispose();
    this.renderer.dispose();
  }
}
