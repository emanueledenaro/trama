# Trama

App desktop in Electron (`app/`), con l'interfaccia di Synara: seguire i token, le misure e i componenti in `app/src/renderer` (ADR 0011). Il motore AI è Codex App Server di OpenAI. I sorgenti SwiftUI sono stati rimossi e restano nella cronologia git.

## Humanizer

Scrivere in italiano semplice. Conservare fatti e significato. Usare frasi dirette, senza em dash, en dash, enfasi promozionale o chiusure da chatbot. Humanizer si applica a risposte, commenti, commit, PR e documenti.

## Lingua del codice

Il codice sorgente è in inglese: nomi di tipi, funzioni, proprietà, test, commenti tecnici, errori tecnici, messaggi di log e testi dei commit. I messaggi di commit usano verbi inglesi e descrivono il cambiamento in modo concreto.

## Commit e branch

I messaggi di commit seguono [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<tipo>[ambito opzionale]: <descrizione>`, per esempio `feat(app): add the search palette` o `fix(app): guard reveal paths`. Tipi usati: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`, `revert`. Una modifica incompatibile usa `!` dopo il tipo o il footer `BREAKING CHANGE:`.

I nomi dei branch seguono [Conventional Branch 1.1.0](https://conventionalbranch.org/): `<tipo>/<descrizione>`. I branch di tronco `main`, `master` e `develop` non hanno prefisso. Tipi ammessi dalla specifica: `feature` (o `feat`), `bugfix` (o `fix`), `hotfix`, `release`, `chore`, e i prefissi per agenti AI `ai`, `claude`, `codex`, `copilot`, `cursor`. In questo repository persone e agenti usano i prefissi di tipo:

- `feature/<descrizione-breve>` per nuove funzioni;
- `bugfix/<descrizione-breve>` per correzioni ordinarie;
- `hotfix/<descrizione-breve>` per correzioni urgenti da portare subito su `main`.

`feature` è preferito a `feat`, `bugfix` a `fix`. La descrizione è in inglese, minuscola, con parole separate da trattini, per esempio `feature/electron-app` o `feature/issue-142-assignment-contract` con il numero della issue. I punti si usano solo nelle versioni di `release/`, per esempio `release/v1.2.0`. Niente trattini o punti consecutivi, né all'inizio né alla fine della descrizione. Dettagli ed esempi non validi in `docs/agents/branch-naming.md`.

Un controllo automatico in CI verifica, a ogni pull request, i commit (compresi i merge), il titolo della PR e il nome del branch. Il commit di unione su `main` ha un oggetto conforme, per esempio `feat(app): add the search palette (#123)`; l'oggetto proposto di default da GitHub non lo è e va sostituito a mano. Dettagli, esempi ed hook locale facoltativo in `docs/agents/conventional-commits.md`.

Il branch `main` è protetto: niente push diretto, solo pull request, con il controllo richiesto `test` e solo commit di merge (niente squash né rebase, niente force push). I tag di rilascio `v*` sono immutabili: una versione sbagliata ottiene un nuovo numero, il tag esistente non si riscrive.

L'interfaccia dell'app, la documentazione di prodotto, le issue, le pull request e le comunicazioni con la persona restano in italiano, salvo quando un termine tecnico o una fonte richiedono l'inglese. Fa eccezione il `README.md`, che è in inglese e si rivolge a chi scopre il progetto su GitHub. Segue la struttura dei README open source: presentazione e schermata, stato del progetto, avvio rapido, funzionamento, provider, sviluppo, limiti noti, contributi e licenza. Le schermate stanno in `docs/images/readme/` e vengono da `npm run ui-check`. Il README riporta solo fatti verificati e rimanda ai registri in `docs/verifiche/`.

Non tradurre retroattivamente dati persistiti, contenuti storici, nomi di API esterne o testo già pubblicato soltanto per applicare questa regola.

## Agent skills

### Issue tracker

Le attività sono GitHub Issues di `emanueledenaro/trama`. Leggere `docs/agents/issue-tracker.md` prima di gestire attività remote.

### Triage labels

Le skill usano il vocabolario predefinito. La mappatura è in `docs/agents/triage-labels.md`.

### Domain docs

Un solo contesto in `CONTEXT.md` e `docs/adr/`. Per esplorare o modificare il dominio leggere `docs/agents/domain.md`.

### Conventional commits

Il controllo gira in CI su ogni pull request e copre commit, merge e titolo della PR. Regole, esempi e hook locale facoltativo in `docs/agents/conventional-commits.md`.

### Branch naming

I nomi dei branch seguono Conventional Branch 1.1.0 e sono controllati nello stesso job di CI. Tipi, regole della descrizione ed esempi non validi in `docs/agents/branch-naming.md`.

## Confini

Distinguere file rilevati, ipotesi, dati di esempio e verifiche eseguite. Un risultato AI non è un'evidenza di test. Credenziali e accesso ChatGPT appartengono al componente ufficiale Codex. Le letture del repository escludono segreti e collegamenti simbolici. Il renderer non decide autonomamente gli esiti delle verifiche.
