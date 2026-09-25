import type { ComponentProps, ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { Element, ElementContent, Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { IconAlertCircle, IconAlertTriangle, IconArrowsSplit, IconBulb, IconFlame, IconInfoCircle, IconLock, type Icon } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { CalloutKind } from "@/lib/remarkCallouts";

const CALLOUT_ICONS: Record<CalloutKind, Icon> = {
  decision: IconArrowsSplit,
  blocked: IconLock,
  warning: IconAlertTriangle,
  important: IconAlertCircle,
  note: IconInfoCircle,
  tip: IconBulb,
  caution: IconFlame,
};

/** A blockquote marked by remarkCallouts becomes a callout: a round icon in the kind's color, its label and the body. */
export function ChatBlockquote({ children, className, ...props }: ComponentProps<"blockquote"> & { node?: unknown; "data-kind"?: string; "data-label"?: string }) {
  const kind = props["data-kind"] as CalloutKind | undefined;
  if (!kind || !(kind in CALLOUT_ICONS)) return <blockquote className={className}>{children}</blockquote>;
  const Glyph = CALLOUT_ICONS[kind];
  return (
    <div className={cn("chat-callout", `chat-callout--${kind}`)} role="note">
      <span className="chat-callout__icon" aria-hidden="true">
        <Glyph size={13} stroke={2.2} />
      </span>
      <div className="chat-callout__body">
        <div className="chat-callout__label">{props["data-label"]}</div>
        {children}
      </div>
    </div>
  );
}

const RECOMMENDED = /\s*[(\[]?\s*(consigliat[ao]|raccomandat[ao]|recommended)\s*[)\]]?\s*|\s*★\s*/i;

const textOf = (node: ElementContent | Root): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map((c) => textOf(c as ElementContent)).join("") : "";

const cellsOf = (row: Element) => row.children.filter((c): c is Element => c.type === "element" && (c.tagName === "th" || c.tagName === "td"));

function rowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  const walk = (node: Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "tr") rows.push(child);
      else walk(child);
    }
  };
  walk(table);
  return rows;
}

/** Drops the "(consigliata)" marker from a header cell, keeping the rest of its content. */
function withoutMarker(cell: Element): Element {
  const copy = structuredClone(cell);
  const strip = (node: Element) => {
    for (const child of node.children) {
      if (child.type === "text") child.value = child.value.replace(RECOMMENDED, " ").trim();
      else if (child.type === "element") strip(child);
    }
  };
  strip(copy);
  return copy;
}

/**
 * A table that compares two or three options (first column the criteria, one column per option) is shown
 * as side-by-side cards; the option whose header says "(consigliata)" is highlighted. Other tables stay tables.
 */
export function comparisonOf(table: Element): { options: { title: Element; recommended: boolean; values: Element[] }[]; criteria: Element[] } | null {
  const [head, ...body] = rowsOf(table);
  if (!head || body.length < 1 || body.length > 8) return null;
  const headers = cellsOf(head);
  if (headers.length < 3 || headers.length > 4) return null;
  const rows = body.map(cellsOf);
  if (rows.some((r) => r.length !== headers.length)) return null;
  return {
    criteria: rows.map((r) => r[0]!),
    options: headers.slice(1).map((header, i) => ({
      title: withoutMarker(header),
      recommended: RECOMMENDED.test(textOf(header)),
      values: rows.map((r) => r[i + 1]!),
    })),
  };
}

export function ChatTable({ node, children, components }: ComponentProps<"table"> & { node?: Element; components: Record<string, unknown> }) {
  const comparison = node ? comparisonOf(node) : null;
  if (!comparison) return <table>{children}</table>;
  const render = (cell: Element): ReactNode =>
    toJsxRuntime({ type: "root", children: cell.children }, { Fragment, jsx, jsxs, components: components as never });
  return (
    <div className="chat-compare" style={{ "--compare-columns": comparison.options.length } as React.CSSProperties}>
      {comparison.options.map((option, i) => (
        <section key={i} className={cn("chat-compare__card", option.recommended && "chat-compare__card--recommended")}>
          <header className="chat-compare__title">
            <span>{render(option.title)}</span>
            {option.recommended && <span className="chat-compare__badge">Consigliata</span>}
          </header>
          <dl>
            {option.values.map((value, j) => (
              <div key={j} className="chat-compare__row">
                <dt>{render(comparison.criteria[j]!)}</dt>
                <dd>{render(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
