"""Download official public weights once; generation then runs offline."""
import json
import hashlib
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local-ai'
os.environ['HF_HOME'] = str(LOCAL / 'huggingface')
os.environ['U2NET_HOME'] = str(LOCAL / 'rembg')
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

from huggingface_hub import HfApi, hf_hub_download
import torch
import rembg

if not torch.cuda.is_available():
    raise RuntimeError('PyTorch CUDA belum bisa mengakses NVIDIA GPU. Periksa driver dan instalasi.')

api = HfApi()
info = api.model_info('stabilityai/TripoSR', files_metadata=True)
revision = info.sha
weights = LOCAL / 'weights'
weights.mkdir(parents=True, exist_ok=True)
for name in ['config.yaml', 'model.ckpt']:
    target = weights / name
    metadata = next(item for item in info.siblings if item.rfilename == name)
    if target.exists() and metadata.lfs and target.stat().st_size == metadata.lfs.size:
        with target.open('rb') as downloaded:
            digest = hashlib.file_digest(downloaded, 'sha256').hexdigest()
        if digest == metadata.lfs.sha256:
            print(f'Verified existing {name}', flush=True)
            continue
    print(f'Downloading TripoSR {name}', flush=True)
    hf_hub_download('stabilityai/TripoSR', filename=name, revision=revision, local_dir=str(weights))
hf_hub_download('facebook/dino-vitb16', filename='config.json')
print('Downloading background-removal model (u2netp)', flush=True)
session = rembg.new_session('u2netp', providers=['CPUExecutionProvider'])
del session
manifest = {'ready': True, 'model': 'TripoSR', 'revision': revision, 'gpu': torch.cuda.get_device_name(0), 'vramGB': round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)}
(LOCAL / 'ready.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
print(json.dumps(manifest), flush=True)
