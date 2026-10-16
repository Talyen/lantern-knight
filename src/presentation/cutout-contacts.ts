import * as T from 'three';
import { cleanupAll } from '../assets/cleanup';
import type { Frame } from '../assets/schema';
import { heightAt, surfaceGradient, type AreaDefinition } from '../content/world';
import { right, up } from './camera';
import { contactShadowMaterial } from './contact-shadows';
import type { GroundOcclusion } from './ground-occlusion';
import type { ActorSprite } from './sprite';

// Collapse only the lowest drawing band onto the floor. Raised feet produce no
// core; wheels and crate bases retain their gaps. The existing soft bed remains.
export class CutoutContacts {
  private disposed = false;
  readonly group = new T.Group();
  private geometry = new T.PlaneGeometry(1, 1);
  private entries = new Map<ActorSprite, ReturnType<CutoutContacts['create']>>();
  constructor(private texture: T.Texture) {}
  private create() {
    const material = contactShadowMaterial(this.texture, 0.72);
    const uniforms = {
      contactA: { value: null as T.Texture | null },
      contactB: { value: null as T.Texture | null },
      contactRectA: { value: new T.Vector4() },
      contactRectB: { value: new T.Vector4() },
      contactTrimA: { value: new T.Vector4() },
      contactTrimB: { value: new T.Vector4() },
      contactAnchorA: { value: new T.Vector3() },
      contactAnchorB: { value: new T.Vector3() },
      contactScale: { value: new T.Vector2() },
      contactRotation: { value: new T.Vector2() },
      contactWidth: { value: 1 },
      contactMix: { value: 0 },
    };
    const previous = material.onBeforeCompile.bind(material),
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader =
        `
uniform sampler2D contactA,contactB;uniform vec4 contactRectA,contactRectB,contactTrimA,contactTrimB;
uniform vec3 contactAnchorA,contactAnchorB;uniform vec2 contactScale,contactRotation;uniform float contactWidth,contactMix;
float contactBand(sampler2D image,vec4 rect,vec4 trim,vec3 anchor,vec2 uv){
 float mask=0.0;
 for(int x=-1;x<=1;x++)for(int y=0;y<4;y++){
  vec2 world=vec2((uv.x-.5)*contactWidth+float(x)*.025,float(y)*.045);
  vec2 local=vec2(dot(world,contactRotation),dot(world,vec2(-contactRotation.y,contactRotation.x)));
  vec2 pixel=anchor.xy+vec2(local.x/contactScale.x,-local.y/contactScale.y)*anchor.z;
  vec2 q=(pixel-trim.xy)/trim.zw;
  if(any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(1.0))))continue;
  mask+=texture2D(image,rect.xy+vec2(q.x,1.0-q.y)*rect.zw).a;
 }
 return mask/12.0;
}
` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.a*=mix(contactBand(contactA,contactRectA,contactTrimA,contactAnchorA,vMapUv),contactBand(contactB,contactRectB,contactTrimB,contactAnchorB,vMapUv),contactMix);`,
      );
    };
    material.customProgramCacheKey = () => key + ':cutout-contact-v1';
    const mesh = new T.Mesh(this.geometry, material);
    mesh.renderOrder = -1.4;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, uniforms };
  }
  update(sprites: readonly ActorSprite[], area: AreaDefinition, occlusion?: GroundOcclusion) {
    if (this.disposed) throw new Error('cutout contacts disposed');
    const live = new Set(sprites);
    for (const [sprite, entry] of this.entries)
      if (!live.has(sprite)) {
        this.entries.delete(sprite);
        entry.mesh.removeFromParent();
        entry.mesh.material.dispose();
      }
    for (const sprite of sprites) {
      const sample = sprite.lightingSample;
      if (!sample) continue;
      let entry = this.entries.get(sprite);
      if (!entry) this.entries.set(sprite, (entry = this.create()));
      const { mesh, uniforms: u } = entry;
      const sx = sprite.mesh.scale.x,
        sy = Math.abs(sprite.mesh.scale.y);
      mesh.visible =
        sprite.mesh.visible && sprite.material.opacity > 0 && Math.abs(sx) > 0.001 && sy > 0.001;
      if (!mesh.visible) continue;
      const axis = new T.Vector3(1, 0, 0).applyQuaternion(sprite.mesh.quaternion),
        c = axis.dot(right),
        s = axis.dot(up);
      u.contactRotation.value.set(c, s).normalize();
      const frame = (f: Frame, suffix: 'A' | 'B') => {
        const registration = f.registration ?? sprite.manifest.asset,
          offset = sprite.stabilized ? (f.visualOffsetPx ?? [0, 0]) : [0, 0],
          page = sprite.manifest.pages.find((p) => p.id === f.page)!,
          [x, y, w, h] = f.rect;
        u[`contact${suffix}`].value = sprite.textures.get(f.page)!;
        u[`contactRect${suffix}`].value.set(
          x / page.width,
          1 - (y + h) / page.height,
          w / page.width,
          h / page.height,
        );
        u[`contactTrim${suffix}`].value.fromArray(f.trim);
        u[`contactAnchor${suffix}`].value.set(
          registration.anchor[0] - offset[0]!,
          registration.anchor[1] - offset[1]!,
          registration.density,
        );
        const xs = [f.trim[0], f.trim[0] + f.trim[2]].map(
            (x) => ((x - registration.anchor[0] + offset[0]!) / registration.density) * sx,
          ),
          ys = [f.trim[1], f.trim[1] + f.trim[3]].map(
            (y) => ((registration.anchor[1] - y - offset[1]!) / registration.density) * sy,
          );
        return 2 * Math.max(...xs.flatMap((x) => ys.map((y) => Math.abs(c * x - s * y))));
      };
      const width =
        Math.max(frame(sample.frame, 'A'), frame(sample.next ?? sample.frame, 'B')) + 0.1;
      u.contactWidth.value = width;
      u.contactScale.value.set(sx, sy);
      u.contactMix.value = sample.blend?.mix ?? 0;
      mesh.material.opacity = 0.72 * sprite.material.opacity;
      const { x, z } = sprite.mesh.position,
        gradient = surfaceGradient(area, x, z),
        normal = new T.Vector3(-gradient.x, 1, -gradient.z).normalize(),
        horizontal = right.clone().projectOnPlane(normal).normalize(),
        vertical = new T.Vector3().crossVectors(normal, horizontal);
      mesh.quaternion.setFromRotationMatrix(
        new T.Matrix4().makeBasis(horizontal, vertical, normal),
      );
      mesh.position.set(x, heightAt(area, x, z) + 0.04, z);
      mesh.scale.set(width, 0.38 * Math.min(2, sy), 1);
      occlusion?.attachShadow(mesh.material);
    }
  }
  reset() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.group.clear();
    cleanupAll(entries.map((entry) => () => entry.mesh.material.dispose()));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cleanupAll([
      () => this.reset(),
      () => this.geometry.dispose(),
      () => this.group.removeFromParent(),
    ]);
  }
}
