import * as T from 'three';
import {heightAt,type AreaDefinition} from '../content/world';
const fragment=`
uniform float mistTime,mistOpacity;uniform vec3 mistColor,mistOrigin;
varying vec3 mistWorld;varying vec2 mistUV;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
float field(vec2 p){return noise(p)*.57+noise(p*2.03+7.1)*.29+noise(p*4.07-3.2)*.14;}
void main(){
 vec2 drift=vec2(-.12,.05)*mistTime;
 vec2 q=mistWorld.xz*vec2(.38,.65)+drift;
 float bend=field(q*.6+vec2(.025,-.04)*mistTime);
 float wisps=smoothstep(.49,.72,field(q+vec2(bend*1.8,bend*.4)));
 float edge=smoothstep(0.,.17,mistUV.x)*smoothstep(0.,.17,1.-mistUV.x)*smoothstep(0.,.25,mistUV.y)*smoothstep(0.,.25,1.-mistUV.y);
 float quietCenter=smoothstep(2.5,6.5,length((mistWorld-mistOrigin).xz));
 float alpha=wisps*edge*quietCenter*mistOpacity;
 if(alpha<.001)discard;
 gl_FragColor=vec4(mistColor,alpha);
 #include <colorspace_fragment>
}`;
// Broken, world-anchored ribbons. Noise advects through them rather than moving
// a large radial texture with the camera or laying a uniform film over actors.
export class GroundMist {
 readonly group=new T.Group();
 private uniforms={mistTime:{value:0},mistOpacity:{value:.08},mistColor:{value:new T.Color()},mistOrigin:{value:new T.Vector3()}};
 private material=new T.ShaderMaterial({uniforms:this.uniforms,transparent:true,depthTest:true,depthWrite:false,side:T.DoubleSide,vertexShader:'varying vec3 mistWorld;varying vec2 mistUV;void main(){mistUV=uv;vec4 world=modelMatrix*vec4(position,1.);mistWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}',fragmentShader:fragment});
 constructor(){for(const [x,z]of [[-7,-1],[7,-3],[0,-11],[0,11]]){const geometry=new T.PlaneGeometry(14,5,14,5);geometry.rotateX(-Math.PI/2);const mesh=new T.Mesh(geometry,this.material);mesh.position.set(x!,0,z!);this.group.add(mesh);}}
 setArea(area:AreaDefinition){for(const mesh of this.group.children as T.Mesh<T.PlaneGeometry>[]){const positions=mesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)positions.setY(i,heightAt(area,mesh.position.x+positions.getX(i),mesh.position.z+positions.getZ(i))+.14);positions.needsUpdate=true;mesh.geometry.computeBoundingSphere();}}
 update(time:number,color:number,opacity:number,origin:T.Vector3){this.uniforms.mistTime.value=time;this.uniforms.mistColor.value.set(color);this.uniforms.mistOpacity.value=opacity;this.uniforms.mistOrigin.value.copy(origin);}
 dispose(){for(const mesh of this.group.children as T.Mesh[])mesh.geometry.dispose();this.material.dispose();this.group.removeFromParent();}
}
