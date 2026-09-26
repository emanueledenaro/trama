import { TramaLogo } from "@/components/TramaLogo";
import { cn } from "@/lib/cn";

export type BrandMarkVariant = "tile" | "glyph" | "mono";

/**
 * The slot for Trama's mark in the launch intro, the welcome and the project picker (B02).
 * TODO(B01 #199): render `<TramaMark size variant />` from components/brand/TramaMark.tsx once it lands.
 * Until then this shows the interim TramaLogo at the same size, so the layout does not change on the swap.
 */
export function BrandMark({ size, variant = "glyph", className }: { size: number; variant?: BrandMarkVariant; className?: string }) {
  return (
    <span
      data-brand-mark={variant}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        variant === "tile" && "rounded-[22%] bg-[var(--color-background-button-secondary)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <TramaLogo className={cn(variant === "tile" ? "size-[78%]" : "size-full", variant !== "mono" && "text-[var(--color-text-accent)]")} />
    </span>
  );
}
