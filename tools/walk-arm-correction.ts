import sharp from 'sharp';
export type ArmCorrection={shift:[number,number];shoulder:[number,number];elbow:[number,number];wrist:[number,number];sword:[number,number,number,number];radius:number};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function distance(x:number,y:number,a:readonly number[],b:readonly number[]){const dx=b[0]!-a[0]!,dy=b[1]!-a[1]!,t=clamp(((x-a[0]!)*dx+(y-a[1]!)*dy)/(dx*dx+dy*dy));return Math.hypot(x-a[0]!-dx*t,y-a[1]!-dy*t);}
export function armDisplacement(x:number,y:number,c:ArmCorrection):[number,number]{
 if(y<=c.shoulder[1]||y<380&&x>=245)return [0,0];
 const t=clamp((y-c.shoulder[1])/(c.wrist[1]-c.shoulder[1])),progress=t*t*(3-2*t);
 const arm=Math.min(distance(x,y,c.shoulder,c.elbow),distance(x,y,c.elbow,c.wrist));
 const blade=distance(x,y,c.sword.slice(0,2),c.sword.slice(2));
 const weight=Math.max(progress*Math.exp(-arm*arm/(2*c.radius*c.radius)),Math.exp(-blade*blade/(2*c.radius*c.radius)));
 if(weight<.001)return [0,0];return [c.shift[0]*weight,c.shift[1]*weight];
}
// Invert one local, smooth paint displacement; the source remains untouched.
// Premultiplied sampling avoids dark RGB leaking through transparent edge pixels.
export async function correctWalkArm(png:Buffer,c:ArmCorrection){
 const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}),out=Buffer.from(data),{width,height}=info;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const initial=armDisplacement(x,y,c);if(!initial[0]&&!initial[1])continue;
  let sx=x,sy=y;for(let n=0;n<20;n++){const d=armDisplacement(sx,sy,c);sx=x-d[0];sy=y-d[1];}
  const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;let alpha=0,r=0,g=0,b=0;
  for(const [dx,dy,w]of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]] as const){
   const xx=x0+dx,yy=y0+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;const i=(yy*width+xx)*4,a=data[i+3]!/255*w;alpha+=a;r+=data[i]!*a;g+=data[i+1]!*a;b+=data[i+2]!*a;
  }
  const i=(y*width+x)*4;out[i+3]=Math.round(alpha*255);out[i]=alpha?Math.round(r/alpha):0;out[i+1]=alpha?Math.round(g/alpha):0;out[i+2]=alpha?Math.round(b/alpha):0;
 }
 return sharp(out,{raw:{width,height,channels:4}}).png().toBuffer();
}
