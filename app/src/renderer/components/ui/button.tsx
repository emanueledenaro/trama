// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-ui outline-none transition-[color,background-color,box-shadow,transform,opacity] focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-button-secondary-hover)]",
        chrome:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)] data-[popup-open]:text-[var(--color-text-foreground)]",
        outline:
          "border-[color:var(--color-border)] bg-transparent text-[var(--color-text-foreground)] hover:bg-[var(--color-background-elevated-secondary)]",
        prominent:
          "rounded-full border-transparent bg-[var(--color-text-foreground)] text-[var(--color-background-surface)] duration-150 hover:scale-105 disabled:opacity-20 disabled:hover:scale-100",
        subtle:
          "border-transparent bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)] hover:bg-[var(--color-background-button-secondary-hover)]",
        destructive: "border-transparent bg-destructive text-white hover:bg-destructive/90",
      },
      size: {
        default: "h-8 px-[calc(--spacing(3)-1px)]",
        sm: "h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)]",
        xs: "h-6 gap-1 rounded-sm px-[calc(--spacing(2)-1px)] text-ui-xs",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        chip: "h-auto gap-1 px-2 py-0.5 text-ui-sm",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
