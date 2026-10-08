import type {AreaDefinition,PropDefinition,Bounds,Point} from './world';
import type {WeatherState} from './visual-effects';
import type {Manifest} from '../assets/schema';
import {cryptScene} from './crypt-scene';
import {graveyardScene} from './graveyard-scene';
import {burialTerraces} from './graveyard-layout';
import cameraContract from './camera.json';
export type ArtPlacement={id:string;clip:string;x:number;z:number;y?:number;scale?:number;fade?:boolean;mirror?:boolean;tint?:number;footprint?:readonly [number,number];purpose?:string;door?:boolean;rotation?:number;asset?:string;role?:'ground'|'upright'|'attachment';footprintAngle?:number;coverage?:string;assembly?:string;shadow?:'contact'|'cast'|'none';mount?:{to:string;offset:readonly [number,number,number]};wallFace?:string;light?:{offset:readonly [number,number,number];power:number;range:number;phase:number};flame?:{clip:string;phase:number};emissive?:boolean;opacity?:number};
export type GroundPatch={bounds:Bounds};
export type GroundPath={points:readonly Point[];width:number;widths?:readonly number[]};
export type SiteWall={id:string;from:Point;to:Point;height:number;thickness:number;visualHeight?:number;breaks?:readonly number[];cutout?:'wall'|'wall-x'|'wall-z'|'boundary-x'|'boundary-z'|'fence';surface?:'masonry';assembly?:string;fade?:boolean};
export type BurialPlot={id:string;x:number;z:number;width:number;length:number;age:'kept'|'old'|'damaged';angle?:number;marker?:'gravestone'|'memorial'|'fallen-marker'};
export type SiteLight={x:number;z:number;radius:number;power:number};
export type SiteFixture={id:string;prop:string;socket:readonly [number,number,number];power:number;radius:number;phase:number;smoke?:boolean;flameScale?:number};
export type OverlapAllowance={a:string;b:string;region:Bounds;reason:string};
export type SiteAssembly={id:string;origin:Point;walls:readonly SiteWall[];props:readonly ArtPlacement[]};
export type WorldVisualDefinition={weather?:WeatherState;rainBounds?:Bounds;rainShelters?:readonly Bounds[];floor:string;props:readonly ArtPlacement[];dependencies:readonly string[];patches:readonly GroundPatch[];decals:readonly ArtPlacement[];paths:readonly GroundPath[];walls:readonly SiteWall[];graves:readonly BurialPlot[];lights:readonly SiteLight[];interior?:Bounds;camera:{bounds:Bounds;bias:Point;keepHeroVisible?:boolean;targetHeight?:number;arrival?:{start:number;end:number;biasZ:number;span?:number;targetHeight?:number}};assemblies:readonly SiteAssembly[];fixtures?:readonly SiteFixture[];groundTiles?:{asset:string;min:number;tileSize:number;count:number};overlaps?:readonly OverlapAllowance[]};
export const floorUV=(x:number,z:number):readonly [number,number]=>[x/4,-z/4];
export {graveHead} from './graveyard-scene';
export const worldVisuals:Readonly<Record<string,WorldVisualDefinition>>={court:graveyardScene,'upper-landing':cryptScene};
export function churchyardColliders(id:string):PropDefinition[]{const art=worldVisuals[id]!;return [...(id==='court'?burialTerraces.map(t=>({id:`terrain-volume-${t.id}`,kind:'border' as const,x:0,z:0,radius:.2,height:t.height,shape:'polygon' as const,polygon:t.points,blocking:true})):[]),...art.props.filter(p=>p.footprint).map(p=>({id:p.id,kind:'wall' as const,x:p.x,z:p.z,radius:.2,height:1,shape:'box' as const,size:p.footprint,rotation:p.footprintAngle??0,blocking:true})),...art.walls.map(w=>({id:w.id,kind:'wall' as const,x:(w.from.x+w.to.x)/2,z:(w.from.z+w.to.z)/2,radius:.2,height:w.height,shape:'box' as const,size:[Math.hypot(w.to.x-w.from.x,w.to.z-w.from.z),w.thickness] as const,rotation:Math.atan2(w.to.z-w.from.z,w.to.x-w.from.x),blocking:true}))];}
export function areaArtAssets(area:AreaDefinition){const art=worldVisuals[area.id];return art?[...new Set([art.floor,...art.dependencies])]:[];}
export function validateAreaArt(area:AreaDefinition,packs:ReadonlyMap<string,{manifest:Manifest}>){const art=worldVisuals[area.id];if(!art)return;const pack=(id:string)=>{const p=packs.get(id);if(!p)throw new Error(`missing room art: ${id}`);return p.manifest;};
 for(const id of [art.floor,...(art.interior?[]:['ink-moss'])]){const m=pack(id);if(m.asset.type!=='material'||m.asset.projection!=='top-down')throw new Error('floor must use raw top-down material');}
 for(const p of art.props){if(!Number.isFinite(p.x+p.z+(p.y??0)+(p.scale??1))||(p.scale??1)<=0||!p.purpose)throw new Error(`invalid art placement: ${p.id}`);if(!pack(p.asset??'ink-scenery').asset.clips[p.clip]?.d45)throw new Error(`required clip unavailable: ${p.clip}`);}
 for(const p of art.decals){const m=pack(p.asset??(p.clip.startsWith('t')?'ink-ground-transitions':'ink-decals'));if(!m.asset.clips[p.clip]?.d45)throw new Error(`required clip unavailable: ${p.clip}`);}
 for(const id of ['ink-cues'])pack(id);
}

export function compositionPoint(area:string,hero:Point,frame?:{halfWidth:number;halfHeight:number}):Point{const f=worldVisuals[area]?.camera;if(!f)return {...hero};
 const t=f.arrival?Math.max(0,Math.min(1,(hero.z-f.arrival.start)/(f.arrival.end-f.arrival.start))):0,biasZ=f.bias.z+(f.arrival?f.arrival.biasZ-f.bias.z:0)*t;
 const target={x:Math.max(f.bounds.minX,Math.min(f.bounds.maxX,hero.x+f.bias.x)),z:Math.max(f.bounds.minZ,Math.min(f.bounds.maxZ,hero.z+biasZ))};
 if(frame&&f.keepHeroVisible){
  const a=cameraContract.azimuthDeg*Math.PI/180,e=cameraContract.elevationDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a),sine=Math.sin(e);
  const dx=hero.x-target.x,dz=hero.z-target.z,lateral=dx*c-dz*s,limit=Math.max(.1,frame.halfWidth-.75),shift=lateral-Math.max(-limit,Math.min(limit,lateral));
  target.x+=shift*c;target.z-=shift*s;
  const vertical=-((hero.x-target.x)*s+(hero.z-target.z)*c)*sine-compositionHeight(area,hero)*Math.cos(e),low=-frame.halfHeight+.6,high=frame.halfHeight-cameraContract.heroHeight*Math.cos(e)-.6,correction=vertical-Math.max(low,Math.min(high,vertical));
  target.x-=correction*s/sine;target.z-=correction*c/sine;
 }
 return target;}


// The requested span remains the saved preference; only the default framing reveals entry.
export function compositionSpan(area:string,hero:Point,requested:number):number{
 const f=worldVisuals[area]?.camera,a=f?.arrival;
 if(!a?.span||requested!==9)return requested;
 const t=Math.max(0,Math.min(1,(hero.z-a.start)/(a.end-a.start))),ease=t*t*(3-2*t);
 return requested+(a.span-requested)*ease;
}

export function compositionHeight(area:string,hero:Point):number{
 const f=worldVisuals[area]?.camera,base=f?.targetHeight??0,a=f?.arrival;
 const t=a?Math.max(0,Math.min(1,(hero.z-a.start)/(a.end-a.start))):0;
 return base+((a?.targetHeight??base)-base)*t;
}
