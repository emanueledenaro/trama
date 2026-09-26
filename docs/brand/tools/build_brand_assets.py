"""Build every Trama brand asset from glyph_geometry.py.

Run from the repository root:  python3 docs/brand/tools/build_brand_assets.py
Needs Python 3 with numpy, scipy, skia-pathops and Pillow, and rsvg-convert (librsvg) on PATH.
"""
import io
import json
import os
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import glyph_geometry as geo  # noqa: E402
from bezier_fit import fit_curve  # noqa: E402
from glyph_geometry import (AXIS, HAIR_BOTTOM, DIFFERENCE, INTERSECTION, UNION, Pen, erode, op, rect,  # noqa: E402
                            to_svg_d, union)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BRAND = os.path.join(ROOT, "docs", "brand")
ICONS = os.path.join(ROOT, "app", "resources", "icons")
PUBLIC = os.path.join(ROOT, "app", "src", "renderer", "public")
COMPONENT = os.path.join(ROOT, "app", "src", "renderer", "components", "brand")
PREVIEWS = os.path.join(BRAND, "previews")

# The palette, sampled from the source images (see docs/brand/README.md).
PALETTE = dict(
    face_blue="#3558FB", face_indigo="#5A6BFC", face_violet="#8F86FA", face_lavender="#CDAAFB",
    back_top="#1A2BC4", back_bottom="#040F63", shade="#010E6E",
    tile_night="#08157A", tile_indigo="#2333D6", tile_violet="#6C4DF9", tile_glow="#D6B8FF",
    tile_blue="#3D55F5", tile_blue_low="#3A55FF",
    white_shade="#2A2F6E", tile_shade="#1F33D6",
)


# ---------------------------------------------------------------- geometry

def fill_holes(path):
    """Keep only the outer contour (the one with the largest bounds)."""
    def box_area(c):
        x0, y0, x1, y1 = c.bounds
        return (x1 - x0) * (y1 - y0)
    q = geo.pathops.Path()
    q.addPath(max(path.contours, key=box_area))
    return op(q, q, UNION)


pieces = geo.build()
ribbons = op(geo.full_ribbons(), pieces["glyph"], UNION)
silhouette = fill_holes(ribbons)
lenses = op(silhouette, ribbons, DIFFERENCE)

# Where a ribbon passes under another one it darkens: strongest at the crossing, fading out radially.
# Each entry: region, centre, radius. The only clips follow the hairline, so no shadow shows an edge.
_lower_left_lane = op(union(pieces["left_block"], pieces["a2"]), pieces["a1"], DIFFERENCE)
_shadows = [
    (op(_lower_left_lane, rect(0, HAIR_BOTTOM - 0.5, AXIS, 175), INTERSECTION), (214, 148), 185),
    (op(pieces["right"], rect(AXIS, HAIR_BOTTOM - 0.5, 560, 175), INTERSECTION), (372, 132), 165),
    (op(pieces["right"], rect(AXIS, 0, 560, HAIR_BOTTOM), INTERSECTION), (318, 72), 100),
    (pieces["s"], (226, 128), 112),
    (pieces["a1"], (336, 298), 118),
    (pieces["loop"], (214, 316), 232),
    (pieces["s"], (356, 524), 108),
]

# Small sizes (16 to 32 px): no gaps, no hairline, thicker ribbons (the lens holes shrink).
small = op(silhouette, erode(lenses, 9), DIFFERENCE)

G = dict(
    glyph=to_svg_d(pieces["glyph"]),
    silhouette=to_svg_d(silhouette),
    small=to_svg_d(small),
    shadows=[dict(d=to_svg_d(p), cx=c[0], cy=c[1], r=r) for p, c, r in _shadows],
)


def squircle(size, n=4.2):
    """The rounded-square tile (superellipse, close to Apple's icon shape) filling a size x size box."""
    a = size / 2
    t = np.linspace(0, 2 * np.pi, 2000, endpoint=False)
    x = a + a * np.sign(np.cos(t)) * np.abs(np.cos(t)) ** (2 / n)
    y = a + a * np.sign(np.sin(t)) * np.abs(np.sin(t)) ** (2 / n)
    pts = np.c_[x, y]
    q = len(pts) // 4
    segs = []
    for k in range(4):
        run = pts[k * q:(k + 1) * q + 1] if k < 3 else np.vstack([pts[3 * q:], pts[:1]])
        segs += fit_curve(run, size * 0.0001)
    f = lambda v: geo._fmt(v)
    d = "M%s %s" % (f(segs[0][0][0]), f(segs[0][0][1]))
    for c in segs:
        d += "C" + " ".join(f(v) for p in c[1:] for v in p)
    return d + "Z"


TILE_1024 = squircle(1024)

# ---------------------------------------------------------------- SVG markup


def glyph_markup(mode, prefix):
    """(defs, body) of the glyph in 560 units. mode: color, white (dark themes) or tile (white on the tile)."""
    defs = []
    if mode == "color":
        defs.append(
            f'<linearGradient id="{prefix}-face" x1="40" y1="200" x2="540" y2="40" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{PALETTE["face_blue"]}"/><stop offset=".45" stop-color="{PALETTE["face_indigo"]}"/>'
            f'<stop offset=".75" stop-color="{PALETTE["face_violet"]}"/><stop offset="1" stop-color="{PALETTE["face_lavender"]}"/>'
            f'</linearGradient>')
        defs.append(
            f'<linearGradient id="{prefix}-back" x1="280" y1="160" x2="280" y2="540" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{PALETTE["back_top"]}"/><stop offset="1" stop-color="{PALETTE["back_bottom"]}"/>'
            f'</linearGradient>')
        body = [f'<path fill="url(#{prefix}-back)" d="{G["silhouette"]}"/>', f'<path fill="url(#{prefix}-face)" d="{G["glyph"]}"/>']
        shade, strength = PALETTE["shade"], 0.82
    elif mode == "white":
        body = [f'<path fill="#fff" fill-opacity=".55" d="{G["silhouette"]}"/>', f'<path fill="#fff" d="{G["glyph"]}"/>']
        shade, strength = PALETTE["white_shade"], 0.34
    else:
        body = [f'<path fill="#fff" fill-opacity=".16" d="{G["silhouette"]}"/>', f'<path fill="#fff" d="{G["glyph"]}"/>']
        shade, strength = PALETTE["tile_shade"], 0.62
    for i, s in enumerate(G["shadows"]):
        defs.append(
            f'<radialGradient id="{prefix}-s{i}" cx="{s["cx"]}" cy="{s["cy"]}" r="{s["r"]}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{shade}" stop-opacity="{strength}"/>'
            f'<stop offset=".55" stop-color="{shade}" stop-opacity="{strength * .42:.3f}"/>'
            f'<stop offset="1" stop-color="{shade}" stop-opacity="0"/></radialGradient>')
        body.append(f'<path fill="url(#{prefix}-s{i})" d="{s["d"]}"/>')
    return defs, body


def tile_defs(prefix, size):
    u = lambda v: f"{v * size:g}"
    return [
        f'<linearGradient id="{prefix}-tile" x1="0" y1="{u(1)}" x2="{u(1)}" y2="0" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{PALETTE["tile_night"]}"/><stop offset=".55" stop-color="{PALETTE["tile_indigo"]}"/>'
        f'<stop offset="1" stop-color="{PALETTE["tile_violet"]}"/></linearGradient>',
        f'<radialGradient id="{prefix}-tl" cx="{u(.08)}" cy="{u(.02)}" r="{u(.5)}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{PALETTE["tile_blue"]}" stop-opacity=".85"/>'
        f'<stop offset="1" stop-color="{PALETTE["tile_blue"]}" stop-opacity="0"/></radialGradient>',
        f'<radialGradient id="{prefix}-br" cx="{u(.98)}" cy="{u(.98)}" r="{u(.45)}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{PALETTE["tile_blue_low"]}" stop-opacity=".8"/>'
        f'<stop offset="1" stop-color="{PALETTE["tile_blue_low"]}" stop-opacity="0"/></radialGradient>',
        f'<radialGradient id="{prefix}-glow" cx="{u(.96)}" cy="{u(.04)}" r="{u(.62)}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{PALETTE["tile_glow"]}"/>'
        f'<stop offset=".45" stop-color="{PALETTE["tile_violet"]}" stop-opacity=".55"/>'
        f'<stop offset="1" stop-color="{PALETTE["tile_violet"]}" stop-opacity="0"/></radialGradient>',
    ]


def glyph_transform(tile, glyph_width, canvas=1024):
    """Place the glyph (542 units wide) in the tile, centred and 1.6% of the tile below the centre, as in the source."""
    s = glyph_width / 542.0
    return canvas / 2 - AXIS * s, canvas / 2 + tile * 0.016 - 280.25 * s, s


def svg(size, view_box, inner, title="Trama"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{view_box}" role="img" '
            f'aria-label="{title}"><title>{title}</title>{inner}</svg>\n')


def app_icon(tile, glyph_width, simplified, prefix, canvas=1024):
    """Tile with the white glyph. tile: side of the tile in a 1024 canvas (824 is the macOS grid)."""
    shape = TILE_1024 if tile == canvas else squircle(tile)
    offset = (canvas - tile) / 2
    defs = tile_defs(prefix, tile)
    fills = "".join(f'<path fill="url(#{prefix}-{k})" d="{shape}"/>' for k in ("tile", "tl", "br", "glow"))
    if simplified:
        glyph = f'<path fill="#fff" fill-rule="evenodd" d="{G["small"]}"/>'
    else:
        gdefs, gbody = glyph_markup("tile", prefix + "g")
        defs += gdefs
        glyph = "".join(gbody)
    gx, gy, s = glyph_transform(tile, glyph_width, canvas)
    tile_group = f'<g transform="translate({offset:g} {offset:g})">{fills}</g>' if offset else fills
    inner = (f'<defs>{"".join(defs)}</defs>{tile_group}'
             f'<g transform="translate({gx:.3f} {gy:.3f}) scale({s:.5f})">{glyph}</g>')
    return svg(canvas, f"0 0 {canvas} {canvas}", inner)


# Tile side and glyph width in a 1024 canvas for each use.
ICON_MAC = (824, 560)          # macOS grid: 100 px margin
ICON_MAC_SMALL = (824, 610)
ICON_SQUARE = (940, 640)       # Windows and Linux
ICON_SQUARE_SMALL = (940, 720)
ICON_FULL = (1024, 700)        # favicon and in-app tile
ICON_FULL_SMALL = (1024, 780)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def render(svg_text, size):
    out = subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size)], input=svg_text.encode(),
                         capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(out)).convert("RGBA")


def png_bytes(im):
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return b.getvalue()


def write_icns(path, images):
    """images: {size: Image}. PNG payloads for every OSType (macOS 10.7 and later)."""
    types = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
             ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
    body = b""
    for ostype, size in types:
        data = png_bytes(images[size])
        body += ostype.encode() + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


def write_ico(path, images):
    sizes = sorted(images)
    first = images[sizes[-1]]
    first.save(path, format="ICO", sizes=[(s, s) for s in sizes], append_images=[images[s] for s in sizes[:-1]])


# ---------------------------------------------------------------- component geometry (TypeScript)

def write_component_geometry():
    tile_full = glyph_transform(*ICON_FULL)
    tile_small = glyph_transform(*ICON_FULL_SMALL)
    shadows = ",\n".join(
        f'    {{ cx: {s["cx"]}, cy: {s["cy"]}, r: {s["r"]}, d: "{s["d"]}" }}' for s in G["shadows"])
    ts = f'''// Generated by docs/brand/tools/build_brand_assets.py from the glyph geometry. Do not edit by hand.

/** The glyph's box: 560 x 560 units. */
export const GLYPH_VIEW_BOX = "0 0 560 560";
/** The tile's box: 1024 x 1024 units. */
export const TILE_VIEW_BOX = "0 0 1024 1024";

/** The woven glyph, with the gaps where one ribbon passes under the other. */
export const GLYPH_PATH =
  "{G["glyph"]}";
/** The glyph's outline with the gaps and the lens-shaped holes filled: the ribbons' back side. */
export const SILHOUETTE_PATH =
  "{G["silhouette"]}";
/** The simplified glyph for 16 to 32 px: no gaps, no hairline, thicker ribbons. Fill with evenodd. */
export const SMALL_GLYPH_PATH =
  "{G["small"]}";

/** Shadows where a ribbon passes under another one: a region and the centre and radius of its radial fade. */
export const GLYPH_SHADOWS: readonly {{ cx: number; cy: number; r: number; d: string }}[] = [
{shadows},
];

/** The rounded-square tile filling the 1024 box. */
export const TILE_PATH =
  "{TILE_1024}";
/** Where the glyph sits on the tile, as an SVG transform: full glyph and simplified glyph. */
export const TILE_GLYPH_TRANSFORM = "translate({tile_full[0]:.3f} {tile_full[1]:.3f}) scale({tile_full[2]:.5f})";
export const TILE_SMALL_GLYPH_TRANSFORM = "translate({tile_small[0]:.3f} {tile_small[1]:.3f}) scale({tile_small[2]:.5f})";
'''
    write(os.path.join(COMPONENT, "tramaMarkGeometry.ts"), ts)


# ---------------------------------------------------------------- previews for the documentation and the PR

def source_crop(x0, bg):
    src = Image.open(os.path.join(BRAND, "source", "glyph-variants.webp")).convert("RGBA")
    # the black variant's glyph box starts at (1396, 69); each variant is 542 px wide
    c = src.crop((x0 - 9, 69 - 16, x0 - 9 + 560, 69 - 16 + 560))
    t = Image.new("RGBA", c.size, bg)
    t.alpha_composite(c)
    return t


def on(bg, im):
    t = Image.new("RGBA", im.size, bg)
    t.alpha_composite(im)
    return t


def label(im, text, dark=False):
    d = ImageDraw.Draw(im)
    d.text((12, im.height - 22), text, fill=(235, 235, 235) if dark else (40, 40, 40))
    return im


def previews(svgs):
    os.makedirs(PREVIEWS, exist_ok=True)
    cell = 280
    rows = [
        (source_crop(1396, "white"), on("white", render(svgs["mono"].replace("currentColor", "#000"), 560)), "white", "nero"),
        (source_crop(62, "white"), on("white", render(svgs["color"], 560)), "white", "a colori"),
        (source_crop(727, "#161616"), on("#161616", render(svgs["white"], 560)), "#161616", "bianco"),
    ]
    icon_src = Image.open(os.path.join(BRAND, "source", "app-icon.webp")).convert("RGBA")
    s = ICON_MAC[0] / 1117
    icon_src = icon_src.resize((round(1254 * s), round(1254 * s)))
    icon_canvas = Image.new("RGBA", (1024, 1024), "white")
    icon_canvas.alpha_composite(icon_src, (round(100 - 68 * s), round(100 - 71 * s)))
    rows.append((icon_canvas, on("white", render(svgs["app_icon"], 1024)), "white", "icona"))
    sheet = Image.new("RGB", (cell * 2 + 30, (cell + 10) * len(rows) + 30), "#ececec")
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), "Sorgente", fill=(40, 40, 40))
    d.text((cell + 20, 8), "SVG", fill=(40, 40, 40))
    for i, (a, b, bg, name) in enumerate(rows):
        y = 26 + i * (cell + 10)
        dark = bg != "white"
        sheet.paste(label(a.resize((cell, cell), Image.LANCZOS), f"sorgente, {name}", dark).convert("RGB"), (10, y))
        sheet.paste(label(b.resize((cell, cell), Image.LANCZOS), f"SVG, {name}", dark).convert("RGB"), (cell + 20, y))
    sheet.save(os.path.join(PREVIEWS, "confronto-sorgente-svg.png"), optimize=True)

    # Overlay of the black variant and the mono SVG: red only in the source, blue only in the SVG.
    src = np.array(source_crop(1396, "white").convert("L")) < 128
    mine = np.array(on("white", render(svgs["mono"].replace("currentColor", "#000"), 560)).convert("L")) < 128
    rgb = np.full(src.shape + (3,), 255, np.uint8)
    rgb[src & mine] = (40, 40, 40)
    rgb[src & ~mine] = (230, 30, 30)
    rgb[~src & mine] = (30, 110, 240)
    Image.fromarray(rgb).resize((1120, 1120), Image.NEAREST).save(os.path.join(PREVIEWS, "sovrapposizione.png"), optimize=True)
    iou = (src & mine).sum() / (src | mine).sum()

    # Small sizes, at 1x and enlarged 6x without smoothing.
    sizes = [16, 24, 32, 48, 64]
    items = [("icona", svgs["app_icon_square_small"], svgs["app_icon_square"]),
             ("simbolo", svgs["small_black"], svgs["mono_black"])]
    col = lambda s: max(s * 6, 150) + 20
    width = 20 + sum(col(s) for s in sizes)
    sheet = Image.new("RGB", (width, 40 + len(items) * (64 * 6 + 60)), "white")
    d = ImageDraw.Draw(sheet)
    y = 10
    for name, small_svg, full_svg in items:
        x = 10
        for sz in sizes:
            im = render(small_svg if sz <= 32 else full_svg, sz)
            sheet.paste(on("white", im).convert("RGB"), (x, y + 14))
            sheet.paste(on("white", im).resize((sz * 6, sz * 6), Image.NEAREST).convert("RGB"), (x, y + 14 + sz + 8))
            d.text((x, y), f"{name} {sz} px" + (", semplificato" if sz <= 32 else ""), fill=(40, 40, 40))
            x += col(sz)
        y += 64 * 6 + 60
    sheet.save(os.path.join(PREVIEWS, "misure-piccole.png"), optimize=True)
    return iou


# ---------------------------------------------------------------- main

def main():
    svgs = {}
    for mode in ("color", "white"):
        defs, body = glyph_markup(mode, "tg")
        svgs[mode] = svg(560, "0 0 560 560", f'<defs>{"".join(defs)}</defs>{"".join(body)}')
    svgs["mono"] = svg(560, "0 0 560 560", f'<path fill="currentColor" d="{G["glyph"]}"/>')
    svgs["small"] = svg(560, "0 0 560 560", f'<path fill="currentColor" fill-rule="evenodd" d="{G["small"]}"/>')
    svgs["mono_black"] = svgs["mono"].replace("currentColor", "#000")
    svgs["small_black"] = svgs["small"].replace("currentColor", "#000")
    svgs["app_icon"] = app_icon(*ICON_MAC, False, "ti")
    svgs["app_icon_small"] = app_icon(*ICON_MAC_SMALL, True, "tis")
    svgs["app_icon_square"] = app_icon(*ICON_SQUARE, False, "tq")
    svgs["app_icon_square_small"] = app_icon(*ICON_SQUARE_SMALL, True, "tqs")
    svgs["favicon"] = app_icon(*ICON_FULL_SMALL, True, "fv")

    write(os.path.join(BRAND, "trama-glyph-color.svg"), svgs["color"])
    write(os.path.join(BRAND, "trama-glyph-white.svg"), svgs["white"])
    write(os.path.join(BRAND, "trama-glyph-mono.svg"), svgs["mono"])
    write(os.path.join(BRAND, "trama-glyph-small.svg"), svgs["small"])
    write(os.path.join(BRAND, "trama-app-icon.svg"), svgs["app_icon"])
    write(os.path.join(BRAND, "trama-app-icon-small.svg"), svgs["app_icon_small"])
    write(os.path.join(BRAND, "trama-app-icon-square.svg"), svgs["app_icon_square"])
    write(os.path.join(BRAND, "trama-app-icon-square-small.svg"), svgs["app_icon_square_small"])
    write(os.path.join(PUBLIC, "favicon.svg"), svgs["favicon"])

    # macOS: .icns with every size; the simplified glyph up to 32 px.
    mac = {s: render(svgs["app_icon_small"] if s <= 32 else svgs["app_icon"], s) for s in (16, 32, 64, 128, 256, 512, 1024)}
    os.makedirs(ICONS, exist_ok=True)
    write_icns(os.path.join(ICONS, "icon.icns"), mac)
    # Windows: .ico from 16 to 256.
    win = {s: render(svgs["app_icon_square_small"] if s <= 32 else svgs["app_icon_square"], s) for s in (16, 24, 32, 48, 64, 128, 256)}
    write_ico(os.path.join(ICONS, "icon.ico"), win)
    # Linux: a PNG per size, named as electron-builder expects.
    os.makedirs(os.path.join(ICONS, "png"), exist_ok=True)
    for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        im = render(svgs["app_icon_square_small"] if s <= 32 else svgs["app_icon_square"], s)
        im.save(os.path.join(ICONS, "png", f"{s}x{s}.png"), optimize=True)
    # Favicons.
    fav = {s: render(svgs["favicon"], s) for s in (16, 32, 48)}
    write_ico(os.path.join(PUBLIC, "favicon.ico"), fav)

    write_component_geometry()
    iou = previews(svgs)
    json.dump(dict(iou_black_variant=round(float(iou), 4)), open(os.path.join(PREVIEWS, "misure.json"), "w"), indent=2)
    print(f"done; overlap with the black variant (IoU): {iou:.4f}")


if __name__ == "__main__":
    main()
