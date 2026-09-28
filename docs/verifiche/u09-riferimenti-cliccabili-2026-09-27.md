# U09: ogni riferimento nei messaggi è un collegamento (2026-09-27)

Controllo di #277 sul branch `feature/issue-277-clickable-references-ewk1n0`.

## Cosa esisteva già

- Menzioni con `@` nel composer (`app/src/shared/mentions.ts`): moduli, issue, decisioni e file, risolti sui dati del progetto e passati al Coordinatore come contesto.
- Link a file del progetto nella chat (`app/src/renderer/lib/chatLinks.ts`, W12): un link Markdown a un file apre il file nell'ispettore.
- Ispettore con viste per issue, candidato, decisione, obiettivo, specialista, modulo, file, mandato, Patto e lavoro.

Il lavoro riusa queste parti: le menzioni con `@` diventano collegamenti con le stesse regole, i link ai file restano come prima e ogni riferimento apre una vista dell'ispettore già esistente.

## Cosa cambia

- Indice dei riferimenti (`app/src/shared/references.ts`): costruito dai dati di Trama (incarichi, candidati, revisioni, esami in focus mode, decisioni, domande del Patto, richieste di mandato, piani, fette, obiettivi, agenti), dai moduli e file del repository e dall'ultima lettura di GitHub (issue, PR, branch, commit). Il testo libero non basta: un id viene collegato solo se l'indice lo conosce.
- Riconoscimento: id con prefisso (`A-`, `C-`, `D-`, `G-`, `M-`, `P-`, `Q-`, `R-`, `F-`, `S-`), anche quelli scritti a mano come `D-1`; `#13` per issue e PR; `S2` per le fette del piano più recente che le ha; nomi degli sviluppatori; percorsi di file e moduli, anche con `:12`; branch; commit da 7 caratteri in su; menzioni del composer. I nomi dei ruoli fissi ("Sicurezza") sono parole comuni e si collegano solo per id.
- Testo mostrato: il nome leggibile ("fetta 2, Il supporto vede gli ordini in revisione", "candidato di Ada", "decisione «Va in revisione»", "issue #13"). Se il testo ha già il nome ("la fetta S2"), il collegamento mostra solo il resto. Due lavori dello stesso agente hanno il loro numero ("candidato di Ada, n. 2"). L'id resta nel titolo al passaggio del mouse. Percorsi, branch e commit restano come sono scritti.
- Dove: tutto quello che passa da `ChatMarkdown` (messaggi del Coordinatore e della persona, studio, risultati degli incarichi, report della focus mode, corpo delle issue) e, con `ReferenceText`, i testi semplici: dettagli delle attività in chat e nel pannello Attività, avvisi, riga di stato (testo e motivo), task in focus e in coda, motivo del passo sotto la risposta, "Aspetta te" (riassunto sopra il composer e rimandi in chat), riepilogo del Coordinatore (fatti e cose che aspettano la persona) e backlog dei problemi trovati.
- Clic: apre l'elemento dentro Trama. Issue, candidato, decisione, obiettivo, agente, modulo, file e focus mode aprono la loro vista; incarico, piano, fetta e domanda portano alla loro scheda nel dialogo se c'è, altrimenti allo specialista, al Lavoro o al Patto; richiesta di mandato al Mandato. PR, commit e branch hanno ora una vista nell'ispettore (`GitView.tsx`) con "Apri su GitHub"; la vista della issue chiama il pulsante "Apri su GitHub".
- Coordinatore: riceve la sezione "Riferimenti di Trama" con gli id reali e il nome leggibile quando l'elenco cambia (sempre gli agenti, degli altri record gli 80 più recenti). Le istruzioni dicono di citare solo quegli id o quelli dei suoi strumenti, mai inventarli.
- Id inesistenti: restano testo semplice, con un titolo che dice che Trama non li trova. Trama registra l'attività "Riferimento che Trama non trova" nel turno e al turno dopo manda al Coordinatore la sezione "Riferimenti che non esistono", come fa #228 per le scelte scritte nel testo. Un `#99` si segnala solo quando GitHub ha già risposto; una fetta inesistente come `S3` non si segnala, perché è anche un nome comune.

## Verifiche

- Test: `app/src/shared/references.test.ts` (riconoscimento, id inesistenti, nomi leggibili, numero dei lavori, link e ritorno, elenco per il Coordinatore), `app/src/renderer/lib/remarkReferences.test.ts` (Markdown: link con nome e titolo, codice, id inesistenti, link e blocchi di codice lasciati stare), `app/src/main/core/referenceCheck.test.ts` (attività e sezione del turno dopo).
- ui-check: il Coordinatore di prova (`[cita]`) cita il candidato, l'incarico e la decisione dall'elenco che Trama gli ha mandato, più `C-00000000`. Il controllo verifica che i tre collegamenti mostrino il nome e non l'id, che l'id stia nel titolo, che `C-00000000` resti testo, che il clic sul candidato apra l'ispettore "Candidato" con quell'id e quello sulla decisione l'ispettore "Decisione", in chiaro e in scuro. Schermate `23a` a `23d`.
- Passi esistenti di ui-check che cercavano l'id grezzo nel testo, ora cercano il collegamento: l'eco "Messaggio sull'obiettivo G-..." (link all'obiettivo con il titolo), il titolo dell'obiettivo riaperto (cercato nell'ispettore, perché anche i titoli dei messaggi ora lo nominano), il report Spec "Fonte: Fetta S1" (link alla fetta) e il motivo della riga di stato "l'incarico A-... è concluso" (link all'incarico con quell'id).

Non verificato: un Coordinatore reale che cita gli id. Il server di prova non è un modello; nessuna esecuzione reale di Codex.
