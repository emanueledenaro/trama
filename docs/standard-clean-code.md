# Standard Clean Code di Trama

Versione 1. Issue Q03 #190, decisione in [ADR 0016](adr/0016-standard-clean-code.md).

Fonte: Robert C. Martin, *Clean Code: A Handbook of Agile Software Craftsmanship* (2008). Il testo che segue riassume i princìpi con le parole della persona. Non riporta il libro.

Lo standard è uno standard di qualità di Trama. Non è una skill e non cambia le skill di Matt Pocock, che restano col loro testo originale. Il testo che ricevono sviluppatori e revisore sta in `app/src/shared/cleanCode.ts` e `app/src/main/core/cleanCode.ts`, alla stessa versione di questo documento. Quando una regola cambia, cambiano insieme il documento e `CLEAN_CODE_VERSION`.

## Ordine di precedenza

1. Le regole del progetto: `AGENTS.md`, `CONTRIBUTING.md`, linter e formatter configurati.
2. Il metodo delle skill native (implement, tdd, codebase-design e le altre).
3. Lo standard di Trama.

Un contrasto si risolve in questo ordine e si dice in modo esplicito: lo sviluppatore lo scrive tra le eccezioni del rapporto, il revisore lo nomina nel rilievo.

codebase-design e improve-codebase-architecture preferiscono moduli profondi con interfacce piccole. Non è un contrasto: "funzioni piccole" vale dentro un modulo e non autorizza a spezzettare le interfacce.

## Regole

| Regola | Cosa chiede | In revisione |
|---|---|---|
| `names` | Nomi significativi che spiegano lo scopo senza commenti (`daysSinceLastAccess`, non `d`). Pronunciabili e ricercabili, senza abbreviazioni criptiche. Il tipo non va nel nome (`users`, non `userList`). | Un nome fuorviante blocca |
| `smallFunctions` | Funzioni piccole che fanno una sola cosa (responsabilità singola), dentro un modulo. | Suggerimento |
| `fewArguments` | Da 0 a 2 argomenti, al massimo 3. Oltre 3 si raggruppano in un oggetto. | Suggerimento |
| `noHiddenSideEffects` | Nessun effetto collaterale nascosto sullo stato globale o condiviso. | Blocca |
| `kiss` | Niente complessità superflua. | Suggerimento |
| `dry` | La stessa logica non si duplica. | Blocca |
| `yagni` | Niente funzioni, opzioni o astrazioni prima che servano. | Suggerimento |
| `solid` | SOLID, solo per il codice a oggetti. | Suggerimento |

## Sviluppatori

Lo sviluppatore che lavora in un worktree riceve lo standard nelle istruzioni di Trama, sopra le skill e separato dal loro testo. Il testo delle skill arriva byte per byte, come prima. Nel rapporto strutturato di W05 c'è un quinto blocco, `Standard exceptions:`, con una riga per ogni regola messa da parte: `- <regola>: <file>: <perché>`, oppure `- none`. È una dichiarazione dello sviluppatore, non un'evidenza.

## Revisione tecnica

Il revisore (V05) controlla il diff anche rispetto allo standard e riporta i rilievi con file e riga, divisi in bloccanti e suggerimenti. Una violazione di `names`, `noHiddenSideEffects` o `dry` è sempre bloccante, anche se il revisore la chiama suggerimento. Un rilievo bloccante porta sempre a "modifiche richieste", anche se il revisore ha scritto "approvato". Un'eccezione dichiarata e motivata dallo sviluppatore non è una violazione.

I rilievi sono il giudizio del modello e restano rilievi. Contano come evidenza solo le misure che Trama calcola da sola, sempre uguali per lo stesso diff:

| Misura | Regola | Limite |
|---|---|---|
| Argomenti di una funzione | `fewArguments` | più di 3 |
| Righe di una funzione, dalla dichiarazione alla graffa di chiusura | `smallFunctions` | più di 40 |
| Righe aggiunte uguali a un blocco presente altrove nei file cambiati | `dry` | almeno 6 righe consecutive con logica |

Le misure riguardano solo le funzioni che il candidato aggiunge o cambia. Le funzioni si leggono nei linguaggi con le graffe: TypeScript, JavaScript, Swift, Kotlin, Rust e Go, con i metodi e i risultati di Go. Le duplicazioni si cercano anche in Python, Java, C, C#, Ruby e PHP. Le righe vuote, quelle con sole parentesi, gli import e i commenti non contano come logica. Trama legge solo file normali dentro il worktree: niente collegamenti simbolici, nemmeno su una cartella del percorso, e niente file sopra i 512 KB.

## Configurazione per progetto

In Impostazioni, Standard del codice, la persona vede le regole del progetto aperto, può spegnerne una alla volta e può scrivere come lo standard si applica al progetto, per esempio "SOLID solo nei moduli a oggetti". Il testo arriva a sviluppatori e revisore come indicazione della persona. Una regola spenta non arriva allo sviluppatore, non entra nella revisione e non ha misure. Con tutte le regole spente lo standard non arriva affatto.
