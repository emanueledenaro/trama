"""Reduces the screenshots of genera.mjs to 256 colors, so the folder weighs about 60% less.

Usage, from the repository root, after genera.mjs: python3 docs/design/schermate-2026-09-28/riduci.py
Needs Pillow (pip install pillow).
"""
from pathlib import Path

from PIL import Image

folder = Path(__file__).parent / "schermate"
for path in sorted(folder.glob("*.png")):
    image = Image.open(path).convert("RGB")
    image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
print(f"{len(list(folder.glob('*.png')))} screenshots reduced")
