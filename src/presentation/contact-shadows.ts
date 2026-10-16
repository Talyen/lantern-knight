import * as T from 'three';
import { cleanupAll } from '../assets/cleanup';
import { multiplyGroundShadow } from './ground-shadow-material';
import type { ArtPlacement } from '../content/world-visuals';
import { heightAt, surfaceGradient, type AreaDefinition } from '../content/world';
import type { ActorSprite } from './sprite';

const contactCores = new WeakMap<T.Material, { value: number }>();
export function setContactCore(material: T.Material, enabled: boolean) {
  const core = contactCores.get(material);
  if (core) core.value = enabled ? 1 : 0;
}

// Grounding is independent of directional lighting and never writes depth.
export function contactShadowMaterial(texture: T.Texture, opacity: number) {
  const material = multiplyGroundShadow(
    new T.MeshBasicMaterial({
      map: texture,
      color: 0x182126,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const core = { value: 0 },
    previous = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey();
  contactCores.set(material, core);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.contactCore = core;
    shader.fragmentShader = 'uniform float contactCore;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
float contactCoverage=clamp(diffuseColor.a/max(opacity,.001),0.0,1.0);
// contact-opacity`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>
if(contactCore>.5){
 float core=contactCoverage*contactCoverage;core*=core*contactCoverage;
 core*=diffuseColor.a*.95;
 gl_FragColor.rgb*=linearToOutputTexel(vec4(mix(vec3(1.0),diffuse,core),1.0)).rgb;
}`,
    );
  };
  material.customProgramCacheKey = () => key + ':contact-core-v1';
  return material;
}

export function contactFootprint(
  p: ArtPlacement,
  sprite: ActorSprite,
): readonly [number, number] | undefined {
  const asset = sprite.manifest.asset;
  if (
    p.shadow === 'none' ||
    p.role === 'attachment' ||
    p.role === 'ground' ||
    p.mount ||
    (asset.type === 'effect' && !p.fixture) ||
    asset.placement === 'ground' ||
    asset.placement === 'reference' ||
    (p.y ?? 0) > 0.05
  )
    return;
  if (p.footprint) return p.footprint;
  const frame = sprite.frameIndex.get(sprite.animator.frame)!,
    registration = frame.registration ?? asset,
    width = (frame.trim[2] / registration.density) * (p.scale ?? 1);
  // Trimmed artwork gives unregistered props a bounded, scale-aware base.
  return [width * 0.65, width * 0.3];
}

export class PropContactShadows {
  private disposed = false;
  readonly mesh: T.InstancedMesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  private opacity: T.InstancedBufferAttribute;
  private entries: { sprite: ActorSprite; opacity: number }[] = [];
  constructor(texture: T.Texture, capacity: number) {
    const geometry = new T.PlaneGeometry(1, 1),
      material = contactShadowMaterial(texture, 1);
    this.opacity = new T.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.opacity.setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('contactOpacity', this.opacity);
    const previous = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      shader.vertexShader =
        'attribute float contactOpacity;\nvarying float vContactOpacity;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvContactOpacity=contactOpacity;',
      );
      shader.fragmentShader = 'varying float vContactOpacity;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '// contact-opacity',
        'diffuseColor.a*=vContactOpacity;',
      );
    };
    material.customProgramCacheKey = () => 'prop-contact-shadow-multiply-v2';
    this.mesh = new T.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = -1.5;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noCastShadow = true;
  }
  add(p: ArtPlacement, sprite: ActorSprite, area: AreaDefinition) {
    const size = contactFootprint(p, sprite);
    if (!size) return;
    const transform = new T.Object3D(),
      gradient = surfaceGradient(area, p.x, p.z);
    transform.position.set(p.x, heightAt(area, p.x, p.z) + 0.03, p.z);
    transform.quaternion.setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      new T.Vector3(-gradient.x, 1, -gradient.z).normalize(),
    );
    transform.rotateZ(-(p.footprintAngle ?? 0));
    transform.scale.set(size[0], size[1], 1);
    transform.updateMatrix();
    this.mesh.setMatrixAt(this.mesh.count++, transform.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.entries.push({ sprite, opacity: 0.4 });
    this.opacity.setX(this.mesh.count - 1, 0.4 * sprite.material.opacity);
    this.opacity.needsUpdate = true;
  }
  update() {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!,
        value = entry.sprite.mesh.visible
          ? Math.fround(entry.opacity * entry.sprite.material.opacity)
          : 0;
      if (this.opacity.getX(i) !== value) {
        this.opacity.setX(i, value);
        this.opacity.needsUpdate = true;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.entries = [];
    cleanupAll([
      () => this.mesh.removeFromParent(),
      () => this.mesh.dispose(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
    ]);
  }
}
