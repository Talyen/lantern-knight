import * as T from 'three';
import { cleanupAll } from '../assets/cleanup';
import { multiplyGroundShadow } from './ground-shadow-material';
import type { ArtPlacement } from '../content/world-visuals';
import { heightAt, surfaceGradient, type AreaDefinition } from '../content/world';
import type { ActorSprite } from './sprite';
import type { Frame } from '../assets/schema';
import { right, up, outward } from './camera';

const contactCores = new WeakMap<T.Material, { value: number }>();
export function setContactCore(material: T.Material, enabled: boolean) {
  const core = contactCores.get(material);
  if (core) core.value = enabled ? 1 : 0;
}

// Grounding is independent of directional lighting and never writes depth.
export function contactShadowMaterial(texture: T.Texture, opacity: number) {
  const material = multiplyGroundShadow(
    Object.assign(
      new T.MeshBasicMaterial({
        map: texture,
        color: 0x182126,
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
      { defaultAttributeValues: { contactStrength: [1] } },
    ),
  );
  const core = { value: 0 },
    previous = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey();
  contactCores.set(material, core);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.contactCore = core;
    shader.vertexShader =
      'attribute float contactStrength;\nvarying float vContactStrength;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvContactStrength=contactStrength;',
    );
    shader.fragmentShader =
      'uniform float contactCore;\nvarying float vContactStrength;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
float contactCoverage=clamp(diffuseColor.a/max(opacity,.001),0.0,1.0);
// contact-shape
diffuseColor.a*=vContactStrength;
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
  material.customProgramCacheKey = () => key + ':contact-core-v2';
  return material;
}

type Patch = readonly [number, number, number, number];
function patches(sprite: ActorSprite): readonly Patch[] {
  const sample = sprite.lightingSample,
    frame = sample?.frame ?? sprite.frameIndex.get(sprite.animator.frame);
  if (!frame?.contact?.length) return [];
  const offset = (f: Frame) =>
    sprite.stabilized && f.visualOffsetPx
      ? [
          f.visualOffsetPx[0] / (f.registration ?? sprite.manifest.asset).density,
          -f.visualOffsetPx[1] / (f.registration ?? sprite.manifest.asset).density,
        ]
      : [0, 0];
  const a = offset(frame),
    next = sample?.next,
    b = next ? offset(next) : a,
    mix = next?.contact?.length === frame.contact.length ? (sample?.blend?.mix ?? 0) : 0;
  return frame.contact.map(
    (p, i) =>
      p.map((v, axis) => {
        const shift = axis < 2 ? a[axis]! : 0,
          to = next?.contact?.[i]?.[axis] ?? v,
          nextShift = axis < 2 ? b[axis]! : 0;
        return (v + shift) * (1 - mix) + (to + nextShift) * mix;
      }) as unknown as Patch,
  );
}
function poseKey(sprite: ActorSprite) {
  const s = sprite.lightingSample;
  return [
    s?.frame.id ?? sprite.animator.frame,
    s?.next?.id,
    s?.blend?.mix,
    (s?.frame ?? sprite.frameIndex.get(sprite.animator.frame))?.contact?.length ?? 0,
    sprite.stabilized,
    s?.frame.visualOffsetPx,
    s?.next?.visualOffsetPx,
  ].join(':');
}
export function actorContactGeometry(width: number, height: number) {
  const geometry = new T.PlaneGeometry(width, height);
  // One stable base and at most two automatically prepared supports. Reserve
  // attributes before upload; animation never creates geometry or GPU resources.
  for (const name of ['position', 'normal', 'uv']) {
    const original = geometry.getAttribute(name),
      array = new Float32Array(original.array.length * 3);
    for (let i = 0; i < 3; i++) array.set(original.array, original.array.length * i);
    const attribute = new T.BufferAttribute(array, original.itemSize);
    if (name === 'position') attribute.setUsage(T.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.setAttribute(
    'contactStrength',
    new T.BufferAttribute(new Float32Array(12).fill(1), 1).setUsage(T.DynamicDrawUsage),
  );
  geometry.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5, 8, 10, 9, 10, 11, 9]);
  geometry.setDrawRange(0, 6);
  return geometry;
}
function projectContact(x: number, y: number, normal: T.Vector3, target: T.Vector3) {
  target.copy(right).multiplyScalar(x).addScaledVector(up, y);
  return target.addScaledVector(outward, -normal.dot(target) / normal.dot(outward));
}
const actorContactPoses = new WeakMap<T.Mesh, { key: string; normal: T.Vector3 }>();
const contactCorner = new T.Vector3();
export function poseActorContact(
  shadow: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>,
  sprite: ActorSprite,
  normal: T.Vector3,
) {
  const key = poseKey(sprite),
    previous = actorContactPoses.get(shadow);
  // The base is floor-local; supports are projected into that same local basis.
  if (previous?.key === key && previous.normal.equals(normal)) return;
  const supports = Math.abs(normal.dot(outward)) > 0.05 ? patches(sprite) : [],
    positions = shadow.geometry.getAttribute('position'),
    strength = shadow.geometry.getAttribute('contactStrength'),
    inverse = shadow.quaternion.clone().invert();
  for (let i = 0; i < 4; i++) strength.setX(i, supports.length ? 0.4 : 1);
  supports.forEach(([x, y, rx, ry], patch) => {
    for (let i = 0; i < 4; i++) {
      projectContact(
        x + (i % 2 ? rx : -rx),
        y + (i < 2 ? ry : -ry),
        normal,
        contactCorner,
      ).applyQuaternion(inverse);
      positions.setXYZ((patch + 1) * 4 + i, contactCorner.x, contactCorner.y, contactCorner.z);
    }
  });
  for (let i = (supports.length + 1) * 4; i < 12; i++) positions.setXYZ(i, 0, 0, 0);
  shadow.geometry.setDrawRange(0, 6 * (1 + supports.length));
  positions.needsUpdate = strength.needsUpdate = true;
  shadow.geometry.computeBoundingSphere();
  actorContactPoses.set(shadow, { key, normal: normal.clone() });
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
  private entries: {
    sprite: ActorSprite;
    p: ArtPlacement;
    base: T.Matrix4;
    normal: T.Vector3;
    start: number;
    key: string;
  }[] = [];
  constructor(texture: T.Texture, capacity: number) {
    const geometry = new T.PlaneGeometry(1, 1),
      material = contactShadowMaterial(texture, 1);
    this.opacity = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 1);
    this.opacity.setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('contactOpacity', this.opacity);
    geometry.setAttribute(
      'contactStrength',
      new T.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 1),
    );
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
    material.customProgramCacheKey = () => 'prop-contact-shadow-support-v3';
    this.mesh = new T.InstancedMesh(geometry, material, capacity * 3);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = -1.5;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noCastShadow = true;
  }
  add(p: ArtPlacement, sprite: ActorSprite, area: AreaDefinition) {
    const size = contactFootprint(p, sprite);
    if (!size) return;
    const transform = new T.Object3D(),
      gradient = surfaceGradient(area, p.x, p.z),
      normal = new T.Vector3(-gradient.x, 1, -gradient.z).normalize();
    transform.position.set(p.x, heightAt(area, p.x, p.z) + 0.03, p.z);
    transform.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    transform.rotateZ(-(p.footprintAngle ?? 0));
    transform.scale.set(size[0], size[1], 1);
    transform.updateMatrix();
    const start = this.mesh.count;
    this.mesh.count += 3;
    const entry = { sprite, p, base: transform.matrix.clone(), normal, start, key: '' };
    this.entries.push(entry);
    this.updateEntry(entry);
  }
  update() {
    for (const entry of this.entries) this.updateEntry(entry);
  }
  private updateEntry(entry: (typeof this.entries)[number]) {
    const { sprite, p, start, base, normal } = entry,
      key = poseKey(sprite);
    if (entry.key !== key) {
      const supports = Math.abs(normal.dot(outward)) > 0.05 ? patches(sprite) : [];
      this.mesh.setMatrixAt(start, base);
      const strength = this.mesh.geometry.getAttribute('contactStrength');
      strength.setX(start, supports.length ? 0.4 : 1);
      for (let i = 0; i < 2; i++) {
        const patch = supports[i];
        if (patch) {
          const [cx, cy, rx, ry] = patch,
            angle = p.rotation ?? 0,
            scale = p.scale ?? 1,
            project = (x: number, y: number) => {
              x *= p.mirror ? -1 : 1;
              return projectContact(
                (x * Math.cos(angle) - y * Math.sin(angle)) * scale,
                (x * Math.sin(angle) + y * Math.cos(angle)) * scale,
                normal,
                new T.Vector3(),
              );
            },
            center = project(cx, cy).add(new T.Vector3().setFromMatrixPosition(base)),
            x = project(rx * 2, 0),
            y = project(0, ry * 2);
          if (x.clone().cross(y).dot(normal) < 0) x.negate();
          this.mesh.setMatrixAt(
            start + i + 1,
            new T.Matrix4().makeBasis(x, y, normal).setPosition(center),
          );
        } else this.mesh.setMatrixAt(start + i + 1, new T.Matrix4().makeScale(0, 0, 0));
      }
      strength.needsUpdate = true;
      this.mesh.instanceMatrix.needsUpdate = true;
      entry.key = key;
    }
    const value = sprite.mesh.visible ? Math.fround(0.4 * sprite.material.opacity) : 0;
    for (let i = 0; i < 3; i++)
      if (this.opacity.getX(start + i) !== value) {
        this.opacity.setX(start + i, value);
        this.opacity.needsUpdate = true;
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
