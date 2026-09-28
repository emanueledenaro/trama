# C09: unione con il mandato senza falsare la revisione umana

Data: 28 settembre 2026. Issue #41, ADR 0003. Base: `origin/main` d9d1e04.

## Cosa copre già A07 (issue #247, PR #312)

- Con il via libera del Coordinatore entro il mandato `integrateCandidate` e il cancello dei revisori superato, Trama pubblica il candidato e unisce la pull request da solo (`app/src/main/core/merge.ts`).
- Via libera del Coordinatore e ok della persona sono record distinti, legati all'impronta del contenuto. Un candidato cambiato dopo non viene unito con il vecchio via libera.
- Revisione tecnica distinta dall'autore, verifiche, decisioni e conflitti sul candidato preciso.
- GitHub riceve il commit che Trama ha spinto (`sha`). Le verifiche della pull request devono essere verdi; una CI in corso fa aspettare.
- Un candidato che cambia l'interfaccia aspetta l'ok della persona con le schermate. Un merge che richiede un divieto fisso si ferma.
- Pubblicazione, merge e CI sono eventi distinti in Attività. Nessuna distribuzione parte dal merge.

## Cosa aggiunge questa modifica sopra A07

- **Casi distruttivi seri.** Modifica incompatibile, file cancellati, SQL che cancella dati: il Coordinatore non li unisce con il suo via libera. Il candidato va in "Aspetta te" come "Unione fermata", con motivi, conseguenze e alternative. "Unisci comunque" è l'ok della persona e unisce come suo atto; "Non unire" lo toglie da "Aspetta te" e lo lascia sulla scheda.
- **Via libera legato al mandato.** Il via libera porta la versione del mandato in vigore. Trama unisce con il via libera solo sotto quella versione: un via libera senza versione, o di un mandato poi cambiato o ristretto, chiede un nuovo via libera. Il record del merge porta la versione del mandato; la scheda del candidato unito la mostra.
- **Rilettura subito prima del merge.** Oltre alle verifiche, Trama legge la testa della pull request e se GitHub trova conflitti. Un push che Trama non ha fatto, o un conflitto, fermano il merge con il motivo.
- **Risposta persa.** Se la richiesta di merge fallisce, Trama rilegge la pull request: se GitHub l'ha unita la registra come unita, con il commit di merge, senza un secondo tentativo e senza la riga "non riuscita".
- Un solo percorso di merge: lo strumento separato `integrate_candidate` delle versioni precedenti di questa PR non c'è più.

## Cosa è stato verificato

Tutte le prove usano il Codex finto e il GitHub finto (`app/test-fixtures/fake-gh.mjs`). Nessun merge reale su GitHub.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 139 file, 1305 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: vedi la pull request. Passi nuovi nel flusso di A07: `30f-merge-stopped-destructive` e `30g-merge-mandate-version`, in chiaro e in scuro.

## Test

- `app/src/main/core/merge.test.ts`: via libera legato alla versione del mandato, anche dopo una restrizione, e versione registrata sul merge; caso distruttivo fermato e unito solo con l'ok della persona; "Non unire"; riconoscimento di modifiche incompatibili e file cancellati, e nessun blocco per le modifiche ordinarie o per un candidato che cambia l'interfaccia; rilettura della pull request.
- `app/src/main/merge.integration.test.ts`: con il controller e il GitHub finto, risposta del merge persa e registrata come unita con un solo merge; pull request con un altro push non unita; candidato che cancella un file fermato in "Aspetta te" e unito con l'ok della persona.
- `app/src/shared/waitingForYou.test.ts`: la voce "Unione fermata" finché la persona non sceglie.

## Schermate

Prima (`origin/main` 59e2a83, lo stesso flusso: il candidato che cancella README.md viene unito con il via libera) e dopo, in chiaro e in scuro: `c09-unione-con-mandato/`.

## Limiti

- Nessuna prova su un repository GitHub reale: questo ambiente non ha un accesso GitHub autenticato.
- Motivi, conseguenze e alternative di un'unione fermata sono record di Trama in italiano: con l'interfaccia in inglese restano in italiano. Anche i testi di A07 sulla scheda non sono ancora nel catalogo.
- Il riconoscimento dei casi distruttivi è per regole: una cancellazione di dati scritta in modo diverso dalle istruzioni SQL riconosciute non viene vista.
- Se la base su GitHub si sposta tra la rilettura e il merge, GitHub unisce comunque quando non ci sono conflitti.
