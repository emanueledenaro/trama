# U05: linguaggio umano, nomi invece di id (2026-09-28)

Controllo di #270 sul branch `feature/issue-270-plain-language-xay56j`, costruito sui riferimenti cliccabili di #285.

## Cosa cambia

- Glossario dell'interfaccia (`docs/glossario.md`, `app/src/shared/plainLanguage.ts`): le parole che Trama usa con la persona, con i termini tecnici che sostituiscono. Un test tiene uguali le due tabelle. Il Coordinatore riceve le stesse parole nelle regole di stile e l'indicazione di chiamare le cose per nome, senza codici tecnici e senza ripetere un'etichetta.
- Nomi al posto degli id: le schede di incarico, candidato e piano hanno come titolo il nome ("Incarico di Ada, fetta 2, ...", "Candidato di Ada") con l'id al passaggio del mouse. Nella scheda del candidato l'incarico, le decisioni ("«Va in revisione», versione 2") e i confronti con altro lavoro sono nomi cliccabili. Negli elenchi dell'ispettore (Team, Patto, Lavoro, Obiettivi, Esame approfondito) l'id non si vede più e resta al passaggio del mouse.
- Titolo dell'ispettore: segue quello che il pannello mostra. Un candidato, una decisione, un obiettivo o un agente hanno il loro nome; Aspetta te aperto su un elemento dice quale ("Aspetta te  Candidato di Ada").
- Confronti tra copie di lavoro: il record salva solo l'id dell'altro candidato. Prima salvava "C-4B220EA8 di Ada (feature/...)"; i record già scritti si leggono allo stesso modo.
- Codici e testo interno tradotti: i blocchi del candidato (`WORKTREE_CONFLICT` e gli altri) hanno una frase italiana; "no spec available" della skill code-review si legge "Nessun piano da confrontare", nei revisori e nell'esame approfondito; il percorso di una skill ("skill:improve-codebase-architecture:/home/.../SKILL.md") diventa il suo nome. Il testo originale della skill e i record restano come sono.
- Proposte della Memoria: la persona legge "Togliere la nota «pnpm»" al posto di "background review consolidation (remove on memory): - remove: pnpm". Il testo interno resta in `proposals.json`.
- Messaggi scritti a nome della persona: "Chiedi al Coordinatore" dalla scheda di uno sviluppatore scrive "Aggiornami sul lavoro di Ada: «...»" senza l'id dell'incarico. I percorsi di Ask Trama sono nell'indice dei riferimenti: "Avvia il percorso AT-... di Ask Trama" mostra la situazione del percorso ("Avvia il percorso «...» di Ask Trama") con l'id al passaggio del mouse.
- Clean Code: l'opzione si scrive una volta sola ("Approfondire l'annullamento", non "Approfondire: Approfondire l'annullamento").
- Riepilogo: le mosse si raccontano come fatti ("Verifica del lavoro non riuscita", non "Esegui le verifiche: non riuscita"); le fette per numero ("Fetta 1 fatta"); traguardi e "Cosa faccio" hanno i riferimenti cliccabili.
- Gergo dell'interfaccia: "Focus mode" diventa "Esame approfondito", "Vai al task" "Vai al lavoro", "Metti in focus" "Metti in primo piano", i seam "punti di prova", il worktree "copia di lavoro". I testi fra backtick nei testi semplici si vedono come codice, senza backtick.
- Messaggi di commit: Trama rifiuta una descrizione tagliata a metà (che finisce con un articolo, una preposizione, una congiunzione, una virgola o dei puntini) e non la produce più quando accorcia un titolo lungo. Una riga di AGENTS.md che elenca altre cose fra backtick ("types: `strict`, `esnext`, `bundler`") non diventa più l'elenco dei tipi di commit: serve che nomini almeno due tipi di Conventional Commits. Così un messaggio "strict: ..." viene rifiutato.

## Verifiche

- Test: `app/src/shared/plainLanguage.test.ts` (glossario uguale al documento, percorsi delle skill, codici, "no spec available", ripetizioni, record di confronto vecchi), `app/src/main/core/conventions.test.ts` (descrizioni tagliate, tipi letti da AGENTS.md), `app/src/main/core/learning/projectLearning.test.ts` (proposte della Memoria in italiano), `app/src/main/core/recap.test.ts` (mosse come fatti, fette per numero), test esistenti aggiornati ai testi nuovi.
- ui-check: Aspetta te aperto sul candidato ha il titolo "Aspetta te  Candidato di ..." con l'id nel titolo al passaggio del mouse, e la scheda non mostra id grezzi; la scheda di Clean Code mostra "Skill ricevute" con il nome della skill, senza percorso, senza "Approfondire: Approfondire" e senza l'id dell'incarico (schermate `26a-plain-clean-code-card-light` e `-dark`). I passi che leggevano gli id dal testo delle schede ora li leggono dagli attributi `data-record-id` e `data-decision-id`.
- Schermate prima e dopo in `docs/images/u05/`, in chiaro e in scuro, da ui-check sullo stesso origin/main (24ba1e0) e su questo branch: Aspetta te aperto sul candidato, revisori del candidato, esame approfondito senza piano, scheda dell'incarico. La scheda di Clean Code ha solo le schermate "dopo" (`clean-code-dopo-*`): su main ui-check non la fotografa.

Non verificato: un Coordinatore reale che segue il glossario. Il server di prova non è un modello; nessuna esecuzione reale di Codex.
