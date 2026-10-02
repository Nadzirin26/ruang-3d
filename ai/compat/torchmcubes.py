"""CPU marching-cubes adapter; avoids compiling a CUDA extension on Windows.

TripoSR's helper expects torchmcubes' reversed coordinate ordering. Return that
ordering here so its own [2, 1, 0] transform produces the skimage coordinates.
"""
import numpy as np
import torch
from skimage.measure import marching_cubes as skimage_marching_cubes


def marching_cubes(volume, threshold):
    values = volume.detach().float().cpu().numpy()
    # Match outward face winding after TripoSR's coordinate conversion.
    vertices, faces, _, _ = skimage_marching_cubes(values, level=threshold, gradient_direction='ascent')
    return (
        torch.from_numpy(np.ascontiguousarray(vertices[:, [2, 1, 0]])),
        torch.from_numpy(np.ascontiguousarray(faces.astype(np.int64))),
    )
