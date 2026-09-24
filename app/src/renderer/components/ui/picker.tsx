import { Popover } from "@base-ui/react/popover";
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

/** Above this many options a picker gets a search field. */
export const PICKER_SEARCH_THRESHOLD = 8;

/** The floating panel shared by every picker: the model picker's look, reused for context, providers and the rest. */
export function PickerPopup({
  children,
  className,
  side = "top",
  align = "start",
}: {
  children: React.ReactNode;
  className?: string;
  side?: Popover.Positioner.Props["side"];
  align?: Popover.Positioner.Props["align"];
}) {
  return (
    <Popover.Portal>
      <Popover.Positioner side={side} align={align} sideOffset={8} className="z-50">
        <Popover.Popup
          className={cn(
            "translucent-popup flex max-h-(--available-height) w-[22rem] max-w-[92vw] flex-col rounded-2xl bg-popover/95 text-ui text-[var(--color-text-foreground)] outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0",
            className,
          )}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

export function PickerHeader({ title, meta, warning = false }: { title: React.ReactNode; meta?: React.ReactNode; warning?: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
      <span className="min-w-0 truncate font-medium">{title}</span>
      {meta ? <span className={cn("shrink-0 text-ui-xs", warning ? "text-warning" : "text-muted-foreground")}>{meta}</span> : null}
    </div>
  );
}

export function PickerSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="mx-3 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-2.5">
      <IconSearch className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ui-sm outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function PickerList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="listbox" aria-label={label} className="flex max-h-72 min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pb-1.5">
      {children}
    </div>
  );
}

export function PickerNote({ children, warning = false }: { children: React.ReactNode; warning?: boolean }) {
  return <p className={cn("px-2.5 py-3 text-ui-sm", warning ? "text-warning" : "text-muted-foreground")}>{children}</p>;
}

/** One row: a title, an optional second line, a check when it is the current choice. */
export function PickerOption({
  title,
  subtitle,
  icon,
  active,
  disabled = false,
  warning = false,
  onSelect,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  /** Shows the second line as a warning. */
  warning?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full shrink-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent",
        active && "bg-[var(--color-background-elevated-secondary)]",
      )}
    >
      {icon ? <span className="mt-0.5 inline-flex shrink-0 items-center">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui-sm">{title}</span>
        {subtitle ? <span className={cn("block truncate text-ui-xs", warning ? "text-warning" : "text-muted-foreground")}>{subtitle}</span> : null}
      </span>
      {active ? <IconCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={2} /> : null}
    </button>
  );
}

/** Filters options by a search text, and resets the text whenever the picker opens. */
export function usePickerSearch<T>(open: boolean, items: T[], text: (item: T) => string) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => text(item).toLowerCase().includes(needle));
  }, [items, query, text]);
  return { query, setQuery, visible, searchable: items.length > PICKER_SEARCH_THRESHOLD };
}

export interface PickerSelectOption<T extends string> {
  value: T;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

/**
 * A select in the picker style, for forms. The trigger looks like a field; the panel opens below it. Replaces
 * the native select so every choice in Trama opens the same panel.
 */
export function PickerSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Scegli",
  title,
  meta,
  side = "bottom",
  className,
  searchPlaceholder = "Cerca",
}: {
  /** Accessible name of the trigger and the list. */
  label: string;
  value: T | "";
  options: PickerSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  /** Header title of the panel; the label when absent. */
  title?: React.ReactNode;
  meta?: React.ReactNode;
  side?: Popover.Positioner.Props["side"];
  className?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { query, setQuery, visible, searchable } = usePickerSearch(open, options, (o) => `${o.title} ${o.subtitle ?? ""}`);
  const current = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`${label}: ${current?.title ?? placeholder}`}
        className={cn(
          "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 text-left text-ui-sm transition-colors hover:bg-[var(--color-background-elevated-secondary)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)]",
          className,
        )}
      >
        {current?.icon ? <span className="inline-flex shrink-0 items-center">{current.icon}</span> : null}
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted-foreground")}>{current?.title ?? placeholder}</span>
        <IconChevronDown className="size-3 shrink-0 opacity-60" />
      </Popover.Trigger>
      <PickerPopup side={side}>
        <PickerHeader title={title ?? label} meta={meta} />
        {searchable ? <PickerSearch value={query} onChange={setQuery} placeholder={searchPlaceholder} /> : null}
        <PickerList label={label}>
          {visible.length === 0 ? (
            <PickerNote>Nessuna voce corrisponde.</PickerNote>
          ) : (
            visible.map((o) => (
              <PickerOption
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                icon={o.icon}
                active={o.value === value}
                disabled={o.disabled}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              />
            ))
          )}
        </PickerList>
      </PickerPopup>
    </Popover.Root>
  );
}
