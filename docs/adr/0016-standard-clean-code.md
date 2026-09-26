# Lo standard Clean Code è testo di Trama, accanto alle skill e dopo le regole del progetto

Stato: accettata il 26 settembre 2026 per Q03 (#190).

La persona chiede che il codice scritto dagli sviluppatori di Trama segua i princìpi del Clean Code di Robert C. Martin: nomi, funzioni piccole con pochi argomenti e senza effetti nascosti, KISS, DRY, YAGNI e SOLID per il codice a oggetti. Le skill di Matt Pocock restano col testo originale (#118), quindi lo standard non può entrare nelle skill.

Decisione:

- **Standard di Trama, non skill.** Il testo dello standard è di Trama, versionato (`CLEAN_CODE_VERSION`), con la fonte. Il documento per le persone è [`docs/standard-clean-code.md`](../standard-clean-code.md) e un test controlla che versione, fonte e regole coincidano con il codice.
- **Ordine di precedenza.** Prima le regole del progetto (`AGENTS.md`, `CONTRIBUTING.md`, linter e formatter), poi il metodo delle skill native, poi lo standard. Un contrasto si risolve in quest'ordine e si dice. I moduli profondi di codebase-design e improve-codebase-architecture non sono in contrasto con le funzioni piccole: le funzioni piccole valgono dentro un modulo.
- **Agli sviluppatori come blocco separato.** Chi lavora in un worktree riceve lo standard nelle istruzioni di Trama, dopo le istruzioni dell'incarico e prima delle skill, come testo a sé. La consegna delle skill non cambia e i loro file restano byte per byte. Il rapporto di W05 ha un blocco in più, `Standard exceptions:`, per le eccezioni con il loro perché.
- **Revisione con rilievi e misure.** Il revisore tecnico di V05 riceve lo standard, le misure di Trama e le eccezioni dello sviluppatore, e risponde con un elenco di rilievi con file, riga, regola e gravità. Duplicazione di logica, effetti collaterali nascosti e nomi fuorvianti bloccano; il resto è un suggerimento. Un rilievo bloccante porta sempre a "modifiche richieste".
- **Solo le misure deterministiche sono evidenza.** Argomenti, lunghezza delle funzioni e duplicazioni li calcola Trama con un analizzatore proprio, senza dipendenze e senza modello, sulle righe che il candidato aggiunge. Il giudizio del modello resta un rilievo e la scheda lo dice.
- **Per progetto.** Il documento del progetto conserva le regole spente e una nota della persona (`cleanCode`). Si cambiano in Impostazioni, Standard del codice.

Conseguenze:

- L'analizzatore riconosce le funzioni con euristiche sul testo, non con un parser completo per ogni linguaggio. È deterministico ma può non vedere alcune forme (per esempio i metodi di Java e C#). Un linguaggio nuovo richiede un test.
- Le soglie sono fisse nella versione 1 (3 argomenti, 40 righe, 6 righe duplicate). Cambiarle vuol dire una nuova versione dello standard.
- Le lenti di F05 (#129) non sono ancora in `main`: quando arriveranno, lo standard sarà una di esse.

Alternative scartate: aggiungere le regole al testo delle skill, che violerebbe #118; affidare le misure al modello, che non darebbe un'evidenza ripetibile; usare ESLint o il compilatore TypeScript dentro l'app, che coprirebbero un solo linguaggio e peserebbero sul pacchetto.
