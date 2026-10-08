import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {FrameScheduler} from '../src/frame-scheduler';
import {Application} from '../src/application';
import type {GamePresentation} from '../src/presentation/game-scene';
import type {Bridge} from '../src/core/save';
import {content} from '../src/content/world';

function environment(t:TestContext){
 const original={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 const win=new EventTarget(),doc=new EventTarget();let focused=true,hidden=false,now=0,id=0;const pending=new Map<number,FrameRequestCallback>();
 Object.assign(doc,{hasFocus:()=>focused});Object.defineProperty(doc,'hidden',{get:()=>hidden});
 globalThis.window=win as Window & typeof globalThis;globalThis.document=doc as Document;
 globalThis.requestAnimationFrame=callback=>{pending.set(++id,callback);return id;};globalThis.cancelAnimationFrame=id=>{pending.delete(id);};
 t.mock.timers.enable({apis:['setTimeout']});t.mock.method(performance,'now',()=>now);
 t.after(()=>{Object.assign(globalThis,original);});
 return {win,doc,get pending(){return pending.size;},raf(ms=16){now+=ms;const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(now));},time(ms:number){now+=ms;t.mock.timers.tick(ms);},blur(){focused=false;win.dispatchEvent(new Event('blur'));},focus(){focused=true;win.dispatchEvent(new Event('focus'));},hide(){hidden=true;doc.dispatchEvent(new Event('visibilitychange'));},show(){hidden=false;doc.dispatchEvent(new Event('visibilitychange'));}};
}

test('background cadence is bounded; focus resumes one loop and resets timing without catch-up',t=>{
 const e=environment(t);let last=0,draws=0;const deltas:number[]=[];
 const frames=new FrameScheduler(now=>{draws++;deltas.push(now-last);last=now;},()=>last=performance.now());
 e.raf();assert.deepEqual(deltas,[16]);e.blur();assert.equal(e.pending,0);
 e.time(999);assert.equal(draws,1);e.time(1);assert.equal(draws,2);e.hide();e.time(1000);assert.equal(draws,3);
 e.show();assert.equal(e.pending,0);e.focus();e.focus();assert.equal(e.pending,1);e.raf();assert.equal(deltas.at(-1),16);
 frames.dispose();frames.dispose();e.raf();e.time(5000);assert.equal(draws,4);assert.equal(e.pending,0);
});

test('automated hidden and unfocused runs retain frame cadence; focus changes during drawing cannot duplicate loops',t=>{
 const e=environment(t);e.blur();e.hide();let draws=0;
 const frames=new FrameScheduler(()=>{draws++;e.show();e.focus();},()=>{},true);
 e.raf();assert.equal(draws,1);assert.equal(e.pending,1);e.raf();assert.equal(draws,2);frames.dispose();
 const normal=new FrameScheduler(()=>{e.blur();e.focus();},()=>{});e.raf();assert.equal(e.pending,1);normal.dispose();
});

test('background Application redraws cannot advance simulation, settings or checkpoints after an explicit unpause',t=>{
 const e=environment(t);let saves=0,frames=0;const elapsed:number[]=[];
 const bridge={saveGame:async()=>{saves++;},saveSettings:async()=>{saves++;}} as unknown as Bridge;
 const app=new Application({dataset:{}} as HTMLCanvasElement,content,{},bridge,()=>({}) as GamePresentation,{status:()=>{},pause:()=>{},frame:()=>frames++});
 app.presentation={mode:'encounter',update:(_sim:unknown,_alpha:number,ms:number)=>elapsed.push(ms),dispose:()=>{}} as unknown as GamePresentation;
 app.input={clear:()=>{},dispose:()=>{},consume:()=>{throw new Error('background consumed gameplay input');}} as unknown as Application['input'];
 const before=app.session.captureSave(),tick=app.sim.tick;
 // Exercise the real Application frame body with the same scheduler used at boot.
 const loop=(app as unknown as {loop:(now:number)=>void}).loop;
 const scheduler=new FrameScheduler(loop,()=>{},false);(app as unknown as {frames:FrameScheduler}).frames=scheduler;
 // Native forwarding can emit blur while the DOM focus query remains true.
 e.win.dispatchEvent(new Event('blur'));app.pause(false);assert.equal(document.hasFocus(),true);assert.equal(e.pending,0);e.time(1000);e.time(1000);
 assert.equal(frames,2);assert.deepEqual(elapsed,[0,0]);assert.equal(app.sim.tick,tick);assert.deepEqual(app.session.captureSave(),before);assert.equal(saves,0);
 scheduler.dispose();app.dispose();
});
