# A06: il Coordinatore fa da solo il ciclo dentro il mandato e risolve i blocchi tecnici

Data: 28 settembre 2026. Issue #246, specifica #239 (Q1, Q3), ADR 0017. Base: `origin/main` 7763d2d.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di un provider.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 123 file, 1199 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 312 schermate. Passi nuovi o cambiati: `14b0-block-resolution`, `04c4a-slices-by-coordinator`, `15b-activity`, `15b1-activity-step-correct`, in chiaro e in scuro.

## Comportamento

- Dentro il mandato il Coordinatore fa da solo quattro passi che prima aspettavano il pulsante della persona: conferma della comprensione, conferma del team, conferma dei seam proposti da to-spec e conferma delle fette proposte da to-tickets. Trama li fa dai dati del progetto, senza un turno del modello, e li registra come passi del Coordinatore.
- Il perimetro: comprensione, seam e fette chiedono l'azione "Preparare piani" e i moduli del piano nel mandato; il team chiede "Comporre il team" e i moduli degli sviluppatori proposti.
- Senza mandato, con un mandato revocato, fuori dal perimetro, in Pausa, con il lavoro continuo spento, mentre un turno lavora o dopo un turno fallito o interrotto, gli stessi passi restano della persona come prima.
- Ogni passo va in Attività ("Comprensione confermata dal Coordinatore", "Seam confermati dal Coordinatore", ...) con cosa è stato confermato, e nel riepilogo in "Cosa ho fatto". Le schede del piano e del team dicono che la conferma è del Coordinatore.
- In Attività ogni passo ha "Correggi": la persona scrive la correzione con parole sue. La correzione è registrata sul passo, che diventa "Corretto", e il lavoro riparte da quel passo:
  - seam: il pianificatore riscrive la spec con la correzione; una spec già pubblicata aggiorna la sua issue;
  - fette: to-tickets rifà la divisione con la correzione; le issue già pubblicate restano su GitHub e Attività lo dice;
  - comprensione e team, o seam e fette quando il lavoro sulle fette è già partito: la correzione arriva al Coordinatore come messaggio della persona.
  Il Coordinatore non rifà lo stesso passo finché la correzione non ha avuto il suo turno.
- Blocchi tecnici: una verifica rossa (anche un rilievo bloccante dei revisori o una revisione che chiede modifiche), un conflitto tra worktree o con il branch principale e un incarico fermo (fallito; uno fermato dalla persona, dal Coordinatore o da Trama resta una scelta e non viene ripreso da solo) avviano una mossa di risoluzione a qualunque evento del lavoro, non solo alla verifica rossa, al conflitto o al giro. La riga di stato dice "Sto risolvendo il conflitto" o "Sto riprendendo l'incarico fermo" con Ferma a destra. Il Coordinatore riceve il blocco e cosa fare. A fine turno Trama legge l'esito e lo scrive in Attività: "Blocco risolto dal Coordinatore" o "Blocco ancora aperto".
- Lavoro nuovo: `assign_task` rifiuta un incarico per un obiettivo che il Coordinatore ha solo proposto (`goal_not_confirmed`). A ogni turno il Coordinatore legge che il lavoro nuovo si propone con `propose_goal` e non si assegna.

## Test

- `app/src/main/core/autonomousCycle.test.ts`: passi presi con il mandato e lasciati alla persona senza mandato, con un'azione mancante, con un modulo fuori, con il mandato revocato, in pausa, con il lavoro continuo spento, con un turno in corso o fallito; seam, fette e team; correzione registrata e passo non ripreso prima del turno della correzione; Attività e riepilogo; mossa di risoluzione di un incarico fermo con e senza mandato ed esito a fine turno.
- `app/src/main/core/continuousWork.test.ts`: un incarico fallito è ora un blocco tecnico che il Coordinatore risolve dentro il mandato, e resta alla persona fuori.
- `app/src/main/core/coordinatorTools.test.ts`: `assign_task` rifiuta l'obiettivo proposto e accetta lo stesso incarico dopo la conferma.
- `app/src/main/controller.test.ts`: con il mandato il Coordinatore conferma i seam; la correzione dei seam fa riscrivere la spec con la nota della persona.
- `app/src/main/team.integration.test.ts`: il ciclo completo dentro il mandato, dalla comprensione alle fette, senza pulsanti della persona, fino all'assegnazione e alla verifica.

## Schermate

Prima e dopo, in chiaro e in scuro, in `a06-ciclo-autonomo/`. Le schermate "prima" vengono da `origin/main` e1ca179, con la ui-check di main a cui sono state aggiunte, solo per questa prova e senza pubblicarle, le stesse inquadrature in chiaro e in scuro.

- 01-04: il lavoro è bloccato dal conflitto di Bea con il branch principale. Prima la riga di stato dice "assegno il lavoro" ma non parte niente; dopo il Coordinatore avvia "Risolvi il conflitto" e la riga dice "Sto risolvendo il conflitto", con Ferma a destra.
- 05-08: prima le fette dicono "Confermate da te"; dopo la Pausa e Riprendi le conferma il Coordinatore dentro il mandato.
- 09-12: Attività prima e dopo; dopo compaiono "Comprensione confermata dal Coordinatore" e "Fette confermate dal Coordinatore" con Correggi, e "Risolvi il conflitto".
- 13-14: la correzione di un passo, con Annulla e Invia la correzione a destra.

## Limiti

- Nel progetto di esempio non c'è il giro periodico: i passi del Coordinatore partono alla fine di un turno o di un piano, non da soli dopo Riprendi.
- La correzione di fette già pubblicate lascia su GitHub le issue della divisione precedente.
- L'esito di un blocco è quello letto a fine turno: "risolto" vuol dire che il lavoro non è più fermo per quel motivo, per esempio perché è partito un nuovo incarico, non che la verifica sia già verde.
- Nella ui-check, perché le schermate dei pulsanti della persona su seam e fette restino, la prova mette il lavoro continuo in Pausa prima del piano: in pausa quei passi restano della persona.
