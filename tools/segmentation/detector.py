"""Text-guided scenery proposals. Loaded only by the local authoring worker."""
import contextlib
import os
import sys
import time

REVISION = '12bdfa3120f3e7ec7b434d90674b3396eccf88eb'
MODEL = 'IDEA-Research/grounding-dino-base'
processor = None
detector = None


def load():
    global processor, detector
    if detector is None:
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        options = dict(revision=REVISION,
                       cache_dir=os.path.join(os.environ['LANTERN_SAM_ROOT'], 'detector-cache'),
                       local_files_only=True)
        with contextlib.redirect_stdout(sys.stderr):
            processor = AutoProcessor.from_pretrained(MODEL, **options)
            detector = AutoModelForZeroShotObjectDetection.from_pretrained(MODEL, **options).to('cpu').eval()
    return processor, detector


def overlap(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return intersection / max(1e-12, area_a + area_b - intersection)


def detect(full, text):
    import torch
    started = time.perf_counter()
    processor, detector = load()
    image = full.copy()
    image.thumbnail((1920, 1920))
    width, height = image.size
    tile_w, tile_h = min(width, 1280), min(height, 854)
    xs = range(0, max(1, width - tile_w + 1), max(1, tile_w // 2))
    ys = range(0, max(1, height - tile_h + 1), max(1, tile_h // 2))
    xs = sorted(set([*xs, width - tile_w]))
    ys = sorted(set([*ys, height - tile_h]))
    candidates = []
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        for y in ys:
            for x in xs:
                crop = image.crop((x, y, x + tile_w, y + tile_h))
                inputs = processor(images=crop, text=text, return_tensors='pt')
                outputs = detector(**inputs)
                result = processor.post_process_grounded_object_detection(
                    outputs, inputs.input_ids, threshold=.25, text_threshold=.25,
                    target_sizes=[crop.size[::-1]])[0]
                for score, label, box in zip(result['scores'], result['text_labels'], result['boxes']):
                    a, b, c, d = box.tolist()
                    uv = [max(0, (a+x)/width), max(0, (b+y)/height),
                          min(1, (c+x)/width), min(1, (d+y)/height)]
                    if uv[2] <= uv[0] or uv[3] <= uv[1]:
                        continue
                    # Crop-edge detections are often fragments. Prefer complete instances.
                    clipped = ((x > 0 and a < 3) or (y > 0 and b < 3) or
                               (x+tile_w < width and c > tile_w-3) or
                               (y+tile_h < height and d > tile_h-3))
                    candidates.append(dict(name=label, box=uv, score=float(score), clipped=clipped))
    accepted = []
    for candidate in sorted(candidates, key=lambda r: (r['clipped'], -r['score'])):
        if any(candidate['name'] == other['name'] and overlap(candidate['box'], other['box']) > .45
               for other in accepted):
            continue
        accepted.append(candidate)
    if len(accepted) > 256:
        raise ValueError('More than 256 scenery proposals. Use fewer object categories.')
    for candidate in accepted:
        del candidate['clipped']
    return dict(mask=[], candidates=accepted, device='CPU · Grounding DINO Base',
                milliseconds=round((time.perf_counter()-started)*1000))
