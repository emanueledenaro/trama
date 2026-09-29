import type * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export type IconButtonProps = Omit<ButtonProps, "aria-label" | "children"> & {
  /** The button's name: the same text is its tooltip and its accessible name. */
  label: string;
  /** The Tabler icon the button shows. */
  icon: React.ReactNode;
  /** A number next to the icon, for example the count of overlaps behind a "details" button. */
  count?: number;
  side?: React.ComponentProps<typeof Tooltip>["side"];
};

/**
 * A button that shows only an icon (ADR 0018, issue #338): secondary, repeated or navigation actions. It cannot be
 * built without a name, and the name is both the tooltip and the `aria-label`, so a screen reader and a pointer read
 * the same words. Decisions and actions that cannot be undone stay text buttons in a `.cta-row`.
 */
export function IconButton({ label, icon, count, side, variant = "ghost", size, className, ...props }: IconButtonProps) {
  const counted = count !== undefined;
  return (
    <Tooltip label={label} side={side}>
      <Button
        variant={variant}
        size={size ?? (counted ? "xs" : "icon-xs")}
        aria-label={label}
        className={cn("shrink-0", className)}
        data-icon-button=""
        {...props}
      >
        {icon}
        {counted ? (
          <span aria-hidden className="tabular-nums">
            {count}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  );
}
