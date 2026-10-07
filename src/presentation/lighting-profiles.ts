export type LightingRig = 'golden' | 'silver';
export type LookPreset = 'ink' | 'diorama' | 'cinematic';
export type LookSettings = {rig:LightingRig;look:LookPreset;baseline:boolean;lighting:boolean;shadows:boolean;atmosphere:boolean;postprocessing:boolean;strength:number;depthOfField:number};
// Azimuth stays relative to the locked camera: negative side means screen-left.
export function cameraKeyDirection(cameraAzimuth:number,elevation:number,side=-35):readonly [number,number,number]{
 const a=(cameraAzimuth+side)*Math.PI/180,e=elevation*Math.PI/180;
 return [Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)];
}
export const lightingRigs = {
 golden:{label:'Golden hour',key:0xffd293,sky:0xbccce5,ground:0xb1b7c1,elevation:42,side:-35,ambient:1,keyStrength:.95,fog:0xb9a385},
 silver:{label:'Silver hour',key:0xd5e4f3,sky:0xadb9ce,ground:0x99a4bb,elevation:48,side:-35,ambient:.95,keyStrength:.45,fog:0x869bab},
} as const;
export const lookPresets = {
 ink:{label:'Atmospheric ink',contrast:1.03,saturation:.95,bloom:.24,mist:.10,haze:.12,shadow:.24,defocus:0,rim:.16},
 diorama:{label:'HD-2D diorama',contrast:1.08,saturation:1.10,bloom:.48,mist:.10,haze:.10,shadow:.32,defocus:1,rim:.28},
 cinematic:{label:'Dark cinematic',contrast:1.14,saturation:.83,bloom:.40,mist:.16,haze:.20,shadow:.36,defocus:0,rim:.30},
} as const;
export const defaultLook:LookSettings={rig:'golden',look:'diorama',baseline:false,lighting:true,shadows:true,atmosphere:true,postprocessing:true,strength:1.5,depthOfField:1};
export function normalPixels(height:Uint8Array,width:number,heightCount:number,strength=16){
 if(height.length!==width*heightCount)throw new Error('normal height field dimensions differ');
 const out=new Uint8Array(width*heightCount*4),at=(x:number,y:number)=>height[Math.max(0,Math.min(heightCount-1,y))*width+Math.max(0,Math.min(width-1,x))]!/255;
 for(let y=0;y<heightCount;y++)for(let x=0;x<width;x++){
  const nx=(at(x-1,y)-at(x+1,y))*strength,ny=(at(x,y+1)-at(x,y-1))*strength,nz=1,length=Math.hypot(nx,ny,nz),i=(y*width+x)*4;
  out[i]=Math.round((nx/length*.5+.5)*255);out[i+1]=Math.round((ny/length*.5+.5)*255);out[i+2]=Math.round((nz/length*.5+.5)*255);out[i+3]=height[y*width+x]!;
 }
 return out;
}
