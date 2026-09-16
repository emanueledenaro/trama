# Trama

App macOS nativa in SwiftUI. Il motore AI è Codex App Server di OpenAI. Seguire i controlli e i materiali di sistema Apple.

## Humanizer

Scrivere in italiano semplice. Conservare fatti e significato. Usare frasi dirette, senza em dash, en dash, enfasi promozionale o chiusure da chatbot. Humanizer si applica a risposte, commenti, commit, PR e documenti.

## Lingua del codice

Il codice sorgente è in inglese: nomi di tipi, funzioni, proprietà, test, commenti tecnici, errori tecnici, messaggi di log e testi dei commit. I messaggi di commit usano verbi inglesi e descrivono il cambiamento in modo concreto.

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
