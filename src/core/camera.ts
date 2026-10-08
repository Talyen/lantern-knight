import { Matrix4, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import contract from '../content/camera.json';
import {heightAt,type AreaDefinition} from '../content/world';
export { contract };
export const HEADINGS = ['d00','d45','d90','d135','d180','d225','d270','d315'] as const;
export type Heading = typeof HEADINGS[number];
const a = contract.azimuthDeg * Math.PI / 180, e = contract.elevationDeg * Math.PI / 180;
export const outward = new Vector3(Math.sin(a)*Math.cos(e), Math.sin(e), Math.cos(a)*Math.cos(e));
export const right = new Vector3(Math.cos(a),0,-Math.sin(a));
export const up = new Vector3().crossVectors(outward,right);
export function makeCamera(aspect: number, target = new Vector3()) {
  const h = contract.verticalSpan / 2;
  const camera = new OrthographicCamera(-h*aspect,h*aspect,h,-h,0.1,100);
  camera.position.copy(target).addScaledVector(outward,30); camera.lookAt(target);
  camera.updateMatrixWorld(); return camera;
}
export function resizeCamera(camera: OrthographicCamera, width: number, height: number,span=contract.verticalSpan) {
  if(width<=0||height<=0||!Number.isFinite(width+height))return;
  const half = span / 2;
  camera.left = -half*width/height; camera.right = half*width/height;
  camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
}
export function drawingBufferSize(width:number,height:number,dpr:number,scale=contract.renderScale){
  if(!Number.isFinite(width+height+dpr+scale)||width<=0||height<=0||dpr<=0||scale<=0||scale>1)throw new Error('invalid drawing-buffer dimensions');
  // Fill physical display pixels where possible, with a bounded 1440p budget.
  // Apply the user's quality reduction after choosing the full-resolution ratio.
  const pixelRatio=Math.min(dpr,contract.pixelRatioCap,contract.baseline.width/width,contract.baseline.height/height);
  return {width:Math.max(1,Math.floor(width*pixelRatio*scale)),height:Math.max(1,Math.floor(height*pixelRatio*scale)),pixelRatio};
}
export function groundPoint(camera: OrthographicCamera, clientX: number, clientY: number, rect: Pick<DOMRect,'left'|'top'|'width'|'height'>) {
  if(rect.width<=0||rect.height<=0||!Number.isFinite(clientX+clientY))return null;
  const ray = new Raycaster(); ray.setFromCamera(new Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),camera);
  return ray.ray.intersectPlane(new Plane(new Vector3(0,1,0),0),new Vector3());
}
export function walkablePoint(camera:OrthographicCamera,clientX:number,clientY:number,rect:Pick<DOMRect,'left'|'top'|'width'|'height'>,area:AreaDefinition){
  if(rect.width<=0||rect.height<=0||!Number.isFinite(clientX+clientY))return null;
  const ray=new Raycaster();ray.setFromCamera(new Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),camera);
  let low=0,high=100;
  const distance=(t:number)=>{const x=ray.ray.origin.x+ray.ray.direction.x*t,z=ray.ray.origin.z+ray.ray.direction.z*t,y=ray.ray.origin.y+ray.ray.direction.y*t;return y-heightAt(area,x,z);};
  if(distance(low)<0||distance(high)>0)return null;
  for(let i=0;i<36;i++){const mid=(low+high)/2;if(distance(mid)>0)low=mid;else high=mid;}
  return ray.ray.at((low+high)/2,new Vector3());
}
export function selectDirection(yaw: number, previous?: Heading, hysteresis = 0.045): Heading {
  if (!Number.isFinite(yaw)) throw new Error('direction yaw must be finite');
  const tau=Math.PI*2, step=tau/8, angle=((yaw%tau)+tau)%tau;
  if (previous) { const p=HEADINGS.indexOf(previous)*step; const delta=Math.abs(Math.atan2(Math.sin(angle-p),Math.cos(angle-p))); if(delta<step/2+hysteresis) return previous; }
  return HEADINGS[Math.floor(angle/step+0.5+1e-12)%8]!; // ties go toward increasing heading
}
export function screenMovement(x: number, y: number, mode: 'screen-relative'|'world' = 'screen-relative') {
  const v=mode==='world'?new Vector3(x,0,-y):right.clone().multiplyScalar(x).add(new Vector3(-Math.sin(a),0,-Math.cos(a)).multiplyScalar(y));
  if(v.lengthSq()>1) v.normalize(); return {x:v.x,z:v.z};
}
export function trimmedBounds(canvas: {density:number;anchor:number[]}, trim: number[]) {
  const [x,y,w,h]=trim as [number,number,number,number], [ax,ay]=canvas.anchor as [number,number];
  return {left:(x-ax)/canvas.density,right:(x+w-ax)/canvas.density,top:(ay-y)/canvas.density,bottom:(ay-y-h)/canvas.density};
}
export function calibrationFixture() {
  const camera=makeCamera(16/9);
  return {contract,matrixLayout:'column-major',units:'world metres', right:right.toArray(),up:up.toArray(),outward:outward.toArray(),matrixWorld:camera.matrixWorld.toArray(),view:camera.matrixWorldInverse.toArray(),projection:camera.projectionMatrix.toArray(),headings:HEADINGS.map((id,i)=>{
    const yaw=i*Math.PI/4, v=new Vector3(Math.sin(yaw),0,Math.cos(yaw));
    return {id,yawDeg:i*45,screenVector:[v.dot(right),-v.dot(up)],facing:i===1?'toward camera':i===5?'away from camera':'oblique'};
  })};
}

export const AUTHORED_HEADINGS=['d00','d90','d180','d270'] as const;
export type AuthoredHeading=typeof AUTHORED_HEADINGS[number];
export function selectAuthoredDirection(yaw:number,previous?:Heading):AuthoredHeading {
  if(!Number.isFinite(yaw))throw new Error('direction yaw must be finite');
  const step=Math.PI/2,angle=((yaw%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  if(previous&&AUTHORED_HEADINGS.some(h=>h===previous)){const p=HEADINGS.indexOf(previous)*Math.PI/4;
    if(Math.abs(Math.atan2(Math.sin(angle-p),Math.cos(angle-p)))<step/2+.045)return previous as AuthoredHeading;}
  return AUTHORED_HEADINGS[Math.floor(angle/step+.5+1e-12)%4]!;
}
