import * as T from 'three';
import type {PackLease} from '../assets/loader';
import {chapelLayout,burialTerraces,retainingStones,gatewayLayout} from '../content/graveyard-layout';
import {graveyardGroundMaterial} from './graveyard-ground';
import {LocalReveal} from './scenery-reveal';
import {right,up,outward,contract} from '../core/camera';
import type {Simulation} from '../core/simulation';
export class ChurchyardArchitecture {
 readonly parts:T.Mesh[]=[];private reveals:LocalReveal[]=[];private owned:{dispose:()=>void}[]=[];
 constructor(private packs:Map<string,PackLease>,private group:T.Group){}
 private map(id:string,frameId?:string){const p=this.packs.get(id)!;const f=frameId?p.manifest.frames.find(f=>f.id===frameId)!:p.manifest.frames[0]!;return {texture:p.textures.get(f.page)!,frame:f,page:p.manifest.pages.find(v=>v.id===f.page)!};}
 private material(tint:number,id='ink-masonry',repeat=true){const {texture}=this.map(id);const t=texture.clone();if(repeat){t.wrapS=t.wrapT=T.RepeatWrapping;t.generateMipmaps=true;t.minFilter=T.LinearMipmapLinearFilter;t.anisotropy=8;}t.needsUpdate=true;const m=new T.MeshBasicMaterial({map:t,color:tint,toneMapped:false});this.owned.push(t,m);return m;}
 private part(id:string,g:T.BufferGeometry,m:T.MeshBasicMaterial,position:T.Vector3,role='architecture'){const local=id.startsWith('gateway-');if(local){m=m.clone();this.owned.push(m);}const o=new T.Mesh(g,m);o.position.copy(position);o.userData.id=id;o.userData.surfaceRole=role;o.userData.ownsCastShadow=true;o.castShadow=role!=='ground';this.group.add(o);this.parts.push(o);this.owned.push(g);if(local)this.reveals.push(new LocalReveal(o,[m]));return o;}
 private box(id:string,w:number,h:number,d:number,x:number,y:number,z:number,m:T.MeshBasicMaterial){const g=new T.BoxGeometry(w,h,d),uv=g.getAttribute('uv'),dimensions=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let i=0;i<uv.count;i++){const [a,b]=dimensions[Math.floor(i/4)]!;uv.setXY(i,uv.getX(i)*a!/2.4,uv.getY(i)*b!/1.25);}
  return this.part(id,g,m,new T.Vector3(x,y+h/2,z));
 }
 build(){const c=chapelLayout,stone=this.material(0x969d93),cap=this.material(0xb9bdac),dark=this.material(0x606f67),roof=this.material(0xc0cbd2,'ink-churchyard-roof');
  const foundationDepth=c.frontZ-c.rearZ+.35;
  this.box('chapel-foundation',c.width+.4,c.foundationHeight,foundationDepth,0,0,c.frontZ-foundationDepth/2,stone);
  this.box('chapel-east-wall',.35,c.wallHeight,5.755,3.05,.3,-9.0475,stone);
  this.box('chapel-west-wall',.35,c.wallHeight,5.755,-3.05,.3,-9.0475,dark);
  this.box('chapel-rear-wall',6.45,c.wallHeight,.35,0,.3,c.rearZ,stone);
  const {texture,frame,page}=this.map('ink-chapel-front');const front=new T.MeshBasicMaterial({map:texture,alphaTest:.4,side:T.DoubleSide,color:0xcbd0c2,toneMapped:false});this.owned.push(front);
  front.onBeforeCompile=s=>{s.vertexShader='varying vec2 chapelFace;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nchapelFace=position.xy;');s.fragmentShader='varying vec2 chapelFace;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(abs(chapelFace.x)<.65&&chapelFace.y<2.49-abs(chapelFace.x)*.53)discard;');};front.customProgramCacheKey=()=> 'blackwood-chapel-front-v2';
  const fg=new T.PlaneGeometry(c.width,c.facadeHeight);fg.translate(0,c.facadeHeight/2,0);const uv=fg.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,(frame.rect[0]+uv.getX(i)*frame.rect[2])/page.width,1-(frame.rect[1]+(1-uv.getY(i))*frame.rect[3])/page.height);this.part('chapel-front',fg,front,new T.Vector3(0,.3,c.frontZ));
  // Back the ornamental painted facade with a continuous wall and gable. Its
  // transparent ivy silhouette must not leave an open triangular void under the roof.
  const backing=stone.clone();backing.onBeforeCompile=front.onBeforeCompile;backing.customProgramCacheKey=()=> 'blackwood-facade-backing-v1';this.owned.push(backing);
  const faceBody=new T.PlaneGeometry(c.width,c.wallHeight);faceBody.translate(0,c.wallHeight/2,0);const bodyUV=faceBody.getAttribute('uv');for(let i=0;i<bodyUV.count;i++)bodyUV.setXY(i,bodyUV.getX(i)*c.width/2.4,bodyUV.getY(i)*c.wallHeight/1.25);this.part('chapel-front-body',faceBody,backing,new T.Vector3(0,.3,c.frontZ-.025));
  const gable=new T.BufferGeometry();gable.setAttribute('position',new T.Float32BufferAttribute([-3.2,c.wallHeight,0,3.2,c.wallHeight,0,0,c.ridgeHeight,0],3));gable.setAttribute('uv',new T.Float32BufferAttribute([0,0,2.66,0,1.33,1.28],2));gable.setIndex([0,1,2]);gable.computeVertexNormals();this.part('chapel-front-gable',gable,stone,new T.Vector3(0,.3,c.frontZ-.025));
  const doorMat=new T.MeshBasicMaterial({map:texture,color:0xb9b6a2,alphaTest:.5,toneMapped:false});this.owned.push(doorMat);const doorGeo=new T.PlaneGeometry(1.38,2.51);doorGeo.translate(0,1.255,0);const duv=doorGeo.getAttribute('uv');for(let i=0;i<duv.count;i++){const x=.5+(duv.getX(i)-.5)*1.38/c.width,y=duv.getY(i)*2.51/c.facadeHeight;duv.setXY(i,(frame.rect[0]+x*frame.rect[2])/page.width,1-(frame.rect[1]+(1-y)*frame.rect[3])/page.height);}this.part('chapel-recessed-door',doorGeo,doorMat,new T.Vector3(0,.3,c.frontZ-.28));
  for(const x of [-.71,.71])this.box(`door-return-${x}`, .16,2.45,.28,x,.3,c.frontZ-.155,dark);
  this.box('porch-first-tread',3,.15,.3,0,0,-5.25,cap);this.box('porch-second-tread',3,.3,.3,0,0,-5.55,cap);this.box('porch-landing',3,.3,.45,0,0,-5.925,cap);
  // The eastern rear roof has one designed wound; the front and ridge remain continuous.
  for(const side of [-1,1]){
   const contour=side===1?[[0,c.roofFrontZ],[1,c.roofFrontZ],[1,c.roofBreakZ-.35],[.76,c.roofBreakZ-.15],[.67,c.roofBreakZ-.9],[.43,c.roofBreakZ-.65],[.40,c.roofRearZ],[0,c.roofRearZ]]:[[0,c.roofFrontZ],[1,c.roofFrontZ],[1,c.roofRearZ],[0,c.roofRearZ]];
   const points=contour.map(([u,z])=>new T.Vector2(u!,z!)),triangles=T.ShapeUtils.triangulateShape(points,[]),positions=contour.flatMap(([u,z])=>[side*c.roofHalfWidth*u!,c.foundationHeight+c.ridgeHeight+(c.wallHeight-c.ridgeHeight)*u!,z!]);
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(contour.flatMap(([u,z])=>[u!*1.6,(c.roofFrontZ-z!)/2.4]),2));g.setIndex(triangles.flatMap(([a,b,c])=>side===1?[a!,c!,b!]:[a!,b!,c!]));g.computeVertexNormals();
   const mesh=this.part(`chapel-roof-${side}`,g,roof,new T.Vector3());mesh.material.side=T.DoubleSide;
   // A thin painted fascia backs every cut edge, including the irregular wound.
   const edges:number[]=[];
   for(let i=0;i<contour.length;i++){const j=(i+1)%contour.length,a=positions.slice(i*3,i*3+3),b=positions.slice(j*3,j*3+3);if(a[0]===0&&b[0]===0)continue;edges.push(...a,...b,a[0]!,a[1]!-.12,a[2]!,...b,b[0]!,b[1]!-.12,b[2]!,a[0]!,a[1]!-.12,a[2]!);}
   const fascia=new T.BufferGeometry();fascia.setAttribute('position',new T.Float32BufferAttribute(edges,3));fascia.setAttribute('uv',new T.Float32BufferAttribute(edges.flatMap((_,i)=>i%3===0?[edges[i]!/2.4,edges[i+1]!/1.25]:[]),2));fascia.computeVertexNormals();const edgeMaterial=dark.clone();edgeMaterial.side=T.DoubleSide;this.owned.push(edgeMaterial);this.part(`chapel-roof-edge-${side}`,fascia,edgeMaterial,new T.Vector3());
  }
  const rearGable=new T.BufferGeometry();rearGable.setAttribute('position',new T.Float32BufferAttribute([-3.05,3.4,c.rearZ,3.05,3.4,c.rearZ,0,5.0,c.rearZ],3));rearGable.setAttribute('uv',new T.Float32BufferAttribute([0,0,2.54,0,1.27,1.28],2));rearGable.setIndex([0,2,1]);rearGable.computeVertexNormals();this.part('chapel-rear-gable',rearGable,dark,new T.Vector3());
  for(const x of [-3.25,3.25])for(const z of [-6.1,-8.9,-11.8])this.box(`chapel-buttress-${x}-${z}`, .5,3.25,.5,x,.3,z,cap);
  // A damaged open belfry occupies the back roof rather than a second floating chapel image.
  this.box('belfry-base',1.6,.9,1.5,1.2,4.05,-10.1,stone);for(const x of [.6,1.8])for(const z of [-10.7,-9.6])this.box(`belfry-pier-${x}-${z}`,.23,1.25,.23,x,4.95,z,cap);this.box('belfry-lintel',.92,.24,.3,.86,6.18,-9.6,cap);this.box('belfry-broken-cap',.35,.20,.35,.6,6.18,-10.7,stone);
  const bell=new T.Mesh(new T.CylinderGeometry(.18,.32,.42,12,1,true),new T.MeshBasicMaterial({color:0x776b4d,toneMapped:false}));bell.position.set(1.2,5.55,-10.1);this.group.add(bell);this.parts.push(bell);this.owned.push(bell.geometry,bell.material);
  for(const t of burialTerraces){const shape=new T.Shape();t.points.forEach((p,i)=>i?shape.lineTo(p.x,-p.z):shape.moveTo(p.x,-p.z));shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth:t.height,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.07,bevelThickness:.04});g.rotateX(-Math.PI/2);const topMat=graveyardGroundMaterial(this.packs);topMat.depthWrite=true;this.owned.push(topMat);const mesh=this.part(`terrain-${t.id}`,g,topMat,new T.Vector3(0,-.04,0),'ground');mesh.renderOrder=-1.8;
  }
  for(const w of retainingStones){const x=(w.from.x+w.to.x)/2,z=(w.from.z+w.to.z)/2,block=this.box(w.id,Math.hypot(w.to.x-w.from.x,w.to.z-w.from.z),w.height,w.thickness,x,0,z,stone);block.rotation.y=-Math.atan2(w.to.z-w.from.z,w.to.x-w.from.x);}
  // A low broken arch frames the maintained lamp rather than competing with the chapel.
  const gate=gatewayLayout;
  this.box('gateway-left-pier',gate.pierWidth,gate.leftHeight,gate.pierDepth,gate.x-gate.halfGap,0,gate.z,stone);
  this.box('gateway-right-pier',gate.pierWidth,gate.rightHeight,gate.pierDepth,gate.x+gate.halfGap,0,gate.z,stone);
  const arch=new T.Shape();arch.moveTo(-1.42,1.36);arch.quadraticCurveTo(-.9,2.62,0,2.65);arch.quadraticCurveTo(.65,2.56,.98,1.96);arch.lineTo(.71,1.97);arch.quadraticCurveTo(.45,2.32,0,2.33);arch.quadraticCurveTo(-.74,2.27,-1.12,1.36);arch.closePath();const ag=new T.ExtrudeGeometry(arch,{depth:gate.archDepth,bevelEnabled:false});this.part('gateway-broken-arch',ag,cap,new T.Vector3(gate.x,0,gate.z-gate.archDepth));
  for(let i=0;i<3;i++){const b=this.box(`gateway-west-return-${i}`,.56,.42-i*.1,.4,gate.x-gate.halfGap-.7-i*.6,0,gate.z-.1-i*.12,stone);b.rotation.y=-.2;}
  for(let i=0;i<3;i++)this.box(`gateway-east-rubble-${i}`,.55,.16+i%2*.07,.4,gate.x+gate.halfGap+.65+i*.65,0,gate.z+.08+i*.13,stone);
 }
 update(sim:Simulation,alpha:number,ms:number){
  const ray=new T.Raycaster(),actors=[sim.hero,...sim.enemies.filter(a=>a.health>0)];
  for(const reveal of this.reveals){reveal.mesh.updateMatrixWorld(true);reveal.update(actors.map(a=>{const root=new T.Vector3(a.px+(a.x-a.px)*alpha,a.y,a.pz+(a.z-a.pz)*alpha),h=(a.kind==='hero'?contract.heroHeight:1.7)*Math.cos(contract.elevationDeg*Math.PI/180);
   const obscures=[.12,.45,.85].some(v=>{ray.set(root.clone().addScaledVector(up,h*v),outward);ray.near=.01;ray.far=12;return ray.intersectObject(reveal.mesh,false).length>0;});
   return {center:new T.Vector2(root.dot(right),root.dot(up)+h*.5),size:new T.Vector2(.62,h*.68),obscures};}),ms);}
 }
 dispose(){for(const o of this.owned)o.dispose();for(const m of this.parts)m.removeFromParent();this.owned=[];this.parts.length=0;}
}
