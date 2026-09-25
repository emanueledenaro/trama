import { useState } from "react";
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

export function Dialogs() {
  return (
    <>
      <CreateProjectDialog />
      <SearchPalette />
      <GuideDialog />
    </>
  );
}
