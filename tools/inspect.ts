import fs from 'node:fs/promises';
import sharp from 'sharp';
import {parseSource} from '../src/assets/schema';
const source=parseSource(JSON.parse(await fs.readFile('staging/source.json','utf8')));
await fs.mkdir('evidence',{recursive:true});
for(const clip of ['walk','attack_sword_01']) {
  const c=source.asset.clips[clip]!.d45!,images=await Promise.all(c.frames.map(id=>fs.readFile(`staging/${source.frames.find(f=>f.id===id)!.path}`)));
  const tiles=await Promise.all(images.map(b=>sharp(b).resize(192,216).png().toBuffer()));
  const captions=Buffer.from(`<svg width="${tiles.length*192}" height="250" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#292630"/>${tiles.map((_,i)=>`<text x="${i*192+10}" y="240" fill="#dec28d" font-family="monospace" font-size="12">${i+1} · ${c.durationsMs[i]} ms · PROXY</text>`).join('')}</svg>`);
  await sharp(captions).composite(tiles.map((input,i)=>({input,left:i*192,top:0}))).png().toFile(`evidence/${clip}-contact.png`);
  // Uniform preview sampling follows authored durations, including fast attack frames and holds.
  const duration=c.durationsMs.reduce((a,b)=>a+b,0),sampled=[] as Buffer[];
  for(let t=0;t<duration;t+=50){let index=0,end=c.durationsMs[0]!;while(t>=end&&index<c.frames.length-1)end+=c.durationsMs[++index]!;sampled.push(await sharp(images[index]!).flatten({background:'#292630'}).raw().toBuffer());}
  await sharp(Buffer.concat(sampled),{raw:{width:384,height:432*sampled.length,channels:3,pageHeight:432}}).gif({loop:0,delay:Array(sampled.length).fill(50)}).toFile(`evidence/${clip}-preview.gif`);
}
const turn=[];for(let i=0;i<8;i++){const file=`authoring/knight/turnaround_d${String(i*45).padStart(2,'0')}.png`;turn.push(await sharp(file).resize(192,216).png().toBuffer());}
await sharp({create:{width:1536,height:250,channels:4,background:'#292630'}}).composite([...turn.map((input,i)=>({input,left:i*192,top:0})),{input:Buffer.from(`<svg width="1536" height="250" xmlns="http://www.w3.org/2000/svg">${turn.map((_,i)=>`<text x="${i*192+20}" y="240" fill="#dec28d" font-size="14">d${String(i*45).padStart(2,'0')} · PROXY</text>`).join('')}</svg>`),left:0,top:0}]).png().toFile('evidence/turnaround.png');
console.log('Contact sheets, timing-respecting GIF previews and proxy turnaround in evidence/');
