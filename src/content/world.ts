import {churchyardColliders} from './world-art';
import {insidePolygon} from './graveyard-layout';
import {tuning} from './gameplay';
import {actorVisuals, assetCatalog} from './visuals';

export type AreaId = string;
export type ActorId = string;
export type Point = {x: number; z: number};
export type Bounds = {minX: number; maxX: number; minZ: number; maxZ: number};
export type Surface =
  | {kind: 'flat'; height: number}
  | {
      kind: 'ramp' | 'stairs';
      steps?: number;
      terraceBounds?: Bounds;
      stairWidth?: number;
      axis: 'x' | 'z';
      start: number;
      end: number;
      startHeight: number;
      endHeight: number;
    };
export type MeleeDefinition = {
  windup: number;
  activeEnd: number;
  total: number;
  range: number;
  halfAngle: number;
  damage: number;
};
export type ActorDefinition = {
  id: string;
  kind: 'hero' | 'enemy';
  maxHealth: number;
  radius: number;
  speed: number;
  melee: MeleeDefinition;
  visual: string;
};
export type SpawnDefinition = Point & {
  id: string;
  actor: string;
  jitterZ?: number;
};
export type EntryDefinition = Point & {id: string};
export type ExitDefinition = {
  id: string;
  trigger: Bounds;
  destination: string;
  entry: string;
  requiresClear: boolean;
  marker: Point;
};
export type PropDefinition = Point & {
  id: string;
  kind: 'pillar' | 'tree' | 'wall' | 'foreground' | 'border';
  radius: number;
  height: number;
  size?: readonly [number, number];
  blocking?: boolean;
  shape?: 'box'|'polygon';
  polygon?:readonly Point[];
  rotation?: number;
};
export type AreaDefinition = {
  id: AreaId;
  name: string;
  subtitle: string;
  bounds: Bounds;
  surface: Surface;
  seedOffset: number;
  activation?: Bounds;
  baselineEntry: string;
  entries: readonly EntryDefinition[];
  spawns: readonly SpawnDefinition[];
  exits: readonly ExitDefinition[];
  props: readonly PropDefinition[];
  floorColor: number;
};
export type ContentDefinitions = {
  initialArea: string;
  player: string;
  actors: readonly ActorDefinition[];
  areas: readonly AreaDefinition[];
};
export const PLAYER_ID = 'player';
export const spawnActorId = (area: AreaId, spawn: string): ActorId =>
  `${area}/${spawn}`;
export function heightAt(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat') return s.height;
  const t = Math.max(
    0,
    Math.min(1, ((s.axis === 'x' ? x : z) - s.start) / (s.end - s.start)),
  );
  if(s.kind==='stairs'&&s.terraceBounds){
    if(contains(s.terraceBounds,{x,z}))return s.endHeight;
    if(Math.abs(x)>(s.stairWidth??3.2)/2||z<Math.min(s.start,s.end)||z>Math.max(s.start,s.end))return s.startHeight;
  }
  const supported=s.kind==='stairs'?Math.ceil(t*(s.steps??3)-1e-9)/(s.steps??3):t;
  return s.startHeight + (s.endHeight - s.startHeight) * supported;
}
export function surfaceGradient(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat'||s.kind==='stairs') return {x: 0, z: 0};
  const p = s.axis === 'x' ? x : z,
    inside = p > Math.min(s.start, s.end) && p < Math.max(s.start, s.end),
    slope = inside ? (s.endHeight - s.startHeight) / (s.end - s.start) : 0;
  return {x: s.axis === 'x' ? slope : 0, z: s.axis === 'z' ? slope : 0};
}
export function contains(bounds: Bounds, p: Point) {
  return (
    p.x >= bounds.minX &&
    p.x <= bounds.maxX &&
    p.z >= bounds.minZ &&
    p.z <= bounds.maxZ
  );
}
const ids = /^[a-z0-9][a-z0-9_-]*$/;
export class ContentRegistry {
  readonly areas = new Map<AreaId, AreaDefinition>();
  readonly actors = new Map<string, ActorDefinition>();
  constructor(public readonly definitions: ContentDefinitions) {
    const fail = (message: string): never => {
      throw new Error(`content: ${message}`);
    };
    const finite = (...values: number[]) => {
      if (values.some((v) => !Number.isFinite(v))) fail('non-finite value');
    };
    const unique = <T extends {id: string}>(
      items: readonly T[],
      label: string,
    ) => {
      const seen = new Set<string>();
      for (const v of items) {
        if (!ids.test(v.id) || seen.has(v.id))
          fail(`invalid or duplicate ${label} ID ${v.id}`);
        seen.add(v.id);
      }
    };
    const bounds = (b: Bounds) => {
      finite(b.minX, b.maxX, b.minZ, b.maxZ);
      if (b.minX >= b.maxX || b.minZ >= b.maxZ) fail('invalid bounds');
    };
    unique(definitions.actors, 'actor');
    unique(definitions.areas, 'area');
    for (const a of definitions.actors) {
      finite(a.maxHealth, a.radius, a.speed, ...Object.values(a.melee));
      if (
        !Number.isInteger(a.maxHealth) ||
        a.maxHealth <= 0 ||
        a.radius <= 0 ||
        a.speed <= 0 ||
        !ids.test(a.visual)
      )
        fail(`invalid actor ${a.id}`);
      const m = a.melee;
      if (
        ![m.windup, m.activeEnd, m.total, m.damage].every(Number.isInteger) ||
        m.windup < 0 ||
        m.activeEnd <= m.windup ||
        m.total <= m.activeEnd ||
        m.range <= 0 ||
        m.halfAngle <= 0 ||
        m.halfAngle > Math.PI ||
        m.damage <= 0
      )
        fail(`invalid melee ${a.id}`);
      if (
        !actorVisuals[a.visual] ||
        !assetCatalog[actorVisuals[a.visual]!.asset]
      )
        fail(`unknown visual ${a.visual}`);
      this.actors.set(a.id, a);
    }
    if (this.actor(definitions.player).kind !== 'hero')
      fail('player must use a hero definition');
    for (const a of definitions.areas) {
      bounds(a.bounds);
      if(a.activation)bounds(a.activation);
      finite(a.seedOffset, a.floorColor);
      if (!Number.isInteger(a.seedOffset) || a.seedOffset < 0)
        fail('invalid seed offset');
      unique(a.entries, 'entry');
      unique(a.spawns, 'spawn');
      unique(a.exits, 'exit');
      unique(a.props, 'prop');
      for (const p of [...a.entries, ...a.spawns]) {
        finite(p.x, p.z);
        if (!contains(a.bounds, p)) fail(`point outside ${a.id}`);
      }
      if (!a.entries.some((e) => e.id === a.baselineEntry))
        fail(`missing baseline entry ${a.id}`);
      const s = a.surface;
      if (s.kind === 'flat') finite(s.height);
      else {
        if(s.kind==='stairs'){if(s.axis!=='z'||!Number.isInteger(s.steps)||s.steps!<1||s.steps!>12)fail('invalid stairs');if(s.terraceBounds){bounds(s.terraceBounds);finite(s.stairWidth??0);if((s.stairWidth??0)<=0)fail('invalid stair width');}}
        finite(s.start, s.end, s.startHeight, s.endHeight);
        if (
          s.start === s.end ||
          Math.abs((s.endHeight - s.startHeight) / (s.end - s.start)) > 0.5
        )
          fail(`invalid shallow ramp ${a.id}`);
      }
      for (const p of a.spawns) {
        if (this.actor(p.actor).kind !== 'enemy')
          fail('encounter spawn must be an enemy');
        finite(p.jitterZ ?? 0);
        if ((p.jitterZ ?? 0) < 0 || p.z + (p.jitterZ ?? 0) > a.bounds.maxZ)
          fail('invalid spawn jitter');
      }
      for (const p of a.props) {
        if(p.shape==='polygon'&&(!p.polygon||p.polygon.length<3||p.polygon.some(v=>!Number.isFinite(v.x+v.z))))fail('invalid terrain polygon');
        if(p.shape==='box'&&!p.size)fail('box footprint requires size');
        finite(p.x, p.z, p.radius, p.height, p.rotation??0, ...(p.size ?? []));
        if (p.radius <= 0 || p.height <= 0 || p.size?.some((v) => v <= 0))
          fail(`invalid prop ${p.id}`);
      }
      for (const e of a.exits) {
        bounds(e.trigger);
        finite(e.marker.x, e.marker.z);
        if (
          !contains(a.bounds, {x: e.trigger.minX, z: e.trigger.minZ}) ||
          !contains(a.bounds, {x: e.trigger.maxX, z: e.trigger.maxZ})
        )
          fail(`exit outside ${a.id}`);
      }
      this.areas.set(a.id, a);
    }
    this.area(definitions.initialArea);
    for (const a of definitions.areas)
      for (const e of a.exits)
        if (!this.area(e.destination).entries.some((p) => p.id === e.entry))
          fail(`missing destination entry ${e.destination}/${e.entry}`);
  }
  area(id: AreaId) {
    const value = this.areas.get(id);
    if (!value) throw new Error(`content: unknown area ${id}`);
    return value;
  }
  actor(id: string) {
    const value = this.actors.get(id);
    if (!value) throw new Error(`content: unknown actor ${id}`);
    return value;
  }
}
const bounds = {minX: -7.5, maxX: 7.5, minZ: -7.5, maxZ: 7.5};
export const contentDefinitions: ContentDefinitions = {
  initialArea: 'court',
  player: 'lamplighter',
  actors: [
    {id:'skeleton',kind:'enemy',maxHealth:50,radius:.25,speed:.9,melee:{windup:39,activeEnd:43,total:68,range:1.2,halfAngle:1.1,damage:8},visual:'skeleton'},
    {
      id: 'lamplighter',
      kind: 'hero',
      maxHealth: tuning.heroMaxHealth,
      radius: tuning.heroRadius,
      speed: tuning.moveSpeed,
      melee: {...tuning.attack},
      visual: 'hero',
    },

  ],
  areas: [
    {
      id: 'court',
      name: 'Graveyard Approach',
      subtitle: 'A worn path leads between the graves to the chapel.',
      bounds: {minX:-6.5,maxX:6.5,minZ:-6.3,maxZ:8},
      surface: {kind:'stairs',steps:2,stairWidth:3.0,terraceBounds:{minX:-2.95,maxX:2.95,minZ:-6.6,maxZ:-5.7},axis:'z',start:-5.1,end:-5.7,startHeight:0,endHeight:.3},
      seedOffset: 0,
      baselineEntry: 'start',
      entries: [
        {id: 'start', x: -3.3, z: 6.65},
        {id: 'from-landing', x: 0, z: -5.5},
      ],
      activation: {minX:-6.5,maxX:6.5,minZ:-6.3,maxZ:2.0},
      spawns: [{id:'warden-1',actor:'skeleton',x:.7,z:.0}],
      props: churchyardColliders('court'),
      floorColor: 0x34434a,
      exits: [
        {
          id: 'landing',
          trigger: {minX:-.95,maxX:.95,minZ:-6.3,maxZ:-5.75},
          destination: 'upper-landing',
          entry: 'start',
          requiresClear: true,
          marker: {x:0,z:-6.15},
        },
      ],
    },
    {
      id: 'upper-landing',
      name: 'Ruined Chapel',
      subtitle: 'The restless dead gather in the ruined nave.',
      bounds:{minX:-5.7,maxX:5.7,minZ:-8.7,maxZ:8.7},
      surface:{kind:'flat',height:.3},
      seedOffset: 101,
      baselineEntry: 'start',
      entries: [{id: 'start', x: 0, z: 7.5}],
      activation: {minX:-5.7,maxX:5.7,minZ:-8.7,maxZ:4.3},
      spawns: [{id:'warden-1',actor:'skeleton',x:-2.0,z:1.0},{id:'warden-2',actor:'skeleton',x:1.7,z:-1.3}],
      props: churchyardColliders('upper-landing'),
      floorColor: 0x3e444e,
      exits: [
        {
          id: 'court',
          trigger: {minX:-.95,maxX:.95,minZ:8.1,maxZ:8.7},
          destination: 'court',
          entry: 'from-landing',
          requiresClear: false,
          marker: {x:0,z:9},
        },
      ],
    },

  ],
};
export const content = new ContentRegistry(contentDefinitions);

// Resolve circular actors against authored circles/boxes, then enforce area bounds.
export function supportedPosition(area:AreaDefinition,p:Point,radius:number):Point {
 let x=p.x,z=p.z;
 const clamp=()=>{x=Math.max(area.bounds.minX+radius,Math.min(area.bounds.maxX-radius,x));z=Math.max(area.bounds.minZ+radius,Math.min(area.bounds.maxZ-radius,z));};
 clamp();
 for(let pass=0;pass<3;pass++)for(const prop of area.props){
  if(prop.blocking===false)continue;
  if(prop.shape==='polygon'&&prop.polygon){
   const points=prop.polygon,inside=insidePolygon({x,z},points),signed=points.reduce((a,p,i)=>{const q=points[(i+1)%points.length]!;return a+p.x*q.z-q.x*p.z;},0),candidates=[];
   for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!,dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(l*l))),qx=a.x+dx*t,qz=a.z+dz*t,d=Math.hypot(x-qx,z-qz),sign=signed<0?1:-1;
    if(!inside&&d>=radius)continue;const nx=inside||d<1e-9?-dz/l*sign:(x-qx)/Math.max(d,1e-9),nz=inside||d<1e-9?dx/l*sign:(z-qz)/Math.max(d,1e-9),candidate={x:qx+nx*(radius+.001),z:qz+nz*(radius+.001)};
    if(candidate.x>=area.bounds.minX+radius&&candidate.x<=area.bounds.maxX-radius&&candidate.z>=area.bounds.minZ+radius&&candidate.z<=area.bounds.maxZ-radius&&!insidePolygon(candidate,points))candidates.push({...candidate,d:Math.hypot(candidate.x-x,candidate.z-z)});
   }
   if(candidates.length){candidates.sort((a,b)=>a.d-b.d);x=candidates[0]!.x;z=candidates[0]!.z;}
  }else if(prop.shape==='box'&&prop.size){
   const hx=prop.size[0]/2,hz=prop.size[1]/2,c=Math.cos(prop.rotation??0),s=Math.sin(prop.rotation??0),wx=x-prop.x,wz=z-prop.z,dx=wx*c+wz*s,dz=-wx*s+wz*c;
   const qx=Math.max(-hx,Math.min(hx,dx)),qz=Math.max(-hz,Math.min(hz,dz));
   const vx=dx-qx,vz=dz-qz,d=Math.hypot(vx,vz);
   if(d>0&&d<radius){const shift=(radius-d)/d;x+=(vx*c-vz*s)*shift;z+=(vx*s+vz*c)*shift;}
   else if(d===0){let lx=dx,lz=dz;if(hx-Math.abs(dx)<hz-Math.abs(dz))lx=(dx<0?-1:1)*(hx+radius);else lz=(dz<0?-1:1)*(hz+radius);x=prop.x+lx*c-lz*s;z=prop.z+lx*s+lz*c;}
  }else{let dx=x-prop.x,dz=z-prop.z,d=Math.hypot(dx,dz),r=prop.radius+radius;if(d<r){if(d<1e-9){dx=1;dz=0;d=1;}x=prop.x+dx/d*r;z=prop.z+dz/d*r;}}
  clamp();
 }
 return {x,z};
}
export function isSupportedPosition(area:AreaDefinition,p:Point,radius:number){const q=supportedPosition(area,p,radius);return Math.hypot(q.x-p.x,q.z-p.z)<1e-6;}
