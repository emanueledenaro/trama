# C06: arresto selettivo quando si restringe il perimetro

Data: 28 settembre 2026. Issue #38.

## Cosa c'era già su main

La parte sulle decisioni era già su `main` e non è stata toccata:

- `assign_task` registra in `decisionVersions` le versioni delle decisioni su cui si basa un incarico (`app/src/main/core/team.ts`, `assign`).
- Una nuova versione di una decisione, o una domanda che la rivede, ferma solo gli incarichi che la usano (`assignmentsAffectedByDecision` in `team.ts`, `stopWorkDependingOn` in `app/src/main/controller.ts`). Gli altri continuano.
- La ripresa ridelega l'incarico sulle versioni attuali (`refreshDecisionVersions`) e lo scrive in Attività.
- Un candidato registra le versioni delle decisioni; un'evidenza raccolta su una versione vecchia diventa `EVIDENCE_STALE` e una decisione cambiata dà `DECISION_CHANGED` (`app/src/main/core/candidates.ts`). Le vecchie evidenze restano nel candidato come storia e non autorizzano il nuovo.
- Test: `app/src/main/core/team.test.ts`, "decision dependencies (C06)".

## Cosa mancava e cosa cambia

Restringere il mandato (issue #244) lasciava finire il lavoro in corso fuori dal nuovo perimetro. Ora:

- Alla restrizione Trama ferma subito il lavoro che il mandato ristretto non copre più e il lavoro che dipende da esso, direttamente o tramite altri incarichi. Il resto continua.
- L'arresto non tocca il worktree: il diff già scritto resta per la ripresa o per un nuovo incarico.
- Un incarico fermato perché dipendente riporta nel motivo l'incarico da cui dipende.
- Un incarico il cui candidato è già unito fa parte del progetto: chi dipende da lui non si ferma.
- Un incarico dipendente non riprende finché il lavoro da cui dipende resta fuori dal mandato, né dalla persona né dal Coordinatore (`withinMandate` in `app/src/main/core/duties.ts`).
- `assign_task` rifiuta un incarico che dipende da lavoro fuori dal mandato (`dependency_outside_mandate`): il Coordinatore deve ripianificare dentro il perimetro.
- Il messaggio al Coordinatore dopo la restrizione elenca il lavoro fermato e i dipendenti, oppure dice che nessun lavoro era fuori.
- Nella vista Mandato, il modulo "Restringi il mandato" mostra prima della conferma quali lavori si fermano; la scheda di una proposta di mandato e la revoca indicano anche da quale lavoro dipende un incarico che si ferma.

Correzione e revoca del mandato usano la stessa regola, perché passano dalla stessa funzione (`workStoppedBy` in `app/src/shared/mandate.ts`).

## Verifiche eseguite

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di un provider.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: tutti i test superati, i dettagli sono nella PR.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: corsa completa, uscita 0. Il passo `26b-mandate-restrict` controlla la nuova anteprima, il passo `26c-mandate-restricted` il nuovo messaggio.

Test nuovi:

- `app/src/shared/mandate.test.ts`: si fermano i dipendenti di un lavoro fuori perimetro, anche tramite un altro incarico; un lavoro unito non ferma chi dipende da lui.
- `app/src/main/controller.test.ts`: con due moduli e tre sviluppatori, restringere il perimetro ferma il lavoro su Orders e quello che dipende da Orders, lascia andare quello su Users, conserva il worktree e non lascia riprendere i due incarichi fermati.
- `app/src/main/core/coordinatorTools.test.ts`: `assign_task` rifiuta una dipendenza fuori dal mandato.
- `app/src/main/core/projectMandate.test.ts`: il messaggio nomina il lavoro fermato e i dipendenti.

## Schermate

Prima, su `main`, e dopo, con Codex, in chiaro e in scuro:

- `c06-perimetro-ristretto/01-prima-restringi-chiaro.png`, `02-prima-restringi-scuro.png`
- `c06-perimetro-ristretto/03-dopo-restringi-chiaro.png`, `04-dopo-restringi-scuro.png`, `05-dopo-restringi-claude-scuro.png`
- `c06-perimetro-ristretto/06-prima-ristretto-chiaro.png`, `07-dopo-ristretto-chiaro.png`, `08-dopo-ristretto-scuro.png`

## Limiti

- Nella corsa di ui-check non c'è lavoro in corso durante la restrizione: la schermata mostra "Nessun lavoro in corso si ferma". Il caso con lavoro fermato è coperto dal test del controller, non da una schermata.
- Nessuna prova con un modello reale. La prova richiesta dalla issue, con due incarichi reali su moduli diversi, resta da fare.
- Una dipendenza vale solo se è scritta nel campo `dependencies` dell'incarico. Un lavoro che usa il codice di un altro senza dichiararlo non si ferma.
