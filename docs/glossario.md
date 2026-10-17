# Glossario dell'interfaccia

Le parole che Trama usa con la persona, in italiano semplice (issue #270). L'interfaccia, il Coordinatore e gli agenti usano queste parole; i termini tecnici della colonna di destra restano nel codice e nei documenti tecnici.

La stessa tabella sta in `app/src/shared/plainLanguage.ts`. Un test controlla che le due restino uguali.

| Parola | Cosa vuol dire | Al posto di |
| --- | --- | --- |
| Coordinatore | L'agente con cui parli. Organizza il lavoro del team e ti chiede solo le scelte che spettano a te. |  |
| Sviluppatore | Un agente del team che scrive il codice di una fetta, nella sua copia di lavoro. | specialista, specialist |
| Obiettivo | Il risultato che vuoi ottenere, con gli esempi di cosa deve e non deve succedere. | goal |
| Piano | La descrizione del lavoro da fare per una richiesta, prima che il team cominci. |  |
| Fetta | Una parte del piano che si può fare, provare e unire da sola. | slice, ticket |
| Incarico | Il lavoro che il Coordinatore affida a uno sviluppatore: di solito una fetta. | assignment, task |
| Candidato | Il risultato di un incarico, pronto per le verifiche e per essere unito. | candidate |
| Verifiche | I comandi di prova che Trama esegue davvero sul candidato, come i test. | check, evidence |
| Revisori | Gli agenti che leggono il candidato prima dell'unione e segnalano i problemi. | gate, review gate |
| Esame approfondito | Una lettura completa di un candidato, di un modulo o dell'intero progetto: prima le verifiche, poi il confronto con le regole del codice e con il piano. Per un modulo o per il progetto occupa tutta la finestra finché non esci; per un candidato è una sezione della sua scheda. | Focus mode, audit |
| Lenti di Trama | I controlli in più dell'esame approfondito, aggiunti da Trama: sicurezza, qualità dei test, documenti e codice. | lens |
| Punto fisso | Il commit, il branch o il tag da cui l'esame approfondito di un modulo o del progetto legge i cambiamenti. | fixed point |
| Punti di prova | I punti del codice da cui i test controllano un comportamento senza toccare il resto. | seam |
| Copia di lavoro | Una cartella separata del progetto dove uno sviluppatore lavora senza toccare la tua. | worktree |
| Sessione cloud | Il lavoro di uno sviluppatore che gira sui server del provider invece che sul Mac. Torna come pull request in bozza e Trama lo verifica sul Mac. | remoto, sandbox |
| Luogo di lavoro | Dove lavora un incarico: in locale sul Mac o in una sessione cloud. Lo sceglie l'impostazione del progetto, e puoi spostare un incarico. | |
| Patto | Le decisioni che hai preso sul comportamento del prodotto, con la loro versione. | pact |
| Mandato | Il permesso che dai al Coordinatore per fare da solo alcune cose. | mandate |
| Aspetta te | L'elenco delle domande, proposte e permessi che aspettano una tua risposta. | pending, waiting |
| Attività | Il registro delle mosse che il Coordinatore ha fatto da solo, con l'esito. | activity log |
| Riepilogo | Cosa ha fatto il Coordinatore, cosa sta facendo e cosa aspetta te. | recap |
| Memoria | Le note che il Coordinatore conserva sul progetto e su di te, oltre la singola conversazione. | memory |
| Lavoro in primo piano | Il lavoro su cui il progetto si concentra ora, in cima alla chat. | task in focus, focus |

## Nomi al posto degli id

Nei testi per la persona un lavoro si chiama per nome: lo sviluppatore, la fetta, l'obiettivo. L'id che Trama registra (per esempio `A-1B2C3D4E`) resta disponibile al passaggio del mouse sul nome, che è anche un collegamento a quello che nomina.

Se il lavoro nominato non esiste più, il testo dice "non più disponibile" e l'id resta solo al passaggio del mouse. Un test (`app/src/shared/visibleText.test.ts`) controlla i testi dei cataloghi, e `ui-check` controlla il testo di ogni schermata: un id interno visibile li fa fallire.

## Durate

Le durate si mostrano in secondi o in minuti ("2,5 s", "1 min 5 s"). Sotto un secondo non si mostrano: nessuna durata in millisecondi.

## Definizioni al passaggio del mouse

Otto parole hanno una definizione di una frase, che compare al passaggio del mouse o con la tastiera, dove la parola compare per la prima volta in una vista: Patto, mandato, candidato, fetta, via libera, lenti di Trama, esame approfondito, Aspetta te. Il componente è `Term` (`app/src/renderer/components/Term.tsx`). Le frasi stanno nei cataloghi in italiano e in inglese (`glossary.*`) e riscrivono le definizioni di `CONTEXT.md`, la fonte unica del vocabolario. I nomi sono quelli della tabella di `CONTEXT.md`: un test controlla che coincidano.

## Nomi inglesi dei difetti del codice

I rilievi dell'esame approfondito possono citare i difetti del codice con il nome inglese del catalogo di Fowler, per esempio "Mysterious Name". Con l'interfaccia in italiano Trama lo mostra nella lingua della persona ("Nome poco chiaro"). I nomi stanno nei cataloghi (`smell.*`).

## Codici tecnici

I codici che Trama usa internamente, come `WORKTREE_CONFLICT` o `GATE_BLOCKED`, non arrivano alla persona: la scheda dice cosa significano in una frase. Lo stesso vale per le frasi fisse delle skill in inglese, come "no spec available", che la persona legge come "Nessun piano da confrontare", e per il percorso completo di una skill, che diventa il suo nome.

## Messaggi di commit

I messaggi di commit che Trama scrive sono completi e hanno un tipo Conventional Commits ammesso dal progetto. Trama rifiuta un messaggio con la descrizione tagliata a metà, per esempio che finisce con un articolo o una preposizione, e un tipo che il progetto non usa.
