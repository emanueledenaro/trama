# Trama

App desktop in Electron (`app/`), con l'interfaccia di Synara: seguire i token, le misure e i componenti in `app/src/renderer` (ADR 0011). Il motore AI è Codex App Server di OpenAI. I sorgenti SwiftUI sono stati rimossi e restano nella cronologia git.

## Humanizer

Scrivere in italiano semplice. Conservare fatti e significato. Usare frasi dirette, senza em dash, en dash, enfasi promozionale o chiusure da chatbot. Humanizer si applica a risposte, commenti, commit, PR e documenti.

## Lingua del codice

Il codice sorgente è in inglese: nomi di tipi, funzioni, proprietà, test, commenti tecnici, errori tecnici, messaggi di log e testi dei commit. I messaggi di commit usano verbi inglesi e descrivono il cambiamento in modo concreto.

## Commit e branch

I messaggi di commit seguono [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<tipo>[ambito opzionale]: <descrizione>`, per esempio `feat(app): add the search palette` o `fix(app): guard reveal paths`. Tipi usati: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`, `revert`. Una modifica incompatibile usa `!` dopo il tipo o il footer `BREAKING CHANGE:`.

I nomi dei branch usano un prefisso per il tipo di lavoro:

- `feature/<descrizione-breve>` per nuove funzioni;
- `bugfix/<descrizione-breve>` per correzioni ordinarie;
- `hotfix/<descrizione-breve>` per correzioni urgenti da portare subito su `main`.

La descrizione è in inglese, minuscola, con parole separate da trattini, per esempio `feature/electron-app`.

L'interfaccia dell'app, la documentazione di prodotto, le issue, le pull request e le comunicazioni con la persona restano in italiano, salvo quando un termine tecnico o una fonte richiedono l'inglese. Non tradurre retroattivamente dati persistiti, contenuti storici, nomi di API esterne o testo già pubblicato soltanto per applicare questa regola.

## Agent skills

### Issue tracker

Le attività sono GitHub Issues di `emanueledenaro/trama`. Leggere `docs/agents/issue-tracker.md` prima di gestire attività remote.

### Triage labels

Le skill usano il vocabolario predefinito. La mappatura è in `docs/agents/triage-labels.md`.

### Domain docs

Un solo contesto in `CONTEXT.md` e `docs/adr/`. Per esplorare o modificare il dominio leggere `docs/agents/domain.md`.

## Confini

Distinguere file rilevati, ipotesi, dati di esempio e verifiche eseguite. Un risultato AI non è un'evidenza di test. Credenziali e accesso ChatGPT appartengono al componente ufficiale Codex. Le letture del repository escludono segreti e collegamenti simbolici. Il renderer non decide autonomamente gli esiti delle verifiche.
