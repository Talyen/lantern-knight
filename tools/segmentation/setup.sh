#!/bin/sh
set -eu
SAM_ROOT="${LANTERN_SAM_ROOT:-$HOME/Library/Application Support/LanternKnight/segmentation}"
SAM_MODE="${1:-automatic}"
case "$SAM_MODE" in small|large|automatic) ;; *) echo 'Choose automatic, small or large' >&2; exit 1 ;; esac
SAM_MODEL=small
SAM_CHECKSUM=6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38
if [ "$SAM_MODE" != small ]; then
  SAM_MODEL=large
  SAM_CHECKSUM=2647878d5dfa5098f2f8649825738a9345572bae2d4350a2468587ece47dd318
fi
mkdir -p "$SAM_ROOT"
python3.11 -m venv "$SAM_ROOT/venv"
"$SAM_ROOT/venv/bin/python" -m pip install -r "$(dirname "$0")/requirements.txt"
SAM2_BUILD_CUDA=0 "$SAM_ROOT/venv/bin/python" -m pip install --no-deps 'git+https://github.com/facebookresearch/sam2.git@2b90b9f5ceec907a1c18123530e92e794ad901a4'
if [ ! -f "$SAM_ROOT/sam2.1_hiera_$SAM_MODEL.pt" ]; then
  curl --fail --location "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_$SAM_MODEL.pt" -o "$SAM_ROOT/checkpoint.tmp"
  mv "$SAM_ROOT/checkpoint.tmp" "$SAM_ROOT/sam2.1_hiera_$SAM_MODEL.pt"
fi

"$SAM_ROOT/venv/bin/python" - "$SAM_ROOT" "$SAM_MODEL" "$SAM_CHECKSUM" "$SAM_MODE" <<'PYVERIFY'
import hashlib, sys, json
from pathlib import Path
root=Path(sys.argv[1])
checkpoint=root/('sam2.1_hiera_'+sys.argv[2]+'.pt')
with open(checkpoint, 'rb') as f:
    digest = hashlib.file_digest(f, 'sha256').hexdigest()
if digest != sys.argv[3]:
    raise SystemExit('SAM checkpoint checksum mismatch')
if sys.argv[4] == 'automatic':
    from huggingface_hub import snapshot_download
    folder=Path(snapshot_download('IDEA-Research/grounding-dino-base',
        revision='12bdfa3120f3e7ec7b434d90674b3396eccf88eb', cache_dir=root/'detector-cache',
        allow_patterns=['*.json','*.txt','model.safetensors']))
    with open(folder/'model.safetensors','rb') as f:
        if hashlib.file_digest(f,'sha256').hexdigest() != '5548f844c928c4b6f411fa8cbcc2bfa8dbbba437cb1d513975519f93c2a9ed21':
            raise SystemExit('Detector checkpoint checksum mismatch')
settings=root/'settings.tmp'
settings.write_text(json.dumps({'model':sys.argv[2],'automatic':sys.argv[4]=='automatic'}))
settings.replace(root/'settings.json')
print('Local selection ready: '+sys.argv[2]+(' + text-guided detection' if sys.argv[4]=='automatic' else ''))
PYVERIFY
