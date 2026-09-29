import { cn } from "@/lib/cn";

/** A switch with its name for screen readers, as in the Codex settings. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-[var(--color-text-accent)]" : "bg-[var(--color-border-heavy)]",
      )}
    >
      <span className={cn("inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[14px]" : "translate-x-[2px]")} />
    </button>
  );
}
