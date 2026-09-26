# Trama diventa un'app desktop Electron con l'interfaccia di Synara

Stato: richiesta dal Product Owner il 23 settembre 2026. Sostituisce l'ADR 0001 per l'interfaccia e la piattaforma. Il porting è in corso: la tabella in fondo dice cosa è già passato nell'app Electron.

L'ADR 0001 aveva scelto un'app macOS nativa in SwiftUI. Il Product Owner ha chiesto di convertire Trama in un'app Electron con lo stesso design di [Synara](https://github.com/Emanuele-web04/synara). Synara è un'app Electron con licenza MIT: la sua interfaccia React e i suoi token di design sono il riferimento visivo.

Decisione: l'app desktop vive in `app/`. Il processo principale (Node, TypeScript) contiene il dominio di Trama: scansione del repository, client di Codex App Server, Coordinatore, server MCP locale degli strumenti, Patto, mandato, GitHub e persistenza. Il renderer (React, Tailwind CSS 4, primitive `@base-ui/react`) riproduce layout, misure, colori e tipografia di Synara: barra laterale traslucida, bordo del contenuto, intestazione di 46 px, timeline con gruppi di lavoro, composer flottante. Il renderer non ha accesso a Node: parla con il processo principale attraverso un bridge IPC con azioni tipizzate.

Regole che restano invariate:

- Codex resta collegato direttamente al suo app-server, con il runtime ristretto: server MCP globali disattivati, app, plugin, hook e sub-agenti spenti, sandbox in sola lettura.
- Trama accetta solo un account ChatGPT e non legge `auth.json`.
- Le letture del repository escludono segreti e collegamenti simbolici.
- Una decisione chiesta dal Coordinatore entra nel Patto solo con la risposta della persona.

Alternative scartate: tenere SwiftUI e imitare Synara a mano (due linguaggi di design e nessun riuso dei componenti); includere l'intero monorepo di Synara (porterebbe server, provider e funzioni che Trama non usa).

Conseguenze: Trama gira anche su Linux e Windows, perché nulla nel processo principale dipende da macOS. Il monitor in background non è più un helper separato registrato con `SMAppService`: gira nel processo principale di Trama, che può partire all'accesso senza finestra. Le verifiche usano la sandbox di Codex (`codex sandbox`) come nella versione SwiftUI. Le icone "Central Icons" di Synara non sono incluse perché il repository non ne dichiara la licenza: Trama usa Tabler Icons (MIT) con le stesse misure. I sorgenti Swift sono stati rimossi dal repository il 23 settembre 2026, su richiesta del Product Owner, e restano nella cronologia git. Le funzioni non ancora portate sono elencate sotto.

## Stato del porting

| Area | App Electron |
|---|---|
| Progetti recenti, apertura, creazione, progetto di esempio | Portato |
| Dati della versione SwiftUI | Importati in sola lettura: progetti recenti, conversazione, Patto, mandato, memoria e thread del Coordinatore. Team, candidati e richieste di modifica restano nei file Swift |
| Menzioni `@` e testi incollati nel composer | Portato, con il punteggio di ricerca di Synara |
| Scansione del repository e mappa dei moduli | Portato, con gli stessi limiti ed esclusioni |
| Codex: account ChatGPT, accesso, modelli, sforzo | Portato |
| Coordinatore: thread persistente, studio, aggiornamenti di contesto, memoria | Portato |
| Strumenti MCP: `read_study`, `read_pact`, `read_mandate`, `read_issues`, `read_history`, `write_memory`, `request_mandate`, `request_decision` | Portato |
| Schede di studio, decisione, mandato e avviso di contesto | Portato |
| Patto: decisioni versionate e risposte alle domande | Portato, con la prova del ciclo di revisione nel progetto di esempio |
| Lavoro: candidati per stato e piani | Portato |
| Mandato: concessione, correzione, revoca, versioni | Portato |
| Issue GitHub tramite `gh` | Portato (lettura e creazione) |
| Immagini nel composer | Portato |
| Piani (`prepare_plan` e "Prepara un piano") | Portato: pianificatore in sola lettura con lo schema `PlanProposal`; le domande del piano diventano schede di decisione. L'esecuzione passa dal team, non dalla vecchia sessione singola |
| Team, specialisti, incarichi, worktree | Portato: proposta e conferma, `create_specialist`, `assign_task`, `stop_specialist`, `read_team`, runtime Codex con worktree proprio |
| Verifiche in sola lettura (`run_readonly_check`) | Portato, con la sandbox di Codex |
| Candidati, verifiche, revisione tecnica, via libera | Portato: `declare_candidate`, `verify_candidate`, `review_candidate`, `clear_candidate`, blocchi del Patto, approvazione della persona |
| Pubblicazione di pull request | Portato: commit nel worktree del candidato, push del branch `trama/` e pull request con `gh`, solo dopo l'approvazione della persona |
| Conflitti con il lavoro dei colleghi | Portato: cache Git locale delle revisioni remote e prova di fusione con `git merge-tree` su un clone temporaneo; conflitti e sovrapposizioni diventano schede |
| Monitor in background e notifiche | Portato nel processo principale: lettura di branch e pull request con `gh`, novità, notifiche di sistema, avvio all'accesso su macOS e Windows. Sostituisce l'helper `SMAppService` |
| Skill AI Hero | Portato: preparazione del metodo di lavoro dalle impostazioni; skill di Codex nel composer con `$` e `/` |
| Obiettivi, dialoghi di obiettivo e panoramica dei progetti (UX01-UX07) | Nuovo nell'app Electron (ADR 0013): obiettivi con esempi nel documento del progetto, dialogo per obiettivo sullo stesso thread del Coordinatore, panoramica per attenzione, lavori dipendenti di una decisione, motivazione del modello, osservazione degli esempi sul candidato |
| Provider oltre Codex | Portato (ADR 0012): i nove provider hanno un adattatore in `app/src/main/core/providers` dietro la forma comune `AgentRuntime`; il composer sceglie provider e modello per dialogo, incarichi e turni registrano il provider |
| Entrata, benvenuto e scelta del progetto (B02) | Nuovo nell'app Electron: un'animazione del logo sopra l'app mentre lo stato si carica, che si chiude appena l'app è pronta e comunque entro 1,4 secondi, ferma con il movimento ridotto; al primo avvio un benvenuto che spiega Trama e configura provider, GitHub e metodo AI Hero con gli stati e le azioni della guida, a passi saltabili e riprendibili; senza un progetto aperto, la scelta del progetto con recenti (percorso, ultimo lavoro, agenti al lavoro, colleghi attivi), apertura di una cartella, clonazione da GitHub, creazione e progetto di esempio. Il logo è nello spazio `BrandMark` in attesa di `TramaMark` (B01) |
| Guida al primo avvio ed esercizi (C12, C13, C14) | Portato: al primo avvio senza progetti si apre il benvenuto (B02), che usa i passi della guida; la guida si riapre da Impostazioni, dalla scelta del progetto e dal menu Aiuto e riapre il benvenuto; i passi (provider, GitHub CLI, progetto, AI Hero, primo esercizio) mostrano lo stato letto e l'avanzamento resta nelle impostazioni. Gli esercizi sulla copia di esempio ricavano i passi dal documento del progetto (studio, risposte con fonti, decisioni, incarichi, candidati, verifiche, conflitti) e dalla navigazione osservata su mappa e moduli. L'esercizio di conflitto crea due commit simulati in un clone locale separato e li confronta con `git merge-tree`, senza rete |

## Verifiche eseguite

Il 23 settembre 2026, su Linux in un container senza Codex reale:

- 58 test Vitest del processo principale e della logica condivisa, compresi scanner, client JSON-RPC, server MCP, Patto, mandato, team, worktree, verifiche nella sandbox, candidati, pubblicazione fino al push, monitor, conflitti con `git merge-tree`, piani e import dei dati Swift.
- `npm run ui-check`: l'app Electron costruita, pilotata con Playwright e un app-server Codex di prova, attraversa studio, messaggio, piano, decisione, proposta del team, mandato, incarico in un worktree, candidato, ricerca e impostazioni, in tema chiaro e scuro.
- Il pacchetto Linux di electron-builder si avvia e apre il progetto di esempio.

Il 23 settembre 2026, dopo i provider: la lettura dell'account e dei modelli di Claude Agent è stata provata sulla CLI `claude` reale presente nel container (5 modelli). Gli altri provider sono provati con CLI, server e SDK finti.

Non ancora verificato: turni reali con i provider diversi da Codex, una sessione con Codex reale e un account ChatGPT, la creazione di una pull request con `gh` su un repository reale, i pacchetti firmati per macOS e Windows, l'avvio all'accesso.

Il 24 settembre 2026, per la guida e gli esercizi: test Vitest sulla logica dei passi e sul confronto con le modifiche simulate; `npm run ui-check` apre la guida al primo avvio, completa il primo esercizio e l'esercizio di conflitto con l'app-server di prova. Non ancora verificati: gli esercizi di modifica e di revisione con un Coordinatore reale, che deve usare il campo `exercise` e `decisionIDs` come chiedono i messaggi della guida; `gh auth status` con un account reale (nel container `gh` non è installato).

Il 26 settembre 2026, per l'entrata, il benvenuto e la scelta del progetto (B02): test Vitest sulla prima apertura, sui tempi dell'entrata e sui colleghi dei progetti recenti; `npm run ui-check` prende i fotogrammi dell'entrata, il benvenuto, i passi e la scelta del progetto in chiaro e in scuro, a finestra larga e stretta. Il registro è in `docs/verifiche/b02-entrata-benvenuto-2026-09-26.md`. Non ancora verificati: la clonazione reale da GitHub e il logo definitivo di B01.
