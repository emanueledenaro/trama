"""Least-squares cubic Bézier fitting (Schneider, "An Algorithm for Automatically Fitting Digitized Curves",
Graphics Gems, 1990). Used to turn points measured on the source image into smooth G1 curves."""
import numpy as np


def bezier(ctrl, t):
    t = np.asarray(t)[:, None]
    p0, p1, p2, p3 = ctrl
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def _d1(ctrl, t):
    t = np.asarray(t)[:, None]
    p0, p1, p2, p3 = ctrl
    return 3 * (1 - t) ** 2 * (p1 - p0) + 6 * (1 - t) * t * (p2 - p1) + 3 * t ** 2 * (p3 - p2)


def _d2(ctrl, t):
    t = np.asarray(t)[:, None]
    p0, p1, p2, p3 = ctrl
    return 6 * (1 - t) * (p2 - 2 * p1 + p0) + 6 * t * (p3 - 2 * p2 + p1)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def _chord_params(pts):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    return d / d[-1]


def _generate(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    a1 = (3 * (1 - u) ** 2 * u)[:, None] * t1
    a2 = (3 * (1 - u) * u ** 2)[:, None] * t2
    c = np.array([[(a1 * a1).sum(), (a1 * a2).sum()], [(a1 * a2).sum(), (a2 * a2).sum()]])
    rest = pts - bezier([p0, p0, p3, p3], u)
    x = np.array([(a1 * rest).sum(), (a2 * rest).sum()])
    det = c[0, 0] * c[1, 1] - c[0, 1] ** 2
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-12:
        alpha1 = (x[0] * c[1, 1] - x[1] * c[0, 1]) / det
        alpha2 = (c[0, 0] * x[1] - c[1, 0] * x[0]) / det
    else:
        alpha1 = alpha2 = seg / 3
    if alpha1 < 1e-6 * seg or alpha2 < 1e-6 * seg:
        alpha1 = alpha2 = seg / 3
    return [p0, p0 + alpha1 * t1, p3 + alpha2 * t2, p3]


def _reparameterize(ctrl, pts, u):
    q = bezier(ctrl, u) - pts
    d1, d2 = _d1(ctrl, u), _d2(ctrl, u)
    num = (q * d1).sum(1)
    den = (d1 * d1).sum(1) + (q * d2).sum(1)
    return np.clip(u - np.where(np.abs(den) > 1e-12, num / den, 0), 0, 1)


def _max_error(ctrl, pts, u):
    e = np.linalg.norm(bezier(ctrl, u) - pts, axis=1)
    i = int(np.argmax(e))
    return e[i], i


def _fit(pts, t1, t2, tolerance, out):
    if len(pts) == 2:
        d = np.linalg.norm(pts[1] - pts[0]) / 3
        out.append([pts[0], pts[0] + t1 * d, pts[1] + t2 * d, pts[1]])
        return
    u = _chord_params(pts)
    ctrl = _generate(pts, u, t1, t2)
    err, i = _max_error(ctrl, pts, u)
    if err < tolerance:
        out.append(ctrl)
        return
    if err < tolerance * 4:
        for _ in range(20):
            u = _reparameterize(ctrl, pts, u)
            ctrl = _generate(pts, u, t1, t2)
            err, i = _max_error(ctrl, pts, u)
            if err < tolerance:
                out.append(ctrl)
                return
    i = max(1, min(len(pts) - 2, i))
    tc = unit(pts[i - 1] - pts[i + 1])
    _fit(pts[: i + 1], t1, tc, tolerance, out)
    _fit(pts[i:], -tc, t2, tolerance, out)


def fit_curve(pts, tolerance, start_tangent=None, end_tangent=None):
    """Fit cubic segments to an ordered polyline. Tangents point along the direction of travel."""
    pts = np.asarray(pts, float)
    k = min(4, len(pts) - 1)
    t1 = unit(pts[k] - pts[0]) if start_tangent is None else unit(start_tangent)
    t2 = unit(pts[-1 - k] - pts[-1]) if end_tangent is None else -unit(end_tangent)
    out = []
    _fit(pts, t1, t2, tolerance, out)
    return out
