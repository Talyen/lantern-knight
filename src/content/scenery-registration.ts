// Measurements are authored against the supplied native drawings, never atlas trims.
// Upright heights exclude painted ground depth; flat/long props use projected length.
export const sceneryRegistration = [
 {id:'pillar',file:'volume_02_gothic/assets/arch_square_pillar_01.png',height:2.8,measurePx:1420},
 {id:'wall',file:'volume_02_gothic/assets/arch_gothic_wall_01.png',height:1.2,measurePx:560,pivot:[260,960] as [number,number],sockets:[[260,960],[1422,583]] as [number,number][]},
 {id:'corner',file:'volume_02_gothic/assets/arch_wall_corner_01.png',height:1.2,measurePx:630},
 {id:'gate',file:'volume_08_landmarks/assets/landmark_mausoleum_entrance_01.png',height:3.5,measurePx:1100},
 {id:'arch',file:'volume_02_gothic/assets/arch_pointed_arch_01.png',height:2.9,measurePx:1260},
 {id:'stairs',file:'volume_02_gothic/assets/arch_three_stairs_01.png',height:.45,measurePx:310},
 {id:'fence',file:'volume_02_gothic/assets/arch_iron_fence_01.png',height:1.2,measurePx:700,pivot:[346,985] as [number,number],sockets:[[346,985],[1210,656]] as [number,number][]},
 {id:'tree',file:'volume_15_tree_forms/assets/vegetation_broad_hollow_oak_01.png',height:5.4,measurePx:1090},
 {id:'yew',file:'volume_15_tree_forms/assets/vegetation_windswept_yew_01.png',height:4.7,measurePx:960},
 {id:'dead-tree',file:'volume_15_tree_forms/assets/vegetation_lightning_split_dead_trunk_01.png',height:5.1,measurePx:1140},
 {id:'foreground',file:'volume_15_tree_forms/assets/vegetation_low_dense_juniper_01.png',height:.9,measurePx:580},
 {id:'fern',file:'volume_01_nature/assets/env_shadow_fern_01.png',height:.45,measurePx:650},
 {id:'gravestone',file:'volume_04_terrain/assets/env_leaning_gravestone_01.png',height:.9,measurePx:1050},
 {id:'tomb',file:'volume_02_gothic/assets/arch_stone_tomb_01.png',height:.65,measurePx:360},
 {id:'rubble',file:'volume_04_terrain/assets/env_masonry_rubble_01.png',height:.35,measurePx:470},
 {id:'lantern',file:'Lantern_Lighting03_CleanInk/png/watch_lantern_lit.png',height:.6,measurePx:400,pivot:[768,1262] as [number,number]},
 {id:'chapel-facade',file:'volume_08_landmarks/assets/landmark_ruined_chapel_facade_01.png',height:5.0,measurePx:1030,pivot:[620,1030] as [number,number]},
 {id:'door-closed',file:'volume_02_gothic/assets/arch_crypt_door_01.png',height:2.25,measurePx:1435,pivot:[520,1450] as [number,number]},
 {id:'cresset',file:'Lantern_Lighting03_CleanInk/png/wall_cresset_lit.png',height:.45,measurePx:390,pivot:[780,995] as [number,number]},
 {id:'votive',file:'Lantern_Lighting03_CleanInk/png/votive_candelabrum_lit.png',height:.48,measurePx:530,pivot:[770,1240] as [number,number]},
 {id:'roots',file:'volume_01_nature/assets/env_exposed_roots_01.png',height:.18,measurePx:200},
 {id:'bramble',file:'volume_01_nature/assets/env_bramble_tangle_02.png',height:.65,measurePx:530},
 {id:'memorial',file:'volume_12_crypt/assets/crypt_blank_memorial_plaque_01.png',height:.8,measurePx:1100},
 {id:'offering-table',file:'volume_12_crypt/assets/crypt_stone_offering_table_01.png',height:.85,measurePx:720},
 {id:'ossuary',file:'volume_12_crypt/assets/crypt_wall_ossuary_cabinet_01.png',height:2.35,measurePx:1420},
 {id:'urn-niche',file:'volume_12_crypt/assets/crypt_urn_niche_stack_01.png',height:1.6,measurePx:1220},
 {id:'funeral-cloth',file:'volume_12_crypt/assets/crypt_funeral_cloth_stand_01.png',height:1.0,measurePx:740},
 {id:'fallen-log',file:'volume_01_nature/assets/env_fallen_log_01.png',height:.42,measurePx:590},
] as const;
// Native fence ground-endpoint displacement converted through the locked camera.
const fence=sceneryRegistration.find(r=>r.id==='fence')!;
const e=Math.atan(1/Math.sqrt(2)),ratio=fence.height*Math.cos(e)/fence.measurePx;
const dx=(1210-346)*ratio,dy=(985-656)*ratio;
export const fenceStep={x:(dx-dy/Math.sin(e))/Math.sqrt(2),z:(-dx-dy/Math.sin(e))/Math.sqrt(2)};

// New native cutouts remain untouched. Endpoints register the painted ground line.
export const restRegistration = [
 {id:'wall-x',file:'wall-x-v1.png',height:2.7,measurePx:600,pivot:[230,620] as [number,number],sockets:[[230,620],[1235,1000]] as [number,number][]},
 {id:'wall-z',file:'wall-z-v1.png',height:2.7,measurePx:700,pivot:[160,1000] as [number,number],sockets:[[160,1000],[1460,700]] as [number,number][]},
 {id:'chapel',file:'chapel-v1.png',height:5.4,measurePx:1180,pivot:[280,1225] as [number,number]},
] as const;
