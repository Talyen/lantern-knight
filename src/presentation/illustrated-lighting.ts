import { registeredTrim } from './animation-blend-shader';
import { NormalLibrary } from './normal-library';
import * as T from 'three';
export function neutralColor(color: T.Color) {
  const v = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  return color.setRGB(v, v, v);
}
import { right, up, outward } from './camera';
import { PAINTED_HEIGHT_RANGE } from '../content/ground-interaction';
import { SCENE_SHADE_CAPACITY } from '../content/world-visuals';
import { cameraContract as contract } from '../assets/camera-contract';
import type { ActorSprite } from './sprite';
import { registeredSword, rigidSwordGLSL } from './rigid-sword';
import { silhouetteMatrix } from './silhouette-pose';
import type { GroundOcclusion } from './ground-occlusion';
import {
  lightingRigs,
  lookPresets,
  cameraKeyDirection,
  type LookSettings,
} from './lighting-profiles';
const localShadowShader = `
${Array.from({ length: 5 }, (_, i) => `uniform samplerCubeShadow inkLocalShadowMap${i};`).join('\n')}
float inkLocalVisibility(int i,vec3 receiver,vec3 normal){
 if(inkLocalShadowEnabled[i]<.5)return 1.0;
 // Offset toward the light-facing side of thin surfaces. A depth-only bias
 // leaves grazing painted leaves comparing against their own raster texels.
 receiver+=normal*(dot(inkLightPosition[i]-receiver,normal)<0.0?-.035:.035);
 vec3 delta=receiver-inkLightPosition[i];
 float d=max(max(abs(delta.x),abs(delta.y)),abs(delta.z)),near=.05,far=inkLocalShadowFar[i];
 if(d<=near||d>=far)return 1.0;
 float biased=max(near,d-.025);float depth=far*(biased-near)/(biased*(far-near));
 vec4 samplePoint=vec4(normalize(delta),depth);
 ${Array.from({ length: 5 }, (_, i) => `if(i==${i})return texture(inkLocalShadowMap${i},samplePoint);`).join('\n')}
 return 1.0;
}
`;
const shader = `
${rigidSwordGLSL}
varying vec3 inkWorld,inkShadowWorld; varying vec3 inkSurface; varying vec2 inkUV;
uniform float inkEnabled,inkStrength,inkAmbient,inkMinimumLight,inkKeyStrength,inkRim,inkHaze,inkIsGround,inkEmissive,inkHasNormal,inkBlend,inkWarp,inkMix,inkMirror,inkFootY,inkBodyHeight,inkShadowEnabled,inkIsSprite,inkIsProp;
uniform vec3 inkFootPosition;uniform vec4 inkShadeZones[${SCENE_SHADE_CAPACITY}];
uniform vec3 inkSky,inkGround,inkKey,inkDirection,inkFog,inkOrigin;
uniform vec3 inkLightPosition[5]; uniform vec3 inkLightColor[5]; uniform float inkLightPower[5],inkLightRange[5];
uniform float inkLocalShadowEnabled[5],inkLocalShadowFar[5];
uniform sampler2D inkNormalA,inkNormalB,inkFlow;
uniform vec4 inkEnvironmentColor;uniform float inkHasEnvironment,inkGroundBounce,inkPaintedValues,inkCohesionEligible;
uniform vec4 inkTrimA,inkTrimB,inkRectA,inkFlowRect;
uniform vec2 inkCanvas;
uniform float inkSwordEnabled,inkSwordWidth,inkSwordRotation;uniform vec4 inkSwordA,inkSwordB;
uniform sampler2DShadow inkShadowMap; uniform mat4 inkShadowMatrix;
uniform sampler2D inkPaintedMask;uniform vec2 inkPaintedSize,inkPaintedRange;uniform float inkHasPaintedMask;
vec4 inkPaintedSample(){
 if(inkIsGround<.5||inkHasPaintedMask<.5)return vec4(0.0);
 vec2 uv=vec2(dot(inkWorld,vec3(${right.x},${right.y},${right.z}))/inkPaintedSize.x+.5,.5-dot(inkWorld,vec3(${up.x},${up.y},${up.z}))/inkPaintedSize.y);
 vec2 stepUV=max(1.0/vec2(textureSize(inkPaintedMask,0)),fwidth(uv)*.5);
 if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return vec4(0.0);
 vec4 center=texture2D(inkPaintedMask,uv);
 if(center.b>.1)return center;
 // Native contour holes smaller than a screen pixel must not alternate
 // ground and upright illumination inside a painted leaf or stone.
 float covered=0.0;vec4 nearest=center;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec4 candidate=texture2D(inkPaintedMask,uv+vec2(float(x),float(y))*stepUV);
  if(candidate.b>.9){covered+=1.0;if(candidate.r*256.0+candidate.g>nearest.r*256.0+nearest.g)nearest=candidate;}
 }
 return covered>=5.0?nearest:center;
}
vec3 inkReceiverPoint(vec4 painted){
 if(painted.b<.1)return inkShadowWorld;
 vec3 ray=vec3(${outward.x},${outward.y},${outward.z});
 float depth=inkPaintedRange.x+(painted.r*255.0*256.0+painted.g*255.0)/65535.0*inkPaintedRange.y;
 vec3 base=inkWorld-ray*(inkWorld.y/ray.y);
 float lift=max(0.0,(depth-dot(base.xz,ray.xz))/dot(ray.xz,ray.xz));
 if(painted.a>0.0)lift=min(lift,painted.a*${PAINTED_HEIGHT_RANGE.toFixed(1)}/ray.y);
 return base+ray*lift;
}
LOCAL_SHADOW_FUNCTION
float inkVisibility(vec3 receiver){
 if(inkShadowEnabled<.5)return 1.0;
 vec4 q=inkShadowMatrix*vec4(receiver+inkDirection*.035,1.0);q.xyz/=q.w;
 if(any(lessThan(q.xyz,vec3(0.0)))||any(greaterThan(q.xyz,vec3(1.0))))return 1.0;
 float result=0.0;
 for(int i=0;i<4;i++){vec2 offset=vec2(float(i%2)*2.0-1.0,float(i/2)*2.0-1.0)*.001;result+=texture(inkShadowMap,vec3(q.xy+offset,q.z-.0012));}
 return result*.25;
}
vec4 inkMotion(vec2 q){vec2 uv=inkFlowRect.xy+clamp(q,0.0,1.0)*inkFlowRect.zw;return (texture2D(inkFlow,vec2(uv.x,1.0-uv.y))*255.0-128.0)*2.0/inkCanvas.xyxy;}
vec3 inkSampleNormal(sampler2D image,vec2 q,vec4 trim){vec2 p=(q-trim.xy)/trim.zw;if(any(lessThan(p,vec2(0.0)))||any(greaterThan(p,vec2(1.0))))return vec3(0.0,0.0,1.0);return normalize(texture2D(image,vec2(p.x,1.0-p.y)).rgb*2.0-1.0);}
vec3 inkNormal(){
 if(inkHasNormal<.5)return normalize(inkSurface);
 vec3 n;
 if(inkBlend>.5){vec2 a=vec2(inkUV.x,1.0-inkUV.y),b=a;if(inkWarp>.5){for(int i=0;i<2;i++){a=vec2(inkUV.x,1.0-inkUV.y)-inkMix*inkMotion(a).xy;b=vec2(inkUV.x,1.0-inkUV.y)-(1.0-inkMix)*inkMotion(b).zw;}}
  float blend=inkMix;
  if(inkSwordEnabled>.5){vec4 rigid=swordCoordinates(vec2(inkUV.x,1.0-inkUV.y)*inkCanvas,inkSwordA,inkSwordB,inkMix,inkSwordRotation);float protect=swordProtection(vec4(a,b)*inkCanvas.xyxy,rigid,inkSwordA,inkSwordB,inkSwordWidth);a=mix(a,rigid.xy/inkCanvas,protect);b=mix(b,rigid.zw/inkCanvas,protect);blend=mix(blend,step(.5,inkMix),protect);}
  n=normalize(mix(inkSampleNormal(inkNormalA,a,inkTrimA),inkSampleNormal(inkNormalB,b,inkTrimB),blend));
 }else{vec2 q=(inkUV-inkRectA.xy)/inkRectA.zw;n=normalize(texture2D(inkNormalA,q).rgb*2.0-1.0);}
 n.x*=inkMirror;return normalize(vec3(${right.x},${right.y},${right.z})*n.x+vec3(${up.x},${up.y},${up.z})*n.y+vec3(${outward.x},${outward.y},${outward.z})*n.z);
}
float inkShade(){
 if(inkIsGround>.5)return 1.0;
 vec2 point=inkIsSprite>.5?inkFootPosition.xz:inkWorld.xz;float shade=0.0;
 for(int i=0;i<${SCENE_SHADE_CAPACITY};i++){vec4 zone=inkShadeZones[i];float radius=max(.001,zone.z);shade=max(shade,zone.w*(1.0-smoothstep(radius*.55,radius,length(point-zone.xy))));}
 return 1.0-shade;
}
vec3 inkIlluminate(vec3 base){
 if(inkEmissive>.5)return inkEnabled<.5?base:base*2.8;
 vec4 painted=inkPaintedSample();vec3 receiver=inkReceiverPoint(painted);
 // Painted depth boundaries can slope across the image. Use the physical
 // receiver plane for shadow bias rather than the stylized lighting normal.
 vec3 receiverNormal=cross(dFdx(receiver),dFdy(receiver));
 receiverNormal=dot(receiverNormal,receiverNormal)>1e-12?normalize(receiverNormal):normalize(inkSurface);
 if(inkEnabled<.5)return base*(.7+.3*inkVisibility(receiver));
 if(inkCohesionEligible>.5&&inkPaintedValues>.5){
  float value=dot(base,vec3(.2126,.7152,.0722));
  // A gentle value grouping preserves black ink, hue and alpha silhouettes.
  base*=1.0-.08*smoothstep(.12,.8,value);
  base=mix(vec3(dot(base,vec3(.2126,.7152,.0722))),base,.96);
 }
 vec3 n=painted.b>.1?normalize(vec3(${outward.x},0.0,${outward.z})):inkNormal();float skyWeight=(inkIsGround>.5||inkIsProp>.5)?.85:clamp(.30+.45*(inkWorld.y-inkFootY)/inkBodyHeight+n.y*.15,0.0,1.0);
 vec3 illumination=mix(inkGround,inkSky,skyWeight)*inkAmbient;
 float key=max(0.0,dot(n,inkDirection))*inkVisibility(receiver);illumination+=inkKey*(.16+key*.84)*inkKeyStrength;
 // Broad silhouettes supply stylized relief; texture luminance is never treated as height.
 vec3 local=vec3(0.0);
 for(int i=0;i<5;i++){vec3 delta=inkLightPosition[i]-receiver;float d=length(delta);float falloff=pow(max(0.0,1.0-d/max(.1,inkLightRange[i])),2.0);local+=inkLightColor[i]*inkLightPower[i]*falloff*(.35+.65*max(0.0,dot(n,normalize(delta+vec3(.0001)))))*inkLocalVisibility(i,receiver,receiverNormal);}
 illumination*=inkShade();
 if(inkCohesionEligible>.5&&inkGroundBounce>.5&&inkHasEnvironment>.5){
  float lower=1.0-smoothstep(.0,.75,max(0.0,inkWorld.y-inkFootY)/inkBodyHeight);
  vec3 bounce=mix(vec3(1.0),inkEnvironmentColor.rgb*2.0,inkEnvironmentColor.a*(.22+.38*lower));
  illumination*=bounce;local*=mix(vec3(1.0),bounce,.45);
 }
 float value=dot(base,vec3(.2126,.7152,.0722)),inkProtection=smoothstep(.006,.13,value);
 vec3 response=max(vec3(.08),mix(vec3(1.0),clamp(illumination+local,vec3(inkMinimumLight),vec3(2.5)),inkStrength));
 vec3 result=base*response;
 float edge=pow(1.0-max(0.0,dot(n,vec3(${outward.x},${outward.y},${outward.z}))),2.0);
 float harmonize=inkCohesionEligible*inkPaintedValues;
 result*=1.0-.12*edge*harmonize*inkProtection;
 result+=(inkKey*key*edge*inkRim+local*.09)*inkProtection*inkStrength*(1.0-inkIsGround)*(1.0-harmonize*.7);
 float distanceFog=smoothstep(7.0,29.0,length((inkWorld-inkOrigin).xz))*inkHaze;
 return min(mix(result,inkFog*.45,distanceFog),vec3(.98));
}
`;
export class IllustratedLighting {
  readonly localShadowMaps = Array.from({ length: 5 }, () => ({ value: null as T.Texture | null }));
  private paintedFallback = new T.DataTexture(new Uint8Array(4), 1, 1);
  readonly normals: NormalLibrary;
  constructor(request?: typeof fetch) {
    this.normals = new NormalLibrary(request);
    this.paintedFallback.needsUpdate = true;
  }
  readonly common = {
    inkPaintedMask: { value: this.paintedFallback as T.Texture },
    inkHasEnvironment: { value: 0 },
    inkGroundBounce: { value: 0 },
    inkPaintedValues: { value: 0 },
    inkPaintedSize: { value: new T.Vector2(1, 1) },
    inkPaintedRange: { value: new T.Vector2(0, 1) },
    inkHasPaintedMask: { value: 0 },
    inkLocalShadowMap0: this.localShadowMaps[0]!,
    inkLocalShadowMap1: this.localShadowMaps[1]!,
    inkLocalShadowMap2: this.localShadowMaps[2]!,
    inkLocalShadowMap3: this.localShadowMaps[3]!,
    inkLocalShadowMap4: this.localShadowMaps[4]!,
    inkLocalShadowEnabled: { value: [0, 0, 0, 0, 0] },
    inkLocalShadowFar: { value: [10, 10, 10, 10, 10] },
    inkShadeZones: { value: Array.from({ length: SCENE_SHADE_CAPACITY }, () => new T.Vector4()) },
    inkShadowEnabled: { value: 0 },
    inkShadowMap: { value: null as T.DepthTexture | null },
    inkShadowMatrix: { value: new T.Matrix4() },
    inkEnabled: { value: 0 },
    inkStrength: { value: 1 },
    inkAmbient: { value: 1 },
    inkMinimumLight: { value: 0.28 },
    inkKeyStrength: { value: 1 },
    inkRim: { value: 0 },
    inkHaze: { value: 0 },
    inkSky: { value: new T.Color() },
    inkGround: { value: new T.Color() },
    inkKey: { value: new T.Color() },
    inkDirection: { value: new T.Vector3() },
    inkFog: { value: new T.Color() },
    inkOrigin: { value: new T.Vector3() },
    inkLightPosition: { value: Array.from({ length: 5 }, () => new T.Vector3()) },
    inkLightColor: { value: Array.from({ length: 5 }, () => new T.Color(0xffc68a)) },
    inkLightRange: { value: [4.8, 4.8, 4.8, 4.8, 7] },
    inkLightPower: { value: [0, 0, 0, 0, 0] },
  };
  private attached = new WeakMap<
    T.MeshBasicMaterial,
    ReturnType<IllustratedLighting['uniformsFor']>
  >();
  private uniformsFor(ground: boolean, emissive: boolean) {
    return {
      ...this.common,
      inkCasterTransform: { value: new T.Matrix4() },
      inkIsGround: { value: ground ? 1 : 0 },
      inkEmissive: { value: emissive ? 1 : 0 },
      inkFootY: { value: 0 },
      inkIsSprite: { value: 0 },
      inkIsProp: { value: 0 },
      inkCohesionEligible: { value: 0 },
      inkEnvironmentColor: { value: new T.Vector4(0.5, 0.5, 0.5, 0) },
      inkFootPosition: { value: new T.Vector3() },
      inkBodyHeight: { value: 1 },
      inkHasNormal: { value: 0 },
      inkMirror: { value: 1 },
      inkBlend: { value: 0 },
      inkWarp: { value: 0 },
      inkMix: { value: 0 },
      inkNormalA: { value: null as T.Texture | null },
      inkNormalB: { value: null as T.Texture | null },
      inkFlow: { value: null as T.Texture | null },
      inkTrimA: { value: new T.Vector4() },
      inkTrimB: { value: new T.Vector4() },
      inkRectA: { value: new T.Vector4() },
      inkFlowRect: { value: new T.Vector4() },
      inkCanvas: { value: new T.Vector2(1, 1) },
      inkSwordEnabled: { value: 0 },
      inkSwordWidth: { value: 22 },
      inkSwordRotation: { value: 0 },
      inkSwordA: { value: new T.Vector4() },
      inkSwordB: { value: new T.Vector4() },
    };
  }
  attach(material: T.MeshBasicMaterial, ground = false, emissive = false) {
    const held = this.attached.get(material);
    if (held) return held;
    const uniforms = this.uniformsFor(ground, emissive);
    const previous = material.onBeforeCompile.bind(material),
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (program, renderer) => {
      previous.call(material, program, renderer);
      Object.assign(program.uniforms, uniforms);
      program.vertexShader =
        'varying vec3 inkWorld,inkShadowWorld; varying vec3 inkSurface; varying vec2 inkUV; uniform mat4 inkCasterTransform; uniform float inkIsSprite;\n' +
        program.vertexShader;
      program.vertexShader = program.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\ninkWorld=(modelMatrix*vec4(transformed,1.0)).xyz;inkShadowWorld=inkIsSprite>.5?(inkCasterTransform*vec4(transformed,1.0)).xyz:inkWorld;inkSurface=normalize(mat3(modelMatrix)*normal);inkUV=uv;\n#ifdef HAS_SPRITE_OUTLINE\ninkUV=vMapUv;\n#endif\n',
      );
      program.fragmentShader =
        shader.replace(
          'LOCAL_SHADOW_FUNCTION',
          this.localShadowMaps[0]!.value
            ? localShadowShader
            : 'float inkLocalVisibility(int i,vec3 receiver,vec3 normal){return 1.0;}',
        ) + program.fragmentShader;
      program.fragmentShader = program.fragmentShader.replace(
        '#include <opaque_fragment>',
        `outgoingLight=inkIlluminate(outgoingLight);
#include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () =>
      `${key}:illustrated-lighting-v7:${!!this.localShadowMaps[0]!.value}`;
    material.needsUpdate = true;
    this.attached.set(material, uniforms);
    return uniforms;
  }
  sprite(sprite: ActorSprite, environmentColor?: T.Vector4) {
    const sample = sprite.lightingSample;
    if (!sample) return;
    for (const material of [sprite.material, sprite.edgeMaterial])
      if (material) {
        const u = this.attach(material, false, !!sprite.mesh.userData.emissive),
          a = this.normals.get(sprite),
          b = sample.next ? this.normals.get(sprite, sample.next) : a;
        u.inkFootY.value = sprite.mesh.position.y;
        if (environmentColor) u.inkEnvironmentColor.value.copy(environmentColor);
        else u.inkEnvironmentColor.value.set(0.5, 0.5, 0.5, 0);
        u.inkIsSprite.value = 1;
        // Illustrated props already contain their own top/side value structure.
        // Match the painting's ambient exposure; normals still shape local lights.
        u.inkIsProp.value =
          sprite.manifest.asset.type === 'prop' && sprite.manifest.asset.placement !== 'ground'
            ? 1
            : 0;
        u.inkCohesionEligible.value =
          sprite.mesh.renderOrder > -1.7 &&
          (sprite.manifest.asset.type === 'character' ||
            (sprite.manifest.asset.type === 'prop' && sprite.manifest.asset.placement !== 'ground'))
            ? 1
            : 0;
        u.inkFootPosition.value.copy(sprite.mesh.position);
        silhouetteMatrix(sprite, u.inkCasterTransform.value);
        u.inkBodyHeight.value = Math.max(
          0.1,
          (sample.frame.trim[3] / (sample.frame.registration ?? sprite.manifest.asset).density) *
            Math.abs(sprite.mesh.scale.y),
        );
        u.inkMirror.value = sprite.mesh.scale.x < 0 ? -1 : 1;
        u.inkHasNormal.value = a ? 1 : 0;
        const frame = sample.frame,
          page = sprite.manifest.pages.find((p) => p.id === frame.page)!,
          [x, y, w, h] = frame.rect;
        u.inkRectA.value.set(
          x / page.width,
          1 - (y + h) / page.height,
          w / page.width,
          h / page.height,
        );
        if (!a) continue;
        u.inkNormalA.value = a;
        u.inkNormalB.value = b ?? a;
        const pair = sample.blend?.motion
          ? sample.flow?.pairs.find(
              (p) =>
                p.asset === sprite.manifest.asset.id &&
                p.from === frame.id &&
                p.to === sample.next?.id,
            )
          : undefined;
        const domain = pair ?? frame.registration ?? sprite.manifest.asset,
          [cw, ch] = domain.canvas;
        u.inkCanvas.value.set(cw, ch);
        u.inkBlend.value = sample.blend ? 1 : 0;
        u.inkMix.value = sample.blend?.mix ?? 0;
        for (const [f, target] of [
          [frame, u.inkTrimA],
          [sample.next ?? frame, u.inkTrimB],
        ] as const) {
          const t = registeredTrim(sprite.manifest, f, domain, sprite.stabilized);
          target.value.set(t[0] / cw, t[1] / ch, t[2] / cw, t[3] / ch);
        }
        u.inkSwordEnabled.value = sample.blend?.guarded && sprite.rigidSword && pair?.sword ? 1 : 0;
        if (pair?.sword) {
          const sword = registeredSword(
            pair.sword,
            { ...frame, visualOffsetPx: [...pair.offsetA] },
            { ...(sample.next ?? frame), visualOffsetPx: [...pair.offsetB] },
            sprite.stabilized,
          );
          u.inkSwordA.value.fromArray(sword.a);
          u.inkSwordB.value.fromArray(sword.b);
          u.inkSwordWidth.value = sword.width;
          u.inkSwordRotation.value = sword.rotationRad;
        }
        u.inkWarp.value = pair ? 1 : 0;
        u.inkFlow.value = sample.flow?.texture ?? a;
        if (pair && sample.flow) {
          const [px, py, pw, ph] = (
            sample.blend!.guarded
              ? sprite.stabilized
                ? pair.guardedRect
                : pair.rawGuardedRect
              : sprite.stabilized
                ? pair.rect
                : pair.rawRect
          ) as [number, number, number, number];
          u.inkFlowRect.value.set(
            (px + 0.5) / sample.flow.width,
            (py + 0.5) / sample.flow.height,
            (pw - 1) / sample.flow.width,
            (ph - 1) / sample.flow.height,
          );
        }
      }
  }
  configure(settings: LookSettings, origin: T.Vector3, interior = false) {
    const rig = lightingRigs[settings.rig],
      look = lookPresets[settings.look],
      u = this.common;
    u.inkEnabled.value = !settings.baseline && settings.lighting ? 1 : 0;
    u.inkStrength.value = settings.strength;
    u.inkGroundBounce.value = settings.groundBounce ? 1 : 0;
    u.inkPaintedValues.value = settings.paintedValues ? 1 : 0;
    for (const [i, target] of u.inkShadeZones.value.entries()) {
      const zone = settings.shadeZones?.[i];
      target.set(zone?.x ?? 0, zone?.z ?? 0, zone?.radius ?? 0, zone?.strength ?? 0);
    }
    u.inkSky.value.set(rig.sky);
    u.inkGround.value.set(rig.ground);
    u.inkKey.value.set(rig.key);
    u.inkFog.value.set(rig.fog);
    u.inkDirection.value.fromArray(
      settings.sun
        ? cameraKeyDirection(settings.sun.azimuthDeg, settings.sun.elevationDeg, 0)
        : cameraKeyDirection(contract.azimuthDeg, rig.elevation, rig.side),
    );
    u.inkOrigin.value.copy(origin);
    u.inkAmbient.value = rig.ambient * (settings.look === 'cinematic' ? 0.8 : 1);
    u.inkMinimumLight.value = rig.minimumLight;
    u.inkKeyStrength.value = rig.keyStrength;
    u.inkRim.value = look.rim;
    u.inkHaze.value = settings.atmosphere ? look.haze * 0.5 : 0;
    if (interior) {
      u.inkAmbient.value *= 1.08;
      u.inkKeyStrength.value *= 0.18;
      u.inkKey.value.set(0xb8cbdc);
      u.inkSky.value.set(0xc3d2dc);
      u.inkGround.value.set(0x9eafb9);
      u.inkHaze.value = 0;
    }
  }
  setGroundOcclusion(
    ground: GroundOcclusion | undefined,
    floor: { width: number; depth: number } | undefined,
  ) {
    this.common.inkPaintedMask.value = ground?.texture ?? this.paintedFallback;
    this.common.inkHasPaintedMask.value = ground && floor ? 1 : 0;
    this.common.inkPaintedRange.value.copy(ground?.range ?? new T.Vector2(0, 1));
    this.common.inkPaintedSize.value.set(floor?.width ?? 1, floor?.depth ?? 1);
  }
  setEnvironment(available = false) {
    this.common.inkHasEnvironment.value = available ? 1 : 0;
  }
  neutralPalette() {
    const u = this.common;
    for (const c of [
      u.inkSky.value,
      u.inkGround.value,
      u.inkKey.value,
      u.inkFog.value,
      ...u.inkLightColor.value,
    ])
      neutralColor(c);
  }
  restoreLightColors() {
    for (const c of this.common.inkLightColor.value) c.set(0xffc68a);
  }
  dispose() {
    this.paintedFallback.dispose();
    this.normals.dispose();
  }
}
