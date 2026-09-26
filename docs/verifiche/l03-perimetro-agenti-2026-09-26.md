# L03: gli agenti restano nel progetto (2026-09-26)

Controllo di #206 sul branch `bugfix/issue-206-agents-stay-in-project-prvhfy`. Nella prova dal vivo del 26 settembre il ruolo Clean Code (incarico A-B25D3B7D) ha eseguito `rg -n -i "ordini|improve-codebase-architecture|architecture review" ~/.codex/memories/MEMORY.md`.

## Causa

- Trama apriva i thread di Codex con `sandbox: "read-only"` e mandava a ogni turno `sandboxPolicy: { type: "readOnly" }` o `workspaceWrite`. In Codex queste politiche limitano la scrittura e la rete, ma la lettura resta libera su tutto il disco: `~/.codex`, gli altri progetti e il resto della cartella home erano leggibili.
- Trama non spegneva le memorie di Codex. Se la persona le ha attive, Codex aggiunge al contesto del modello le istruzioni per leggere `~/.codex/memories`. Da qui il comando della prova dal vivo.
- Gli altri provider avevano lo stesso buco negli strumenti di lettura: Claude, Pi e Antigravity non controllavano il percorso delle letture, e ACP lo controllava solo rispetto alla cartella di lavoro.

## Cosa cambia

- `app/src/main/core/readScope.ts` definisce il perimetro di una sessione. Comprende la cartella di lavoro, il progetto (serve a Git in un worktree) e le skill del pacchetto (`resources/AIHero/skills`), che il controller passa come `readableRoots`. I link simbolici vengono risolti.
- Codex: ogni thread riceve due profili di permessi, `trama_read` e `trama_write`. Leggono solo le cartelle minime della piattaforma (`:minimal`), il perimetro e le cartelle delle toolchain sul PATH, senza rete. Non leggono mai la home, una sua cartella diretta o la cartella di Codex. `trama_write` scrive solo il worktree. Ogni turno sceglie il profilo con `permissions` al posto di `sandboxPolicy`. Le memorie sono spente in due modi: `--disable memories` all'avvio di app-server e `features.memories = false` nel thread.
- Claude: gli strumenti di lettura rifiutano un percorso fuori dal perimetro. Nei turni con worktree la sandbox dei comandi nega la lettura della home e della cartella di Codex, tranne il perimetro e le toolchain.
- Pi: `read`, `grep`, `find` e `ls` rifiutano un percorso fuori dal perimetro prima di leggerlo.
- Antigravity: l'hook di Trama rifiuta una lettura fuori dal perimetro (`denied-read`). Il controllo iniziale dell'hook verifica anche questo rifiuto.
- ACP (Cursor, Devin, Droid, Grok): permessi e `fs/read_text_file` accettano il perimetro intero e rifiutano il resto. `~` viene espanso.
- OpenCode era già coperto dalla regola `external_directory` in `deny`.
- Registrazione: ogni lettura rifiutata diventa l'evento `readOutsideScope` e un'attività "Lettura fuori dal progetto bloccata", con il percorso e la richiesta. Resta nel documento del progetto e si vede nel lavoro dell'agente o del Coordinatore. Per Codex, Trama riconosce i percorsi privati nei comandi (home e cartella di Codex fuori dal perimetro), perché la sandbox li nasconde senza dire chi li ha chiesti.

## Verificato

- Codex reale 0.157.1 (`@openai/codex`, Linux, bubblewrap incluso), guidato con un server Responses finto su 127.0.0.1 e senza account. Nessun modello reale è stato chiamato.
  - Con la politica di prima (`sandbox: "read-only"`, `sandboxPolicy: readOnly`), `cat ~/.codex/memories/MEMORY.md` riesce e il contenuto torna al modello.
  - Con `permissions: "trama_read"` e il profilo nella config del thread, lo stesso comando fallisce con "No such file or directory". Il thread riporta `activePermissionProfile: trama_read`.
  - `trama_read` non scrive nel progetto. `trama_write` scrive solo nel worktree, e il profilo si cambia turno per turno.
  - Con `[features] memories = true` nella config della persona, le richieste al modello contengono le istruzioni su `memories/`. Con `features.memories = false` nel thread, oppure con `--disable memories`, non le contengono più.
  - Con `":root" = "read"`, `home = "none"` e il progetto in `"read"`, su Linux anche il progetto diventa illeggibile. Per questo Trama usa un elenco di cartelle ammesse e non un elenco di cartelle negate.
- `app/src/main/readScope.integration.test.ts` ripete la sequenza dal vivo con il Codex di prova. Prima c'è un controllo fallito, poi diagnosi, correzione e revisione dell'architettura di Clean Code, che esegue lo stesso `rg` sulla memoria. La memoria non arriva a Trama, l'attività registra il percorso e ogni thread ha le memorie spente e un profilo senza la cartella di Codex. Con il runtime Codex di prima lo stesso test fallisce e la memoria compare nell'esito.
- `app/src/main/core/providers/codex.test.ts`: il Codex di prova legge la memoria senza profilo e la nasconde con il profilo di Trama. Un turno che chiede di scrivere fuori dalla cartella del thread viene rifiutato.
- `app/src/main/core/readScope.test.ts`, e i test dei provider in `claudeAgent.test.ts`, `pi.test.ts`, `antigravity.test.ts` e `acp/acpRuntime.test.ts`: letture dentro e fuori dal perimetro, `~`, `..` e link simbolici, eventi registrati.
- `node scripts/ui-check.mjs`, passo `20-read-outside-project`: la revisione di Clean Code mostra "Lettura fuori dal progetto bloccata" con il percorso di `MEMORY.md` e il comando. Il testo della memoria non compare nella finestra. Tema chiaro e scuro.

## Non verificato

- Il profilo su macOS con Seatbelt: la prova con il binario reale è stata fatta solo su Linux.
- Una prova dal vivo con Codex `gpt-6-luna` dopo la correzione.
- Una toolchain installata direttamente in una cartella della home, come `~/.local/bin` con collegamenti verso `~/.local/share`: Trama ammette solo la cartella `bin`, e un collegamento che ne esce resta illeggibile nei comandi degli agenti. Le verifiche di Trama (`checks.ts`) non cambiano.
