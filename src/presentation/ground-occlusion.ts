import * as T from 'three';
import type { ContentSnapshot } from '../content/snapshot';
import type { GroundInteraction, GroundRegion } from '../content/ground-interaction';
import { artworkFloorLayout } from '../content/floor-layout';
import { outward, right, up } from './camera';
import type { ActorSprite } from './sprite';
type Ground = ContentSnapshot<GroundInteraction>;
export function regionDepth(
  region: ContentSnapshot<GroundRegion>,
  u: number,
  layout: ReturnType<typeof artworkFloorLayout>,
) {
  const depth = (p: { x: number; z: number }) => p.x * outward.x + p.z * outward.z;
  if (!region.depth) return -Infinity;
  if (region.depth.kind === 'anchor') return depth(region.depth.point);
  const points = region.depth.points;
  let i = 1;
  while (i < points.length - 1 && layout.uv(points[i]!)[0] < u) i++;
  const a = points[i - 1]!,
    b = points[i]!,
    x = layout.uv(a)[0],
    span = layout.uv(b)[0] - x,
    t = Math.max(0, Math.min(1, (u - x) / span));
  return depth(a) + (depth(b) - depth(a)) * t;
}
export class GroundOcclusion {
  readonly texture: T.DataTexture;
  readonly range: T.Vector2;
  readonly size: T.Vector2;
  readonly uniforms;
  readonly bytes: number;
  outlines = true;
  private actorUniforms = new WeakMap<
    ActorSprite,
    {
      groundFoot: { value: number };
      groundOutline: { value: number };
      groundColor: { value: T.Color };
    }
  >();
  constructor(ground: Ground, width: number, depth: number, maxTextureSize: number) {
    const [w, h] = ground.dimensions;
    if (Math.max(w, h) > maxTextureSize)
      throw new Error('GPU cannot hold the authored ground occlusion atlas at source dimensions');
    const layout = artworkFloorLayout(width, depth),
      depths = layout.corners.map((p) => p.x * outward.x + p.z * outward.z),
      low = Math.min(...depths) - 1,
      span = Math.max(...depths) - low + 1;
    this.range = new T.Vector2(low, span);
    this.size = new T.Vector2(w, h);
    const data = new Uint8Array(w * h * 4);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    for (const region of ground.regions) {
      if (!region.mask?.length || !region.depth) continue;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      let minX = w,
        minY = h,
        maxX = 0,
        maxY = 0;
      for (const shape of region.mask) {
        ctx.beginPath();
        for (const ring of [shape.outer, ...shape.holes]) {
          ring.forEach(([u, v], i) => {
            const x = u * w,
              y = v * h;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
      const x0 = Math.max(0, Math.floor(minX)),
        y0 = Math.max(0, Math.floor(minY)),
        rw = Math.min(w, Math.ceil(maxX)) - x0,
        rh = Math.min(h, Math.ceil(maxY)) - y0;
      if (rw <= 0 || rh <= 0) continue;
      const pixels = ctx.getImageData(x0, y0, rw, rh).data;
      for (let x = 0; x < rw; x++) {
        const value = Math.max(
          0,
          Math.min(
            65535,
            Math.round(((regionDepth(region, (x0 + x + 0.5) / w, layout) - low) / span) * 65535),
          ),
        );
        for (let y = 0; y < rh; y++) {
          const alpha = pixels[(y * rw + x) * 4 + 3]!;
          if (alpha === 0) continue;
          const index = ((y0 + y) * w + x0 + x) * 4,
            previous = data[index]! * 256 + data[index + 1]!;
          if (data[index + 2] === 0 || value > previous) {
            data[index] = value >> 8;
            data[index + 1] = value & 255;
            data[index + 2] = alpha;
            data[index + 3] = 255;
          }
        }
      }
    }
    canvas.width = canvas.height = 1;
    this.texture = new T.DataTexture(data, w, h, T.RGBAFormat, T.UnsignedByteType);
    this.texture.minFilter = this.texture.magFilter = T.NearestFilter;
    this.texture.needsUpdate = true;
    this.bytes = data.byteLength;
    // Project each fragment along the fixed viewing ray onto the artwork floor.
    this.uniforms = {
      groundAtlas: { value: this.texture },
      groundRange: { value: this.range },
      groundWidth: { value: width },
      groundHeight: { value: depth },
      groundRight: { value: right },
      groundUp: { value: up },
    };
  }
  private shadowMaterials = new WeakSet<T.Material>();
  /** Ground shadows must not stain upright scenery baked into the floor painting. */
  attachShadow(material: T.MeshBasicMaterial | T.ShadowMaterial) {
    if (this.shadowMaterials.has(material)) return;
    this.shadowMaterials.add(material);
    const previous = material.onBeforeCompile.bind(material),
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = 'varying vec3 shadowGroundWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 shadowWorld=vec4(transformed,1.0);
#ifdef USE_INSTANCING
shadowWorld=instanceMatrix*shadowWorld;
#endif
shadowGroundWorld=(modelMatrix*shadowWorld).xyz;`,
      );
      shader.fragmentShader =
        `varying vec3 shadowGroundWorld;
uniform sampler2D groundAtlas;
uniform float groundWidth,groundHeight;
uniform vec3 groundRight,groundUp;
` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        `vec2 shadowUV=vec2(dot(shadowGroundWorld,groundRight)/groundWidth+.5,.5-dot(shadowGroundWorld,groundUp)/groundHeight);
if(all(greaterThanEqual(shadowUV,vec2(0.0)))&&all(lessThanEqual(shadowUV,vec2(1.0)))&&texture2D(groundAtlas,shadowUV).b>.1)discard;
#include <colorspace_fragment>`,
      );
    };
    material.customProgramCacheKey = () => key + ':painted-shadow-mask-v1';
    material.needsUpdate = true;
  }
  attach(sprite: ActorSprite, kind: 'hero' | 'enemy' | 'drop') {
    if (this.actorUniforms.has(sprite)) return;
    if (kind === 'drop') sprite.mesh.userData.groundDrop = true;
    const actor = {
      groundFoot: { value: 0 },
      groundOutline: { value: kind === 'drop' ? 0 : 1 },
      groundColor: { value: new T.Color(kind === 'hero' ? 0xd1ba7c : 0xa77368) },
    };
    this.actorUniforms.set(sprite, actor);
    for (const material of [
      sprite.material,
      ...(sprite.edgeMaterial ? [sprite.edgeMaterial] : []),
    ]) {
      const previous = material.onBeforeCompile.bind(material),
        key = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        previous(shader, renderer);
        Object.assign(shader.uniforms, this.uniforms, actor);
        shader.vertexShader = 'varying vec3 vGroundWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvGroundWorld=(modelMatrix*vec4(transformed,1.0)).xyz;',
        );
        shader.fragmentShader =
          `varying vec3 vGroundWorld;
uniform sampler2D groundAtlas;
uniform vec2 groundRange;
uniform float groundWidth,groundHeight,groundFoot,groundOutline;
uniform vec3 groundRight,groundUp,groundColor;
` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphatest_fragment>',
          `
vec2 groundUV=vec2(dot(vGroundWorld,groundRight)/groundWidth+.5,.5-dot(vGroundWorld,groundUp)/groundHeight);
vec4 occlusion=texture2D(groundAtlas,groundUV);
float sceneryDepth=groundRange.x+(occlusion.r*255.0*256.0+occlusion.g*255.0)/65535.0*groundRange.y;
bool insideGround=all(greaterThanEqual(groundUV,vec2(0.0)))&&all(lessThanEqual(groundUV,vec2(1.0)));
if(insideGround&&occlusion.b>.1&&groundFoot<sceneryDepth-.001){
  if(groundOutline<.5||diffuseColor.a<.05)discard;
  float edgeAlpha=1.0;
  vec2 sx=dFdx(vMapUv)*1.5,sy=dFdy(vMapUv)*1.5;
  for(int i=0;i<4;i++){
    vec2 offset=i==0?sx:i==1?-sx:i==2?sy:-sy;
    float neighbor=texture2D(map,vMapUv+offset).a;
#ifdef HAS_WALK_BLEND
    if(walkEnabled>.5){
      vec2 saved=vWalkCanvas;
      neighbor=walkCompositeAt(saved+vec2(offset.x,-offset.y)).a;
    }
#endif
    edgeAlpha=min(edgeAlpha,neighbor);
  }
  if(edgeAlpha>.05)discard;
  diffuseColor=vec4(groundColor,1.0);
}
#include <alphatest_fragment>`,
        );
      };
      material.customProgramCacheKey = () => key + ':ground-occlusion-v1';
      material.needsUpdate = true;
    }
  }
  update(sprite: ActorSprite, x: number, z: number) {
    const uniforms = this.actorUniforms.get(sprite);
    if (uniforms) {
      uniforms.groundFoot.value = x * outward.x + z * outward.z;
      uniforms.groundOutline.value = this.outlines && !sprite.mesh.userData.groundDrop ? 1 : 0;
    }
  }
  dispose() {
    this.texture.dispose();
  }
}
