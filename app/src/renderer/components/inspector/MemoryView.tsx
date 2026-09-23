import { MEMORY_BYTE_LIMIT } from "@shared/domain";
import { formatDate } from "@/lib/format";
import { useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

export function MemoryView() {
  const memory = useUi((s) => s.app?.project?.document.coordinator.memory)!;
  const bytes = new TextEncoder().encode(memory.text).length;
  return (
    <>
      <InspectorSection title="Cosa conserva">
        <p className="text-ui-sm text-muted-foreground">
          Il Coordinatore scrive qui i fatti del progetto e le tue scelte che devono sopravvivere a una finestra di contesto più corta. Ogni scrittura sostituisce l'intero testo.
        </p>
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {memory.revision
            ? `Revisione ${memory.revision} · ${memory.updatedAt ? formatDate(memory.updatedAt) : ""} · ${bytes} di ${MEMORY_BYTE_LIMIT} byte`
            : `0 di ${MEMORY_BYTE_LIMIT} byte`}
        </p>
      </InspectorSection>
      <InspectorSection title="Memoria">
        {memory.text ? (
          <pre className="rounded-xl bg-[var(--app-chat-code-surface)] p-3 font-sans text-ui whitespace-pre-wrap text-foreground/90">{memory.text}</pre>
        ) : (
          <EmptyNote>Il Coordinatore non ha ancora scritto la sua memoria.</EmptyNote>
        )}
      </InspectorSection>
    </>
  );
}
