"""Offline 16-frame motion experiment. OpenCV 5.0.0 / NumPy are regeneration-only.
Source artwork stays unchanged; normal build/check verifies committed hashes.
"""
from pathlib import Path
import hashlib
import json
import os
import sys
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'references/art/rust_16_frame_drawing_walk_prototype'
WORKSPACE = Path(os.environ['LANTERN_ASSET_WORKSPACE'])
OUTPUT = WORKSPACE / 'staging/walk-blending'
STAGED = WORKSPACE / 'staging/ink/ink-hero.json'
WIDTH, HEIGHT, GUTTER, SCALE = 128, 160, 2, 4
STRIDE_X, STRIDE_Y = WIDTH + GUTTER * 2, HEIGHT + GUTTER * 2
cv2.setNumThreads(1)
cv2.setRNGSeed(0)
resolver = None
def source_bytes(member):
    global resolver
    try:
        return (SOURCE / member).read_bytes()
    except FileNotFoundError:
        if resolver is None:
            sys.path.insert(0, str(ROOT / 'tools/assets'))
            from resolver import SourceResolver
            index = json.loads((ROOT / 'assets/sources.json').read_text())
            library = Path(os.environ.get('ASSET_LIBRARY_ROOT', Path.home() / 'Documents/Asset Library'))
            resolver = SourceResolver(library / index['libraryDirectory'], index)
        return resolver.read('file:rust_16_frame_drawing_walk_prototype/' + member)

registration = json.loads(source_bytes('timing_and_registration.json'))
staged = json.loads(STAGED.read_text())
tuning_path = ROOT / 'authoring/walk-tuning.json'
tuning = json.loads(tuning_path.read_text())
assert len(registration['frames']) == len(staged['frames']) == 16
sources, prepared, raw_gray, registered_gray = {}, {}, [], []
for record, frame in zip(registration['frames'], staged['frames']):
    data = source_bytes(record['file'])
    sources[record['file']] = hashlib.sha256(data).hexdigest()
    runtime = (WORKSPACE / 'staging' / frame['path']).read_bytes()
    prepared[frame['path']] = hashlib.sha256(runtime).hexdigest()
    rgba = cv2.imdecode(np.frombuffer(runtime, np.uint8), cv2.IMREAD_UNCHANGED)
    assert rgba.shape == (640, 512, 4)
    dx, dy = frame.get('visualOffsetPx', [0, 0])
    corrected = cv2.warpAffine(rgba, np.float32([[1, 0, dx], [0, 1, dy]]), (512, 640), flags=cv2.INTER_LINEAR)
    for image, target in ((rgba, raw_gray), (corrected, registered_gray)):
        small = cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
        alpha = small[:, :, 3].astype(np.float32) / 255
        luminance = cv2.cvtColor(small[:, :, :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
        target.append(np.rint((luminance * .65 + 80) * alpha).astype(np.uint8))


def guarded(first, reverse):
    """Round-trip error in native pixels, with no correspondence beyond the canvas."""
    yy, xx = np.mgrid[:HEIGHT, :WIDTH].astype(np.float32)
    x, y = xx + first[:, :, 0], yy + first[:, :, 1]
    match = cv2.remap(reverse, x, y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    error = np.linalg.norm(first + match, axis=2) * SCALE
    t = np.clip((error - 2) / 4, 0, 1)
    confidence = 1 - t * t * (3 - 2 * t)
    confidence[(x < 0) | (x > WIDTH - 1) | (y < 0) | (y > HEIGHT - 1)] = 0
    native = first * SCALE
    magnitude = np.linalg.norm(native, axis=2)
    native *= np.minimum(1, 24 / np.maximum(magnitude, 1e-6))[:, :, None]
    return native * confidence[:, :, None], int(np.count_nonzero(confidence == 0))


def encode(fields, capped=False):
    signed = np.rint(np.clip(fields / 2, -128, 127))
    if capped:
        # Preserve the radial cap after two-pixel component quantization.
        for channels in (slice(0, 2), slice(2, 4)):
            pair = signed[:, :, channels]
            magnitude = np.linalg.norm(pair, axis=2)
            scale = np.minimum(1, 12 / np.maximum(magnitude, 1e-6))
            signed[:, :, channels] = np.trunc(pair * scale[:, :, None])
    return (signed + 128).astype(np.uint8)


# Four 4x4 regions share one data texture: registered/raw, standard/guarded.
atlas = np.zeros((STRIDE_Y * 16, STRIDE_X * 4, 4), np.uint8)
records = [{'from': f'walk-{i+1:02}', 'to': f'walk-{(i+1)%16+1:02}', 'sword': {'a': tuning['frames'][i]['sword'], 'b': tuning['frames'][(i+1)%16]['sword'], 'width': 22}} for i in range(16)]
for variant, gray in enumerate((registered_gray, raw_gray)):
    for i, first in enumerate(gray):
        second = gray[(i + 1) % 16]
        engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        forward, backward = engine.calc(first, second, None), engine.calc(second, first, None)
        guarded_forward, rejected_forward = guarded(forward, backward)
        guarded_backward, rejected_backward = guarded(backward, forward)
        for guard, fields in enumerate((np.concatenate([forward, backward], axis=2) * SCALE,
                                       np.concatenate([guarded_forward, guarded_backward], axis=2))):
            encoded = encode(fields, capped=bool(guard))
            padded = cv2.copyMakeBorder(encoded, GUTTER, GUTTER, GUTTER, GUTTER, cv2.BORDER_REPLICATE)
            x, y = i % 4 * STRIDE_X, (i // 4 + (variant + guard * 2) * 4) * STRIDE_Y
            atlas[y:y + STRIDE_Y, x:x + STRIDE_X] = padded
            key = ('rect', 'rawRect', 'guardedRect', 'rawGuardedRect')[variant + guard * 2]
            records[i][key] = [x + GUTTER, y + GUTTER, WIDTH, HEIGHT]
        records[i]['registeredRejectedPixels' if variant == 0 else 'rawRejectedPixels'] = [rejected_forward, rejected_backward]
OUTPUT.mkdir(parents=True, exist_ok=True)
encoded_png = cv2.imencode('.png', cv2.cvtColor(atlas, cv2.COLOR_RGBA2BGRA),
                           [cv2.IMWRITE_PNG_COMPRESSION, 9])[1].tobytes()
(OUTPUT / 'flow.png').write_bytes(encoded_png)
metadata = {'recipe': 'walk-dis-flow-v2-density16', 'opencv': cv2.__version__,
            'sourceRoot': SOURCE.relative_to(ROOT).as_posix(),
            'stagedSourceHash': hashlib.sha256(STAGED.read_bytes()).hexdigest(),
            'tuningHash': hashlib.sha256(tuning_path.read_bytes()).hexdigest(),
            'canvas': [512, 640], 'width': atlas.shape[1], 'height': atlas.shape[0],
            'bytes': len(encoded_png), 'sha256': hashlib.sha256(encoded_png).hexdigest(),
            'pixelsPerUnit': 2, 'zero': 128, 'sourceHashes': sources, 'preparedHashes': prepared, 'pairs': records,
            'guard': {'roundTripFadePixels': [2, 6], 'maximumDisplacementPixels': 24, 'rejectOutsideCanvas': True},
            'limitations': ['Estimated 2D correspondence, not authored intermediate poses.',
                            'Crossfades may ghost; guards limit but do not eliminate equipment deformation.']}
(OUTPUT / 'flow.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f'Prepared 16 pairs, four variants: {len(encoded_png)} bytes; OpenCV {cv2.__version__}')
