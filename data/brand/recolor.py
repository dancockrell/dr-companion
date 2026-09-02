from PIL import Image
import numpy as np

im = Image.open('emblem-source.png').convert('RGB')
arr = np.array(im).astype(np.float32)

bg = np.array([19, 20, 23], dtype=np.float32)
target_bg = np.array([13, 12, 10], dtype=np.float32)  # --color-surface

dist = np.linalg.norm(arr - bg, axis=2)
mask = np.clip(1.0 - dist / 40.0, 0.0, 1.0)
mask = mask[..., None]

recolored = arr * (1 - mask) + target_bg * mask
recolored = np.clip(recolored, 0, 255).astype(np.uint8)

out = Image.fromarray(recolored, 'RGB')
out.save('emblem-recolored.png')
print('done', out.size)
