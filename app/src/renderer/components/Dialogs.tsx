import { useState } from "react";
import { parseRepositoryInput } from "@shared/onboarding";
import { Button } from "@/components/ui/button";
import { Input, Label, TextArea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { SearchPalette } from "@/components/SearchPalette";
import { GuideDialog } from "@/components/onboarding/GuideDialog";
import { act, useUi } from "@/lib/store";

function CreateProjectDialog() {
  const open = useUi((s) => s.dialog === "createProject");
  const setDialog = useUi((s) => s.setDialog);
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "createProject" : null)}
      title="Crea un progetto"
      description="Trama crea la cartella con un README che descrive l'idea."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
            Annulla
          </Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              void act("project:create", { name, idea }).then(() => {
                setName("");
                setIdea("");
                setDialog(null);
              })
            }
          >
            Scegli la cartella
          </Button>
        </>
      }
    >
      <div className="space-y-3 pt-2">
        <div>
          <Label>Nome del progetto</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>Cosa vuoi costruire?</Label>
          <TextArea value={idea} onChange={(e) => setIdea(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

/** Clones a GitHub repository into a folder the person picks, then opens it (B02). */
function CloneProjectDialog() {
  const open = useUi((s) => s.dialog === "cloneProject");
  const setDialog = useUi((s) => s.setDialog);
  const gh = useUi((s) => s.app?.gitHubCli.status ?? "unknown");
  const [repository, setRepository] = useState("");
  const parsed = parseRepositoryInput(repository);
  const submit = () => {
    if (!parsed) return;
    setDialog(null);
    void act("project:clone", { repository: parsed }).then(() => setRepository(""));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "cloneProject" : null)}
      title="Clona da GitHub"
      description="Trama clona il repository in una cartella che scegli, poi lo apre. Lo studio è in sola lettura: nulla viene modificato o pubblicato."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
            Annulla
          </Button>
          <Button size="sm" disabled={!parsed} onClick={submit}>
            Scegli la cartella
          </Button>
        </>
      }
    >
      <div className="space-y-2 pt-2">
        <div>
          <Label>Repository</Label>
          <Input
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="proprietario/nome oppure https://github.com/proprietario/nome"
            aria-invalid={repository.trim() !== "" && !parsed}
            autoFocus
          />
        </div>
        <p className="text-ui-xs text-muted-foreground">
          {repository.trim() && !parsed
            ? "Non è un repository GitHub: scrivi proprietario/nome o incolla il suo indirizzo."
            : gh === "ready"
              ? "Trama usa GitHub CLI già collegato: funzionano anche i repository privati."
              : "Senza GitHub CLI collegato si clonano solo i repository pubblici."}
        </p>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  return (
    <>
      <CreateProjectDialog />
      <CloneProjectDialog />
      <SearchPalette />
      <GuideDialog />
    </>
  );
}
