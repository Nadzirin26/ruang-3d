"""One offline conversion per process, freeing GPU memory when it exits."""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local-ai'
os.environ['HF_HOME'] = str(LOCAL / 'huggingface')
os.environ['U2NET_HOME'] = str(LOCAL / 'rembg')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
sys.path.insert(0, str(LOCAL / 'TripoSR'))
sys.path.insert(0, str(ROOT / 'ai' / 'compat'))

def progress(value, message):
    print(json.dumps({'progress': value, 'message': message}), flush=True)

def run(args):
    progress(5, 'Memuat dependency lokal')
    import numpy as np
    import torch
    import rembg
    import trimesh
    from PIL import Image, ImageOps
    from omegaconf import OmegaConf
    from tsr.system import TSR
    from tsr.utils import resize_foreground

    if not torch.cuda.is_available():
        raise RuntimeError('NVIDIA GPU tidak tersedia pada PyTorch CUDA.')
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    progress(12, 'Menghapus background gambar')
    Image.MAX_IMAGE_PIXELS = 25_000_000
    with Image.open(args.input) as original:
        image = ImageOps.exif_transpose(original).convert('RGBA')
        image.thumbnail((1024, 1024))
    if image.getchannel('A').getextrema()[0] == 255:
        session = rembg.new_session('u2netp', providers=['CPUExecutionProvider'])
        image = rembg.remove(image, session=session)
        del session
    alpha = np.asarray(image)[:, :, 3]
    if np.count_nonzero(alpha > 64) < 100:
        raise RuntimeError('Objek tidak ditemukan setelah background dihapus. Coba gambar lain.')
    image = resize_foreground(image, 0.85)
    rgba = np.asarray(image).astype(np.float32) / 255
    rgb = rgba[:, :, :3] * rgba[:, :, 3:4] + (1 - rgba[:, :, 3:4]) * 0.5
    image = Image.fromarray((rgb * 255).astype(np.uint8))
    image.save(Path(args.output).with_suffix('.input.png'))

    progress(25, 'Memuat model TripoSR ke GPU')
    config = OmegaConf.load(LOCAL / 'weights' / 'config.yaml')
    OmegaConf.resolve(config)
    model = TSR(config)
    checkpoint = torch.load(LOCAL / 'weights' / 'model.ckpt', map_location='cpu', weights_only=True)
    model.load_state_dict(checkpoint)
    del checkpoint
    model.eval().to('cuda:0')
    model.renderer.set_chunk_size(2048)
    progress(45, 'Merekonstruksi bentuk dari gambar')
    # Mixed precision keeps the reconstruction within a 6GB GPU. Mesh extraction
    # uses float32 for grid_sample compatibility and stable surface coordinates.
    with torch.inference_mode(), torch.autocast('cuda', dtype=torch.float16):
        codes = model([image], device='cuda:0')
    codes = codes.float()
    # The image encoder and transformer are no longer needed for mesh extraction.
    del model.image_tokenizer, model.tokenizer, model.backbone, model.post_processor
    torch.cuda.empty_cache()
    progress(65, 'Mengekstrak permukaan dan warna')
    with torch.inference_mode():
        mesh = model.extract_mesh(codes, has_vertex_color=True, resolution=args.resolution)[0]
    if not len(mesh.faces):
        raise RuntimeError('Model tidak menghasilkan permukaan. Coba gambar objek yang lebih jelas.')
    progress(92, 'Menyimpan GLB')
    # TripoSR uses Z-up; GLB viewers use Y-up.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    mesh.export(args.output, file_type='glb')
    progress(100, 'Model selesai')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--resolution', type=int, choices=[96, 128, 192], default=128)
    args = parser.parse_args()
    try:
        run(args)
    except Exception as error:
        message = str(error)
        if 'out of memory' in message.lower():
            message = 'VRAM tidak cukup. Tutup aplikasi GPU lain dan coba lagi dengan kualitas Ringan.'
        print(json.dumps({'error': message[:800]}), flush=True)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
