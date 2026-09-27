# W10: cancello del candidato con tutti i revisori in parallelo

Data: 27 settembre 2026. Issue #147, specifica #137. Base: `origin/main` 8fb058a.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 107 file, 945 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0. Passi nuovi: `18e1-candidate-gate-passed` e `18e2-candidate-gate-passed-dark` (cancello superato), `23a-candidate-gate-blocked` e `23b-candidate-gate-blocked-dark` (rilievo bloccante), `23c-gate-finding-to-developer` e `23d-gate-finding-to-developer-dark` (il rilievo nel lavoro dello sviluppatore).

## Comportamento

- `review_candidate` apre il cancello. Trama esegue prima le verifiche richieste che non hanno un'evidenza sulla versione del candidato.
- Con le verifiche superate, tutte le figure del momento candidato partono insieme, ognuna in una sessione propria in sola lettura nel worktree del candidato: revisore della spec, sicurezza, prestazioni, UX, DevOps e documentazione su un modello leggero; Clean Code con la revisione tecnica sullo standard di Trama, in un thread distinto da quello dell'autore; il guardiano delle regressioni è un confronto di Trama, senza modello.
- Revisore della spec, UX, DevOps e documentazione ricevono `code-review` con il testo originale e un binding di Trama; sicurezza e prestazioni sono aggiunte di Trama e hanno solo le istruzioni di Trama. Senza spec il revisore della spec non parte e riporta "no spec available".
- Il guardiano esegue le verifiche di build e test richieste dal candidato sulla sua base, in un checkout staccato e nella sandbox, e le confronta con le evidenze del candidato. Un test che passa sulla base e fallisce sul candidato è una regressione e blocca il candidato. Un test che fallisce su entrambi, o che non gira, è un suggerimento. Il checkout della base viene rimosso alla fine.
- Chi non ha rilievi firma "Niente da segnalare". Il cancello è superato solo se ogni figura ha firmato: una figura che non riesce a rivedere fa fallire il cancello.
- Un rilievo bloccante ferma il candidato (`GATE_BLOCKED`, il via libera è rifiutato). Il messaggio del revisore finisce nel lavoro dello sviluppatore, e il lavoro concluso riprende nella stessa sessione e nello stesso worktree con i rilievi, dentro il mandato e il limite degli sviluppatori in parallelo. Se non può riprendere, il cancello dice perché.
- Se una verifica richiesta fallisce, i revisori del diff non partono e la diagnosi resta al debugger (W11). Il guardiano confronta comunque la suite con la base e segna la verifica fallita come regressione quando lo è.
- La revisione tecnica registrata sul candidato porta il verdetto del cancello. La scheda del candidato mostra il cancello figura per figura, il confronto della suite e il ritorno allo sviluppatore.

## Test

- `app/src/main/core/gate.test.ts`: figure nell'ordine della specifica; verifiche mancanti eseguite prima; verifica fallita che ferma i revisori del diff e lascia il guardiano; regressione, fallimento già sulla base e verifica non eseguita; firma "Niente da segnalare"; blocco su un rilievo bloccante; cancello fallito senza tutte le firme; revisione tecnica di Clean Code; lettura delle risposte; `code-review` byte per byte con il binding del cancello; ritorno allo sviluppatore con i rilievi una sola volta; cancello interrotto alla riapertura.
- `app/src/main/gate.integration.test.ts`: con il controller, sei sessioni aperte insieme e trattenute finché il test non le libera; sicurezza blocca una chiave nel diff, le altre figure firmano; lo sviluppatore riprende nel suo worktree con il rilievo e lo corregge; il candidato nuovo supera il cancello e riceve il via libera; senza spec il revisore della spec salta. Un secondo caso con un test Node che passa sulla base e fallisce sul candidato: regressione, candidato bloccato, diagnosi segnata come regressione, checkout della base rimosso.
- ui-check: le schermate elencate sopra, in chiaro e in scuro.

## Limiti

- Nessuna prova con un modello reale.
- Il guardiano confronta le verifiche di build e test che il candidato richiede, non una suite che l'incarico non nomina. Un candidato senza build né test ha il suggerimento "Nessuna suite da confrontare".
- Le chat tra agenti con thread propri sono la issue #144: qui il messaggio del revisore è un'attività registrata nel lavoro dello sviluppatore.
- Nell'ambiente Linux della prova `swift` non è installato, quindi `swift_build` e `swift_test` non passano. Il test d'integrazione della regressione usa un test Node.
