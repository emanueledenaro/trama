// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type * as React from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipPrimitive.Positioner.Props["side"];
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-[60]">
          <TooltipPrimitive.Popup className="translucent-popup rounded-lg px-2 py-1 text-balance text-ui-sm transition-[scale,opacity] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0">
            {label}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
