import {
  PlaneGeometry,
  MeshBasicMaterial,
  Mesh,
  BufferAttribute,
  Vector3,
  type OrthographicCamera,
  type Texture,
  type Material,
} from 'three';
import { trimmedBounds, contract } from '../core/camera';
import { Animator } from '../core/animation';
import type { Manifest, Frame, Clip } from '../assets/schema';
import {
  sampleAnimation,
  type FrameBlend,
  type AnimationTreatment,
} from '../core/animation-treatment';
import { AnimationBlendShader, type AnimationFlow } from './animation-blend-shader';
const edgeMaterials = new WeakMap<Material, MeshBasicMaterial>();
// Transparency changes the OPAQUE shader define; opacity alone cannot invalidate it.
export function setCutoutOpacity(material: Material, opacity: number) {
  const transparent = opacity < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = opacity;
  material.depthWrite = !transparent;
  const edge = edgeMaterials.get(material);
  if (edge) edge.opacity = opacity;
}
export class ActorSprite {
  lightingSample:
    { frame: Frame; next?: Frame; blend?: FrameBlend; flow?: AnimationFlow } | undefined;
  geometry = new PlaneGeometry(1, 1);
  material = new MeshBasicMaterial({
    alphaTest: 0.05,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    toneMapped: false,
  });
  edgeMaterial: MeshBasicMaterial | undefined;
  edgeMesh: Mesh | undefined;
  private blendShader: AnimationBlendShader | undefined;
  private fullCanvas = false;
  private lastPair = '';
  private lastStabilized = true;
  stabilized = true;
  rigidSword = true;
  mesh = new Mesh(this.geometry, this.material);
  animator: Animator;
  lastFrame = '';
  frameIndex = new Map<string, Frame>();
  constructor(
    public id: string,
    public manifest: Manifest,
    public textures: ReadonlyMap<string, Texture>,
    clip: Clip,
  ) {
    this.animator = new Animator(id, clip);
    this.frameIndex = new Map(manifest.frames.map((f) => [f.id, f]));
    this.mesh.frustumCulled = false;
    if (manifest.asset.renderStyle === 'clean-ink' && manifest.asset.renderCategory === 'cutout') {
      this.material.alphaTest = 0.98;
      this.edgeMaterial = new MeshBasicMaterial({
        alphaTest: 1 / 255,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      this.edgeMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphatest_fragment>',
          '#include <alphatest_fragment>\nif(diffuseColor.a>=0.98) discard;',
        );
      };
      this.edgeMaterial.customProgramCacheKey = () => 'ink-soft-edge-v1';
      this.edgeMesh = new Mesh(this.geometry, this.edgeMaterial);
      this.edgeMesh.frustumCulled = false;
      this.mesh.add(this.edgeMesh);
      edgeMaterials.set(this.material, this.edgeMaterial);
    }
    if (manifest.asset.type === 'effect' || manifest.asset.renderCategory === 'translucent') {
      this.material.transparent = true;
      this.material.depthWrite = false;
      this.material.alphaTest = 0;
    }
  }
  showAnimation(
    foot: Vector3,
    camera: OrthographicCamera,
    mode: AnimationTreatment = 'original',
    flow?: AnimationFlow,
  ) {
    if (mode === 'original' || this.animator.clip.frames.length < 2)
      return this.show(this.animator.frame, foot, camera, undefined, flow);
    const sample = sampleAnimation(this.animator.clip, this.animator.time, mode, flow?.pairs);
    const pair = flow?.pairs.find(
      (p) => p.asset === this.manifest.asset.id && p.from === sample.from && p.to === sample.to,
    );
    if (!pair?.supported || sample.mix === 0 || sample.from === sample.to)
      return this.show(this.animator.frame, foot, camera, undefined, flow);
    return this.show(sample.from, foot, camera, sample, flow);
  }
  show(
    frameId: string,
    foot: Vector3,
    camera: OrthographicCamera,
    blend?: FrameBlend,
    flow?: AnimationFlow,
  ) {
    const original = this.frameIndex.get(frameId),
      offset = flow?.offsets[frameId];
    const f = original && offset ? { ...original, visualOffsetPx: offset } : original;
    if (!f) throw new Error(`runtime required frame missing: ${frameId}`);
    this.lightingSample = {
      frame: f,
      next: blend
        ? (() => {
            const frame = this.frameIndex.get(blend.to)!;
            return { ...frame, visualOffsetPx: flow?.offsets[frame.id] ?? frame.visualOffsetPx };
          })()
        : undefined,
      blend,
      flow,
    };
    if (blend) {
      this.blendShader ??= new AnimationBlendShader([
        this.material,
        ...(this.edgeMaterial ? [this.edgeMaterial] : []),
      ]);
      const next = this.frameIndex.get(blend.to);
      if (!next) throw new Error(`runtime blend frame missing: ${blend.to}`);
      this.blendShader.update(
        blend,
        this.manifest,
        f,
        next,
        this.textures,
        flow,
        this.stabilized,
        this.rigidSword,
      );
    } else if (this.blendShader) this.blendShader.uniforms.walkEnabled.value = 0;
    const pair = blend
        ? flow?.pairs.find(
            (p) => p.asset === this.manifest.asset.id && p.from === blend.from && p.to === blend.to,
          )
        : undefined,
      pairTag = pair ? [pair.from, pair.to].join(':') : '';
    const fullCanvas = !!blend,
      geometryChanged =
        pairTag !== this.lastPair ||
        frameId !== this.lastFrame ||
        fullCanvas !== this.fullCanvas ||
        this.stabilized !== this.lastStabilized;
    if (geometryChanged) {
      const texture = this.textures.get(f.page);
      if (!texture) throw new Error(`runtime page missing: ${f.page}`);
      this.material.map = texture;
      this.material.needsUpdate = this.lastFrame === '';
      if (this.edgeMaterial) {
        this.edgeMaterial.map = texture;
        this.edgeMaterial.needsUpdate = this.lastFrame === '';
      }
      const registration = pair ?? f.registration ?? this.manifest.asset;
      const b = trimmedBounds(registration, fullCanvas ? [0, 0, ...registration.canvas] : f.trim);
      // Translate only artwork in the camera plane; mesh.position remains the foot root.
      if (!fullCanvas && this.stabilized && f.visualOffsetPx) {
        const [x, y] = f.visualOffsetPx,
          d = registration.density;
        b.left += x / d;
        b.right += x / d;
        b.top -= y / d;
        b.bottom -= y / d;
      }
      const pos = this.geometry.getAttribute('position') as BufferAttribute;
      // Move corners along camera depth without changing projected screen X/Y.
      // up*y + outward*y*tan(elevation) = worldY*y/cos(elevation): a vertical
      // actor plane, so a pillar behind the foot cannot incorrectly cut the head.
      const depth =
        this.manifest.asset.projection === 'projected-world' ||
        this.manifest.asset.projection === 'front-view' ||
        this.manifest.asset.projection === 'top-down'
          ? 0
          : Math.tan((contract.elevationDeg * Math.PI) / 180);
      pos.setXYZ(0, b.left, b.top, b.top * depth);
      pos.setXYZ(1, b.right, b.top, b.top * depth);
      pos.setXYZ(2, b.left, b.bottom, b.bottom * depth);
      pos.setXYZ(3, b.right, b.bottom, b.bottom * depth);
      pos.needsUpdate = true;
      if (fullCanvas) {
        const uv = this.geometry.getAttribute('uv') as BufferAttribute;
        uv.setXY(0, 0, 1);
        uv.setXY(1, 1, 1);
        uv.setXY(2, 0, 0);
        uv.setXY(3, 1, 0);
        uv.needsUpdate = true;
      } else {
        const p = this.manifest.pages.find((p) => p.id === f.page)!,
          [x, y, w, h] = f.rect,
          uv = this.geometry.getAttribute('uv') as BufferAttribute;
        uv.setXY(0, x / p.width, 1 - y / p.height);
        uv.setXY(1, (x + w) / p.width, 1 - y / p.height);
        uv.setXY(2, x / p.width, 1 - (y + h) / p.height);
        uv.setXY(3, (x + w) / p.width, 1 - (y + h) / p.height);
        uv.needsUpdate = true;
      }
      this.geometry.computeBoundingSphere();
      this.lastFrame = frameId;
      this.fullCanvas = fullCanvas;
      this.lastStabilized = this.stabilized;
      this.lastPair = pairTag;
    }
    if (this.edgeMaterial) {
      this.edgeMaterial.color.copy(this.material.color);
      this.edgeMaterial.opacity = this.material.opacity;
    }
    this.mesh.position.copy(foot);
    if (this.manifest.asset.projection === 'front-view') this.mesh.rotation.set(0, 0, 0);
    else if (this.manifest.asset.projection === 'top-down')
      this.mesh.rotation.set(-Math.PI / 2, 0, 0);
    else this.mesh.quaternion.copy(camera.quaternion);
    return f;
  }
  dispose() {
    edgeMaterials.delete(this.material);
    this.geometry.dispose();
    this.edgeMaterial?.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
