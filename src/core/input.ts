import type {Command} from './simulation';
import {groundPoint,screenMovement} from './camera';
import type {OrthographicCamera} from 'three';
export class Input {
  keys=new Set<string>();edges={attack:false,dodge:false,ability:false};pointer={x:0,y:0};cleanups:(()=>void)[]=[];
  constructor(public canvas:HTMLCanvasElement,public camera:OrthographicCamera,public pause:()=>void){
    const on=<K extends keyof WindowEventMap>(type:K,fn:(event:WindowEventMap[K])=>void)=>{window.addEventListener(type,fn);this.cleanups.push(()=>window.removeEventListener(type,fn));};
    on('keydown',e=>{if((e.target as HTMLElement).matches('input,select,textarea'))return;this.keys.add(e.code);if(e.code==='ShiftLeft'||e.code==='ShiftRight')this.edges.dodge=!e.repeat;if(e.code==='Escape'&&!e.repeat)this.pause();});
    on('keyup',e=>this.keys.delete(e.code));on('blur',()=>this.clear());
    on('pointermove',e=>{this.pointer={x:e.clientX,y:e.clientY};});
    const down=(e:PointerEvent)=>{if(e.button===0)this.edges.attack=true;if(e.button===2)this.edges.ability=true;};
    canvas.addEventListener('pointerdown',down);this.cleanups.push(()=>canvas.removeEventListener('pointerdown',down));
    const context=(e:Event)=>e.preventDefault();canvas.addEventListener('contextmenu',context);this.cleanups.push(()=>canvas.removeEventListener('contextmenu',context));
  }
  consume():Command{const p=groundPoint(this.camera,this.pointer.x,this.pointer.y,this.canvas.getBoundingClientRect());const cmd={move:screenMovement(Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA')),Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS'))),aim:p?{x:p.x,z:p.z}:{x:0,z:1},...this.edges};this.edges={attack:false,dodge:false,ability:false};return cmd;}
  clear(){this.keys.clear();this.edges={attack:false,dodge:false,ability:false};}
  dispose(){this.cleanups.forEach(f=>f());this.clear();}
}
