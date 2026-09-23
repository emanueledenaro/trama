import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom type scale must be known to tailwind-merge, or `text-ui` would be read as a color
// and dropped next to `text-foreground`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["ui", "ui-lg", "ui-sm", "ui-xs", "ui-2xs", "ui-meta", "ui-timestamp", "chat", "chat-code", "chat-meta"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
