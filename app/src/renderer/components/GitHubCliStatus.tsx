import type { GitHubCliState } from "@shared/onboarding";

/**
 * GitHub CLI's state in plain words (P10). "Not checked yet" and "checking" never read as "not connected": only a
 * check that found gh signed out or missing asks for gh auth login.
 */
export function GitHubCliDescription({ state }: { state: GitHubCliState }) {
  switch (state.status) {
    case "ready":
      return <>{state.account ? `Collegato come ${state.account}.` : "gh è autenticato."}</>;
    case "unknown":
      return <>Trama legge lo stato di GitHub CLI all'avvio e quando apri questa pagina.</>;
    case "checking":
      return <>Trama sta leggendo gh auth status.</>;
    case "error":
      return <>{state.detail ? `gh auth status non è riuscito: ${state.detail}` : "gh auth status non è riuscito."} Premi Controlla di nuovo.</>;
    case "missing":
      return (
        <>
          Trama non trova GitHub CLI, neanche nelle cartelle di Homebrew. Installala, poi esegui{" "}
          <code className="font-mono text-foreground/90">gh auth login</code> nel terminale e premi Controlla di nuovo.
        </>
      );
    case "signedOut":
      return (
        <>
          gh non ha un accesso valido{state.detail ? `: ${state.detail}` : ""}. Esegui <code className="font-mono text-foreground/90">gh auth login</code> nel
          terminale, poi premi Controlla di nuovo.
        </>
      );
  }
}
