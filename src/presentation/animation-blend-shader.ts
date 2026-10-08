import { Vector2, Vector4, type MeshBasicMaterial, type Texture } from 'three';
import type { Frame, Manifest } from '../assets/schema';
import type { FrameBlend } from '../core/animation-treatment';
import { registeredSword, rigidSwordGLSL } from './rigid-sword';
import type { PreparedRegistration } from '../assets/registration';
export type AnimationPair = PreparedRegistration['animation']['pairs'][number];
export type AnimationFlow = PreparedRegistration['animation'] & { texture: Texture };
export function registeredTrim(
  manifest: Manifest,
  frame: Frame,
  domain: { canvas: readonly number[]; anchor: readonly number[]; density: number },
  stabilized = true,
) {
  const r = frame.registration ?? manifest.asset,
    scale = domain.density / r.density,
    offset = stabilized ? (frame.visualOffsetPx ?? [0, 0]) : [0, 0];
  return [
    (frame.trim[0] - r.anchor[0] + offset[0]!) * scale + domain.anchor[0]!,
    (frame.trim[1] - r.anchor[1] + offset[1]!) * scale + domain.anchor[1]!,
    frame.trim[2] * scale,
    frame.trim[3] * scale,
  ] as const;
}

// One composited RGBA sample per fragment, shared by the cutout core/edge passes.
// Blend premultiplied linear color and alpha, then return straight alpha. Overlaying
// two transparent meshes instead would darken overlaps and change occlusion.
const fragment = `
varying vec2 vWalkCanvas;
uniform float walkEnabled;
uniform float walkMix;
uniform float walkWarp;
uniform sampler2D walkNext;
uniform sampler2D animationFlow;
uniform vec4 walkTrimA;
uniform vec4 walkTrimB;
uniform vec4 walkRectA;
uniform vec4 walkRectB;
uniform vec4 animationFlowRect;
uniform vec2 walkCanvasSize;
uniform float walkSwordEnabled,walkSwordWidth,walkSwordRotation;
uniform vec4 walkSwordA,walkSwordB;
${rigidSwordGLSL}
vec4 walkSample(sampler2D page,vec2 q,vec4 trim,vec4 rect){
  vec2 local=(q-trim.xy)/trim.zw;
  if(any(lessThan(local,vec2(0.0)))||any(greaterThan(local,vec2(1.0))))return vec4(0.0);
  vec2 uv=rect.xy+local*rect.zw;
  return texture2D(page,vec2(uv.x,1.0-uv.y));
}
vec4 walkDisplacement(vec2 q){
  vec2 uv=animationFlowRect.xy+clamp(q,0.0,1.0)*animationFlowRect.zw;
  return (texture2D(animationFlow,vec2(uv.x,1.0-uv.y))*255.0-128.0)*2.0/walkCanvasSize.xyxy;
}
vec4 walkComposite(){
  vec2 a=vWalkCanvas,b=vWalkCanvas;
  if(walkWarp>0.5){
    // Two inverse-map estimates keep both drawings registered to the same output.
    for(int i=0;i<2;i++){
      a=vWalkCanvas-walkMix*walkDisplacement(a).xy;
      b=vWalkCanvas-(1.0-walkMix)*walkDisplacement(b).zw;
    }
  }
  float blend=walkMix;
  if(walkSwordEnabled>.5){
    vec4 rigid=swordCoordinates(vWalkCanvas*walkCanvasSize,walkSwordA,walkSwordB,walkMix,walkSwordRotation);
    float protect=swordProtection(vec4(a,b)*walkCanvasSize.xyxy,rigid,walkSwordA,walkSwordB,walkSwordWidth);
    a=mix(a,rigid.xy/walkCanvasSize,protect);b=mix(b,rigid.zw/walkCanvasSize,protect);
    blend=mix(blend,step(.5,walkMix),protect);
  }
  vec4 ca=walkSample(map,a,walkTrimA,walkRectA),cb=walkSample(walkNext,b,walkTrimB,walkRectB);
  float alpha=mix(ca.a,cb.a,blend);
  vec3 premul=mix(ca.rgb*ca.a,cb.rgb*cb.a,blend);
  return vec4(alpha>0.00001?premul/alpha:vec3(0.0),alpha);
}
`;
export class AnimationBlendShader {
  uniforms = {
    walkEnabled: { value: 0 },
    walkMix: { value: 0 },
    walkWarp: { value: 0 },
    walkNext: { value: null as Texture | null },
    animationFlow: { value: null as Texture | null },
    walkTrimA: { value: new Vector4() },
    walkTrimB: { value: new Vector4() },
    walkRectA: { value: new Vector4() },
    walkRectB: { value: new Vector4() },
    animationFlowRect: { value: new Vector4() },
    walkCanvasSize: { value: new Vector2() },
    walkSwordEnabled: { value: 0 },
    walkSwordWidth: { value: 22 },
    walkSwordRotation: { value: 0 },
    walkSwordA: { value: new Vector4() },
    walkSwordB: { value: new Vector4() },
  };
  constructor(materials: MeshBasicMaterial[]) {
    materials.forEach((material, index) => {
      const previous = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey.bind(material);
      const cacheKey = previousKey();
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = 'varying vec2 vWalkCanvas;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\nvWalkCanvas=vec2(uv.x,1.0-uv.y);',
        );
        // map is declared by map_pars_fragment; helpers must follow that include.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_pars_fragment>',
          '#include <map_pars_fragment>\n' + fragment,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `if(walkEnabled>0.5){diffuseColor*=walkComposite();}else{\n#include <map_fragment>\n}`,
        );
      };
      material.customProgramCacheKey = () => `${cacheKey}:walk-blend-v3-${index}`;
      material.needsUpdate = true;
    });
  }
  update(
    sample: FrameBlend,
    manifest: Manifest,
    a: Frame,
    b: Frame,
    textures: Map<string, Texture>,
    flow?: AnimationFlow,
    stabilized = true,
    rigidSword = true,
  ) {
    const pair = flow?.pairs.find(
      (p) => p.asset === manifest.asset.id && p.from === a.id && p.to === b.id,
    );
    const domain = pair ?? a.registration ?? manifest.asset,
      u = this.uniforms,
      [width, height] = domain.canvas;
    u.walkEnabled.value = 1;
    u.walkMix.value = sample.mix;
    u.walkNext.value = textures.get(b.page)!;
    u.walkCanvasSize.value.set(width, height);
    for (const [frame, trim, rect] of [
      [a, u.walkTrimA, u.walkRectA],
      [b, u.walkTrimB, u.walkRectB],
    ] as const) {
      const page = manifest.pages.find((p) => p.id === frame.page)!;
      const t = registeredTrim(
        manifest,
        { ...frame, visualOffsetPx: flow?.offsets[frame.id] ?? frame.visualOffsetPx },
        domain,
        stabilized,
      );
      trim.value.set(t[0] / width, t[1] / height, t[2] / width, t[3] / height);
      rect.value.set(
        frame.rect[0] / page.width,
        frame.rect[1] / page.height,
        frame.rect[2] / page.width,
        frame.rect[3] / page.height,
      );
    }
    u.walkSwordEnabled.value = sample.guarded && rigidSword && pair?.sword ? 1 : 0;
    if (pair?.sword) {
      const sword = registeredSword(
        pair.sword,
        { ...a, visualOffsetPx: [...pair.offsetA] },
        { ...b, visualOffsetPx: [...pair.offsetB] },
        stabilized,
      );
      u.walkSwordA.value.fromArray(sword.a);
      u.walkSwordB.value.fromArray(sword.b);
      u.walkSwordWidth.value = sword.width;
      u.walkSwordRotation.value = sword.rotationRad;
    }
    u.walkWarp.value = pair ? 1 : 0;
    u.animationFlow.value = flow?.texture ?? textures.get(a.page)!;
    if (pair && flow) {
      const rect = sample.guarded
        ? stabilized
          ? pair.guardedRect
          : pair.rawGuardedRect
        : stabilized
          ? pair.rect
          : pair.rawRect;
      const [x, y, w, h] = rect as [number, number, number, number];
      // Sample pixel centres; gutters prevent adjacent pair contamination.
      u.animationFlowRect.value.set(
        (x + 0.5) / flow.width,
        (y + 0.5) / flow.height,
        (w - 1) / flow.width,
        (h - 1) / flow.height,
      );
    }
  }
}
