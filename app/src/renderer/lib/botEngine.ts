import type { BotAnimation, BotExpression, BotShape } from "@shared/agentBot";
import { badgeTransform, type BotDetail, type BotPose, botPose, mixPose, renderPose, weaveStrength } from "./botGeometry";

/**
 * The bots' motion (W16), kept cheap. A bot at rest never recomputes its outline: the steady moves (breathing, the
 * hop of the exclamation mark, the shake of the alert, the pulse of the knots) are CSS animations chosen by the
 * `data-move` attribute, and they run only on bots in view (`data-live`). This module draws only what CSS cannot:
 * the morph from one form to the next when the state changes, and blinks and winks, which are two writes each at
 * random intervals. The eyes do not follow the cursor. Its frame loop runs at most `BOT_FPS` times per second and
 * only while a morph is under way. Everything stops when the window is hidden or loses focus, and
 * with `prefers-reduced-motion` each bot keeps the still pose of its expression.
 */

export const BOT_FPS = 24;
const FRAME = 1 / BOT_FPS;
/** How long a morph runs after the target changes; the pose eases toward it with a 0.11 s time constant. */
const SETTLE = 0.6;
const BLINK = 0.13;
const WINK = 0.45;
const EVENT_SLOT = 0.25;

export interface BotNodes {
  root: SVGGElement;
  blobs: [SVGPathElement, SVGPathElement, SVGPathElement];
  dim: SVGPathElement;
  seam: SVGPathElement | null;
  weave: SVGPathElement | null;
  eyes: SVGGElement;
  eyePaths: [SVGPathElement, SVGPathElement];
  badge: SVGCircleElement;
}

export interface BotState {
  shape: BotShape;
  animation: BotAnimation;
  expression: BotExpression;
  detail: BotDetail;
  seed: number;
}

interface Instance {
  el: SVGSVGElement;
  nodes: BotNodes;
  state: BotState;
  /** A move played once over the state's own: alert, wide eyes, a wink on hover. */
  once: { animation: BotAnimation; expression: BotExpression; until: number } | null;
  pose: BotPose;
  target: BotPose;
  /** The loop eases this bot toward its target until then. */
  settleUntil: number;
  blinkUntil: number;
  nextBlink: number;
  winkUntil: number;
  nextWink: number;
  visible: boolean;
}

/** Counters read by ui-check to prove the loop stays within its budget. */
export interface BotStats {
  frames: number;
  writes: number;
}
const stats: BotStats = { frames: 0, writes: 0 };

const instances = new Map<Element, Instance>();
let frameTimer: ReturnType<typeof setTimeout> | null = null;
let eventTimer: ReturnType<typeof setTimeout> | null = null;
let lastFrame = 0;
let blurred = false;

const hasWindow = typeof window !== "undefined";
const reducedQuery = hasWindow && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const prefersReducedMotion = () => Boolean(reducedQuery?.matches);
const paused = () => prefersReducedMotion() || blurred || (typeof document !== "undefined" && document.hidden);
const seconds = () => performance.now() / 1000;

/** A pseudo-random number in [0, 1) from the bot's seed and a counter, so bots blink out of step. */
const jitter = (seed: number, n: number) => {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const observer =
  typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const instance = instances.get(entry.target);
          if (!instance) continue;
          instance.visible = entry.isIntersecting;
          // CSS animates only the bots in view.
          if (entry.isIntersecting) instance.el.setAttribute("data-live", "");
          else instance.el.removeAttribute("data-live");
        }
        schedule();
      })
    : null;

function setPaused() {
  document.documentElement.classList.toggle("bots-paused", paused());
  if (paused()) {
    stopTimers();
    // A bot caught mid-blink or mid-morph settles on its still pose.
    for (const instance of instances.values()) drawStill(instance);
  } else {
    const now = seconds();
    for (const instance of instances.values()) planEvents(instance, now);
    schedule();
  }
}

if (hasWindow) {
  document.addEventListener("visibilitychange", setPaused);
  window.addEventListener("blur", () => {
    blurred = true;
    setPaused();
  });
  window.addEventListener("focus", () => {
    blurred = false;
    setPaused();
  });
  blurred = typeof document.hasFocus === "function" && !document.hasFocus();
  reducedQuery?.addEventListener("change", setPaused);
  (window as unknown as { __tramaBots?: BotStats }).__tramaBots = stats;
  queueMicrotask(() => document.documentElement.classList.toggle("bots-paused", paused()));
}

function stopTimers() {
  if (frameTimer) clearTimeout(frameTimer);
  if (eventTimer) clearTimeout(eventTimer);
  frameTimer = null;
  eventTimer = null;
}

function write(instance: Instance, pose: BotPose) {
  const { nodes } = instance;
  const weave = weaveStrength(instance.state.detail);
  const r = renderPose(pose);
  nodes.root.setAttribute("transform", r.root);
  r.blobs.forEach((d, i) => nodes.blobs[i]!.setAttribute("d", d));
  nodes.dim.setAttribute("d", r.blobs[0]);
  nodes.dim.setAttribute("opacity", String(r.dim * 0.5));
  if (nodes.seam) {
    nodes.seam.setAttribute("d", r.seam);
    nodes.seam.setAttribute("opacity", String(r.body));
  }
  if (nodes.weave) {
    nodes.weave.setAttribute("d", r.blobs[0]);
    nodes.weave.setAttribute("opacity", String(r.body * weave));
  }
  nodes.eyes.setAttribute("opacity", String(r.body));
  r.eyes.forEach((eye, i) => {
    nodes.eyePaths[i]!.setAttribute("d", eye.d);
    nodes.eyePaths[i]!.setAttribute("transform", eye.transform);
  });
  nodes.badge.setAttribute("transform", badgeTransform(r.badge));
  stats.writes++;
}

function move(instance: Instance, now: number): { animation: BotAnimation; expression: BotExpression } {
  if (instance.once && now < instance.once.until) return instance.once;
  return instance.state;
}

/** Where the bot should be now: its move's still pose, with the eyes closed in a blink or winking. */
function targetPose(instance: Instance, now: number): BotPose {
  const current = move(instance, now);
  const winking = now < instance.winkUntil && current.animation === "idle" && current.expression === "neutral";
  const pose = botPose({
    shape: instance.state.shape,
    animation: winking ? "wink" : current.animation,
    expression: current.expression,
    t: 0,
    seed: instance.state.seed,
    detail: instance.state.detail,
    moving: false,
  });
  if (now < instance.blinkUntil && current.expression !== "sleepy") {
    pose.eyes = [
      { ...pose.eyes[0], h: pose.eyes[0].h * 0.12 },
      { ...pose.eyes[1], h: pose.eyes[1].h * 0.12 },
    ];
  }
  return pose;
}

function setMoveAttribute(instance: Instance, now: number) {
  instance.el.setAttribute("data-move", move(instance, now).animation);
}

function drawStill(instance: Instance) {
  instance.once = null;
  instance.blinkUntil = 0;
  instance.winkUntil = 0;
  instance.pose = targetPose(instance, 0);
  instance.target = instance.pose;
  instance.settleUntil = 0;
  setMoveAttribute(instance, 0);
  write(instance, instance.pose);
}

/** A new target: morphed toward over the next frames, or drawn at once for a blink. */
function retarget(instance: Instance, now: number, instant = false) {
  instance.target = targetPose(instance, now);
  if (instant) {
    // Only the eyes change in a blink or a wink: no need to ease the outline.
    instance.pose = { ...instance.pose, eyes: instance.target.eyes };
    write(instance, instance.pose);
    return;
  }
  instance.settleUntil = now + SETTLE;
  schedule();
}

function planEvents(instance: Instance, now: number) {
  instance.nextBlink = now + 3.5 + jitter(instance.state.seed, now) * 4;
  instance.nextWink = now + 12 + jitter(instance.state.seed + 1, now) * 10;
}

/** Runs the blinks, winks and the end of one-off moves that are due, then waits for the next one. */
function runEvents() {
  eventTimer = null;
  if (paused()) return;
  const now = seconds();
  let next = Infinity;
  for (const instance of instances.values()) {
    if (instance.once && now >= instance.once.until) {
      instance.once = null;
      setMoveAttribute(instance, now);
      retarget(instance, now);
    }
    if (instance.once) next = Math.min(next, instance.once.until);
    if (!instance.visible) continue;
    if (instance.blinkUntil && now >= instance.blinkUntil) {
      instance.blinkUntil = 0;
      retarget(instance, now, true);
    } else if (!instance.blinkUntil && now >= instance.nextBlink) {
      instance.blinkUntil = now + BLINK;
      instance.nextBlink = now + 3.5 + jitter(instance.state.seed, now) * 4;
      retarget(instance, now, true);
    }
    if (instance.winkUntil && now >= instance.winkUntil) {
      instance.winkUntil = 0;
      retarget(instance, now, true);
    } else if (!instance.winkUntil && now >= instance.nextWink) {
      instance.winkUntil = now + WINK;
      instance.nextWink = now + 12 + jitter(instance.state.seed + 1, now) * 10;
      retarget(instance, now, true);
    }
    next = Math.min(next, instance.blinkUntil || instance.nextBlink, instance.winkUntil || instance.nextWink);
  }
  // Events wait for the next quarter second, so the blinks of many bots share one redraw.
  if (next < Infinity) eventTimer = setTimeout(runEvents, Math.max(16, (Math.ceil(next / EVENT_SLOT) * EVENT_SLOT - seconds()) * 1000));
}

function frame() {
  frameTimer = null;
  if (paused()) return;
  const now = seconds();
  const step = Math.min(0.1, lastFrame ? now - lastFrame : FRAME);
  lastFrame = now;
  stats.frames++;
  const visible = [...instances.values()].filter((i) => i.visible);
  const k = 1 - Math.exp(-step / 0.11);
  for (const instance of visible) {
    if (instance.settleUntil <= now) continue;
    instance.pose = mixPose(instance.pose, instance.target, k);
    write(instance, instance.pose);
  }
  schedule();
}

/** Keeps the frame loop running only while a bot in view morphs, at most `BOT_FPS` times per second. */
function schedule() {
  if (paused() || !hasWindow) return;
  if (!eventTimer) eventTimer = setTimeout(runEvents, 0);
  if (frameTimer) return;
  const now = seconds();
  const busy = [...instances.values()].some((i) => i.visible && i.settleUntil > now);
  if (!busy) {
    lastFrame = 0;
    return;
  }
  const wait = lastFrame ? Math.max(0, FRAME - (now - lastFrame)) : 0;
  frameTimer = setTimeout(() => requestAnimationFrame(frame), wait * 1000);
}

export function registerBot(el: SVGSVGElement, nodes: BotNodes, state: BotState) {
  const empty = botPose({ ...state, t: 0, moving: false });
  const instance: Instance = {
    el,
    nodes,
    state,
    once: null,
    pose: empty,
    target: empty,
    settleUntil: 0,
    blinkUntil: 0,
    nextBlink: 0,
    winkUntil: 0,
    nextWink: 0,
    visible: false,
  };
  instances.set(el, instance);
  drawStill(instance);
  planEvents(instance, seconds());
  observer?.observe(el);
  return {
    update(next: BotState) {
      const reset = next.detail !== instance.state.detail;
      instance.state = next;
      const now = seconds();
      setMoveAttribute(instance, now);
      if (reset || paused()) drawStill(instance);
      else retarget(instance, now);
    },
    /** Plays a move once, for `seconds`, then returns to the state's own. */
    play(animation: BotAnimation, expression: BotExpression, duration: number) {
      if (paused()) return;
      const now = seconds();
      instance.once = { animation, expression, until: now + duration };
      setMoveAttribute(instance, now);
      retarget(instance, now);
      if (eventTimer) clearTimeout(eventTimer);
      eventTimer = setTimeout(runEvents, duration * 1000);
    },
    unregister() {
      observer?.unobserve(el);
      instances.delete(el);
    },
  };
}
