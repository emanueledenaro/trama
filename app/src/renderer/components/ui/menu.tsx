// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { cn } from "@/lib/cn";

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuPopup({
  children,
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  composer = false,
}: {
  children: React.ReactNode;
  className?: string;
  side?: MenuPrimitive.Positioner.Props["side"];
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: number;
  composer?: boolean;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="z-50 min-w-32" side={side} align={align} sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          className={cn(
            "translucent-popup relative flex origin-(--transform-origin) text-[var(--color-text-foreground)] outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0",
            composer ? "rounded-[0.875rem] shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_12%,transparent)]" : "rounded-2xl",
            className,
          )}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  destructive,
  ...props
}: MenuPrimitive.Item.Props & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex min-h-[26px] cursor-default select-none items-center gap-2 rounded-[0.625rem] px-2 py-1 text-ui text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-disabled:opacity-64 [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg]:size-4 [&>svg]:shrink-0",
        destructive && "text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function MenuGroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 font-normal text-ui leading-snug text-muted-foreground/45">{children}</div>;
}

export function MenuSeparator() {
  return <div className="mx-2 my-1 h-px bg-border" />;
}

export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "flex min-h-[26px] cursor-default select-none items-center gap-2 rounded-[0.625rem] px-2 py-1 text-ui text-[var(--color-text-foreground)] outline-none data-highlighted:bg-[var(--color-background-button-secondary-hover)]",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <MenuPrimitive.RadioItemIndicator className="ms-auto text-[var(--color-text-foreground)]">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}
