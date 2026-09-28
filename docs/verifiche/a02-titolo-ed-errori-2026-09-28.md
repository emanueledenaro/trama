# A02, seguito: titolo della barra di focus ed errori degli strumenti

Data: 28 settembre 2026. Issue #241 (commento dall'audit #262), seguito di #282. Base: `origin/main` f0972a0.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 114 file, 1013 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: uscita 0. Passi nuovi: il titolo della barra non è un messaggio; nessun errore inglese in chat; `18a4-activity-tool-errors` in chiaro e in scuro.

## Comportamento

- La barra di focus prende il titolo dall'obiettivo. Il lavoro del dialogo del progetto che non serve un obiettivo si chiama "Lavoro nel dialogo del progetto", mai con il primo messaggio.
- Nella barra e nella coda il motivo di un lavoro fermo è quello per la persona, senza id. La coda mostra prima la mossa della persona, poi il motivo.
- Il Coordinatore legge che non deve incollare l'errore di uno strumento e deve spiegare in italiano semplice cosa non è andato.
- Se la risposta incolla comunque il testo esatto di un errore arrivato nello stesso turno, Trama lo sostituisce in chat con "uno strumento di Trama ha rifiutato la richiesta (il dettaglio è in Attività)".
- In Attività ogni mossa mostra gli strumenti non riusciti, con l'errore tecnico, in una sezione da aprire.

## Test

- `app/src/main/core/toolErrors.test.ts`: lettura dell'errore di uno strumento; sostituzione del testo incollato; nessuna modifica a una spiegazione con parole proprie o a frammenti troppo corti.
- `app/src/shared/activity.test.ts`: gli strumenti non riusciti di una mossa.
- `app/src/main/core/focus.test.ts`: il titolo non è mai il primo messaggio; il motivo senza id.
- `app/src/main/candidate.integration.test.ts`: con il controller, la risposta che incollava l'errore di `verify_candidate` arriva in chat senza il testo inglese, e l'errore è nella voce di Attività.
- `controller.test.ts`, `askTrama.integration.test.ts` e ui-check: i rifiuti degli strumenti si leggono dall'attività del turno, non dalla risposta.

## Limiti

- Una risposta che riassume o traduce l'errore non viene toccata: conta la regola nelle istruzioni del Coordinatore.
- Durante lo streaming il testo compare com'è; la sostituzione avviene quando la risposta è registrata.
