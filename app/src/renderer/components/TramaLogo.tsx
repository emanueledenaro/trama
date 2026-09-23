import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

/** Trama's mark: warp and weft threads crossing over and under. */
export function TramaLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden className={cn("shrink-0 text-foreground", className)} {...props}>
      <rect x="4" y="4" width="32" height="32" rx="9" stroke="currentColor" strokeOpacity="0.16" strokeWidth="2" />
      <path d="M13 9v22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 9v22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.55" />
      <path d="M27 9v22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 15h7m8 0h7M9 25h14m4 0h4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
