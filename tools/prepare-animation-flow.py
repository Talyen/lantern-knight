"""Prepare registered guarded transitions for the current kit; original RGBA stays intact."""
from pathlib import Path
import hashlib,json,os,math
import cv2
import numpy as np
cv2.setNumThreads(1)
cv2.setRNGSeed(0)
ROOT=Path(__file__).resolve().parents[1]
WORK=Path(os.environ['LANTERN_ASSET_WORKSPACE'])
source_file=WORK/'staging/ink/ink-hero-current.json'
source=json.loads(source_file.read_text())
motion_file=ROOT/'authoring/hero-motion.json'
motion_recipe=json.loads(motion_file.read_text())
original=json.loads((WORK/'staging/ink/hero-receipt.json').read_text())['originalTimings']
frames={f['id']:f for f in source['frames']}
if motion_recipe['schemaVersion']!=1 or set(motion_recipe['frames'])!=set(frames):raise ValueError('Motion recipe must cover exactly the selected drawings')
W,H,G=128,160,2
SX,SY=W+G*2,H+G*2
records,clips,images,prepared,offsets=[],{}, {},{},{}
for fid,f in frames.items():
 data=(WORK/'staging'/f['path']).read_bytes()
 prepared[f['path']]=hashlib.sha256(data).hexdigest()
 images[fid]=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_UNCHANGED)

def domain(ids):
 regs=[frames[i].get('registration',source['asset']) for i in ids]
 density=min(r['density'] for r in regs)
 bounds=[]
 for fid,r in zip(ids,regs):
  ys,xs=np.nonzero(images[fid][:,:,3])
  bounds.append([(xs.min()-r['anchor'][0])/r['density'],(ys.min()-r['anchor'][1])/r['density'],(xs.max()+1-r['anchor'][0])/r['density'],(ys.max()+1-r['anchor'][1])/r['density']])
 left=min(b[0] for b in bounds);top=min(b[1] for b in bounds);right=max(b[2] for b in bounds);bottom=max(b[3] for b in bounds)
 return {'canvas':[math.ceil((right-left)*density)+48,math.ceil((bottom-top)*density)+48],'anchor':[-left*density+24,-top*density+24],'density':density}

def normalized(fid,d):
 r=frames[fid].get('registration',source['asset'])
 scale=d['density']/r['density']
 matrix=np.float32([[scale,0,d['anchor'][0]-r['anchor'][0]*scale],[0,scale,d['anchor'][1]-r['anchor'][1]*scale]])
 rgba=cv2.warpAffine(images[fid],matrix,tuple(d['canvas']),flags=cv2.INTER_LINEAR)
 small=cv2.resize(rgba,(W,H),interpolation=cv2.INTER_AREA)
 gray=np.rint((cv2.cvtColor(small[:,:,:3],cv2.COLOR_BGR2GRAY)*.65+80)*small[:,:,3]/255).astype(np.uint8)
 return gray,rgba

def reviewed_blade(fid,d):
 r=frames[fid].get('registration',source['asset']);entry=motion_recipe['frames'][fid]['sword']
 if entry['visibility']!='visible':return None
 line=np.array(entry['line'],np.float32).reshape(2,2)
 if not np.isfinite(line).all() or np.linalg.norm(line[1]-line[0])<1 or (line<0).any() or (line>r['canvas']).any():raise ValueError('Invalid native sword landmarks: '+fid)
 return ((line-r['anchor'])*d['density']/r['density']+d['anchor']).flatten().tolist()

def landmark(fid,d,stabilized):
 r=frames[fid].get('registration',source['asset']);point=np.array(motion_recipe['frames'][fid]['bodyPoint'],np.float32)
 if not np.isfinite(point).all() or (point<0).any() or (point>r['canvas']).any():raise ValueError('Invalid body correspondence marker: '+fid)
 if stabilized:point+=np.array(offsets[fid],np.float32)
 return ((point-r['anchor'])*d['density']/r['density']+d['anchor'])*np.float32([W/d['canvas'][0],H/d['canvas'][1]])

def guarded(first,reverse,canvas,cap):
 yy,xx=np.mgrid[:H,:W].astype(np.float32)
 x,y=xx+first[:,:,0],yy+first[:,:,1]
 match=cv2.remap(reverse,x,y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 scales=np.float32([canvas[0]/W,canvas[1]/H])
 error=np.linalg.norm((first+match)*scales,axis=2)
 t=np.clip((error-2)/4,0,1);confidence=1-t*t*(3-2*t)
 confidence[(x<0)|(x>W-1)|(y<0)|(y>H-1)]=0
 native=first*scales
 native*=np.minimum(1,cap/np.maximum(np.linalg.norm(native,axis=2),1e-6))[:,:,None]
 return native*confidence[:,:,None]

for name,dirs in source['asset']['clips'].items():
 for heading,clip in dirs.items():
  ids=clip['frames'];d=domain(ids)
  gray={};swords={};rgba_small={}
  for fid in dict.fromkeys(ids):
   gray[fid],rgba=normalized(fid,d);swords[fid]=reviewed_blade(fid,d);rgba_small[fid]=cv2.resize(rgba,(W,H),interpolation=cv2.INTER_AREA)
  # Only reviewed residual corrections move artwork, never actor roots.
  for fid in dict.fromkeys(ids):
   r=frames[fid].get('registration',source['asset']);offsets[fid]=motion_recipe['frames'][fid]['offsetPx']
   if len(offsets[fid])!=2 or not np.isfinite(offsets[fid]).all() or np.linalg.norm(offsets[fid])>r['density']*.05:raise ValueError('Unbounded presentation correction: '+fid)
  registered={}
  for fid in dict.fromkeys(ids):
   r=frames[fid].get('registration',source['asset']);delta=np.array(offsets[fid])*d['density']/r['density']
   registered[fid]=cv2.warpAffine(gray[fid],np.float32([[1,0,delta[0]*W/d['canvas'][0]],[0,1,delta[1]*H/d['canvas'][1]]]),(W,H),flags=cv2.INTER_LINEAR)
  # Contact/loading weighting is direction-specific and preserves the full cycle.
  holds=clip['durationsMs']
  if name=='walk' and heading in ('d00','d90','d180','d270'):
   weights=[]
   for fid in ids:
    a=images[fid][:,:,3];ys,xs=np.nonzero(a>220)
    bottom=int(np.percentile(ys,96));feet=xs[ys>=bottom]
    spread=float(np.std(feet)) if len(feet) else 0
    weights.append(spread)
   low,high=min(weights),max(weights)
   factors=[.85+.3*((v-low)/(high-low) if high>low else .5) for v in weights]
   weighted=[v*f for v,f in zip(holds,factors)];ratio=sum(holds)/sum(weighted);weighted=[v*ratio for v in weighted]
  else:weighted=holds
  direction=motion_recipe['clips'][f'{name}:{heading}']
  if 'weightedHoldsTicks' in direction:
   weighted=[v*1000/60 for v in direction['weightedHoldsTicks']]
   if name!='walk' or len(weighted)!=len(holds) or any(v<=0 for v in weighted) or abs(sum(weighted)-sum(holds))>.001:raise ValueError('Weighted rhythm must preserve the source cycle')
  clips[f'{name}:{heading}']={'asset':'ink-hero-current','frames':ids,'weightedHoldsMs':weighted,'originalHoldsMs':original[name][heading]['holdsMs'],'loop':clip['loop'],'registration':d}
  if len(direction['transitions'])!=len(ids) or len(direction['swordRotationRad'])!=len(ids):raise ValueError('Incomplete transition review')
  adjacent=list(zip(ids,ids[1:]+([ids[0]] if clip['loop'] else [ids[-1]])))
  for cel,(first,second) in enumerate(adjacent):
   if first==second:continue
   variants=[]
   for variant,samples in enumerate((registered,gray)):
    engine=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    shift=landmark(second,d,variant==0)-landmark(first,d,variant==0)
    seed=np.empty((H,W,2),np.float32);seed[:]=shift
    fw=engine.calc(samples[first],samples[second],seed.copy());bw=engine.calc(samples[second],samples[first],-seed.copy())
    fields=np.concatenate([guarded(fw,bw,d['canvas'],d['density']*.35),guarded(bw,fw,d['canvas'],d['density']*.35)],axis=2)
    signed=np.rint(np.clip(fields/2,-128,127))
    for channels in (slice(0,2),slice(2,4)):
     pair=signed[:,:,channels];signed[:,:,channels]=np.trunc(pair*np.minimum(1,(d['density']*.35/2)/np.maximum(np.linalg.norm(pair,axis=2),1e-6))[:,:,None])
    variants.append((signed+128).astype(np.uint8))
   # Hold ambiguous equipment/pose transitions instead of guessing blade geometry.
   a,b=swords[first],swords[second]
   visible=motion_recipe['frames'][first]['sword']['visibility'],motion_recipe['frames'][second]['sword']['visibility']
   hidden=visible==('hidden','hidden')
   if a and b:
    da=np.array(a[2:])-a[:2];db=np.array(b[2:])-b[:2];ratio=np.linalg.norm(da)/np.linalg.norm(db)
    if not .65<=ratio<=1.55:a=None
   # Reject visible silhouette/color disagreement after the exact capped inverse
   # mapping used by the renderer. Failed correspondence must not crossfade
   # two limbs, lanterns or faces just because a blade was detected.
   first_rgba=rgba_small[first].astype(np.float32)/255;second_rgba=rgba_small[second].astype(np.float32)/255
   for rgba,fid in ((first_rgba,first),(second_rgba,second)):
    r=frames[fid].get('registration',source['asset']);delta=np.array(offsets[fid])*d['density']/r['density']
    rgba[:]=cv2.warpAffine(rgba,np.float32([[1,0,delta[0]*W/d['canvas'][0]],[0,1,delta[1]*H/d['canvas'][1]]]),(W,H),flags=cv2.INTER_LINEAR)
   encoded=variants[0].astype(np.float32)
   motion=(encoded-128)*2/np.float32([d['canvas'][0]/W,d['canvas'][1]/H]*2)
   yy,xx=np.mgrid[:H,:W].astype(np.float32);base=np.stack([xx,yy],axis=2)
   scores=[];errors=[]
   for phase in (.25,.5,.75):
    qa=base.copy();qb=base.copy()
    for _ in range(2):
     qa=base-phase*cv2.remap(motion[:,:,:2],qa[:,:,0],qa[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
     qb=base-(1-phase)*cv2.remap(motion[:,:,2:],qb[:,:,0],qb[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
    ca=cv2.remap(first_rgba,qa[:,:,0],qa[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    cb=cv2.remap(second_rgba,qb[:,:,0],qb[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    aa,ab=ca[:,:,3],cb[:,:,3]
    weight=np.ones((H,W),np.float32)
    # The rigid pass selects one blade's paint, so body-coherence checks must
    # exclude that protected region instead of penalizing sword rotation twice.
    if a and b:
     for q,line in ((qa,a),(qb,b)):
      points=q*np.float32([d['canvas'][0]/W,d['canvas'][1]/H]);start=np.array(line[:2]);axis=np.array(line[2:])-start
      t=np.clip(((points-start)*axis).sum(2)/(axis*axis).sum(),0,1)
      distance=np.linalg.norm(points-start-axis*t[:,:,None],axis=2)
      weight[distance<max(10,d['density']*.035)+4]=0
    aa*=weight;ab*=weight;union=np.maximum(aa,ab);total=max(float(union.sum()),1e-6)
    scores.append(float(np.minimum(aa,ab).sum())/total)
    errors.append(float(np.abs(ca[:,:,:3]*aa[:,:,None]-cb[:,:,:3]*ab[:,:,None]).sum())/(total*3))
   coherent=min(scores)>=.96 and max(errors)<=.09
   equipment=bool(a and b) or hidden;supported=equipment and coherent
   intent=direction['transitions'][cel];beat=motion_recipe['beats'][intent]
   if not 0<=beat['holdFraction']<1 or beat['easing'] not in ('linear','ease-in','ease-out','smoothstep'):raise ValueError('Invalid transition timing')
   reason=intent+'; '+('registered body correspondence; equipment stays occluded' if hidden and supported else 'registered body and rigid blade' if supported else 'held: equipment visibility/registration changes' if not equipment else 'held: silhouette or color correspondence disagrees')
   record={'asset':'ink-hero-current','clip':name,'heading':heading,'from':first,'to':second,**d,'supported':bool(supported),'silhouetteAgreement':min(scores),'colorError':max(errors),'rejectionReason':None if supported else 'uncertain-sword' if not equipment else 'pose-disagreement','weaponVisibility':'hidden' if hidden else 'visible' if a and b else 'uncertain','intent':intent,**beat,'reviewReason':reason,'offsetA':(np.array(offsets[first])*d['density']/frames[first].get('registration',source['asset'])['density']).tolist(),'offsetB':(np.array(offsets[second])*d['density']/frames[second].get('registration',source['asset'])['density']).tolist()}
   if a and b:
    widths=[motion_recipe['frames'][f]['sword']['width']*d['density']/frames[f].get('registration',source['asset'])['density'] for f in (first,second)]
    record['sword']={'a':a,'b':b,'width':max(widths),'rotationRad':direction['swordRotationRad'][cel]}
   records.append((record,variants))
columns=24
atlas=np.full((max(1,math.ceil(len(records)*2/columns))*SY,columns*SX,4),128,np.uint8)
pairs=[]
for i,(record,variants) in enumerate(records):
 for variant,encoded in enumerate(variants):
  index=i*2+variant;x,y=index%columns*SX,index//columns*SY
  atlas[y:y+SY,x:x+SX]=cv2.copyMakeBorder(encoded,G,G,G,G,cv2.BORDER_REPLICATE)
  rect=[x+G,y+G,W,H]
  for key in (('rect','guardedRect') if variant==0 else ('rawRect','rawGuardedRect')):record[key]=rect
 pairs.append(record)
output=WORK/'staging/animation';output.mkdir(parents=True,exist_ok=True)
data=cv2.imencode('.png',cv2.cvtColor(atlas,cv2.COLOR_RGBA2BGRA),[cv2.IMWRITE_PNG_COMPRESSION,9])[1].tobytes()
(output/'flow.png').write_bytes(data)
metadata={'recipe':'current-kit-directed-v3','width':atlas.shape[1],'height':atlas.shape[0],'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'canvas':source['asset']['canvas'],'pairs':pairs,'offsets':offsets,'clips':clips,'preparedHashes':prepared,'tuningHash':hashlib.sha256((ROOT/'authoring/hero-actions.json').read_bytes()).hexdigest(),'motionHash':hashlib.sha256(motion_file.read_bytes()).hexdigest(),'stagedSourceHash':hashlib.sha256(source_file.read_bytes()).hexdigest(),'opencv':cv2.__version__,'limitations':['Estimated correspondence; uncertain sword transitions retain authored holds.','Source canvas/pivot/density registrations are preserved; no inferred root motion.']}
(output/'flow.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(f'Prepared {len(pairs)} current-kit pairs; {sum(p["supported"] for p in pairs)} guarded candidates; remaining pairs retain held drawings.')
