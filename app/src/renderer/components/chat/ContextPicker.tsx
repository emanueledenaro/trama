import { Popover } from "@base-ui/react/popover";
import { IconAt, IconChevronDown } from "@tabler/icons-react";
import type { RepositoryModule } from "@shared/repository";
import { useState } from "react";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  const { query, setQuery, visible, searchable } = usePickerSearch(open, modules, (m) => `${m.name} ${m.relativePath}`);
  const current = moduleId ? modules.find((m) => m.id === moduleId) : null;
  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={className} aria-label={t("chat.contextPicker.label")}>
        <IconAt className="size-3.5 shrink-0 opacity-70" stroke={1.8} />
        <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{current ? current.name : t("chat.contextPicker.wholeProject")}</span>
        <IconChevronDown className="ms-0.5 size-3 shrink-0 opacity-60" />
      </Popover.Trigger>
      <PickerPopup>
        <PickerHeader title={t("chat.contextPicker.title")} meta={t("chat.contextPicker.modules", { count: modules.length })} />
        {searchable ? <PickerSearch value={query} onChange={setQuery} placeholder={t("chat.contextPicker.search")} /> : null}
        <PickerList label={t("chat.contextPicker.title")}>
          {query.trim() ? null : (
            <PickerOption title={t("chat.contextPicker.wholeProject")} subtitle={t("chat.contextPicker.allModules")} active={!moduleId} onSelect={() => choose(null)} />
          )}
          {visible.length === 0 && query.trim() ? <PickerNote>{t("chat.contextPicker.noMatch")}</PickerNote> : null}
          {visible.map((m) => (
            <PickerOption key={m.id} title={m.name} subtitle={m.relativePath === "." ? t("chat.contextPicker.rootFolder") : m.relativePath} active={m.id === moduleId} onSelect={() => choose(m.id)} />
          ))}
        </PickerList>
      </PickerPopup>
    </Popover.Root>
  );
}
