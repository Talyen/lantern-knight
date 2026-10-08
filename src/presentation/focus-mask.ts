import * as T from 'three';
import { ActorSprite } from './sprite';
import { attachRevealMask } from './scenery-reveal';
import { AnimationBlendShader } from './animation-blend-shader';
import { FoliageWind } from './foliage-wind';
import type { GamePresentation } from './game-scene';
type DepthEntry = { material: T.MeshBasicMaterial; blend?: AnimationBlendShader };
export class FocusMask {
  readonly target = new T.WebGLRenderTarget(1, 1, {
    minFilter: T.NearestFilter,
    magFilter: T.NearestFilter,
    depthBuffer: true,
  });
  private depths = new Map<T.Material, DepthEntry>();
  constructor(
    private presentation: GamePresentation,
    private uniforms: { lookNear: T.Uniform<number>; lookFar: T.Uniform<number> },
    private extras: T.Group,
    private proxies: T.Group,
  ) {}
  private depthMaterial(source: T.Material, sprite?: ActorSprite) {
    let entry = this.depths.get(source);
    if (!entry) {
      const material = new T.MeshBasicMaterial({
        alphaTest: sprite
          ? 1 / 255
          : source instanceof T.MeshBasicMaterial
            ? Math.max(source.map && source.transparent ? 1 / 255 : 0, source.alphaTest)
            : 0,
        depthWrite: true,
        depthTest: true,
        side: source.side,
        toneMapped: false,
      });
      const protect =
        sprite?.manifest.asset.type === 'character' ||
        (sprite?.manifest.asset.type === 'effect' && !sprite.mesh.userData.decorative)
          ? 1
          : 0;
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
          focusNear: this.uniforms.lookNear,
          focusFar: this.uniforms.lookFar,
        });
        shader.vertexShader = 'varying float focusDepth;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nfocusDepth=-mvPosition.z;',
        );
        shader.fragmentShader =
          'varying float focusDepth; uniform float focusNear,focusFar;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `outgoingLight=vec3(clamp((focusDepth-focusNear)/(focusFar-focusNear),0.,1.),${protect.toFixed(1)},0.0);\n#include <opaque_fragment>`,
        );
      };
      material.customProgramCacheKey = () => `focus-mask-${protect}`;
      attachRevealMask(material, source);
      entry = { material };
      this.depths.set(source, entry);
    }
    const wind = source.userData.foliageWind as FoliageWind | undefined;
    if (wind) wind.attach(entry.material);
    entry.material.depthTest = source.depthTest;
    entry.material.map = source instanceof T.MeshBasicMaterial ? source.map : null;
    entry.material.opacity = source.opacity;
    const s = sprite?.lightingSample;
    if (s?.blend && s.next) {
      entry.blend ??= new AnimationBlendShader([entry.material]);
      entry.blend.update(
        s.blend,
        sprite!.manifest,
        s.frame,
        s.next,
        sprite!.textures,
        s.flow,
        sprite!.stabilized,
        sprite!.rigidSword,
      );
    } else if (entry.blend) entry.blend.uniforms.walkEnabled.value = 0;
    return entry.material;
  }
  render(sprites: ActorSprite[]) {
    const p = this.presentation,
      renderer = p.renderer,
      restore: { mesh: T.Mesh; material: T.Material | T.Material[] }[] = [],
      byMaterial = new Map<T.Material, ActorSprite>(),
      edges = new Set(sprites.flatMap((s) => (s.edgeMesh ? [s.edgeMesh] : [])));
    for (const s of sprites) {
      byMaterial.set(s.material, s);
      if (s.edgeMaterial) byMaterial.set(s.edgeMaterial, s);
    }
    const previousTarget = renderer.getRenderTarget(),
      clear = renderer.getClearColor(new T.Color()),
      clearAlpha = renderer.getClearAlpha(),
      previousShadow = renderer.shadowMap.enabled;
    const extras = this.extras.visible,
      proxies = this.proxies.visible;
    try {
      this.extras.visible = this.proxies.visible = false;
      renderer.shadowMap.enabled = false;
      p.scene.traverseVisible((o) => {
        if (!(o instanceof T.Mesh) || edges.has(o)) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        if (materials.every((m) => m instanceof T.ShadowMaterial)) return;
        const sprite = byMaterial.get(materials[0]!);
        // A faded foreground prop must not hide the focus protection of a visible actor.
        if (
          o.userData.decorative ||
          sprite?.mesh.userData.decorative ||
          (materials[0]!.opacity < 0.99 &&
            sprite?.manifest.asset.type !== 'character' &&
            sprite?.manifest.asset.type !== 'effect')
        ) {
          edges.add(o);
          return;
        }
        restore.push({ mesh: o, material: o.material });
        o.material = Array.isArray(o.material)
          ? materials.map((m) => this.depthMaterial(m, byMaterial.get(m)))
          : this.depthMaterial(materials[0]!, sprite);
      });
      // One alpha-tested core includes the entire soft edge in this auxiliary pass.
      // Hide its duplicate beauty edge mesh while retaining all original visibility states.
      const visible = [...edges].map((mesh) => [mesh, mesh.visible] as const);
      try {
        for (const [mesh] of visible) mesh.visible = false;
        renderer.setRenderTarget(this.target);
        renderer.setClearColor(0xff0000, 1);
        renderer.clear();
        renderer.render(p.scene, p.camera);
      } finally {
        for (const [mesh, wasVisible] of visible) mesh.visible = wasVisible;
      }
    } finally {
      for (const r of restore) r.mesh.material = r.material;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, clearAlpha);
      renderer.shadowMap.enabled = previousShadow;
      this.extras.visible = extras;
      this.proxies.visible = proxies;
    }
  }
  stats() {
    const pixels = new Uint8Array(this.target.width * this.target.height * 4);
    this.presentation.renderer.readRenderTargetPixels(
      this.target,
      0,
      0,
      this.target.width,
      this.target.height,
      pixels,
    );
    let protectedPixels = 0,
      groundPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 1]! > 128) protectedPixels++;
      else if (pixels[i]! < 254) groundPixels++;
    }
    return { protectedPixels, groundPixels, width: this.target.width, height: this.target.height };
  }
  reset() {
    for (const entry of this.depths.values()) entry.material.dispose();
    this.depths.clear();
  }
  dispose() {
    this.reset();
    this.target.dispose();
  }
}
