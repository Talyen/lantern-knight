import {tuning,props} from '../content/gameplay';
export type State='idle'|'walk'|'attack'|'dodge'|'ability'|'hurt'|'death';
export type Actor={id:number;kind:'hero'|'enemy';x:number;z:number;px:number;pz:number;yaw:number;aim:number;state:State;age:number;action:number;health:number;cooldown:number;dodgeCooldown:number;stun:number;hitIds:number[]};
export type Command={move:{x:number;z:number};aim:{x:number;z:number};attack?:boolean;dodge?:boolean;ability?:boolean};
export type SimEvent={tick:number;actor:number;kind:'damage'|'swing'|'flare'|'death';target?:number};
const idleCommand:Command={move:{x:0,z:0},aim:{x:0,z:1}};
export class Simulation {
  tick=0;seed:number;actors:Actor[]=[];events:SimEvent[]=[];cleared=false;
  constructor(seed=142){this.seed=seed;this.actors.push(this.create(1,'hero',0,2.3));for(let i=0;i<3;i++)this.actors.push(this.create(i+2,'enemy',-2.5+i*2.7,-3.5+this.random()));}
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  create(id:number,kind:Actor['kind'],x:number,z:number):Actor{return{id,kind,x,z,px:x,pz:z,yaw:Math.PI/4,aim:Math.PI/4,state:'idle',age:0,action:0,health:kind==='hero'?tuning.heroMaxHealth:tuning.enemy.maxHealth,cooldown:0,dodgeCooldown:0,stun:0,hitIds:[]};}
  get hero(){return this.actors[0]!;}
  start(a:Actor,state:State,yaw=a.aim){a.state=state;a.age=0;a.action++;a.yaw=yaw;a.hitIds=[];}
  move(a:Actor,x:number,z:number){
    const h=tuning.room.halfSize-.3;a.x=Math.max(-h,Math.min(h,a.x+x));a.z=Math.max(-h,Math.min(h,a.z+z));
    for(const p of props){let dx=a.x-p.x,dz=a.z-p.z,dist=Math.hypot(dx,dz),r=p.radius+tuning.heroRadius;if(dist<r){if(dist<.0001){dx=1;dz=0;dist=1;}a.x=p.x+dx/dist*r;a.z=p.z+dz/dist*r;}}
  }
  damage(from:Actor,to:Actor,amount:number){
    if(to.health<=0||(to.kind==='hero'&&to.state==='dodge'&&to.age>=tuning.dodge.invulnerableStart&&to.age<tuning.dodge.invulnerableEnd))return;
    to.health=Math.max(0,to.health-amount);this.events.push({tick:this.tick,actor:from.id,kind:'damage',target:to.id});
    this.start(to,to.health<=0?'death':'hurt',to.yaw);if(!to.health)this.events.push({tick:this.tick,actor:to.id,kind:'death'});
  }
  step(command:Command=idleCommand){
    this.tick++;this.events=[];
    for(const a of this.actors){a.px=a.x;a.pz=a.z;a.cooldown=Math.max(0,a.cooldown-1);a.dodgeCooldown=Math.max(0,a.dodgeCooldown-1);a.stun=Math.max(0,a.stun-1);}
    const h=this.hero;if(Math.hypot(command.aim.x-h.x,command.aim.z-h.z)>.001)h.aim=Math.atan2(command.aim.x-h.x,command.aim.z-h.z);
    const len=Math.hypot(command.move.x,command.move.z),mx=len>1?command.move.x/len:command.move.x,mz=len>1?command.move.z/len:command.move.z;
    if(h.health>0&&(h.state==='idle'||h.state==='walk')){
      if(command.dodge&&h.dodgeCooldown===0){this.start(h,'dodge',len>.01?Math.atan2(mx,mz):h.aim);h.dodgeCooldown=tuning.dodge.cooldown;}
      else if(command.ability&&h.cooldown===0){this.start(h,'ability');h.cooldown=tuning.ability.cooldown;}
      else if(command.attack)this.start(h,'attack');
      else {h.state=len>.01?'walk':'idle';h.yaw=h.state==='walk'?Math.atan2(mx,mz):h.aim;this.move(h,mx*tuning.moveSpeed/60,mz*tuning.moveSpeed/60);}
    }
    for(const a of this.actors){
      if(a.health<=0){a.age++;continue;}
      if(a.kind==='enemy'&&h.health>0&&a.stun===0&&(a.state==='idle'||a.state==='walk')){
        const dx=h.x-a.x,dz=h.z-a.z,dist=Math.hypot(dx,dz);a.aim=Math.atan2(dx,dz);
        if(dist<tuning.enemy.range+.1)this.start(a,'attack');
        else{a.state='walk';a.yaw=a.aim;this.move(a,dx/dist*tuning.enemy.speed/60,dz/dist*tuning.enemy.speed/60);}
      }
      if(a.kind==='enemy'&&a.stun>0&&(a.state==='walk'||a.state==='idle'))a.state='idle';
      if(a.state==='attack'){
        const t=a.kind==='hero'?tuning.attack:tuning.enemy;
        if(a.age===t.windup)this.events.push({tick:this.tick,actor:a.id,kind:'swing'});
        if(a.age>=t.windup&&a.age<t.activeEnd)for(const target of this.actors){
          if(target.kind===a.kind||target.health<=0||a.hitIds.includes(target.id))continue;
          const dx=target.x-a.x,dz=target.z-a.z,angle=Math.atan2(dx,dz),diff=Math.abs(Math.atan2(Math.sin(angle-a.yaw),Math.cos(angle-a.yaw)));
          if(Math.hypot(dx,dz)<=t.range && diff<(a.kind==='hero'?tuning.attack.halfAngle:1.1)){a.hitIds.push(target.id);this.damage(a,target,t.damage);}
        }
        if(a.age>=t.total-1)this.start(a,'idle');
      }else if(a.state==='dodge'){
        this.move(a,Math.sin(a.yaw)*tuning.dodge.speed/60,Math.cos(a.yaw)*tuning.dodge.speed/60);
        if(a.age>=tuning.dodge.total-1)this.start(a,'idle');
      }else if(a.state==='ability'){
        if(a.age===tuning.ability.windup){this.events.push({tick:this.tick,actor:a.id,kind:'flare'});for(const target of this.actors)if(target.kind==='enemy'&&target.health>0&&Math.hypot(target.x-a.x,target.z-a.z)<tuning.ability.range){this.damage(a,target,tuning.ability.damage);target.stun=tuning.ability.stun;}}
        if(a.age>=tuning.ability.total-1)this.start(a,'idle');
      }else if(a.state==='hurt'&&a.age>=tuning.hurt.total-1)this.start(a,'idle',a.yaw);
      a.age++;
    }
    // Bounded pair separation, independent from art alpha bounds and render sorting.
    for(let i=0;i<this.actors.length;i++)for(let j=i+1;j<this.actors.length;j++){
      const a=this.actors[i]!,b=this.actors[j]!;if(a.health<=0||b.health<=0)continue;const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz),r=tuning.heroRadius*2;
      if(d<r&&d>.001){const delta=(r-d)/2;this.move(a,-dx/d*delta,-dz/d*delta);this.move(b,dx/d*delta,dz/d*delta);}
    }
    this.cleared=this.actors.slice(1).every(a=>a.health<=0);
  }
}
export class FixedClock {
  accumulator=0;droppedMs=0;readonly stepMs=1000/60;
  advance(ms:number,step:()=>void){
    const bounded=Math.min(Math.max(ms,0),100);this.droppedMs+=Math.max(0,ms-bounded);this.accumulator+=bounded;
    let steps=0;while(this.accumulator+1e-8>=this.stepMs&&steps<6){step();this.accumulator-=this.stepMs;steps++;}
    return Math.max(0,this.accumulator/this.stepMs);
  }
  reset(){this.accumulator=0;}
}
