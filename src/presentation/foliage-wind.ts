import * as T from 'three';
import type { ActorSprite } from './sprite';
/** Root-relative deformation is identical in beauty, soft edge and auxiliary passes. */
export class FoliageWind {
  readonly time = new T.Uniform(0);
  readonly strength = new T.Uniform(0);
  private root = new T.Uniform(0);
  private phase = new T.Uniform(0);
  constructor(sprite: ActorSprite, phase = 0) {
    this.phase.value = phase;
    const positions = sprite.geometry.getAttribute('position');
    this.root.value = Math.min(
      ...Array.from({ length: positions.count }, (_, i) => positions.getY(i)),
    );
    for (const m of [sprite.material, sprite.edgeMaterial]) if (m) this.attach(m);
  }
  attach(material: T.Material) {
    if (material.userData.foliageWind === this) return;
    const previous = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, {
        foliageTime: this.time,
        foliageStrength: this.strength,
        foliageRoot: this.root,
        foliagePhase: this.phase,
      });
      shader.vertexShader =
        'uniform float foliageTime,foliageStrength,foliageRoot,foliagePhase;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nfloat swayHeight=max(0.,position.y-foliageRoot);transformed.x+=(sin(foliageTime*1.2+position.y*1.6+foliagePhase)+.25*sin(foliageTime*2.7+foliagePhase))*swayHeight*foliageStrength;',
      );
    };
    material.customProgramCacheKey = () => `${key}:foliage-wind-v1`;
    material.userData.foliageWind = this;
    material.needsUpdate = true;
  }
  update(time: number, enabled: boolean, strength = 0.012) {
    this.time.value = time;
    this.strength.value = enabled ? strength : 0;
  }
}
