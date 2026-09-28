# C10: aggiornare ticket e checklist solo quando le prove lo consentono

Data: 28 settembre 2026. Issue #42. Base: `origin/main` d9d1e04, con la scelta della lingua (#303).

## Cosa c'era già su main

Il meccanismo di C10 era già su `main`, arrivato con la PR #110. L'audit `ticket-c-t19.md` lo dava "PARTIAL, vicino a DONE sul codice".

- Lo strumento `update_ticket` del Coordinatore (`app/src/main/core/coordinatorTools.ts`) chiede per ogni criterio l'esito, le prove e i limiti. Serve il mandato `openPullRequest`, e `integrateCandidate` per chiudere.
- `evidenceProblems` (`app/src/main/core/tickets.ts`) accetta come prova solo un candidato verificato o deciso, una PR pubblicata da Trama o un commit. La fine di un turno o un testo libero non bastano.
- `updateTicket` (`app/src/main/controller.ts`) rilegge da GitHub issue, commenti e stato delle PR prima di scrivere. Pubblica un solo commento per resoconto (segno `<!-- trama-progress:... -->`), spunta solo i criteri soddisfatti e chiude solo con tutti i criteri spuntati e una PR unita con le verifiche passate.

## Cosa mancava e cosa cambia

- Un commit citato come prova non veniva cercato: bastava una stringa esadecimale, anche inventata. Ora Trama controlla che il commit esista nel repository del progetto (`git cat-file`), altrimenti rifiuta il resoconto e non scrive niente su GitHub.
- Il commento su GitHub citava i candidati con l'id (`C-...`). Ora li nomina per autore e fetta, con la PR se c'è, come fa la chat.
- In Attività i motivi per cui la issue resta aperta erano in inglese ("Criterion not met", "No pull request of this work is merged") e i criteri spuntati erano numeri. Ora il passo nomina la issue con il titolo e dice in italiano cosa manca, con i criteri per nome. Il Coordinatore riceve ancora i motivi in inglese dallo strumento.
- Un errore di GitHub a metà aggiornamento lasciava in Attività solo l'errore tecnico dello strumento. Ora c'è un passo "aggiornamento non riuscito" che dice cosa è arrivato su GitHub e cosa no (resoconto, criteri, chiusura).
- I testi nuovi di Attività sono nel catalogo delle traduzioni (`app/src/shared/messages/it.ts` ed `en.ts`, chiavi `ticket.*`) e seguono la lingua scelta. Il commento su GitHub resta in italiano, come prima.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`) e un `gh` finto. Nessuna esecuzione reale di un provider e nessuna scrittura su un repository GitHub reale.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 139 file, 1299 test superati, 3 saltati, su d9d1e04.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 371 schermate, su 59e2a83 (da lì a d9d1e04 cambia solo un test). Passi nuovi: `30a-ticket-partial` e `30b-ticket-failed`, con Codex e Claude, in chiaro e in scuro.

## Test

- `app/src/main/core/tickets.test.ts`: prove accettate e rifiutate, commit assente dal repository, commento con i candidati per nome, motivi di chiusura in inglese per lo strumento e in italiano per la persona.
- `app/src/main/controller.test.ts`, test "updates a ticket only with evidence, without duplicates, and never reports a failed write as done (C10)": un `gh` finto conserva la issue in un file (`FAKE_GH_TICKET`). Il test porta la issue da un incremento parziale alla chiusura e controlla:
  - l'incremento parziale spunta solo il criterio provato e lascia la issue aperta con quello che manca;
  - lo stesso resoconto ripetuto dopo un timeout non pubblica un secondo commento;
  - un commit inventato viene rifiutato prima di scrivere su GitHub;
  - un errore di GitHub diventa "aggiornamento non riuscito" e non cambia la issue;
  - con tutti i criteri e la PR unita con le verifiche passate la issue si chiude una volta sola;
  - riaperta, la issue conserva i resoconti precedenti e si richiude senza commenti doppi.

## Schermate

`c10-ticket-con-prove/`. Le schermate "prima" vengono da `origin/main` 7e13d3f con gli stessi fixture, le schermate "dopo" dai passi `30a` e `30b` della corsa completa di `ui-check`.

- `01`, `02`: prima, incremento parziale. Il passo dice "Resta aperta: Criterion not met: ... No pull request of this work is merged."
- `03`, `04`: prima, errore di GitHub. C'è solo "github_failed: HTTP 502".
- `05`, `06`, `07`: dopo, incremento parziale, con il titolo della issue e i criteri mancanti per nome.
- `08`, `09`, `10`: dopo, errore di GitHub, con il passo "aggiornamento non riuscito" e cosa non è arrivato su GitHub.

## Limiti

- La prova di completamento della issue chiede di portare una issue reale da lavoro parziale a chiusura e di confrontare chat e GitHub. Qui è stata fatta solo con un `gh` finto. Manca la prova su un repository GitHub reale.
- Manca la revisione Standards e Spec con `code-review` registrata da un provider reale.
- Se la issue viene riaperta e il Coordinatore manda di nuovo lo stesso identico resoconto, Trama non ripubblica il commento: la cronologia resta quella già sulla issue. Un resoconto nuovo dopo la riapertura deve dire qualcosa di diverso.
- Un commit citato come prova deve esistere nel repository locale del progetto. Un commit che esiste solo su GitHub, non ancora scaricato, viene rifiutato finché il progetto non lo scarica.
- Lo stato delle verifiche di una PR arriva da `gh pr view`. Una PR senza verifiche configurate non chiude la issue.
