import { Popover } from "@base-ui/react/popover";
import { IconAt, IconChevronDown } from "@tabler/icons-react";
import type { RepositoryModule } from "@shared/repository";
import { useState } from "react";
import { PickerHeader, PickerList, PickerNote, PickerOption, PickerPopup, PickerSearch, usePickerSearch } from "@/components/ui/picker";

/** The part of the project the next message is about: the whole project or one module. Same panel as the model picker. */
export function ContextPicker({
  className,
  modules,
  moduleId,
  onChange,
}: {
  className: string;
  modules: RepositoryModule[];
  moduleId: string | null;
  onChange: (moduleId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { query, setQuery, visible, searchable } = usePickerSearch(open, modules, (m) => `${m.name} ${m.relativePath}`);
  const current = moduleId ? modules.find((m) => m.id === moduleId) : null;
  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={className} aria-label="Contesto del messaggio">
        <IconAt className="size-3.5 shrink-0 opacity-70" stroke={1.8} />
        <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{current ? current.name : "Intero progetto"}</span>
        <IconChevronDown className="ms-0.5 size-3 shrink-0 opacity-60" />
      </Popover.Trigger>
      <PickerPopup>
        <PickerHeader title="Contesto" meta={modules.length === 1 ? "1 modulo" : `${modules.length} moduli`} />
        {searchable ? <PickerSearch value={query} onChange={setQuery} placeholder="Cerca un modulo" /> : null}
        <PickerList label="Contesto">
          {query.trim() ? null : (
            <PickerOption title="Intero progetto" subtitle="Tutti i moduli del repository" active={!moduleId} onSelect={() => choose(null)} />
          )}
          {visible.length === 0 && query.trim() ? <PickerNote>Nessun modulo corrisponde.</PickerNote> : null}
          {visible.map((m) => (
            <PickerOption key={m.id} title={m.name} subtitle={m.relativePath === "." ? "Cartella principale" : m.relativePath} active={m.id === moduleId} onSelect={() => choose(m.id)} />
          ))}
        </PickerList>
      </PickerPopup>
    </Popover.Root>
  );
}
