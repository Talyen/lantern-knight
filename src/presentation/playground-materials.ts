import * as T from 'three';
import type { OutlineSettings } from '../content/effects-playground';
import { puddleGLSL } from './playground-surfaces';
import { normalPixels } from './lighting-profiles';

/** Matching authored color/height patterns; ink brightness is never interpreted as geometry. */
export function sampleMaterial(kind: 'stone' | 'wood') {
  const size = 512,
    stone = kind === 'stone',
    rgba = new Uint8Array(size * size * 4),
    heights = new Uint8Array(size * size * 4),
    height = new Uint8Array(size * size),
    base: readonly [number, number, number] = stone ? [0.39, 0.43, 0.4] : [0.31, 0.23, 0.16];
  for (let y = 0; y < size; y++) {
    const v = y / size,
      row = Math.floor(v * 4),
      rowPhase = row * 0.9,
      rowShift = stone ? (row % 2) * 0.5 : 0,
      b = (v * 4) % 1,
      stoneWave = y * 0.18,
      woodWave = v * 130;
    for (let x = 0; x < size; x++) {
      const u = x / size,
        iu = Math.floor(u * 4),
        a = (u * 4 + rowShift) % 1;
      const edge = stone ? Math.min(a, 1 - a, b, 1 - b) : Math.min(a, 1 - a),
        joint = edge < 0.025;
      const value = joint ? 0.16 : 0.68 + 0.06 * Math.sin(iu * 1.8 + rowPhase);
      const h = Math.round((joint ? 0.12 : Math.min(1, value + Math.min(0.2, edge * 2))) * 255),
        i = y * size + x,
        p = i * 4;
      height[i] = h;
      heights[p] = heights[p + 1] = heights[p + 2] = h;
      heights[p + 3] = 255;
      const grain = stone
        ? 0.025 * Math.sin(x * 0.21 + stoneWave)
        : 0.05 * Math.sin(woodWave + Math.sin(u * 23) * 2);
      for (let c = 0; c < 3; c++)
        rgba[p + c] = Math.round(255 * Math.max(0, base[c]! * (joint ? 0.3 : 1) + grain));
      rgba[p + 3] = 255;
    }
  }
  const color = new T.DataTexture(rgba, size, size, T.RGBAFormat),
    normal = new T.DataTexture(normalPixels(height, size, size, 12), size, size, T.RGBAFormat);
  const relief = new T.DataTexture(heights, size, size, T.RGBAFormat);
  color.colorSpace = T.SRGBColorSpace;
  for (const t of [color, normal, relief]) {
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = t.minFilter = T.LinearFilter;
    t.needsUpdate = true;
  }
  const uniforms = {
    labTime: new T.Uniform(0),
    labWet: new T.Uniform(0),
    labRain: new T.Uniform(0),
    labRelief: new T.Uniform(0),
    labHeight: new T.Uniform(relief),
    labView: new T.Uniform(new T.Vector3()),
    labLights: new T.Uniform(Array.from({ length: 3 }, () => new T.Vector3())),
    labPower: new T.Uniform([0, 0, 0]),
    labImpactCount: new T.Uniform(0),
    labImpacts: new T.Uniform(Array.from({ length: 32 }, () => new T.Vector3())),
  };
  const material = new T.MeshStandardMaterial({
    map: color,
    normalMap: normal,
    normalScale: new T.Vector2(0, 0),
    roughness: 1,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 labWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nlabWorld=(modelMatrix*vec4(transformed,1.)).xyz;',
    );
    shader.fragmentShader =
      `varying vec3 labWorld;uniform float labTime,labWet,labRain,labRelief;uniform sampler2D labHeight;uniform vec3 labView,labLights[3];uniform float labPower[3];uniform int labImpactCount;uniform vec3 labImpacts[32];
   ${puddleGLSL()}
  ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
   vec2 labUV=vMapUv;float labPuddle=ponds(labWorld.xz)*${kind === 'wood' ? '0.' : '1.'},labDamp=labWet*${kind === 'wood' ? '.10' : '(.18+.22*labPuddle)'};
   vec2 offset=vec2(labView.x,-labView.z)/max(.35,labView.y)*labRelief*.012;
   labUV-=offset*(texture2D(labHeight,labUV).r-.5);labUV-=offset*(texture2D(labHeight,labUV).r-.5)*.5;
   diffuseColor*=texture2D(map,labUV);diffuseColor.rgb*=1.-labDamp*.30;
  `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.84,labDamp);roughnessFactor=mix(roughnessFactor,.24,labPuddle*labWet);',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'texture2D( normalMap, vNormalMapUv )',
      'texture2D( normalMap, labUV )',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
   vec2 ripple=vec2(0.);for(int i=0;i<32;i++){if(i>=labImpactCount)break;vec2 d=labWorld.xz-labImpacts[i].xy;float r=length(d),age=labImpacts[i].z;float ring=exp(-pow((r-age*.7)*22.,2.))*sin(r*45.-age*15.)*exp(-age*3.);ripple+=normalize(d+vec2(.0001))*ring*.014;}
   normal=normalize(normal+mat3(viewMatrix)*vec3(ripple.x,0.,ripple.y)*labWet*labRain*labPuddle);
  `,
    );
  };
  material.customProgramCacheKey = () => `playground-material-${kind}-v1`;
  return { material, uniforms, textures: [color, normal, relief] };
}

export class SilhouetteOutline {
  readonly mesh: T.Mesh;
  private material: T.ShaderMaterial;
  private positionsVersion = -1;
  private pad = -1;
  constructor(readonly source: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>) {
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        map: { value: null },
        rect: { value: new T.Vector4() },
        center: { value: new T.Vector2() },
        pad: { value: 0 },
        uvPad: { value: new T.Vector2() },
        depthSlope: { value: 0 },
        tint: { value: new T.Color(0x242424) },
        opacity: { value: 0.25 },
        style: { value: 0 },
        inset: { value: 0 },
      },
      vertexShader:
        'varying vec2 vUV;uniform vec2 center,uvPad;uniform float pad,depthSlope,inset;void main(){vec2 side=sign(position.xy-center);vec3 p=position;p.xy+=side*pad*(1.-inset);p.z+=side.y*pad*depthSlope*(1.-inset);vUV=uv+side*uvPad*(1.-inset);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader: `varying vec2 vUV;uniform sampler2D map;uniform vec4 rect;uniform vec2 uvPad;uniform vec3 tint;uniform float opacity,style,inset;
    float a(vec2 p){if(any(lessThan(p,rect.xy))||any(greaterThan(p,rect.zw)))return 0.;return texture2D(map,p).a;}
    // Sample outer dilation and inner erosion independently; mixing before the
    // neighborhood maxima would leave a faint seam at the original alpha edge.
    vec2 coverage(vec2 offset){
      float outer=a(vUV+offset*(1.-inset));
      float inner=1.-a(vUV+offset*inset);
      return vec2(outer,inner);
    }
    float stroke(vec2 coverage){float alpha=a(vUV);return dot(coverage,vec2(1.-alpha,alpha));}
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
    void main(){
      // Object-local coordinates keep grain attached to the drawing, not the screen.
      vec2 paper=(vUV-rect.xy)/uvPad*4.;
      float radius=1.;
      if(style>3.5&&style<4.5)radius=.5+.5*noise(paper*.12);
      vec2 edge=vec2(0.),inner=vec2(0.),middle=vec2(0.),outerInner=vec2(0.);
      float lit=0.;
      for(int i=0;i<16;i++){
        float angle=float(i)*6.2831853/16.;
        vec2 direction=vec2(cos(angle),sin(angle));
        vec2 neighbor=coverage(direction*uvPad*radius);
        inner=max(inner,coverage(direction*uvPad*.25));
        middle=max(middle,coverage(direction*uvPad*.5));
        outerInner=max(outerInner,coverage(direction*uvPad*.75));
        edge=max(edge,neighbor);
        lit=max(lit,stroke(neighbor)*max(0.,dot(direction,normalize(vec2(1.,-1.)))));
      }
      if(style>3.5&&style<4.5)edge=max(edge,inner);
      else edge=max(edge,max(inner,max(middle,outerInner)));
      float alpha=stroke(edge);
      vec3 color=tint;
      if(style>.5&&style<1.5)alpha=stroke(max(inner,max(vec2(0.),edge-outerInner)));
      if(style>1.5&&style<2.5){color=mix(vec3(.003),tint,smoothstep(.1,.8,lit));alpha*=mix(.3,1.,lit);}
      if(style>2.5&&style<3.5){
        float bristles=noise(vec2(paper.x*.18,paper.y*.5));
        alpha*=smoothstep(.32,.65,bristles)*mix(.5,1.,hash(floor(paper)));
      }
      if(style>4.5)alpha=stroke(inner*.4+middle*.32+edge*.28)*mix(.3,1.,noise(paper*.8));
      if(alpha<.01)discard;
      gl_FragColor=vec4(color,alpha*opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    });
    this.mesh = new T.Mesh(source.geometry, this.material);
    this.mesh.frustumCulled = false;
  }
  update(worldPad: number, settings: OutlineSettings, insetPx = 0) {
    const pad = worldPad / Math.abs(this.source.scale.x);
    const positions = this.source.geometry.getAttribute('position');
    const depthSlope =
      (positions.getZ(0) - positions.getZ(2)) / (positions.getY(0) - positions.getY(2));
    const u = this.material.uniforms;
    u.opacity!.value = settings.opacity * this.source.material.opacity;
    u.tint!.value.set(settings.color);
    u.style!.value = { solid: 0, double: 1, rim: 2, brush: 3, hand: 4, charcoal: 5 }[
      settings.style
    ];
    u.map!.value = this.source.material.map;
    u.depthSlope!.value = depthSlope;
    u.inset!.value = Math.max(0, Math.min(1, insetPx / settings.thickness));
    const pos = this.source.geometry.getAttribute('position') as T.BufferAttribute;
    if (this.positionsVersion !== pos.version || this.pad !== pad) {
      this.positionsVersion = pos.version;
      this.pad = pad;
      const uv = this.source.geometry.getAttribute('uv'),
        left = pos.getX(0),
        right = pos.getX(1),
        top = pos.getY(0),
        bottom = pos.getY(2),
        minU = uv.getX(0),
        maxU = uv.getX(1),
        minV = uv.getY(2),
        maxV = uv.getY(0);
      u.map!.value = this.source.material.map;
      u.center!.value.set((left + right) / 2, (top + bottom) / 2);
      u.pad!.value = pad;
      u.rect!.value.set(minU, minV, maxU, maxV);
      u.uvPad!.value.set(
        (pad * (maxU - minU)) / (right - left),
        (pad * (maxV - minV)) / (top - bottom),
      );
    }
    this.mesh.position.copy(this.source.position);
    this.mesh.quaternion.copy(this.source.quaternion);
    this.mesh.scale.copy(this.source.scale);
  }
  dispose() {
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
