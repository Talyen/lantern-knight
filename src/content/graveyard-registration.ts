// Native measurements for the cemetery kit; originals and hashes live in its provenance receipt.
export const graveyardRegistration = [
 {id:'boundary-x',file:'boundary-x.png',height:1.05,measurePx:350,pivot:[155,414] as [number,number],sockets:[[155,414],[1345,984]] as [number,number][],topSockets:[[155,65],[1345,590]] as [number,number][]},
 {id:'boundary-z',file:'boundary-z.png',height:1.05,measurePx:340,pivot:[155,905] as [number,number],sockets:[[155,905],[1440,449]] as [number,number][],topSockets:[[155,545],[1440,134]] as [number,number][]},
] as const;
export const graveyardExtraRegistration = [
 {id:'pine',file:'volume_15_tree_forms/assets/vegetation_tall_split_pine_01.png',height:4.9},
 {id:'birch',file:'volume_15_tree_forms/assets/vegetation_pale_birch_cluster_01.png',height:4.3},
 {id:'juniper',file:'volume_15_tree_forms/assets/vegetation_low_dense_juniper_01.png',height:.85},
 {id:'fallen-marker',file:'volume_12_crypt/assets/crypt_leaning_sarcophagus_lid_01.png',height:.8},
 {id:'lantern-hardware',pivot:[768,1276] as const,file:'Lantern_Lighting03_CleanInk/png/watch_lantern_unlit.png',height:.6},
 {id:'cresset-hardware',pivot:[780,995] as const,file:'Lantern_Lighting03_CleanInk/png/wall_cresset_unlit.png',height:.45},
 {id:'crook-lamp',pivot:[768,1284] as const,file:'Lantern_Lighting03_CleanInk/png/crook_street_lamp_unlit.png',height:2.8},
] as const;
