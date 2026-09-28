# A08: il Coordinatore apre e smista da solo le issue dei problemi che trova

Data: 28 settembre 2026. Issue #248, specifica #239 (Q10), ADR 0017. Base: `origin/main` 082fc93.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`) e un `gh` finto. Nessuna esecuzione reale di un provider e nessuna scrittura su un repository GitHub reale.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 122 file, 1187 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 306 schermate. Passi nuovi: `27a-found-problem-issue`, `27b-found-problem-recap`, `27c-found-problem-local-backlog`, ognuno con Codex e Claude, in chiaro e in scuro.

## Comportamento

- Trama riconosce un problema fuori dal lavoro in corso con regole sue, mai con il giudizio del modello:
  - una verifica rossa sul checkout del progetto;
  - una verifica della suite rossa sul candidato e anche sulla sua base, quindi non causata dal candidato;
  - un rilievo non bloccante di un revisore su un file che il candidato non cambia.
- Ogni record si legge una volta. I record precedenti al primo sguardo di Trama sul progetto non sono problemi nuovi.
- Un problema ha una chiave (`check:<verifica>` o `finding:<ruolo>:<file>:<titolo>`). Finché la issue di un problema è aperta, lo stesso problema trovato di nuovo, per esempio la stessa verifica rossa su un altro commit, non crea un secondo problema. Dopo la chiusura della issue sì.
- Prima di aprire una issue Trama rilegge le issue da GitHub e cerca una issue aperta con il segno del problema nel testo (`<!-- trama-problem: ... -->`) o con lo stesso titolo. Se c'è, la collega e non ne apre un'altra.
- La issue nuova porta l'etichetta del repository per `needs-triage`, letta da `docs/agents/triage-labels.md` quando c'è, altrimenti il nome della skill. Il testo contiene cosa ha visto Trama e la prova: l'id della verifica fallita o del cancello del candidato.
- La issue entra nella regola delle issue nuove: il bug triage la smista con `triage`. Dopo l'esito Trama applica le etichette dello stato e della categoria del repository e toglie `needs-triage`. Il commento proposto dal triage resta una scelta della persona.
- Dopo il triage Trama assegna la issue all'incarico che lavora già sul problema (un incarico sulla stessa issue o la correzione di un bug riprodotto dalla diagnosi della stessa verifica) oppure la mette nel backlog. Una voce del backlog passa all'incarico quando un incarico inizia a lavorarci. Una issue già aperta e collegata si smista subito.
- Attività elenca ogni passo: issue aperta o collegata, issue non aperta con il motivo, backlog o incarico con il motivo e l'esito del triage, con il pulsante "Apri la issue" a destra. Sotto, la sezione "Backlog dei problemi trovati".
- Il riepilogo cita in "Cosa ho fatto" le issue aperte dal Coordinatore, con il numero. Una issue solo collegata non viene citata come aperta.
- Senza GitHub collegato il problema diventa una voce del backlog in Trama, "Solo in Trama", senza issue.
- Per aprire le issue serve un mandato concesso. In pausa e nel progetto di esempio non parte niente. Un tentativo fallito di aprire la issue o di applicare le etichette si ripete dopo cinque minuti.

## Test

- `app/src/main/core/problems.test.ts`: deduplicazione per chiave, per record letto e dopo la chiusura della issue; nessun problema dai record precedenti; problemi dal cancello (verifica rossa anche sulla base, rilievo fuori dal candidato) e casi esclusi; ricerca della issue aperta per segno o titolo; testo della issue; mappa delle etichette del repository; smistamento nel backlog, attesa del triage, assegnazione alla correzione anche dal backlog; backlog locale senza GitHub; intervallo dopo un tentativo fallito; voci di Attività e citazione nel riepilogo.
- `app/src/main/problems.integration.test.ts`: prova con un repository di prova simulato da un `gh` finto che conserva le issue in un file. Una verifica rossa apre una sola issue con l'etichetta mappata del repository e la prova, il triage la smista, Trama applica le etichette e la smista; la stessa verifica rossa di nuovo non apre una seconda issue; il riepilogo cita la issue. Con una issue aperta sullo stesso problema Trama la collega. Senza GitHub il problema resta nel backlog di Trama.

## Schermate

Prima (`origin/main` e1ca179) e dopo, in chiaro e in scuro: `a08-problemi-trovati/`. Le schermate "prima" mostrano Attività dopo la stessa verifica rossa: nessuna issue e nessuna voce. Le schermate "dopo" vengono dai passi `27a`, `27b` e `27c` della corsa completa di `ui-check`.

## Limiti

- Le fonti sono solo quelle elencate sopra. Un problema che il Coordinatore o un agente descrive a parole non apre una issue: serve una prova che Trama sa leggere.
- La prova su GitHub usa un `gh` finto. Non è stata fatta una prova su un repository GitHub reale.
- La ricerca dei duplicati guarda il segno di Trama e il titolo. Una issue scritta a mano sullo stesso problema con un titolo diverso non viene riconosciuta.
- Il backlog non ha ancora un ordine manuale né gli sprint: la sezione di Attività elenca le voci dalla più vecchia.
