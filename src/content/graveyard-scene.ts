import type {Point} from './world';
import type {ArtPlacement,BurialPlot,SiteWall,WorldVisualDefinition} from './world-art';
import {burialTerraces,terraceHeight} from './graveyard-layout';
const stone=0xc2c7b7;
export const graveRows:BurialPlot[]=[
 {id:'family-kept',x:-4.35,z:1.2,width:.8,length:1.7,age:'old',angle:-.13},
 {id:'family-plaque',x:-5.65,z:.05,width:.7,length:1.5,age:'old',angle:.16,marker:'memorial'},
 {id:'family-old',x:-4.6,z:-.75,width:.82,length:1.65,age:'old',angle:-.22},
 {id:'east-old-1',x:4.65,z:1.7,width:.8,length:1.75,age:'old',angle:.3},
 {id:'east-old-2',x:5.7,z:.05,width:.8,length:1.6,age:'old',angle:.13,marker:'memorial'},
 {id:'east-old-3',x:4.4,z:-1.9,width:.82,length:1.65,age:'old',angle:-.2},
 {id:'disturbed',x:-5.25,z:-4.15,width:.9,length:1.7,age:'damaged',marker:'fallen-marker'},
 {id:'recent',x:4.8,z:-2.1,width:.8,length:1.7,age:'kept',angle:.16},
];
export function graveHead(g:BurialPlot):Point{const a=g.angle??0;return {x:g.x+Math.sin(a)*(g.length/2+.06),z:g.z-Math.cos(a)*(g.length/2+.06)};}
const props:ArtPlacement[]=[
 ...graveRows.map(g=>({id:`grave-${g.id}`,clip:g.marker??'gravestone',...graveHead(g),y:terraceHeight(g.x,g.z),scale:g.marker==='fallen-marker'?.85:g.marker==='memorial'?.8:1,tint:stone,footprint:[.55,.3] as const,footprintAngle:g.angle??0,assembly:`burial-${g.id}`,purpose:`Settled ${g.age} burial within its terraced group`})),
 {id:'family-tomb-west',clip:'tomb',x:-6.1,z:1.4,y:.55,tint:stone,footprint:[.85,2.1],purpose:'Mossed family sarcophagus on the western terrace'},
 {id:'family-tomb-east',clip:'tomb',x:6.15,z:-2.9,y:.7,tint:0xa9b8a5,footprint:[.85,2.1],purpose:'Older tomb partially swallowed by the eastern planting'},
 {id:'boundary-oak',clip:'oak',asset:'ink-blackwood-oak',x:-7.15,z:-1.9,scale:1.10,fade:true,tint:0xd4deca,purpose:'Ancient oak shaping the western burial terrace and clearing'},
 {id:'gate-lamp',clip:'crook-lamp',x:-4.25,z:7.1,scale:.9,footprint:[.2,.2],purpose:'Warm lamp at the broken approach gateway'},
 {id:'threshold-light',clip:'lantern-hardware',x:-1.45,z:-5.35,purpose:'Warm light marking the chapel threshold'},
 {id:'chapel-cresset',clip:'cresset-hardware',x:-1.2,z:-6.0,y:1.7,purpose:'Cresset mounted beside the recessed chapel door'},
 ...[[-5.6,3.1],[-6.7,-.8],[-4.9,-2.4],[5.8,2.9],[6.5,-.8],[3.5,-2.7],[-6.3,-5.6]].map(([x,z],i)=>({id:`understory-mass-${i}`,clip:'juniper',x:x!,z:z!,y:terraceHeight(x!,z!),scale:.9+(i%2)*.12,tint:0xa5ad8d,purpose:'Layered understory joining the burial terrace to woodland'})),
 ...[[-4.9,3.25],[-6.0,1.7],[-5.7,-1.8],[3.4,2.8],[5.2,-.1],[6.1,-3.8],[-3.7,-4.8]].map(([x,z],i)=>({id:`fern-bank-${i}`,clip:'fern',x:x!,z:z!,y:terraceHeight(x!,z!),scale:1.05,tint:0xbbbca0,purpose:'Sheltered fern bank beside settled masonry'})),
 ...[[-3.1,1.7],[-3.1,.2],[3.3,2.6],[3.15,-1.1],[-3.35,-4.0],[-6.45,-2.8]].map(([x,z],i)=>({id:`rim-overgrowth-${i}`,clip:'bramble',x:x!,z:z!,y:terraceHeight(x!,z!),scale:.7,tint:0x989d80,purpose:'Grouped sheltered growth knitting turf and retaining stone together'})),
 ...[[-11,4],[-10,-6],[-5,-13],[3,-16],[10,-12],[11,-4],[12,4],[-8,10],[7,11]].map(([x,z],i)=>({id:`woodland-${i}`,clip:'woodland',asset:'ink-blackwood-woodland',x:x!,z:z!,scale:.90+(i%2)*.05,mirror:i%2===1,fade:z!>4||x!>6,tint:i<4?0x8faaa2:0x99b3a7,purpose:'Connected woodland silhouettes with varied trunks and sweeping interlocked canopy'})),
 ...[[-17,3],[-16,-10],[-8,-19],[5,-21],[17,-14],[18,0],[16,12]].map(([x,z],i)=>({id:`woodland-far-${i}`,clip:'woodland',asset:'ink-blackwood-woodland',x:x!,z:z!,scale:.9,mirror:i%2===0,tint:0x719193,purpose:'Quiet distant woodland band behind the near tree groups'})),
 {id:'foreground-oak',clip:'oak',asset:'ink-blackwood-oak',x:7.8,z:8.7,scale:.95,mirror:true,fade:true,tint:0x9ab0a0,purpose:'Dark near trunk and branches framing the clearing'},
];
const walls:SiteWall[]= [...burialTerraces.flatMap(t=>t.points.map((from,i)=>({id:`${t.id}-rim-${i}`,from,to:t.points[(i+1)%t.points.length]!,height:t.height,thickness:.42,surface:'masonry' as const,assembly:t.id,fade:t.id==='east-old'}))),

 {id:'chapel-front-left',from:{x:-3.2,z:-6.15},to:{x:-.85,z:-6.15},height:3.1,thickness:.35,surface:'masonry',assembly:'chapel'},
 {id:'chapel-front-right',from:{x:.85,z:-6.15},to:{x:3.2,z:-6.15},height:3.1,thickness:.35,surface:'masonry',assembly:'chapel'},
 {id:'gateway-west-pier',from:{x:-4.79,z:7.55},to:{x:-4.21,z:7.55},height:2.45,thickness:.55,surface:'masonry',assembly:'gateway'},
 {id:'gateway-east-pier',from:{x:-2.29,z:7.55},to:{x:-1.71,z:7.55},height:1.85,thickness:.55,surface:'masonry',assembly:'gateway'},
];
const fixtures=[{id:'entrance-flame',prop:'gate-lamp',socket:[.24,1.67,-.24] as const,power:.65,radius:3,phase:.2,flameScale:.3},{id:'porch-flame',prop:'threshold-light',socket:[-.03,.22,.03] as const,power:.6,radius:3,phase:.7,flameScale:.25},{id:'cresset-flame',prop:'chapel-cresset',socket:[-.11,.32,.11] as const,power:1.1,radius:4.1,phase:.45,smoke:true,flameScale:.6}];
export const graveyardScene:WorldVisualDefinition={
 floor:'ink-graveyard-materials',props:props.map(p=>{const f=fixtures.find(f=>f.prop===p.id);return {...p,shadow:'none' as const,...(['juniper','fallen-marker','crook-lamp','lantern-hardware','cresset-hardware'].includes(p.clip)?{asset:'ink-graveyard-scenery'}:{}),...(f?{light:{offset:f.socket.map(v=>v/(p.scale??1)) as [number,number,number],power:f.power,range:f.radius,phase:f.phase}}:{})};}),walls,fixtures,
 paths:[{width:1.45,widths:[1.4,1.5,1.65,2.3,2.5,1.8],points:[{x:-3.3,z:40},{x:-3.3,z:7.4},{x:-2.5,z:4.6},{x:-.2,z:2.2},{x:.2,z:-1.5},{x:0,z:-5.8}]}],
 graves:graveRows,patches:[],lights:[],decals:[
 {id:'tree-leaves',clip:'d05_leaf_drift',x:-4.8,z:3.0,scale:.8},
 {id:'old-roots',clip:'t08_crossing_root',x:-5.8,z:.3,scale:.7,rotation:.6},
 {id:'porch-scuffs',clip:'d08_dirt_scuffs',x:0,z:-5.0,scale:.3},
 {id:'gate-scuffs',clip:'d08_dirt_scuffs',x:-3.3,z:7.4,scale:.25},
 {id:'family-damp',clip:'t07_damp_spread',x:4.55,z:-2.0,scale:.7},
 {id:'east-puddle',clip:'t06_still_puddle',x:2.4,z:3.8,scale:.3},
 {id:'west-leaf-bank',clip:'d06_scattered_leaves',x:-2.7,z:3.5,scale:.4},
 {id:'family-moss',clip:'d03_moss_edge',x:4.5,z:-2.8,scale:.5},
 {id:'old-grave-moss',clip:'d04_moss_islands',x:-4.2,z:-1.0,scale:.55},
 ].map(p=>({...p,asset:'ink-graveyard-overlays'})),
 dependencies:['ink-scenery','ink-graveyard-scenery','ink-graveyard-overlays','ink-ambient','ink-moss','ink-masonry','ink-soil','ink-chapel-front','ink-churchyard-roof','ink-blackwood-oak','ink-blackwood-woodland','ink-cues'],
 camera:{bounds:{minX:-1.5,maxX:2.0,minZ:-6.4,maxZ:3.7},bias:{x:.8,z:-3.0}},assemblies:[],overlaps:[],
};
