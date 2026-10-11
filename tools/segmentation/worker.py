"""Local JSON-lines image selection worker. stdout is exclusively protocol frames."""
import contextlib
import json
import os
import sys
import time
from collections import OrderedDict

import cv2
import numpy as np
from PIL import Image

predictor = None
device = 'cpu'
embeddings = OrderedDict()


def model():
    global predictor, device
    if predictor is None:
        with contextlib.redirect_stdout(sys.stderr):
            import torch
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            device = 'mps' if torch.backends.mps.is_available() else 'cpu'
            root = os.environ['LANTERN_SAM_ROOT']
            settings_file = os.path.join(root, 'settings.json')
            settings = json.load(open(settings_file)) if os.path.exists(settings_file) else {}
            variant = settings.get('model', 'small')
            config = {'small': 's', 'large': 'l'}[variant]
            predictor = SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_'+config+'.yaml', os.path.join(root, 'sam2.1_hiera_'+variant+'.pt'), device=device, apply_postprocessing=False))
    return predictor


def contours(mask, offset, dimensions):
    found, hierarchy = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    def ring(c):
        simplified = cv2.approxPolyDP(c, 0.5, True).reshape(-1, 2)
        return [[round(float(x + offset[0]) / dimensions[0], 8), round(float(y + offset[1]) / dimensions[1], 8)] for x, y in simplified]
    shapes = []
    for i, c in enumerate(found):
        if hierarchy[0][i][3] != -1 or len(c) < 3:
            continue
        outer = ring(c)
        if len(outer) < 3:
            continue
        holes = []
        child = hierarchy[0][i][2]
        while child != -1:
            hole = ring(found[child])
            if len(hole) >= 3:
                holes.append(hole)
            child = hierarchy[0][child][0]
        shapes.append({'outer': outer, 'holes': holes})
    return shapes


def run(request):
    global device, predictor
    started = time.perf_counter()
    with Image.open(request['image']) as source:
        full = source.convert('RGB').crop(request['frameRect'])
    if 'canvas' in request:
        canvas = Image.new('RGB', tuple(request['canvas']))
        canvas.paste(full, tuple(request['trim'][:2]))
        full = canvas
    dimensions = full.size
    if request.get('operation') == 'detect':
        from detector import detect
        return detect(full, request['text'])
    x0,y0,x1,y1 = request['crop']
    x0=max(0,int(x0*dimensions[0])); y0=max(0,int(y0*dimensions[1]))
    x1=min(dimensions[0],int(np.ceil(x1*dimensions[0]))); y1=min(dimensions[1],int(np.ceil(y1*dimensions[1])))
    image=np.array(full.crop((x0,y0,x1,y1)))
    p=model()
    import torch
    key=(request['identity'],x0,y0,x1,y1,device)
    def predict():
        if key in embeddings:
            p._features, p._orig_hw = embeddings.pop(key)
            p._is_image_set = True
        else:
            p.set_image(image)
        embeddings[key]=(p._features,p._orig_hw)
        while len(embeddings)>2:
            embeddings.popitem(last=False)
        points=request.get('points',[])
        coords=np.array([[v['uv'][0]*dimensions[0]-x0,v['uv'][1]*dimensions[1]-y0] for v in points],dtype=np.float32) if points else None
        labels=np.array([1 if v['include'] else 0 for v in points],dtype=np.int32) if points else None
        box=request.get('box')
        if box:
            box=np.array([box[0]*dimensions[0]-x0,box[1]*dimensions[1]-y0,box[2]*dimensions[0]-x0,box[3]*dimensions[1]-y0],dtype=np.float32)
        masks,scores,_=p.predict(point_coords=coords,point_labels=labels,box=box,multimask_output=True)
        return masks[int(np.argmax(scores))].astype(bool)
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        try:
            mask=predict()
        except (RuntimeError, NotImplementedError):
            if device != 'mps':
                raise
            p.model.to('cpu'); device='cpu'; embeddings.clear(); p.reset_predictor()
            mask=predict()
    shapes=contours(mask,(x0,y0),dimensions)
    return {'mask':shapes,'device':device,'milliseconds':round((time.perf_counter()-started)*1000)}


for line in sys.stdin:
    try:
        request=json.loads(line)
        response={'id':request['id'],'result':run(request)}
    except Exception as error:
        response={'id':request.get('id'),'error':str(error)}
    print(json.dumps(response,separators=(',',':')),flush=True)
