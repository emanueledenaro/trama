import type { BotAnimation, BotExpression, BotShape } from "@shared/agentBot";

/**
 * The bot's drawing (W16, ADR 0007), as pure functions so a frame can be tested and drawn without animation.
 * Poses live in unit coordinates, where the body fits in [-1, 1]; `renderPose` scales them to the SVG's
 * `-108 -108 216 216` box. Every form (the body, three knots, a mark, a spool) is three closed outlines with the
 * same number of points, so the engine morphs between forms point by point instead of cutting.
 */

export interface Point {
  x: number;
  y: number;
}

export interface EyePose {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees. */
  rotate: number;
  /** Degrees of horizontal skew: the slant of a stitch. */
  skew: number;
}

export interface BotPose {
  /** Three outlines: in the body form they coincide; the other forms pull them apart. */
  blobs: [Point[], Point[], Point[]];
  eyes: [EyePose, EyePose];
  /** The eyes, the seam and the weave belong to the body form and fade in the others. */
  body: number;
  /** The darker middle knot while thinking. */
  dim: number;
  /** The notification knot at the top right, 0 to 1. */
  badge: number;
  /** The thread, five points drawn behind the body. */
  thread: Point[];
  offset: { x: number; y: number; rotate: number };
}

export type BotDetail = "low" | "mid" | "high";

export const BOT_VIEWBOX = "-108 -108 216 216";
/** A unit in viewBox units: the body's half size. */
export const BOT_UNIT = 80;
/** The clay's radial gradient, lit from the top left; the stop colors are in `.agent-bot` in index.css. */
export const CLAY = { cx: -58, cy: -66, r: 200, stops: [0, 0.14, 0.4, 1] } as const;
export const MINIMUM_BOT_SIZE = 16;
export const MAXIMUM_BOT_SIZE = 96;

export function clampBotSize(size: number): number {
  return Math.min(MAXIMUM_BOT_SIZE, Math.max(MINIMUM_BOT_SIZE, Math.round(size)));
}

/** Small bots drop the thread, the seam and the weave, and keep bigger eyes so they stay readable. */
export function botDetail(size: number): BotDetail {
  if (size < 24) return "low";
  if (size < 48) return "mid";
  return "high";
}

export function pointCount(detail: BotDetail): number {
  return detail === "low" ? 20 : detail === "mid" ? 28 : 40;
}

const TAU = Math.PI * 2;

/** A superellipse's radius at an angle: `n` = 2 is an ellipse, larger values are squarer. */
function superRadius(theta: number, a: number, b: number, n: number): number {
  return (Math.abs(Math.cos(theta) / a) ** n + Math.abs(Math.sin(theta) / b) ** n) ** (-1 / n);
}

/** A polygon with softened corners: `sides` corners, one pointing at `rotation`, corners pulled in by `soft`. */
function polygonRadius(theta: number, sides: number, rotation: number, soft: number): number {
  const sector = TAU / sides;
  const phi = ((((theta - rotation) % sector) + sector) % sector) - sector / 2;
  const apothem = Math.cos(Math.PI / sides);
  const sharp = apothem / Math.cos(phi);
  return sharp - soft * (sharp - apothem);
}

const UP = -Math.PI / 2;

/** Each body as a radius around its centre, before it is fitted into the unit box. y grows downward. */
const RADIUS: Record<BotShape, (theta: number) => number> = {
  circle: (t) => 1 + 0.015 * Math.sin(3 * t + 0.4),
  pebble: (t) => 1 + 0.08 * Math.cos(2 * t) + 0.045 * Math.sin(3 * t + 0.6),
  squircle: (t) => superRadius(t, 1, 1, 4.2),
  capsule: (t) => superRadius(t, 0.62, 1, 2.6),
  triangle: (t) => polygonRadius(t, 3, UP, 0.3),
  hexagon: (t) => polygonRadius(t, 6, UP, 0.22),
  cloud: (t) => superRadius(t, 1, 0.7, 2.8) + 0.2 * Math.max(0, -Math.sin(t)) * Math.abs(Math.cos(3 * (t - UP))) ** 0.8,
  droplet: (t) => 0.8 + 0.34 * Math.max(0, -Math.sin(t)) ** 5,
  shield: (t) => (Math.sin(t) < 0 ? superRadius(t, 0.9, 0.8, 4) : 0.9 - 0.12 * Math.sin(t) ** 2 + 0.4 * Math.sin(t) ** 8),
  arch: (t) => (Math.sin(t) < 0 ? 0.86 : superRadius(t, 0.86, 1, 5)),
  diamond: (t) => polygonRadius(t, 4, UP, 0.26),
  flower: (t) => 0.9 + 0.1 * Math.cos(8 * (t - UP)),
  egg: (t) => 1 - 0.1 * Math.max(0, -Math.sin(t)) * Math.abs(Math.cos(t)) - 0.02 * Math.sin(t),
  bean: (t) => superRadius(t, 1, 0.84, 2.2) - 0.14 * Math.max(0, -Math.sin(t)) ** 9,
  star: (t) => 0.8 + 0.2 * Math.cos(5 * (t - UP)),
  pentagon: (t) => polygonRadius(t, 5, UP, 0.22),
  screen: (t) => superRadius(t, 1, 0.74, 4.6),
};

/** Where each body's eyes sit and how far apart, in unit coordinates. */
const EYES: Record<BotShape, { y: number; gap: number }> = {
  circle: { y: -0.12, gap: 0.3 },
  pebble: { y: -0.1, gap: 0.3 },
  squircle: { y: -0.12, gap: 0.32 },
  capsule: { y: -0.2, gap: 0.22 },
  triangle: { y: 0.26, gap: 0.22 },
  hexagon: { y: -0.08, gap: 0.3 },
  cloud: { y: 0, gap: 0.3 },
  droplet: { y: 0.14, gap: 0.26 },
  shield: { y: -0.2, gap: 0.3 },
  arch: { y: -0.16, gap: 0.28 },
  diamond: { y: -0.06, gap: 0.24 },
  flower: { y: -0.08, gap: 0.28 },
  egg: { y: 0, gap: 0.28 },
  bean: { y: 0.04, gap: 0.3 },
  star: { y: 0.02, gap: 0.2 },
  pentagon: { y: -0.02, gap: 0.28 },
  screen: { y: -0.06, gap: 0.32 },
};

const outlineCache = new Map<string, Point[]>();

/** A body's outline, `count` points from the top going clockwise, fitted and centred in [-1, 1]. */
export function shapeOutline(shape: BotShape, count: number): Point[] {
  const key = `${shape}:${count}`;
  const cached = outlineCache.get(key);
  if (cached) return cached;
  const raw = Array.from({ length: count }, (_, i) => {
    const theta = UP + (i / count) * TAU;
    const r = RADIUS[shape](theta);
    return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
  });
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = 2 / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const fitted = raw.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }));
  outlineCache.set(key, fitted);
  return fitted;
}

/** A form other than the body, sampled the same way: `count` points from the top, clockwise. */
function formOutline(count: number, form: { cx: number; cy: number; a: number; b: number; n?: number; rotate?: number; taper?: number }): Point[] {
  const rotate = ((form.rotate ?? 0) * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => {
    const theta = UP + (i / count) * TAU;
    const r = superRadius(theta, form.a, form.b, form.n ?? 2);
    let x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    // A tapered bar is wider at the top, like a hand-drawn exclamation mark.
    if (form.taper) x *= 1 - form.taper * (y / form.b);
    return {
      x: form.cx + x * Math.cos(rotate) - y * Math.sin(rotate),
      y: form.cy + x * Math.sin(rotate) + y * Math.cos(rotate),
    };
  });
}

const EXPRESSIONS: Record<BotExpression, { w: number; h: number; dy: number; rotate: number; skew: number; spread?: number }> = {
  // Two short slanted stitches.
  neutral: { w: 0.1, h: 0.3, dy: 0, rotate: 0, skew: -14 },
  attentive: { w: 0.1, h: 0.24, dy: -0.04, rotate: 0, skew: -6 },
  surprised: { w: 0.2, h: 0.24, dy: -0.02, rotate: 0, skew: 0 },
  excited: { w: 0.16, h: 0.46, dy: -0.04, rotate: 0, skew: -12 },
  happy: { w: 0.2, h: 0.08, dy: -0.04, rotate: 10, skew: 0 },
  laughing: { w: 0.22, h: 0.06, dy: -0.02, rotate: 22, skew: 0 },
  angry: { w: 0.15, h: 0.18, dy: 0.02, rotate: -28, skew: 0 },
  sad: { w: 0.15, h: 0.18, dy: 0.06, rotate: 28, skew: 0 },
  scared: { w: 0.08, h: 0.18, dy: 0, rotate: 0, skew: 0, spread: 0.06 },
  sleepy: { w: 0.18, h: 0.04, dy: 0.06, rotate: 0, skew: 0 },
};

export interface PoseInput {
  shape: BotShape;
  animation: BotAnimation;
  expression: BotExpression;
  /** Seconds; 0 gives the still frame of the expression. */
  t: number;
  /** A number from the agent's id, so bots of the same state do not move in step. */
  seed: number;
  /** Where the cursor is, as a vector of length up to 1 from the bot; null keeps the default glance. */
  look: Point | null;
  detail: BotDetail;
  /** False for reduced motion: the pose of the expression, with no breathing, blinking or wobble. */
  moving: boolean;
}

function eyePair(input: PoseInput, expression: BotExpression, wink: boolean): [EyePose, EyePose] {
  const place = EYES[input.shape];
  const preset = EXPRESSIONS[expression];
  const grow = input.detail === "low" ? 1.45 : 1;
  // By default the stitches glance up and to the right; the cursor takes over when it is near.
  const glance = input.look ? { x: input.look.x * 0.12, y: input.look.y * 0.1 } : { x: 0.07, y: -0.06 };
  let drift = { x: 0, y: 0 };
  let blink = 1;
  let tremble = 0;
  if (input.moving) {
    drift = { x: 0.02 * Math.sin(input.t * 0.7 + input.seed), y: 0.015 * Math.sin(input.t * 0.53 + input.seed * 2) };
    const period = 4.2 + (input.seed % 1) * 2.4;
    if ((input.t + input.seed * 7) % period < 0.13 && expression !== "sleepy") blink = 0.12;
    if (expression === "scared") tremble = 0.012 * Math.sin(input.t * 40);
  }
  const eye = (side: -1 | 1): EyePose => {
    const closed = wink && side === 1;
    return {
      x: side * (place.gap + (preset.spread ?? 0)) + glance.x + drift.x + tremble,
      y: place.y + preset.dy + glance.y + drift.y,
      w: (closed ? 0.18 : preset.w) * grow,
      h: (closed ? 0.045 : preset.h * blink) * grow,
      rotate: closed ? 0 : preset.rotate * -side,
      skew: closed ? 0 : preset.skew,
    };
  };
  return [eye(-1), eye(1)];
}

/** The body form, breathing and slightly soft on its outline when it moves. */
function bodyBlob(input: PoseInput, count: number): Point[] {
  const outline = shapeOutline(input.shape, count);
  if (!input.moving) return outline.map((p) => ({ ...p }));
  const breath = Math.sin((input.t * TAU) / 3.6 + input.seed);
  const sx = 1 + 0.018 * breath;
  const sy = 1 - 0.012 * breath;
  const wobble = input.detail === "high" ? 0.012 : 0;
  return outline.map((p, i) => {
    const theta = (i / count) * TAU;
    const soft = 1 + wobble * (Math.sin(3 * theta + input.t * 1.4 + input.seed) + 0.6 * Math.sin(5 * theta - input.t * 1.1));
    return { x: p.x * sx * soft, y: p.y * sy * soft };
  });
}

const circle = (count: number, cx: number, cy: number, r: number) => formOutline(count, { cx, cy, a: r, b: r });

/** The thread behind the body: it comes out at the lower right and trails away, waving a little. */
function bodyThread(input: PoseInput): Point[] {
  const wave = input.moving ? 0.05 * Math.sin(input.t * 2 + input.seed) : 0;
  return [
    { x: 0.2, y: 0.3 },
    { x: 0.66, y: 0.66 },
    { x: 0.98, y: 0.9 + wave * 0.4 },
    { x: 1.16, y: 0.94 + wave },
    { x: 1.3, y: 0.86 + wave * 1.6 },
  ];
}

/** The pose of one move at time `t`. */
export function botPose(input: PoseInput): BotPose {
  const count = pointCount(input.detail);
  const t = input.moving ? input.t : 0;
  const still = { x: 0, y: 0, rotate: 0 };
  const body = bodyBlob(input, count);
  const base: BotPose = {
    blobs: [body, body, body],
    eyes: eyePair(input, input.expression, false),
    body: 1,
    dim: 0,
    badge: 0,
    thread: bodyThread(input),
    offset: still,
  };
  switch (input.animation) {
    case "idle": {
      const wink = input.moving && input.expression === "neutral" && (t + input.seed * 11) % (13 + (input.seed % 1) * 5) < 0.45;
      return { ...base, eyes: eyePair(input, input.expression, wink) };
    }
    case "wink":
      return { ...base, eyes: eyePair(input, "neutral", true) };
    case "wide":
      return { ...base, eyes: eyePair(input, "excited", false) };
    case "notification": {
      const pulse = input.moving ? 1 + 0.14 * Math.max(0, Math.sin((t * TAU) / 2.4)) ** 8 : 1;
      return { ...base, eyes: eyePair(input, "surprised", false), badge: pulse };
    }
    case "thinking": {
      // Three knots on a thread, the middle one larger and darker, tightening one after the other.
      const knot = (i: number) => (input.moving ? 1 + 0.28 * Math.max(0, Math.sin((t * TAU) / 1.3 - i * 1.1)) : 1);
      const wave = (x: number) => (input.moving ? 0.04 * Math.sin(t * 2.4 + x * 3) : 0);
      return {
        ...base,
        blobs: [circle(count, 0, wave(0), 0.26 * knot(1)), circle(count, -0.6, wave(-0.6), 0.18 * knot(0)), circle(count, 0.6, wave(0.6), 0.18 * knot(2))],
        body: 0,
        dim: 1,
        thread: [-1.2, -0.6, 0, 0.6, 1.2].map((x) => ({ x, y: wave(x) })),
      };
    }
    case "alert": {
      // A slanted exclamation mark with a short shake.
      const cycle = t % 2.2;
      const shake = input.moving ? 0.07 * Math.sin(t * TAU * 8) * Math.max(0, 1 - cycle / 0.5) : 0;
      const dot = formOutline(count, { cx: -0.16, cy: 0.66, a: 0.17, b: 0.17 });
      return {
        ...base,
        blobs: [formOutline(count, { cx: 0.06, cy: -0.2, a: 0.2, b: 0.58, n: 2.2, rotate: 14 }), dot, dot],
        body: 0,
        thread: [
          { x: -0.16, y: 0.66 },
          { x: -0.02, y: 0.82 },
          { x: 0.2, y: 0.9 },
          { x: 0.4, y: 0.88 },
          { x: 0.56, y: 0.8 },
        ],
        offset: { x: shake, y: 0, rotate: shake * 40 },
      };
    }
    case "exclamation": {
      // An upright, tapered exclamation mark that keeps bouncing.
      const hop = input.moving ? -0.09 * Math.abs(Math.sin((t * Math.PI) / 0.75)) : 0;
      const dot = circle(count, 0, 0.7, 0.18);
      return {
        ...base,
        blobs: [formOutline(count, { cx: 0, cy: -0.22, a: 0.2, b: 0.56, n: 2.4, taper: 0.35 }), dot, dot],
        body: 0,
        thread: [
          { x: 0, y: 0.7 },
          { x: 0.16, y: 0.86 },
          { x: 0.38, y: 0.92 },
          { x: 0.58, y: 0.88 },
          { x: 0.72, y: 0.8 },
        ],
        offset: { x: 0, y: hop, rotate: 0 },
      };
    }
    case "sleep": {
      // A small spool with its thread, breathing slowly.
      const r = 0.24 * (input.moving ? 1 + 0.12 * Math.sin((t * TAU) / 4 + input.seed) : 1);
      const spool = circle(count, 0, 0.1, r);
      return {
        ...base,
        blobs: [spool, spool, spool],
        body: 0,
        thread: [
          { x: 0, y: 0.1 },
          { x: 0.22, y: 0.26 },
          { x: 0.46, y: 0.34 },
          { x: 0.66, y: 0.3 },
          { x: 0.82, y: 0.22 },
        ],
      };
    }
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpPoints = (a: Point[], b: Point[], k: number) => (a.length === b.length ? a.map((p, i) => ({ x: lerp(p.x, b[i]!.x, k), y: lerp(p.y, b[i]!.y, k) })) : b);
const lerpEye = (a: EyePose, b: EyePose, k: number): EyePose => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
  rotate: lerp(a.rotate, b.rotate, k),
  skew: lerp(a.skew, b.skew, k),
});

/** A pose `k` of the way from `a` to `b`: the morph between moves. */
export function mixPose(a: BotPose, b: BotPose, k: number): BotPose {
  return {
    blobs: [lerpPoints(a.blobs[0], b.blobs[0], k), lerpPoints(a.blobs[1], b.blobs[1], k), lerpPoints(a.blobs[2], b.blobs[2], k)],
    eyes: [lerpEye(a.eyes[0], b.eyes[0], k), lerpEye(a.eyes[1], b.eyes[1], k)],
    body: lerp(a.body, b.body, k),
    dim: lerp(a.dim, b.dim, k),
    badge: lerp(a.badge, b.badge, k),
    thread: lerpPoints(a.thread, b.thread, k),
    offset: { x: lerp(a.offset.x, b.offset.x, k), y: lerp(a.offset.y, b.offset.y, k), rotate: lerp(a.offset.rotate, b.offset.rotate, k) },
  };
}

const f = (value: number) => (Math.round(value * 10) / 10).toString();
const scaled = (p: Point) => ({ x: p.x * BOT_UNIT, y: p.y * BOT_UNIT });

/** A smooth closed outline through the points (Catmull-Rom as cubic Béziers), in viewBox units. */
export function closedPath(points: Point[]): string {
  const p = points.map(scaled);
  const n = p.length;
  let d = `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p[(i - 1 + n) % n]!, p[i]!, p[(i + 1) % n]!, p[(i + 2) % n]!];
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return `${d}Z`;
}

/** A smooth open line through the points, in viewBox units. */
export function openPath(points: Point[]): string {
  const p = points.map(scaled);
  let d = `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [p0, p1, p2, p3] = [p[Math.max(0, i - 1)]!, p[i]!, p[i + 1]!, p[Math.min(p.length - 1, i + 2)]!];
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** A stitch: a stadium of the eye's size, centred on the origin, in viewBox units. */
export function eyePath(eye: EyePose): string {
  const w = Math.max(0.5, eye.w * BOT_UNIT);
  const h = Math.max(0.5, eye.h * BOT_UNIT);
  const r = Math.min(w, h) / 2;
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -h / 2, h / 2];
  return `M${f(x0 + r)} ${f(y0)}H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)}V${f(y1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)}H${f(x0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0)} ${f(y1 - r)}V${f(y0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)}Z`;
}

export function eyeTransform(eye: EyePose): string {
  return `translate(${f(eye.x * BOT_UNIT)} ${f(eye.y * BOT_UNIT)}) rotate(${f(eye.rotate)}) skewX(${f(eye.skew)})`;
}

/** The seam: the first outline drawn again a little inside itself, as a dashed stitch. */
export function seamPath(points: Point[]): string {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return closedPath(points.map((p) => ({ x: cx + (p.x - cx) * 0.8, y: cy + (p.y - cy) * 0.8 })));
}

/** Everything the SVG needs for one pose, as attribute strings. */
export interface RenderedPose {
  blobs: [string, string, string];
  seam: string;
  thread: string;
  eyes: [{ d: string; transform: string }, { d: string; transform: string }];
  body: number;
  dim: number;
  badge: number;
  root: string;
}

export function renderPose(pose: BotPose): RenderedPose {
  return {
    blobs: [closedPath(pose.blobs[0]), closedPath(pose.blobs[1]), closedPath(pose.blobs[2])],
    seam: seamPath(pose.blobs[0]),
    thread: openPath(pose.thread),
    eyes: [
      { d: eyePath(pose.eyes[0]), transform: eyeTransform(pose.eyes[0]) },
      { d: eyePath(pose.eyes[1]), transform: eyeTransform(pose.eyes[1]) },
    ],
    body: Math.round(pose.body * 100) / 100,
    dim: Math.round(pose.dim * 100) / 100,
    badge: Math.round(pose.badge * 100) / 100,
    root: `translate(${f(pose.offset.x * BOT_UNIT)} ${f(pose.offset.y * BOT_UNIT)}) rotate(${f(pose.offset.rotate)})`,
  };
}

/** The badge knot's radius, in viewBox units; it sits at the top right and grows from its centre. */
export const BADGE_RADIUS = 0.2 * BOT_UNIT;

export function badgeTransform(scale: number): string {
  return `translate(${f(0.7 * BOT_UNIT)} ${f(-0.7 * BOT_UNIT)}) scale(${Math.round(scale * 100) / 100})`;
}
