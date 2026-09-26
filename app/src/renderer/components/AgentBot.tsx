import { useEffect, useId, useMemo, useRef } from "react";
import { ACTIVITY_LOOK, type AgentActivity, type BotShape, stableHash, transitionMove } from "@shared/agentBot";
import type { AgentColor } from "@shared/domain";
import { badgeTransform, BADGE_RADIUS, BOT_VIEWBOX, CLAY, botDetail, botPose, clampBotSize, renderPose } from "@/lib/botGeometry";
import { type BotNodes, registerBot } from "@/lib/botEngine";
import { cn } from "@/lib/cn";
import { agentStyle } from "./AgentIdentity";

/**
 * An agent's bot (W16, ADR 0007): a soft body in the agent's color with a seam, two stitches for eyes and a thread
 * that trails behind it. The body is the agent's own (a shape per role); the move and the eyes follow its state.
 * Drawn from scratch in SVG; `botEngine` animates it while it is on screen.
 */
export function AgentBot({
  shape,
  color,
  activity,
  seed,
  size = 16,
  className,
}: {
  shape: BotShape;
  color: AgentColor;
  activity: AgentActivity;
  /** The agent's id, so two bots in the same state do not move in step. */
  seed: string;
  /** Pixels, from 16 to 96. */
  size?: number;
  className?: string;
}) {
  const px = clampBotSize(size);
  const detail = botDetail(px);
  const look = ACTIVITY_LOOK[activity];
  const number = (stableHash(seed) / 0xffffffff) * 10;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const handle = useRef<ReturnType<typeof registerBot> | null>(null);
  const previous = useRef<AgentActivity | null>(null);
  const state = { shape, animation: look.animation, expression: look.expression, followsCursor: look.followsCursor, detail, seed: number };

  // The first frame, drawn by React: the still pose of the expression, the same the loop starts from.
  const still = useMemo(
    () => renderPose(botPose({ ...state, t: 0, look: null, moving: false })),
    [shape, look.animation, look.expression, detail, number],
  );

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const part = <T extends Element>(name: string) => el.querySelector<T>(`[data-part="${name}"]`);
    const nodes: BotNodes = {
      root: part<SVGGElement>("root")!,
      blobs: [part<SVGPathElement>("blob-0")!, part<SVGPathElement>("blob-1")!, part<SVGPathElement>("blob-2")!],
      dim: part<SVGPathElement>("dim")!,
      seam: part<SVGPathElement>("seam"),
      thread: part<SVGPathElement>("thread"),
      eyes: part<SVGGElement>("eyes")!,
      eyePaths: [part<SVGPathElement>("eye-0")!, part<SVGPathElement>("eye-1")!],
      badge: part<SVGCircleElement>("badge")!,
    };
    handle.current = registerBot(el, nodes, state);
    return () => {
      handle.current?.unregister();
      handle.current = null;
    };
    // The loop keeps its own nodes; a change of detail remounts the SVG through its key.
  }, [detail]);

  useEffect(() => {
    handle.current?.update(state);
    const move = transitionMove(previous.current, activity);
    previous.current = activity;
    if (move) handle.current?.play(move.animation, move.expression, move.seconds);
  }, [shape, activity, detail, number]);

  const showThread = detail !== "low";
  return (
    <svg
      key={detail}
      ref={svg}
      aria-hidden
      viewBox={BOT_VIEWBOX}
      width={px}
      height={px}
      overflow="visible"
      className={cn("agent-identity agent-bot", className)}
      style={agentStyle({ color })}
      data-agent={seed}
      data-shape={shape}
      data-activity={activity}
      data-detail={detail}
      data-testid="agent-bot"
      onPointerEnter={() => {
        if (activity === "idle") handle.current?.play("wink", "neutral", 0.5);
      }}
    >
      <defs>
        <radialGradient id={`${id}-clay`} gradientUnits="userSpaceOnUse" cx={CLAY.cx} cy={CLAY.cy} r={CLAY.r}>
          <stop offset={CLAY.stops[0]} className="bot-stop-light" />
          <stop offset={CLAY.stops[1]} className="bot-stop-soft" />
          <stop offset={CLAY.stops[2]} className="bot-stop-base" />
          <stop offset={CLAY.stops[3]} className="bot-stop-shade" />
        </radialGradient>
      </defs>
      <g data-part="root" transform={still.root}>
        {showThread ? <path data-part="thread" className="bot-thread" d={still.thread} /> : null}
        {still.blobs.map((d, i) => (
          <path key={i} data-part={`blob-${i}`} d={d} fill={`url(#${id}-clay)`} />
        ))}
        <path data-part="dim" className="bot-shade" d={still.blobs[0]} opacity={still.dim * 0.5} />
        {showThread ? <path data-part="seam" className="bot-seam" d={still.seam} opacity={still.body} /> : null}
        <g data-part="eyes" opacity={still.body} className="bot-eye">
          <path data-part="eye-0" d={still.eyes[0].d} transform={still.eyes[0].transform} />
          <path data-part="eye-1" d={still.eyes[1].d} transform={still.eyes[1].transform} />
        </g>
        <circle data-part="badge" className="bot-badge" r={BADGE_RADIUS} transform={badgeTransform(still.badge)} />
      </g>
    </svg>
  );
}
