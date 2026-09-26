import type { BotAnimation, BotExpression, BotShape } from "@shared/agentBot";
import { badgeTransform, type BotDetail, type BotPose, botPose, mixPose, type Point, renderPose, weaveStrength } from "./botGeometry";

/**
 * One animation loop for every bot on screen (W16). A bot moves only while it is visible (IntersectionObserver), so
 * long lists animate just the rows in view; with `prefers-reduced-motion` the loop stops and each bot keeps the still
 * frame of its expression. The loop writes SVG attributes directly, without React renders.
 */

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
  followsCursor: boolean;
  detail: BotDetail;
  seed: number;
}

interface Instance {
  el: Element;
  nodes: BotNodes;
  state: BotState;
  /** A move played once over the state's own: alert, wide eyes, a wink on hover. */
  once: { animation: BotAnimation; expression: BotExpression; until: number } | null;
  pose: BotPose | null;
  visible: boolean;
  lastFrame: number;
}

const instances = new Map<Element, Instance>();
let frame = 0;
let lastTime = 0;
const pointer = { x: 0, y: 0, seen: false };

const reducedQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const prefersReducedMotion = () => Boolean(reducedQuery?.matches);

const observer =
  typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const instance = instances.get(entry.target);
          if (instance) instance.visible = entry.isIntersecting;
        }
        schedule();
      })
    : null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => (pointer.seen = false));
  reducedQuery?.addEventListener("change", () => {
    for (const instance of instances.values()) drawStill(instance);
    schedule();
  });
}

const seconds = () => performance.now() / 1000;

function write(nodes: BotNodes, pose: BotPose, weave: number) {
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
}

function current(instance: Instance, now: number): { animation: BotAnimation; expression: BotExpression } {
  if (instance.once && now < instance.once.until) return instance.once;
  instance.once = null;
  return instance.state;
}

function drawStill(instance: Instance) {
  const { state } = instance;
  instance.pose = botPose({ ...state, t: 0, look: null, moving: false });
  write(instance.nodes, instance.pose, weaveStrength(instance.state.detail));
}

function tick() {
  frame = 0;
  const now = seconds();
  const dt = Math.min(0.1, lastTime ? now - lastTime : 0.016);
  lastTime = now;
  if (prefersReducedMotion()) return;
  const active = [...instances.values()].filter((i) => i.visible);
  // Read every position first, then write, so the loop never forces a layout between writes.
  const looks = active.map((instance) => {
    if (!instance.state.followsCursor || !pointer.seen) return null;
    const box = instance.el.getBoundingClientRect();
    const reach = Math.max(box.width * 4, 160);
    const look: Point = { x: (pointer.x - (box.left + box.width / 2)) / reach, y: (pointer.y - (box.top + box.height / 2)) / reach };
    const length = Math.hypot(look.x, look.y);
    return length > 1 ? { x: look.x / length, y: look.y / length } : look;
  });
  active.forEach((instance, index) => {
    // Small bots move at a lower frame rate: their detail is lower too.
    if (instance.state.detail === "low" && now - instance.lastFrame < 1 / 20) return;
    const step = now - (instance.lastFrame || now - dt);
    instance.lastFrame = now;
    const move = current(instance, now);
    const target = botPose({ ...instance.state, ...move, t: now, look: looks[index] ?? null, moving: true });
    instance.pose = instance.pose ? mixPose(instance.pose, target, 1 - Math.exp(-step / 0.11)) : target;
    write(instance.nodes, instance.pose, weaveStrength(instance.state.detail));
  });
  if (active.length) schedule();
}

function schedule() {
  if (frame || prefersReducedMotion() || typeof requestAnimationFrame === "undefined") return;
  if (![...instances.values()].some((i) => i.visible)) {
    lastTime = 0;
    return;
  }
  frame = requestAnimationFrame(tick);
}

export function registerBot(el: Element, nodes: BotNodes, state: BotState) {
  const instance: Instance = { el, nodes, state, once: null, pose: null, visible: false, lastFrame: 0 };
  instances.set(el, instance);
  drawStill(instance);
  observer?.observe(el);
  return {
    update(next: BotState) {
      const reset = next.detail !== instance.state.detail;
      instance.state = next;
      if (reset || prefersReducedMotion()) drawStill(instance);
      schedule();
    },
    /** Plays a move once, for `seconds`, then returns to the state's own. */
    play(animation: BotAnimation, expression: BotExpression, duration: number) {
      if (prefersReducedMotion()) return;
      instance.once = { animation, expression, until: seconds() + duration };
      schedule();
    },
    unregister() {
      observer?.unobserve(el);
      instances.delete(el);
    },
  };
}
