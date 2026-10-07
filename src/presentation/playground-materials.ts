import * as T from 'three';
import {puddleGLSL} from './playground-surfaces';
import {normalPixels} from './lighting-profiles';

/** Matching authored color/height patterns; ink brightness is never interpreted as geometry. */
export function sampleMaterial(kind:'stone'|'wood'){
 const size=512,rgba=new Uint8Array(size*size*4),height=new Uint8Array(size*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size,row=Math.floor(v*4),a=(u*4+(kind==='stone'?(row%2)*.5:0))%1,b=v*4%1;
  const edge=Math.min(a,1-a,kind==='stone'?b:1,kind==='stone'?1-b:1),joint=edge<.025;
  const value=joint?.16:.68+.06*Math.sin(Math.floor(u*4)*1.8+row*.9);
  height[y*size+x]=Math.round((joint?.12:Math.min(1,value+Math.min(.2,edge*2)))*255);
  const texture=kind==='wood'?.05*Math.sin(v*130+Math.sin(u*23)*2):.025*Math.sin(x*.21+y*.18);
  const color=kind==='stone'?[.39,.43,.40]:[.31,.23,.16],p=(y*size+x)*4;
  for(let c=0;c<3;c++)rgba[p+c]=Math.round(255*Math.max(0,color[c]!*(joint?.3:1)+texture));rgba[p+3]=255;
 }
 const color=new T.DataTexture(rgba,size,size,T.RGBAFormat),normal=new T.DataTexture(normalPixels(height,size,size,12),size,size,T.RGBAFormat);
 const heights=new Uint8Array(size*size*4);for(let i=0;i<height.length;i++){heights[i*4]=heights[i*4+1]=heights[i*4+2]=height[i]!;heights[i*4+3]=255;}
 const relief=new T.DataTexture(heights,size,size,T.RGBAFormat);color.colorSpace=T.SRGBColorSpace;
 for(const t of [color,normal,relief]){t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=t.minFilter=T.LinearFilter;t.needsUpdate=true;}
 const uniforms={labTime:new T.Uniform(0),labWet:new T.Uniform(0),labRain:new T.Uniform(0),labRelief:new T.Uniform(0),labHeight:new T.Uniform(relief),labView:new T.Uniform(new T.Vector3()),labLights:new T.Uniform(Array.from({length:3},()=>new T.Vector3())),labPower:new T.Uniform([0,0,0]),labImpactCount:new T.Uniform(0),labImpacts:new T.Uniform(Array.from({length:32},()=>new T.Vector3()))};
 const material=new T.MeshStandardMaterial({map:color,normalMap:normal,normalScale:new T.Vector2(0,0),roughness:1});
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);shader.vertexShader='varying vec3 labWorld;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nlabWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=`varying vec3 labWorld;uniform float labTime,labWet,labRain,labRelief;uniform sampler2D labHeight;uniform vec3 labView,labLights[3];uniform float labPower[3];uniform int labImpactCount;uniform vec3 labImpacts[32];
   ${puddleGLSL()}
  `+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
   vec2 labUV=vMapUv;float labPuddle=ponds(labWorld.xz)*${kind==='wood'?'0.':'1.'},labDamp=labWet*${kind==='wood'?'.10':'(.18+.22*labPuddle)'};
   vec2 offset=vec2(labView.x,-labView.z)/max(.35,labView.y)*labRelief*.012;
   labUV-=offset*(texture2D(labHeight,labUV).r-.5);labUV-=offset*(texture2D(labHeight,labUV).r-.5)*.5;
   diffuseColor*=texture2D(map,labUV);diffuseColor.rgb*=1.-labDamp*.30;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.84,labDamp);roughnessFactor=mix(roughnessFactor,.24,labPuddle*labWet);');
  shader.fragmentShader=shader.fragmentShader.replace('texture2D( normalMap, vNormalMapUv )','texture2D( normalMap, labUV )');
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   vec2 ripple=vec2(0.);for(int i=0;i<32;i++){if(i>=labImpactCount)break;vec2 d=labWorld.xz-labImpacts[i].xy;float r=length(d),age=labImpacts[i].z;float ring=exp(-pow((r-age*.7)*22.,2.))*sin(r*45.-age*15.)*exp(-age*3.);ripple+=normalize(d+vec2(.0001))*ring*.014;}
   normal=normalize(normal+mat3(viewMatrix)*vec3(ripple.x,0.,ripple.y)*labWet*labRain*labPuddle);
  `);

 };
 material.customProgramCacheKey=()=>`playground-material-${kind}-v1`;
 return {material,uniforms,textures:[color,normal,relief]};
}

export class SilhouetteOutline {
 readonly mesh:T.Mesh;private material:T.ShaderMaterial;
 constructor(readonly source:T.Mesh<T.PlaneGeometry,T.MeshBasicMaterial>){
  this.material=new T.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,uniforms:{map:{value:null},rect:{value:new T.Vector4()},center:{value:new T.Vector2()},pad:{value:0},uvPad:{value:new T.Vector2()},depthSlope:{value:0},tint:{value:new T.Color(0x29343b)},opacity:{value:.25}},
   vertexShader:'varying vec2 vUV;uniform vec2 center,uvPad;uniform float pad,depthSlope;void main(){vec2 side=sign(position.xy-center);vec3 p=position;p.xy+=side*pad;p.z+=side.y*pad*depthSlope;vUV=uv+side*uvPad;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
   fragmentShader:`varying vec2 vUV;uniform sampler2D map;uniform vec4 rect;uniform vec2 uvPad;uniform vec3 tint;uniform float opacity;
    float a(vec2 p){if(any(lessThan(p,rect.xy))||any(greaterThan(p,rect.zw)))return 0.;return texture2D(map,p).a;}
    void main(){float edge=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)edge=max(edge,a(vUV+vec2(float(x),float(y))*uvPad));float alpha=edge*(1.-a(vUV));if(alpha<.01)discard;gl_FragColor=vec4(tint,alpha*opacity);}`});
  this.mesh=new T.Mesh(source.geometry,this.material);this.mesh.frustumCulled=false;
 }
 update(pad:number,depthSlope:number,opacity=.25,color='#29343b'){this.material.uniforms.opacity!.value=opacity*this.source.material.opacity;this.material.uniforms.tint!.value.set(color);const pos=this.source.geometry.getAttribute('position'),uv=this.source.geometry.getAttribute('uv'),u=this.material.uniforms;
  const left=pos.getX(0),right=pos.getX(1),top=pos.getY(0),bottom=pos.getY(2),minU=uv.getX(0),maxU=uv.getX(1),minV=uv.getY(2),maxV=uv.getY(0);
  u.map!.value=this.source.material.map;u.center!.value.set((left+right)/2,(top+bottom)/2);u.pad!.value=pad;u.depthSlope!.value=depthSlope;
  u.rect!.value.set(minU,minV,maxU,maxV);u.uvPad!.value.set(pad*(maxU-minU)/(right-left),pad*(maxV-minV)/(top-bottom));
  this.mesh.position.copy(this.source.position);this.mesh.quaternion.copy(this.source.quaternion);this.mesh.scale.copy(this.source.scale);
 }
 dispose(){this.material.dispose();this.mesh.removeFromParent();}
}
