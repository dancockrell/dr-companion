from PIL import Image
import numpy as np

im = Image.open('emblem-recolored.png').convert('RGB')
arr = np.array(im).astype(np.float32)
bg = np.array([13, 12, 10], dtype=np.float32)
dist = np.linalg.norm(arr - bg, axis=2)
fg_mask = dist > 12

ys, xs = np.where(fg_mask)
x0, x1 = xs.min(), xs.max()
y0, y1 = ys.min(), ys.max()

# Exclude the long tail whip below the wheel: cut off well above y1.
# The wheel's compass points (widest x-extent) mark the wheel's vertical center band.
row_width = fg_mask.sum(axis=1)
wheel_row = np.argmax(row_width)  # widest row = through the compass points
wheel_bottom = wheel_row + int((x1 - x0) * 0.30)  # a bit below the wheel's equator

y1_tight = min(y1, wheel_bottom)

cx = (x0 + x1) / 2
cy = (y0 + y1_tight) / 2
content_w = x1 - x0
content_h = y1_tight - y0
side = max(content_w, content_h) * 1.28

half = side / 2
left = int(cx - half)
top = int(cy - half)
right = int(cx + half)
bottom = int(cy + half)

W, H = im.size
canvas = Image.new('RGB', (right - left, bottom - top), (13, 12, 10))
src_left = max(left, 0)
src_top = max(top, 0)
src_right = min(right, W)
src_bottom = min(bottom, H)
region = im.crop((src_left, src_top, src_right, src_bottom))
canvas.paste(region, (src_left - left, src_top - top))

canvas = canvas.resize((1024, 1024), Image.LANCZOS)
canvas.save('emblem-icon-tight-1024.png')
for sz in (256, 128, 64, 32, 16):
    canvas.resize((sz, sz), Image.LANCZOS).save(f'preview-{sz}.png')
print('saved')
