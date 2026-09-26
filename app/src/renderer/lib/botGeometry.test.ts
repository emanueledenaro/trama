import { describe, expect, it } from "vitest";
import { BOT_SHAPES, type BotAnimation, type BotExpression } from "@shared/agentBot";
import { AGENT_PALETTE } from "@shared/identity";
import { BOT_UNIT, botDetail, CLAY, botPose, clampBotSize, closedPath, mixPose, type PoseInput, pointCount, renderPose, shapeOutline, weaveStrength } from "./botGeometry";

const ANIMATIONS: BotAnimation[] = ["idle", "thinking", "wink", "wide", "alert", "notification", "exclamation", "sleep"];
const EXPRESSIONS: BotExpression[] = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "sleepy"];
const input = (over: Partial<PoseInput> = {}): PoseInput => ({
  shape: "circle",
  animation: "idle",
  expression: "neutral",
  t: 0,
  seed: 1.3,
  look: null,
  detail: "high",
  moving: false,
  ...over,
});

describe("bot geometry (W16)", () => {
  it("fits every body in the unit box, each with its own outline", () => {
    const outlines = new Set<string>();
    for (const shape of BOT_SHAPES) {
      const points = shapeOutline(shape, 40);
      expect(points).toHaveLength(40);
      for (const p of points) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1.0001);
      }
      outlines.add(closedPath(points));
    }
    expect(outlines.size).toBe(BOT_SHAPES.length);
  });

  it("keeps sizes between 16 and 96 px and reduces detail when small", () => {
    expect(clampBotSize(8)).toBe(16);
    expect(clampBotSize(200)).toBe(96);
    expect(botDetail(16)).toBe("low");
    expect(botDetail(24)).toBe("mid");
    expect(botDetail(48)).toBe("high");
    expect(pointCount("low")).toBeLessThan(pointCount("high"));
    // The fabric shows on big bots, fades at mid size and is gone on small ones.
    expect(weaveStrength("high")).toBe(1);
    expect(weaveStrength("mid")).toBeGreaterThan(0);
    expect(weaveStrength("mid")).toBeLessThan(1);
    expect(weaveStrength("low")).toBe(0);
  });

  it("gives every move three outlines of the same length, so moves morph point by point", () => {
    for (const detail of ["low", "mid", "high"] as const) {
      for (const animation of ANIMATIONS) {
        const pose = botPose(input({ animation, detail, t: 1.7, moving: true }));
        for (const blob of pose.blobs) expect(blob).toHaveLength(pointCount(detail));
      }
    }
    const halfway = mixPose(botPose(input()), botPose(input({ animation: "thinking" })), 0.5);
    expect(halfway.body).toBeCloseTo(0.5);
    expect(renderPose(halfway).blobs[0]).toMatch(/^M.*Z$/);
  });

  it("turns the body into knots, marks and a spool, and hides the eyes there", () => {
    const body = botPose(input());
    expect(body.body).toBe(1);
    expect(body.blobs[1]).toEqual(body.blobs[0]);
    const thinking = botPose(input({ animation: "thinking" }));
    const centre = (i: number) => thinking.blobs[i]!.reduce((s, p) => s + p.x, 0) / thinking.blobs[i]!.length;
    expect([centre(1), centre(0), centre(2)]).toEqual([expect.closeTo(-0.6, 1), expect.closeTo(0, 1), expect.closeTo(0.6, 1)]);
    expect(thinking.dim).toBe(1);
    expect(thinking.body).toBe(0);
    for (const animation of ["alert", "exclamation", "sleep"] as const) expect(botPose(input({ animation })).body).toBe(0);
    const spool = botPose(input({ animation: "sleep" }));
    expect(Math.max(...spool.blobs[0].map((p) => p.x))).toBeLessThan(0.3);
    expect(botPose(input({ animation: "notification" })).badge).toBe(1);
    expect(body.badge).toBe(0);
  });

  it("draws a different pair of eyes for each expression, and a wink closes one eye", () => {
    const eyes = new Set(EXPRESSIONS.map((expression) => JSON.stringify(botPose(input({ expression })).eyes)));
    expect(eyes.size).toBe(EXPRESSIONS.length);
    const [left, right] = botPose(input({ animation: "wink" })).eyes;
    expect(left.h).toBeGreaterThan(left.w);
    expect(right.w).toBeGreaterThan(right.h * 3);
    const wide = botPose(input({ animation: "wide" })).eyes[0];
    expect(wide.h).toBeGreaterThan(botPose(input()).eyes[0].h);
  });

  it("stays still with reduced motion and moves otherwise; the eyes follow the cursor", () => {
    expect(botPose(input({ t: 0 }))).toEqual(botPose(input({ t: 5 })));
    expect(botPose(input({ t: 0.3, moving: true }))).not.toEqual(botPose(input({ t: 2.1, moving: true })));
    const right = botPose(input({ look: { x: 1, y: 0 } })).eyes[0];
    const left = botPose(input({ look: { x: -1, y: 0 } })).eyes[0];
    expect(right.x).toBeGreaterThan(left.x);
  });

  it("keeps the white stitches readable on the woven clay of every palette color", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v * k + b[i]! * (1 - k));
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const entry of AGENT_PALETTE) {
      const [pale, deep] = [rgb(entry.dark), rgb(entry.light)];
      // The stops of `.agent-bot` in index.css.
      const stops: [number, number[]][] = [
        [CLAY.stops[0], mix(pale, [255, 255, 255], 0.7)],
        [CLAY.stops[1], mix(pale, deep, 0.5)],
        [CLAY.stops[2], deep],
        [CLAY.stops[3], mix(deep, [0, 0, 0], 0.65)],
      ];
      const clay = (offset: number) => {
        const i = stops.findIndex(([o]) => o >= offset);
        if (i <= 0) return stops[Math.max(0, i)]![1];
        const [[o0, c0], [o1, c1]] = [stops[i - 1]!, stops[i]!];
        return mix(c1, c0, (offset - o0) / (o1 - o0));
      };
      for (const shape of BOT_SHAPES) {
        for (const eye of botPose(input({ shape })).eyes) {
          const offset = Math.hypot(eye.x * BOT_UNIT - CLAY.cx, eye.y * BOT_UNIT - CLAY.cy) / CLAY.r;
          // The worst spot: a pale thread of the weave (`.bot-weave-across`) right beside the eye, on a big bot.
          const thread = mix(pale, [255, 255, 255], 0.8);
          const ratio = 1.05 / (lum(mix(thread, clay(offset), 0.26 * weaveStrength("high"))) + 0.05);
          expect(ratio, `${entry.color} ${shape}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
