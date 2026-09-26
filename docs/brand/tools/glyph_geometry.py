"""The Trama glyph, rebuilt as clean vector geometry from the black variant in docs/brand/source/glyph-variants.webp.

Units: a 560 x 560 box. A source pixel of the black variant maps to (x - 1387, y - 53.5).

The glyph is two ribbons woven into a "T". It is built from four ribbon shapes, each drawn whole
(also where it is hidden), and the weave is made with boolean operations: where a ribbon passes under
another one it is cut back by the over ribbon grown by GAP, which leaves the thin gap of the source.

- A1: the left bar's upper lane, the diagonal and the right side of the upper loop.
- A2: the left bar's lower lane; it folds under A1 along the hairline and goes under the S.
- C:  the S, from under A1 at the top to under the lower loop at the bottom.
- Dp: the lower loop, from under the S down around the bottom.
- The right bar is the mirror of the left bar and goes under A1 with both lanes.

Straight lines, caps and the lower loop's corners are exact geometry. The curves follow points measured
on the source every 10 units and are fitted with a smoothing spline, then with cubic Béziers.
"""
import numpy as np
import pathops
from scipy.interpolate import splev, splprep

from bezier_fit import fit_curve

AXIS = 280.0  # mirror axis of the bar and of the lower loop
TOP, BOTTOM = 16.0, 160.0  # the bar
CAP_R = 72.0
CAP_LEFT_X, CAP_RIGHT_X, CAP_Y = 81.0, 479.0, 88.0
HAIR_TOP, HAIR_BOTTOM = 90.6, 93.9  # the hairline between the bar's two lanes
GAP = 7.0  # the gap where one ribbon passes under another one
LOOP_R = 75.0  # corners of the lower loop
BASELINE = 544.5

UNION = pathops.PathOp.UNION
DIFFERENCE = pathops.PathOp.DIFFERENCE
INTERSECTION = pathops.PathOp.INTERSECTION


def op(a, b, kind):
    return pathops.op(a, b, kind)


def union(*paths):
    result = paths[0]
    for p in paths[1:]:
        result = op(result, p, UNION)
    return result


def _outline(path, r):
    s = pathops.Path()
    s.addPath(path)
    s.stroke(2 * r, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    s.convertConicsToQuads(0.01)
    return s


def dilate(path, r):
    return op(path, _outline(path, r), UNION)


def erode(path, r):
    return op(path, _outline(path, r), DIFFERENCE)


def mirror(path):
    q = path.transform(-1, 0, 0, 1, 2 * AXIS, 0)
    return op(q, q, UNION)


def smooth_curve(pts, start_tangent=None, end_tangent=None, tolerance=0.5):
    """Cubic Béziers through measured points: smoothing spline with pinned ends, then a least-squares fit."""
    pts = np.array(pts, float)
    if len(pts) > 4:
        w = np.ones(len(pts))
        w[0] = w[-1] = 60
        tck, _ = splprep(pts.T, w=w, s=len(pts) * 0.25, k=3)
        dense = np.array(splev(np.linspace(0, 1, 600), tck)).T
    else:
        dense = pts
    length = np.r_[0, np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]
    s = np.linspace(0, length[-1], max(3, int(length[-1] / 0.5)))
    dense = np.c_[np.interp(s, length, dense[:, 0]), np.interp(s, length, dense[:, 1])]
    dense[0], dense[-1] = pts[0], pts[-1]
    return fit_curve(dense, tolerance, start_tangent, end_tangent)


class Pen:
    def __init__(self):
        self.path = pathops.Path()
        self.cur = None

    def move(self, x, y):
        self.path.moveTo(x, y)
        self.cur = (x, y)
        return self

    def line(self, x, y):
        self.path.lineTo(x, y)
        self.cur = (x, y)
        return self

    def cubic(self, x1, y1, x2, y2, x, y):
        self.path.cubicTo(x1, y1, x2, y2, x, y)
        self.cur = (x, y)
        return self

    def through(self, pts, start_tangent=None, end_tangent=None):
        for c in smooth_curve([self.cur] + list(pts), start_tangent, end_tangent):
            self.cubic(*c[1], *c[2], *c[3])
        return self

    def arc(self, cx, cy, r, a0, a1):
        """Circular arc from angle a0 to a1 in degrees (y down), one cubic per quarter turn."""
        a0, a1 = np.radians(a0), np.radians(a1)
        n = max(1, int(np.ceil(abs(a1 - a0) / (np.pi / 2) - 1e-9)))
        da = (a1 - a0) / n
        k = 4 / 3 * np.tan(da / 4)
        for i in range(n):
            t0, t1 = a0 + i * da, a0 + (i + 1) * da
            p0 = np.array([cx + r * np.cos(t0), cy + r * np.sin(t0)])
            p3 = np.array([cx + r * np.cos(t1), cy + r * np.sin(t1)])
            p1 = p0 + k * r * np.array([-np.sin(t0), np.cos(t0)])
            p2 = p3 - k * r * np.array([-np.sin(t1), np.cos(t1)])
            self.cubic(*p1, *p2, *p3)
        return self

    def close(self):
        self.path.close()
        return self.path


def rect(x0, y0, x1, y1):
    return Pen().move(x0, y0).line(x1, y0).line(x1, y1).line(x0, y1).close()


# A1: upper lane of the left bar, the diagonal over the S, the right side of the upper loop.
A1 = (
    Pen().move(130, TOP).line(166, TOP)
    .through([(206.6, 20), (232.9, 30), (250.8, 40), (265.6, 50), (278.6, 60), (290.9, 70), (302.9, 80), (314.3, 90),
              (325.4, 100), (336.1, 110), (347, 120), (357.2, 130), (366.6, 140), (374.7, 150), (381.1, 160),
              (386.9, 170), (390.8, 180), (393.7, 190), (395.2, 200), (395.7, 210)], (1, 0), (0, 1))
    .through([(395.4, 220), (393.9, 230), (391.4, 240), (387.9, 250), (383, 260), (376.9, 270), (369.2, 280),
              (360.3, 290), (350.6, 300), (339, 310), (326, 319)], (0, 1), None)
    .line(319.7, 319).line(319.7, 245)
    .through([(318.5, 230), (316.3, 220), (312.7, 210), (307.1, 200), (300, 190), (291.1, 180), (280.9, 170),
              (270.3, 160), (259, 150), (247.6, 140), (235.8, 130), (222.5, 120), (207.3, 110), (188.6, 100),
              (170, 93.9), (150, HAIR_TOP)], (0, -1), (-1, 0))
    .line(130, HAIR_TOP).close()
)

# A2: lower lane of the left bar; the hairline and the S cut it.
A2 = rect(130, HAIR_TOP, 262, BOTTOM)

# C: the S. Its top and its bottom end are hidden under A1 and under the lower loop.
C = (
    Pen().move(232, 100).line(300, 100).line(300, 138)
    .through([(284, 155), (270.1, 169.5), (261.1, 180), (255.2, 190), (251.8, 200), (250.9, 210), (252.2, 220),
              (256.4, 230), (263.8, 240), (274.5, 250), (285.9, 260), (297.4, 270), (309, 280), (320.5, 290),
              (332.1, 300), (343.5, 310), (353.4, 320), (362.2, 330), (369.3, 340), (374.9, 350), (379, 360),
              (382, 370), (383.9, 380), (384.8, 390), (384.9, 400)], None, (0, 1))
    .line(384.9, BASELINE - LOOP_R).arc(309.9, BASELINE - LOOP_R, LOOP_R, 0, 90).line(311.2, 500).line(311.2, 425)
    .through([(309.9, 410), (307, 400), (302.2, 390), (295.6, 380), (286.2, 370), (275.2, 360), (264.3, 350),
              (252.8, 340), (241.1, 330), (229.4, 320), (218.1, 310), (207.1, 300), (197.6, 290), (188.6, 280),
              (181.6, 270), (175.5, 260), (170.3, 250), (167, 240), (164.4, 230), (162.9, 220), (162.3, 210)],
             (0, -1), (0, -1))
    .through([(163, 200), (164.7, 190), (167.5, 180), (171.4, 170), (177, 160), (184.2, 150), (193, 140),
              (203.7, 130), (214, 120), (224, 109), (234, 98)], (0, -1), None)
    .close()
)

# Dp: the lower loop. It starts under the S and ends over the S's tail at the bottom right.
_lower_loop = (
    Pen().move(174.9, 380).line(385, 380).line(385, BASELINE - LOOP_R).arc(310, BASELINE - LOOP_R, LOOP_R, 0, 90)
    .line(250, BASELINE).arc(250, BASELINE - LOOP_R, LOOP_R, 90, 180).close()
)
Dp = op(
    Pen().move(253.7, 298).line(253.7, 395)
    .through([(254.5, 400), (256.8, 410), (260.9, 420), (267.3, 430), (275.4, 440), (285.4, 450), (295.1, 460),
              (305, 470), (315.2, 480), (325.4, 490), (335.1, 500), (343.4, 510), (349.4, 520), (353.4, 530),
              (356, 536)], (0, 1), None)
    .line(420, 600).line(250.1, 600).line(250.1, BASELINE).arc(250.1, BASELINE - LOOP_R, LOOP_R, 90, 180)
    .line(174.9, 372)
    .through([(175.8, 360), (177.7, 350), (180.8, 340), (185.1, 330), (190.9, 320), (198.1, 310), (206, 300),
              (216, 290)], (0, -1), None)
    .line(253.7, 298).close(),
    union(_lower_loop, rect(150, 280, 400, 380)),
    INTERSECTION,
)

# The left cap, and the hairline that tapers to a point inside it.
CAP_LEFT = union(Pen().move(CAP_LEFT_X, TOP).arc(CAP_LEFT_X, CAP_Y, CAP_R, -90, -270).close(),
                 rect(CAP_LEFT_X, TOP, 141, BOTTOM))
_mid = (HAIR_TOP + HAIR_BOTTOM) / 2
_hair_taper = (
    Pen().move(35, _mid).cubic(55, 91.4, 75, HAIR_TOP, 95, HAIR_TOP).line(142, HAIR_TOP).line(142, HAIR_BOTTOM)
    .line(95, HAIR_BOTTOM).cubic(75, HAIR_BOTTOM, 55, 92.9, 35, _mid).close()
)
LEFT_BLOCK = op(CAP_LEFT, _hair_taper, DIFFERENCE)


def build(gap=GAP):
    """Return the woven pieces. 'glyph' is the whole mark; the others are used for shading."""
    hair = HAIR_BOTTOM - HAIR_TOP
    a1_top = op(A1, rect(0, 0, 560, 200), INTERSECTION)
    c_low = op(C, rect(0, 240, 560, 560), INTERSECTION)
    c_mid = op(C, rect(0, 0, 560, 400), INTERSECTION)
    d_low = op(Dp, rect(0, 430, 560, 560), INTERSECTION)

    a1 = op(A1, dilate(c_low, gap), DIFFERENCE)  # its end goes under the S
    a2 = op(op(A2, dilate(A1, hair), DIFFERENCE), dilate(C, gap), DIFFERENCE)
    left = union(LEFT_BLOCK, a1, a2)
    s = op(op(C, dilate(a1_top, gap), DIFFERENCE), dilate(d_low, gap), DIFFERENCE)
    loop = op(Dp, dilate(c_mid, gap), DIFFERENCE)
    mirrored_a1 = mirror(A1)
    right_full = union(
        mirror(LEFT_BLOCK),
        op(mirrored_a1, rect(AXIS, 0, 560, 200), INTERSECTION),
        op(mirror(A2), dilate(mirrored_a1, hair), DIFFERENCE),
    )
    right = op(right_full, dilate(A1, gap), DIFFERENCE)
    return dict(left=left, right=right, s=s, loop=loop, a1=a1, a2=a2, left_block=LEFT_BLOCK,
                glyph=union(left, right, s, loop))


def full_ribbons():
    """Every ribbon drawn whole: the glyph without gaps, with the two lens-shaped holes."""
    return union(CAP_LEFT, A1, A2, C, Dp, mirror(CAP_LEFT),
                 op(mirror(A1), rect(AXIS, 0, 560, 200), INTERSECTION), mirror(A2))


def _fmt(v, digits=2):
    s = f"{v:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def to_svg_d(path, digits=2):
    """SVG path data. Quadratic runs with implied on-curve points are expanded."""
    f = lambda v: _fmt(v, digits)
    out = []
    for verb, pts in path.segments:
        if verb == "moveTo":
            out.append("M" + " ".join(f(c) for c in pts[0]))
        elif verb == "lineTo":
            out.append("L" + " ".join(f(c) for c in pts[0]))
        elif verb == "curveTo":
            out.append("C" + " ".join(f(c) for p in pts for c in p))
        elif verb == "qCurveTo":
            offs, end = list(pts[:-1]), pts[-1]
            for i, off in enumerate(offs):
                nxt = end if i == len(offs) - 1 else ((off[0] + offs[i + 1][0]) / 2, (off[1] + offs[i + 1][1]) / 2)
                out.append("Q" + " ".join(f(c) for c in (*off, *nxt)))
        elif verb == "closePath":
            out.append("Z")
        else:
            raise ValueError(f"unexpected path verb {verb}")
    return "".join(out)
