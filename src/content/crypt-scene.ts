import type {ArtPlacement,SiteWall,WorldVisualDefinition} from './world-art';

const pale=0xc9c8bb,stone=0xabb4b4;
const walls:SiteWall[]=[
 {id:'crypt-west',from:{x:-8,z:9},to:{x:-8,z:-9},height:3.25,thickness:.38,surface:'masonry'},
 {id:'crypt-rear',from:{x:-8,z:-9},to:{x:8,z:-9},height:3.25,thickness:.38,surface:'masonry'},
 ...[[-8,-1.2],[1.2,8]].map(([a,b],i)=>({id:`crypt-front-${i}`,from:{x:a!,z:9},to:{x:b!,z:9},height:.72,thickness:.38,surface:'masonry' as const,assembly:`crypt-entry-${i}`,fade:true})),
 ...[[9,3.25],[3.25,-2.5],[-2.5,-9]].map(([a,b],i)=>({id:`crypt-east-${i}`,from:{x:8,z:a!},to:{x:8,z:b!},height:i===1?.38:.72,thickness:.38,surface:'masonry' as const,assembly:`crypt-east-bay-${i}`,fade:true})),
 ...[2.7,-2.8].flatMap((z,i)=>[
  {id:`crypt-west-return-${i}`,from:{x:-8,z},to:{x:-5.55,z},height:.62,thickness:.28,surface:'masonry' as const},
  {id:`crypt-east-return-${i}`,from:{x:5.55,z},to:{x:8,z},height:.62,thickness:.28,surface:'masonry' as const,assembly:`crypt-east-bay-${i+1}`,fade:true},
 ]),
];
const props:ArtPlacement[]=[
 ...[-7.4,7.4].flatMap((x,side)=>[7.7,2.7,-2.8,-8.1].map((z,i)=>({id:`crypt-pier-${side}-${i}`,clip:'pillar',x,z,scale:.94,tint:stone,footprint:[.6,.6] as const,fade:side===1,assembly:side===1?`crypt-east-bay-${Math.min(i,2)}`:undefined,shadow:'contact' as const,purpose:'Pier joining the three structural burial bays'}))),
 {id:'crypt-return-door',clip:'doorway',asset:'ink-crypt',x:0,z:9,door:true,shadow:'none',tint:pale,purpose:'Registered leaf and stone surround share one composited surface and threshold'},
 {id:'crypt-altar',clip:'offering-table',x:0,z:-6.95,tint:pale,footprint:[1.1,1],shadow:'contact',purpose:'Human-scale offering table at the marble sanctuary'},
 ...[-2.25,2.25].map((x,i)=>({id:`crypt-sanctuary-pier-${i}`,clip:'pillar',x,z:-8.1,scale:1,tint:pale,footprint:[.65,.65] as const,shadow:'contact' as const,purpose:'Piers framing the principal sanctuary image'})),
 {id:'crypt-glass',clip:'glass',asset:'ink-crypt-wall',x:0,z:-8.795,y:.38,scale:.75,wallFace:'crypt-rear',shadow:'none',tint:0xb0b6ae,purpose:'One stained-glass memorial above the altar, mounted on the rear wall'},
 {id:'crypt-altar-candles',clip:'votive-hardware',asset:'ink-crypt',x:-.07,z:-6.87,y:.61,mount:{to:'crypt-altar',offset:[-.07,.61,.08]},flame:{clip:'votive',phase:.31},light:{offset:[0,.38,0],range:4.5,power:1.35,phase:.31},shadow:'none',purpose:'Registered candelabrum supported on the offering slab'},
 {id:'crypt-ossuary',clip:'ossuary',x:-6.85,z:-5.15,tint:stone,footprint:[.8,1.1],shadow:'contact',purpose:'West memorial cabinet seated in the far burial bay'},
 {id:'crypt-urns',clip:'urn-niche',x:-6.85,z:.45,tint:stone,footprint:[.75,.85],shadow:'contact',purpose:'Kept urns beneath the west memorial niche'},
 {id:'crypt-niche',clip:'niche',asset:'ink-crypt-wall',x:-7.795,z:.45,y:1.5,scale:.36,wallFace:'crypt-west',shadow:'none',purpose:'Carved memorial mounted above the urn grouping'},
 {id:'crypt-plaque',clip:'memorial',x:-7.58,z:-4.6,y:1.1,scale:.64,mount:{to:'crypt-west',offset:[.42,1.1,-13.6]},tint:pale,shadow:'none',purpose:'Blank memorial plaque beside the ossuary'},
 {id:'crypt-bier',clip:'bier',asset:'ink-crypt',x:-6.25,z:5.4,tint:0xb8aa91,footprint:[.85,2.1],shadow:'contact',purpose:'Wooden funeral bier in the near west bay'},
 {id:'crypt-wall-light',clip:'cresset-hardware',asset:'ink-crypt',x:-7.6,z:3.8,y:1.25,mount:{to:'crypt-west',offset:[.4,1.25,-5.2]},flame:{clip:'cresset',phase:1.12},light:{offset:[-.1,.31,.1],range:3.5,power:.8,phase:1.12},shadow:'none',purpose:'Mounted cresset illuminating the near west bay'},
 {id:'crypt-mural',clip:'mural',asset:'ink-crypt-wall',x:-7.795,z:5.8,y:1.5,scale:.32,wallFace:'crypt-west',shadow:'none',tint:0x999b91,purpose:'A faded devotional fragment above the funeral bier'},
 {id:'crypt-soot',clip:'plaster',asset:'ink-crypt-wall',x:-7.792,z:3.7,y:1.72,scale:.14,wallFace:'crypt-west',shadow:'none',tint:0x454348,purpose:'Small reversible dark stain above the cresset'},
 {id:'crypt-plaster',clip:'plaster',asset:'ink-crypt-wall',x:-7.795,z:2.9,y:1.5,scale:.3,wallFace:'crypt-west',shadow:'none',tint:0x999e98,purpose:'Peeling plaster alongside the old wall fixture'},
 {id:'crypt-tomb',clip:'tomb',x:6.15,z:-5.45,tint:pale,footprint:[.95,2.25],shadow:'contact',purpose:'Stone tomb occupying the quiet east sanctuary bay'},
 {id:'crypt-lid',clip:'lid',asset:'ink-crypt',x:6.35,z:-3.6,tint:stone,footprint:[.5,.5],shadow:'contact',purpose:'Displaced sarcophagus lid supported beside its tomb'},
 {id:'crypt-bones',clip:'bones',asset:'ink-crypt',x:5.8,z:-3.05,scale:.75,tint:0xbfb8a5,shadow:'contact',purpose:'Restrained remains at the disturbed tomb rather than scattered through combat'},
 {id:'crypt-cloth',clip:'funeral-cloth',x:6.45,z:5.6,tint:0x929fa8,footprint:[.7,1],shadow:'contact',purpose:'Folded funerary cloth in the near east bay'},
 {id:'crypt-broken-return',clip:'corner',x:7.5,z:-.6,tint:stone,footprint:[.6,.6],fade:true,assembly:'crypt-east-bay-1',shadow:'contact',purpose:'A broken masonry return marking the damaged east bay'},
 {id:'crypt-collapse-stone',clip:'rubble',x:6.85,z:.4,tint:stone,footprint:[.9,.9],shadow:'contact',purpose:'Masonry concentrated under the damaged east bay'},
 {id:'crypt-collapse-timber',clip:'fallen-log',x:6.2,z:1.95,scale:.8,tint:0x8e8674,footprint:[.75,1.1],shadow:'contact',purpose:'Supported fallen timber beside the collapse; no plank decal in the nave'},
 {id:'crypt-entry-lamp',clip:'votive-hardware',asset:'ink-crypt',x:-1.7,z:7.7,scale:.85,flame:{clip:'votive',phase:1.3},light:{offset:[0,.32,0],range:2.8,power:.5,phase:1.3},shadow:'none',purpose:'A small warm landmark beside the return threshold'},
];
export const cryptScene:WorldVisualDefinition={
 floor:'ink-crypt-stone',interior:{minX:-8,maxX:8,minZ:-9,maxZ:9},props,walls,
 assemblies:[{id:'crypt',origin:{x:0,z:0},props,walls}],paths:[],graves:[],patches:[],lights:[],
 dependencies:['ink-scenery','ink-crypt','ink-crypt-wall','ink-crypt-flame','ink-crypt-damp','ink-crypt-marble','ink-masonry','ink-decals','ink-ground-transitions','ink-cues','ink-crypt-ambient','ink-crypt-feature'],
 overlaps:[...[-7.4,7.4].flatMap((x,side)=>[2.7,-2.8].map((z,i)=>({a:`crypt-pier-${side}-${i+1}`,b:`crypt-${side?'east':'west'}-return-${i}`,region:{minX:x-.31,maxX:x+.31,minZ:z-.31,maxZ:z+.31},reason:'The bay return is joined to its structural pier'})))],
 decals:[
  {id:'crypt-damp',clip:'t07_damp_spread',x:6.75,z:.15,scale:.7,tint:0x87969b},
  {id:'crypt-puddle',clip:'puddle',asset:'ink-crypt-feature',x:6.6,z:.3,scale:.5,tint:0x7c929c},
  {id:'crypt-moss',clip:'t02_moss_invasion',x:7.2,z:.2,scale:.32,tint:0x727e68},
  {id:'crypt-collapse-crack',clip:'d01_branching_crack',x:6.35,z:1.0,scale:.38,tint:0x929b98},
  {id:'crypt-entry-wear',clip:'t07_damp_spread',x:0,z:7.7,scale:.45,tint:0x858f91,opacity:.14},
  {id:'crypt-altar-wear',clip:'t07_damp_spread',x:0,z:-5.65,scale:.4,tint:0x858f91,opacity:.12},
 ],camera:{bounds:{minX:-3,maxX:3,minZ:-5.4,maxZ:5.9},bias:{x:0,z:-1.5},arrival:{start:3,end:7.5,biasZ:-5.5}},
};
