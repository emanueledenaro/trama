# U07: un solo vocabolario di stati in tutte le viste (2026-09-28)

Controllo di #272 sul branch `bugfix/issue-272-one-state-vocabulary`. Dall'audit #262, sezione 9, con gli esempi aggiunti nei commenti della issue (le due pause, i residui dopo U05).

## Cosa cambia

- Stati calcolati in un solo punto (`app/src/shared/states.ts`): piano, candidato, incarico, fetta, verifica. La scheda in chat, Lavoro, gli obiettivi, Team e la riga compatta di una scheda risolta leggono le stesse etichette.
- Piano: con le fette confermate Lavoro dice "Fette confermate" (o "Fette confermate dal Coordinatore") come la scheda in chat, non più "Da rivedere". Una divisione in fette non riuscita ha la sua etichetta.
- Candidato: il gruppo "In costruzione" diventa "Non ancora pronto" e ogni candidato dice perché: "In verifica" quando mancano solo verifiche o revisori al lavoro, "Da sistemare" quando c'è qualcosa da correggere.
- Due pause con nomi diversi: "Pausa del Coordinatore" e "Riprendi il Coordinatore" nella riga di stato; "Sospendi questo lavoro" nella barra del lavoro in primo piano, con i lavori sospesi in coda come "Sospeso". Un incarico o una fetta fermi per una domanda dello sviluppatore dicono "Aspetta una risposta"; una fetta fermata con un motivo dice "Sospesa".
- Durate leggibili: "inattivo da 12 ore" al posto di "inattivo da 757 min", anche nel testo per il Coordinatore.
- Contesto: la lettura del contesto è quella di #318 (`app/src/shared/contextReading.ts`, `last` di Codex, misuratore nascosto se la finestra non si conosce). U07 aggiunge solo che lo stato rispetto alla soglia si decide sulla percentuale esatta: 79,6% si legge 80% ma non supera una soglia dell'80%.
- Panoramica: il segnale è "Aspetta te" e i motivi hanno il loro nome ("1 richiesta di mandato", "1 proposta di team"), non tutti "decisione richiesta".
- Barra laterale: i numeri delle cose da fare (Aspetta te, Obiettivi, Patto, Mandato, Lavoro, Memoria) sono un'etichetta colorata; i numeri solo informativi (Issue aperte, sviluppatori al lavoro in Team) sono testo tenue.
- Monitor: "Nessun repository osservato." compare solo se sotto non c'è il repository del progetto, che dice "non ancora osservato".
- Verifiche con nomi umani ("Stato del repository: letto", "Test Node: non superati"), con il nome tecnico al passaggio del mouse; anche in "Cosa manca" e nei revisori.
- Sigle dello standard (KISS, DRY, YAGNI, SOLID) spiegate al passaggio del mouse, nei rilievi del revisore e nelle impostazioni.
- Clean Code: le opzioni della scheda sono i titoli delle proposte ("Unire i pagamenti"), perché la domanda chiede già cosa approfondire. Dopo la risposta l'incarico dice "hai scelto «...»" invece di "3 proposte da decidere". Il server di prova non mette più "Skill ricevute: ..." nel consiglio: dà un consiglio vero se la sessione ha ricevuto la skill, altrimenti dice che manca.

## Verifiche

- Test: `app/src/shared/states.test.ts` (piano con le fette, candidato finito, fette sospese o in attesa, nomi delle verifiche, durate), `app/src/shared/contextReading.test.ts` (soglia sulla percentuale esatta), `app/src/shared/duties.test.ts` (Clean Code prima e dopo la risposta), `app/src/shared/settledCards.test.ts` con le etichette vere, `app/src/main/core/duties.test.ts` e `app/src/main/duties.integration.test.ts` con le opzioni senza prefisso.
- ui-check, passi nuovi: Lavoro mostra "Fette confermate dal Coordinatore" e nessun "In costruzione" (`10h`, chiaro e scuro); la barra del lavoro non ha pause dal nome ambiguo e il lavoro sospeso dice "Sospeso"; il Monitor non dice "Nessun repository" sopra il repository del progetto (`16f`); la scheda di Clean Code non ripete "Approfondire:" e non mostra "Skill ricevute", e dopo la risposta l'incarico dice cosa hai scelto (`22c`, chiaro e scuro). Passi esistenti adattati ai nomi nuovi delle pause e degli stati. Nella finestra più stretta (720x640) i pulsanti del Coordinatore mostrano "Pausa" e "Riprendi", con il nome intero come nome accessibile, così la riga di stato resta su una riga.
- Schermate prima e dopo in `docs/images/u07/`: "prima" da ui-check su origin/main `40eb4b5`, "dopo" da questo branch unito a origin/main, con U05 (#299). Lavoro e Clean Code dopo la risposta hanno solo il "dopo", perché su main ui-check non li fotografa.
- Dopo il merge di U05 (#299) restano i nomi di U05 (nomi al posto degli id, "In primo piano", riferimenti) con gli stati di U07. Il controllo di ui-check sulla scheda di Clean Code cerca il consiglio vero invece di "Skill ricevute".
- Merge con #318 (misura del contesto): tenuta la lettura di #318 in `controller.ts`, `codexClient.ts`, `ContextMeter.tsx` e `fake-codex.mjs`; tolto `contextFill` di U07, che faceva la stessa cosa; la regola della soglia esatta è passata in `contextReading`.
- Correzioni dalla revisione automatica: `GATE_FAILED` conta come verifica in corso, come in `workPhase.ts`; la riga di un incarico fermo per una domanda dice "Aspetta la risposta ...", anche nei record scritti prima; l'avviso del contesto usa la percentuale esatta e non quella arrotondata.

Non verificato: un Codex reale oltre la finestra di contesto; nessuna esecuzione reale di Codex.
