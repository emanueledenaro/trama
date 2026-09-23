import { CandidateCard } from "@/components/chat/Cards";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-[var(--color-text-accent)]";
  if (line.startsWith("+")) return "bg-success/10 text-foreground";
  if (line.startsWith("-")) return "bg-destructive/10 text-foreground";
  return "text-foreground/80";
}

export function CandidateView({ id }: { id: string }) {
  const candidate = useUi((s) => s.app?.project?.document.candidates.find((c) => c.id === id));
  if (!candidate) return <div className="p-4"><EmptyNote>Candidato non trovato.</EmptyNote></div>;
  return (
    <>
      <div className="px-4">
        <CandidateCard candidateId={id} />
      </div>
      <InspectorSection title={`Diff catturato da Trama · ${candidate.changedFiles.length} file`}>
        <pre className="overflow-x-auto rounded-xl bg-[var(--app-chat-code-surface)] py-2 font-mono text-[11px] leading-[1.55]">
          {candidate.diff.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond their position.
            <div key={index} className={cn("px-3 whitespace-pre", lineClass(line))}>
              {line || " "}
            </div>
          ))}
        </pre>
      </InspectorSection>
    </>
  );
}
