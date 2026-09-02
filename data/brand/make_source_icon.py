from PIL import Image, ImageDraw

SIZE = 1024
RADIUS = int(SIZE * 0.223)  # matches typical squircle-ish corner radius used by the old icon
INK = (13, 12, 10, 255)

emblem = Image.open('emblem-icon-tight-1024.png').convert('RGB')

# Rounded-rect mask
mask = Image.new('L', (SIZE, SIZE), 0)
d = ImageDraw.Draw(mask)
d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)

canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
base = Image.new('RGBA', (SIZE, SIZE), INK)
canvas.paste(base, (0, 0), mask)

emblem_rgba = emblem.convert('RGBA')
canvas.alpha_composite(emblem_rgba)

# Re-apply rounded mask so the emblem doesn't spill past the corners
final = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
final.paste(canvas, (0, 0), mask)

final.save('source-icon-1024.png')
print('saved', final.size)
