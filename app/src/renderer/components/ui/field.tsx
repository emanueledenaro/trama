import type * as React from "react";
import { cn } from "@/lib/cn";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={cn("mb-1 block text-ui-sm font-medium text-muted-foreground", className)}>{children}</label>;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 font-sans text-ui text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring/60 focus:ring-1 focus:ring-ring/30",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-sans text-ui leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring/60 focus:ring-1 focus:ring-ring/30",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "secondary",
  className,
}: {
  children: React.ReactNode;
  tone?: "secondary" | "info" | "success" | "warning" | "destructive" | "outline";
  className?: string;
}) {
  const tones = {
    secondary: "bg-secondary text-secondary-foreground",
    info: "bg-info/8 text-info-foreground dark:bg-info/16",
    success: "bg-success/8 text-success dark:bg-success/16",
    warning: "bg-warning/10 text-warning dark:bg-warning/16",
    destructive: "bg-destructive/8 text-destructive dark:bg-destructive/16",
    outline: "border-[color:var(--color-border)] text-[var(--color-text-foreground)]",
  };
  return (
    <span
      className={cn(
        "relative inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-[calc(--spacing(1)-1px)] text-ui-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
