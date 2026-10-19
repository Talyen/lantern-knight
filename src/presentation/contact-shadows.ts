import * as T from 'three';
import { cleanupAll } from '../assets/cleanup';
import { multiplyGroundShadow } from './ground-shadow-material';
import type { ArtPlacement } from '../content/world-visuals';
import { heightAt, surfaceGradient, type AreaDefinition } from '../content/world';
import { spritePlacementEnvelope } from '../content/placement-envelope';
import type { ActorSprite } from './sprite';
import { actorContactPatches, toolboxContact, type ContactPatches } from './contact-profiles';
import { right, up, outward } from './camera';

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
// contact-shape
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

export function actorContactGeometry(width: number, height: number, profiled: boolean) {
  const geometry = new T.PlaneGeometry(width, height);
  if (profiled) {
    // Reserve both quads before the first upload. Changing a stance only writes
    // these buffers and drawRange; it never replaces uploaded GPU attributes.
    for (const name of ['position', 'normal', 'uv']) {
      const original = geometry.getAttribute(name),
        array = new Float32Array(original.array.length * 2);
      array.set(original.array);
      array.set(original.array, original.array.length);
      geometry.setAttribute(name, new T.BufferAttribute(array, original.itemSize));
    }
    geometry.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
    geometry.setDrawRange(0, 6);
  }
  return geometry;
}

// Intersect a screen-plane offset with the local receiving plane along the
// camera ray. This puts the mark under the drawn sole without moving gameplay.
function projectContact(x: number, y: number, normal: T.Vector3, target: T.Vector3) {
  target.copy(right).multiplyScalar(x).addScaledVector(up, y);
  return target.addScaledVector(outward, -normal.dot(target) / normal.dot(outward));
}

const actorContactPoses = new WeakMap<
  T.Mesh,
  { patches: ContactPatches | undefined; normal: T.Vector3 }
>();
const contactCorner = new T.Vector3();
export function poseActorContact(
  shadow: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>,
  sprite: ActorSprite,
  normal: T.Vector3,
) {
  if (shadow.geometry.getAttribute('position').count !== 8) return;
  const patches = Math.abs(normal.dot(outward)) > 0.05 ? actorContactPatches(sprite) : undefined,
    previous = actorContactPoses.get(shadow);
  if (patches) shadow.quaternion.identity();
  if (previous && previous.patches === patches && previous.normal.equals(normal)) return;
  const positions = shadow.geometry.getAttribute('position');
  if (patches) {
    for (let patch = 0; patch < 2; patch++)
      for (let i = 0; i < 4; i++) {
        const [x, y, rx, ry] = patches[patch]!;
        projectContact(x + (i % 2 ? rx : -rx), y + (i < 2 ? ry : -ry), normal, contactCorner);
        positions.setXYZ(patch * 4 + i, contactCorner.x, contactCorner.y, contactCorner.z);
      }
    shadow.geometry.setDrawRange(0, 12);
  } else if (previous?.patches) {
    const { width, height } = shadow.geometry.parameters;
    for (let i = 0; i < 4; i++)
      positions.setXYZ(i, (i % 2 ? width : -width) / 2, (i < 2 ? height : -height) / 2, 0);
    shadow.geometry.setDrawRange(0, 6);
  }
  positions.needsUpdate = true;
  shadow.geometry.computeBoundingSphere();
  actorContactPoses.set(shadow, { patches, normal: normal.clone() });
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
  const bounds = spritePlacementEnvelope(sprite.manifest, [p.clip]),
    width = (bounds.right - bounds.left) * (p.scale ?? 1);
  // Measured alpha extents avoid grounding a prop's transparent canvas margins.
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
    geometry.setAttribute(
      'contactBox',
      new T.InstancedBufferAttribute(new Float32Array(capacity), 1),
    );
    const previous = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      shader.vertexShader =
        'attribute float contactOpacity;\nattribute float contactBox;\nvarying float vContactOpacity;\nvarying float vContactBox;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvContactOpacity=contactOpacity;\nvContactBox=contactBox;',
      );
      shader.fragmentShader =
        'varying float vContactOpacity;\nvarying float vContactBox;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '// contact-shape',
        `if(vContactBox>.5){
 vec2 edge=abs(vMapUv-.5)*2.0;
 contactCoverage=1.0-smoothstep(.70,1.0,max(edge.x,edge.y));
 diffuseColor.a=opacity*contactCoverage;
}`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '// contact-opacity',
        'diffuseColor.a*=vContactOpacity;',
      );
    };
    material.customProgramCacheKey = () => 'prop-contact-shadow-profile-v2';
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
      gradient = surfaceGradient(area, p.x, p.z),
      normal = new T.Vector3(-gradient.x, 1, -gradient.z).normalize();
    transform.position.set(p.x, heightAt(area, p.x, p.z) + 0.03, p.z);
    transform.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    transform.rotateZ(-(p.footprintAngle ?? 0));
    transform.scale.set(size[0], size[1], 1);
    transform.updateMatrix();
    const profile = !p.footprint && Math.abs(normal.dot(outward)) > 0.05 && toolboxContact(sprite);
    if (profile) {
      const scale = p.scale ?? 1,
        angle = p.rotation ?? 0,
        project = ([x, y]: readonly [number, number]) => {
          x *= p.mirror ? -1 : 1;
          return projectContact(
            (x * Math.cos(angle) - y * Math.sin(angle)) * scale,
            (x * Math.sin(angle) + y * Math.cos(angle)) * scale,
            normal,
            new T.Vector3(),
          );
        },
        center = project(profile.center).add(transform.position),
        x = project(profile.x),
        y = project(profile.y);
      // InstancedMesh cannot reverse face winding for a negative instance scale.
      // A symmetric box profile can reverse either basis axis without changing its footprint.
      if (x.clone().cross(y).dot(normal) < 0) x.negate();
      transform.matrix.makeBasis(x, y, normal);
      transform.matrix.setPosition(center);
      const boxes = this.mesh.geometry.getAttribute('contactBox');
      boxes.setX(this.mesh.count, 2);
      boxes.needsUpdate = true;
    }
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
