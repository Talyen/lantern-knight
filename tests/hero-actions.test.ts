import test from 'node:test';
import assert from 'node:assert/strict';
import {GameSession} from '../src/core/session';
import {Simulation} from '../src/core/simulation';
import {attackDefinition,tuning} from '../src/content/gameplay';
import {heroActionTiming,heroTimings} from '../src/content/hero-actions';
import {selectAuthoredDirection,AUTHORED_HEADINGS,makeCamera,trimmedBounds} from '../src/core/camera';
import {parseManifest,resolveClip} from '../src/assets/schema';
import {readAsset} from '../tools/assets/io';
import {ActorSprite} from '../src/presentation/sprite';
import {Texture,Vector3} from 'three';
const still={move:{x:0,z:0},aim:{x:1,z:0}};
function duel(){const s=new Simulation();s.actors=[s.hero,s.enemies[0]!];Object.assign(s.hero,{x:0,z:0});Object.assign(s.enemies[0]!,{x:1,z:0,health:100,stun:10000});return s;}
test('authored heading ties and hysteresis preserve action headings while aim changes',()=>{
 assert.equal(selectAuthoredDirection(Math.PI/4),'d90');assert.equal(selectAuthoredDirection(Math.PI/4-.01,'d90'),'d90');
 assert.equal(selectAuthoredDirection(-Math.PI/2),'d270');
 const s=duel();s.step({...still,attack:true});const heading=s.hero.actionHeading;
 for(let i=0;i<8;i++)s.step({...still,aim:{x:0,z:-2}});
 assert.equal(s.hero.actionHeading,heading);assert.equal(s.hero.yaw,Math.PI/2);
});
test('each authored attack heading damages only during its active phase and completes without chaining',()=>{
 for(const kind of ['sweep','lunge'] as const)for(const heading of AUTHORED_HEADINGS){
  const s=duel(),yaw=AUTHORED_HEADINGS.indexOf(heading)*Math.PI/2;
  Object.assign(s.enemies[0]!,{x:Math.sin(yaw),z:Math.cos(yaw)});s.hero.aim=yaw;s.startSword(s.hero,kind);
  const spec=attackDefinition(s.hero),hits:number[]=[];
  for(let i=0;i<spec.total;i++){s.step({move:{x:0,z:0},aim:{x:Math.sin(yaw),z:Math.cos(yaw)}});if(s.events.some(e=>e.kind==='damage'))hits.push(i);}
  assert.deepEqual(hits,[spec.windup]);assert.equal(s.hero.state,'idle');assert.equal(s.enemies[0]!.health,74);
  assert.equal(spec.total,Math.ceil(heroTimings[kind]![heading].holdsMs.reduce((a,b)=>a+b,0)*60/1000));
 }
 const narrow=duel();Object.assign(narrow.enemies[0]!,{x:Math.cos(.5),z:Math.sin(.5)});narrow.hero.aim=Math.PI/2;narrow.startSword(narrow.hero,'lunge');
 for(let i=0;i<54;i++)narrow.step(still);assert.equal(narrow.enemies[0]!.health,100);
});
test('alternation survives waiting, dodge and hurt; interruptions cannot complete or damage stale attacks',()=>{
 const s=duel();s.step({...still,attack:true});assert.equal(s.hero.nextAttack,'lunge');
 s.damage(s.enemies[0]!,s.hero,1);for(let i=0;i<100;i++)s.step(still);
 s.step({...still,dodge:true});for(let i=0;i<45;i++)s.step(still);
 s.step({...still,attack:true});assert.equal(s.hero.attackKind,'lunge');assert.equal(s.hero.nextAttack,'sweep');
 assert.equal(new Simulation().hero.nextAttack,'sweep');
 const session=new GameSession();session.sim.hero.nextAttack='lunge';session.sim.enemies.forEach(a=>a.health=0);session.sim.cleared=true;session.commitTransition(session.prepareTransition('landing'));assert.equal(session.sim.hero.nextAttack,'lunge');
});
test('dodge invulnerability and distance are confined to travel cels; lantern pulses once and death completes',()=>{
 const s=duel();s.enemies[0]!.x=5;s.step({...still,move:{x:1,z:0},dodge:true});
 const start=s.hero.x;for(let i=1;i<tuning.dodge.travelStart;i++)s.step(still);assert.equal(s.hero.x,start);
 s.hero.age=tuning.dodge.invulnerableStart;s.damage(s.enemies[0]!,s.hero,10);assert.equal(s.hero.health,100);
 for(let i=tuning.dodge.travelStart;i<tuning.dodge.total;i++)s.step(still);assert.ok(Math.abs(s.hero.x-start-2.1)<1e-9);
 s.start(s.hero,'dodge');s.hero.age=tuning.dodge.invulnerableEnd;s.damage(s.enemies[0]!,s.hero,10);assert.equal(s.hero.health,90);
 s.start(s.hero,'ability');let pulses=0;for(let i=0;i<73;i++){s.step(still);pulses+=s.events.filter(e=>e.kind==='flare').length;}assert.equal(pulses,1);assert.equal(s.hero.state,'idle');
 s.damage(s.enemies[0]!,s.hero,1000);for(let i=0;i<90;i++)assert.equal(s.step(still).reset,undefined);assert.equal(s.step(still).reset,'death');
 assert.equal(heroActionTiming('hit','d90').total,30);
});
test('current hero preserves mixed native registrations and resolves all headings without mirroring',async()=>{
 const m=parseManifest(JSON.parse(await readAsset('public/generated/ink/ink-hero-current/manifest.json','utf8')));
 assert.equal(m.asset.status,'proxy');assert.equal(m.asset.viewMode,'four-directional');
 assert.throws(()=>parseManifest(m,true),/production/);
 const clip=resolveClip(m,'sweep','d00'),frames=clip.frames.map(id=>m.frames.find(f=>f.id===id)!);
 assert.equal(frames[0]!.registration!.density,350);assert.equal(frames[1]!.registration!.density,243);
 const textures=new Map(m.pages.map(p=>[p.id,new Texture()]));const sprite=new ActorSprite('native-hero',m,textures,clip),camera=makeCamera(16/9),foot=new Vector3(1,.2,2);
 for(const frame of frames){sprite.show(frame.id,foot,camera);const b=trimmedBounds(frame.registration!,frame.trim),pos=sprite.geometry.getAttribute('position');assert.ok(Math.abs(pos.getX(0)-b.left)<1e-6);assert.ok(Math.abs(pos.getY(0)-b.top)<1e-6);assert.deepEqual(sprite.mesh.position,foot);}
 for(const [name,dirs]of Object.entries(m.asset.clips))for(const heading of AUTHORED_HEADINGS){const c=resolveClip(m,name,heading);assert.deepEqual(c.durationsMs,heroTimings[name]![heading].holdsMs);assert.ok(c.frames.every(id=>m.frames.some(f=>f.id===id)));assert.equal(c.loop,['ready','idle','walk'].includes(name));}
 sprite.dispose();
});
