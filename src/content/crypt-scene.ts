import type {ArtPlacement,SiteWall,WorldVisualDefinition} from './world-art';

const pale=0xe0ded0,stone=0xc4ced0;
const walls:SiteWall[]=[
 {id:'crypt-west',from:{x:-6,z:9},to:{x:-6,z:-9},height:3.6,thickness:.38,surface:'masonry'},
 {id:'crypt-rear',from:{x:-6,z:-9},to:{x:6,z:-9},height:4.2,thickness:.38,surface:'masonry'},
 ...[[-6,-1.2],[1.2,6]].map(([a,b],i)=>({id:`crypt-front-${i}`,from:{x:a!,z:9},to:{x:b!,z:9},height:.65,thickness:.38,surface:'masonry' as const,assembly:`crypt-entry-${i}`,fade:true})),
 ...[[9,2],[2,-2.2],[-2.2,-9]].map(([a,b],i)=>({id:`crypt-east-${i}`,from:{x:6,z:a!},to:{x:6,z:b!},height:i===1?.26:.65,thickness:.38,surface:'masonry' as const,assembly:`crypt-east-bay-${i}`,fade:true})),
];
const props:ArtPlacement[]=[
 ...[-5.45,5.45].flatMap((x,side)=>[7.8,1.7,-2.2,-8.1].map((z,i)=>({id:`crypt-pier-${side}-${i}`,clip:'pillar',x,z,scale:side===1?.65:1.05,tint:stone,footprint:[.6,.6] as const,fade:side===1,assembly:side===1?`crypt-east-bay-${Math.min(i,2)}`:undefined,shadow:'contact' as const,purpose:'Structural pier; nearer eastern remains stay low to reveal combat'}))),
 {id:'crypt-return-door',clip:'doorway',asset:'ink-crypt',x:0,z:9,door:true,shadow:'none',tint:pale,purpose:'Registered return door seated at the retained safe threshold'},
 ...[-4.4,4.4].flatMap((x,side)=>[5.8,2.6].map((z,i)=>({id:`chapel-pew-${side}-${i}`,clip:side?'broken-pew':'pew',asset:side?'ink-chapel-broken-pew':'ink-chapel-pew',x:side&&i===1?4.55:x,z,fade:true,assembly:`chapel-seating-${side}-${i}`,footprint:side?[2.05,1.05] as const:[1.9,.85] as const,shadow:'contact' as const,purpose:side?'Displaced broken pew beside the breached east bay':'Surviving oak pew facing the sanctuary'}))),
 {id:'crypt-altar',clip:'altar',asset:'ink-chapel-altar',x:0,z:-6.95,footprint:[2.4,1.2],shadow:'contact',purpose:'Principal limestone altar with a carved lantern insignia'},
 ...[-2.1,2.1].map((x,i)=>({id:`crypt-sanctuary-pier-${i}`,clip:'pillar',x,z:-8.1,scale:1.16,tint:pale,footprint:[.7,.7] as const,shadow:'contact' as const,purpose:'Substantial piers framing the surviving lantern window'})),
 {id:'crypt-glass',clip:'window',asset:'ink-chapel-window',x:0,z:-8.795,y:.8,wallFace:'crypt-rear',shadow:'none',purpose:'Damaged lancet window depicting a surviving lantern bearer'},
 {id:'crypt-altar-candles',clip:'votive-hardware',asset:'ink-crypt',x:-.07,z:-6.87,y:1.15,mount:{to:'crypt-altar',offset:[-.07,1.15,.08]},flame:{clip:'votive',phase:.31},light:{offset:[0,.38,0],range:3.4,power:.85,phase:.31},shadow:'none',purpose:'Candelabrum supported on the principal altar slab'},
 {id:'chapel-devotional-table',clip:'offering-table',x:-4.65,z:-5.25,scale:.75,tint:pale,footprint:[.85,.75],shadow:'contact',purpose:'One small devotional table in the west memorial grouping'},
 {id:'chapel-devotional-candles',clip:'votive-hardware',asset:'ink-crypt',x:-4.72,z:-5.17,y:.46,scale:.8,mount:{to:'chapel-devotional-table',offset:[-.07,.46,.08]},flame:{clip:'votive',phase:1.12},light:{offset:[0,.38,0],range:2.5,power:.3,phase:1.12},shadow:'none',purpose:'Restrained votive warmth beside the west devotional fragment'},
 {id:'crypt-mural',clip:'mural',asset:'ink-crypt-wall',x:-5.795,z:-5.25,y:1.25,scale:.38,wallFace:'crypt-west',shadow:'none',tint:0xc6cbc4,purpose:'Single faded devotional fragment above the west prayer table'},
 {id:'crypt-tomb',clip:'tomb',x:4.55,z:-5.45,tint:pale,footprint:[.95,2.25],shadow:'contact',purpose:'One quiet memorial tomb in the east sanctuary recess'},
 {id:'chapel-collapse',clip:'collapse',asset:'ink-chapel-collapse',x:4.75,z:-.15,fade:true,assembly:'crypt-east-bay-1',footprint:[1.6,2.5],shadow:'contact',purpose:'Fallen roof rib and weighty stones explain the breached eastern wall'},
 {id:'crypt-entry-lamp',clip:'votive-hardware',asset:'ink-crypt',x:-1.7,z:7.7,scale:.85,flame:{clip:'votive',phase:1.3},light:{offset:[0,.32,0],range:2.5,power:.25,phase:1.3},shadow:'none',purpose:'Small warm return landmark beneath the surviving sanctuary'},
];
export const cryptScene:WorldVisualDefinition={
 floor:'ink-chapel-floor',interior:{minX:-6,maxX:6,minZ:-9,maxZ:9},props,walls,
 assemblies:[{id:'crypt',origin:{x:0,z:0},props,walls}],paths:[],graves:[],patches:[],lights:[],
 dependencies:['ink-scenery','ink-crypt','ink-crypt-wall','ink-crypt-flame','ink-masonry','ink-decals','ink-ground-transitions','ink-cues','ink-crypt-ambient','ink-crypt-feature','ink-chapel-altar','ink-chapel-window','ink-chapel-pew','ink-chapel-broken-pew','ink-chapel-collapse'],
 decals:[
  {id:'crypt-puddle',clip:'puddle',asset:'ink-crypt-feature',x:5.3,z:-.2,scale:.3,tint:0x8dabb4},
  {id:'crypt-collapse-crack',clip:'d01_branching_crack',x:4.9,z:1,scale:.22,tint:0x71848d},
  {id:'crypt-entry-wear',clip:'t07_damp_spread',x:0,z:7.7,scale:.42,tint:0xadb6b4,opacity:.10},
  {id:'crypt-altar-wear',clip:'t07_damp_spread',x:0,z:-5.65,scale:.3,tint:0x929b98,opacity:.08},
 ],camera:{bounds:{minX:-2,maxX:2,minZ:-6,maxZ:5.9},bias:{x:0,z:-1.5},targetHeight:.6,arrival:{start:3,end:7.5,biasZ:-7,span:11,targetHeight:2.2}},
};
