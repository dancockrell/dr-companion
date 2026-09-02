"""Reject room-scene payloads that decode but contain large flat bands.

Dimension and JPEG decoder checks did not catch four generated images whose
lower halves were replaced by gray or black data. This gate samples sixteen
horizontal bands in every shipped Grok room scene and rejects four or more
consecutive near-uniform bands. It is deliberately a corruption check, not an
automated aesthetic score; native-resolution human review still decides what
art is admitted.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageStat


ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/grok-art/room-scenes")
BAND_COUNT = 16
MAX_FLAT_RUN = 3
FLAT_STDDEV = 1.0

failed = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global failed
    print(f"{'OK  ' if condition else 'FAIL'} {label}{f': {detail}' if detail else ''}")
    if not condition:
        failed += 1


def longest_flat_run(values: list[float]) -> int:
    run = 0
    longest = 0
    for value in values:
        run = run + 1 if value < FLAT_STDDEV else 0
        longest = max(longest, run)
    return longest


files = sorted(ROOT.glob("*.jpg"))
check("the Grok room-scene library is present", bool(files), str(ROOT))

for path in files:
    try:
        with Image.open(path) as source:
            source.load()
            width, height = source.size
            image = source.convert("L")
    except Exception as exc:  # Pillow provides the actionable decoder detail.
        check(f"{path.name} decodes completely", False, str(exc))
        continue

    check(f"{path.name} has landscape production dimensions", width >= 1024 and height >= 576, f"{width}x{height}")

    # Downsampling preserves a truly flat payload band while keeping the gate
    # fast enough to run over the complete shipped library on every PR.
    sample_width = min(width, 256)
    sample_height = max(BAND_COUNT, round(height * sample_width / width))
    sample = image.resize((sample_width, sample_height))
    deviations = []
    for index in range(BAND_COUNT):
        top = index * sample_height // BAND_COUNT
        bottom = (index + 1) * sample_height // BAND_COUNT
        deviations.append(ImageStat.Stat(sample.crop((0, top, sample_width, bottom))).stddev[0])

    flat_run = longest_flat_run(deviations)
    check(
        f"{path.name} has no large flat corruption band",
        flat_run <= MAX_FLAT_RUN,
        f"longest near-uniform run {flat_run}/{BAND_COUNT}; band deviations "
        + ", ".join(f"{value:.2f}" for value in deviations),
    )
    check(
        f"{path.name} has a rendered bottom edge",
        deviations[-1] >= FLAT_STDDEV,
        f"bottom-band deviation {deviations[-1]:.2f}",
    )

print(f"\n{failed} failed" if failed else "\nall room-scene image-integrity checks passed")
raise SystemExit(1 if failed else 0)
