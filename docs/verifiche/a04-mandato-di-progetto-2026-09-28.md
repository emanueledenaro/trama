# A04: mandato di progetto per tutto il ciclo, con divieti fissi

Data: 28 settembre 2026. Issue #244, specifica #239 (Q8, Q1), ADR 0017. Base: `origin/main` 2b91dd3.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di un provider.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 119 file, 1139 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: vedi la pull request per l'esito dell'ultima corsa. Passi nuovi: `26a-project-mandate`, `26b-mandate-restrict`, `26c-mandate-restricted`, `26d-fixed-ban`, ognuno con Codex e Claude, in chiaro e in scuro.

## Comportamento

- All'apertura di un progetto senza mandato in vigore e senza richieste in attesa, Trama mette in "Aspetta te" la proposta del mandato di progetto per conto del Coordinatore: tutti i moduli, tutte le azioni delegabili, per tutto il ciclo. È una regola di Trama, senza un turno del modello. Il progetto di esempio non la riceve.
- Con un mandato concesso non arriva nessuna proposta. Dopo un rifiuto Trama non la ripropone a ogni apertura: torna solo dopo che un nuovo mandato viene revocato.
- Un mandato scritto dalla persona nella vista Mandato risponde anche alla proposta in attesa.
- La scheda del mandato, in chat, in "Aspetta te" e nella vista Mandato, elenca i sei divieti fissi come sempre esclusi, senza un controllo per attivarli.
- La vista Mandato ha la sezione "Restringi il mandato": la persona toglie moduli o azioni, il mandato resta in vigore, nasce una nuova versione con la versione precedente nella cronologia. Il Coordinatore riceve un messaggio con quello che è stato tolto e legge la nuova versione dal turno successivo. Una restrizione non può allargare il mandato né togliere tutto.
- Divieti fissi: force push, push diretto sul branch principale, cancellazione di branch o tag remoti, creazione di tag o rilasci, letture o scritture di segreti e credenziali, modifiche alle impostazioni del repository. Valgono per ogni mandato, anche per quelli concessi prima, senza migrazione: la lista sta nel codice (`app/src/shared/fixedBans.ts`), non nei dati del mandato.
- Dove Trama li applica:
  - Claude, per il Coordinatore e per gli specialisti: la decisione sui permessi rifiuta il comando o il file prima che parta.
  - Provider ACP (Cursor, Grok, Droid, Devin): la richiesta di permesso e le letture e scritture dirette di file vietati vengono rifiutate.
  - Codex: Codex esegue i comandi nel suo sandbox senza chiedere il permesso. Trama riconosce il comando vietato quando parte e interrompe subito il turno. Il sandbox di Codex è senza rete, quindi le azioni remote falliscono comunque.
  - Push di Trama: né `pushBranch` né la pubblicazione di un candidato spingono sul branch principale del progetto, su main o su master.
- Ogni rifiuto diventa una voce "Azione vietata" di "Aspetta te" con il divieto, chi l'ha chiesta e il comando o il file, e una riga in Attività. La voce resta finché la persona preme "Ho visto".
- Il Coordinatore legge i divieti fissi a ogni turno nello stato di Trama.

## Test

- `app/src/shared/fixedBans.test.ts`: ogni divieto con più forme del comando (`git -C`, `bash -lc`, catene con `&&`, `gh api`), i file di segreti e i comandi ordinari che restano permessi.
- `app/src/main/core/projectMandate.test.ts`: proposta all'apertura e nessuna proposta con un mandato concesso, dopo un rifiuto o senza moduli; restrizione con nuova versione e cronologia, messaggio al Coordinatore, rifiuto di allargare o di togliere tutto; voci di "Aspetta te" per i rifiuti; mandato concesso prima senza migrazione.
- `app/src/main/core/providers/claudeAgent.test.ts`, `acp/acpRuntime.test.ts`, `codexClient.test.ts`, `push.test.ts`: il divieto in ogni punto di applicazione.
- `app/src/main/controller.test.ts`: proposta all'apertura e non dopo la concessione; restrizione dal controller; comando vietato del Coordinatore che interrompe il turno e crea la voce di "Aspetta te".

## Schermate

Prima (`origin/main` f18bb07) e dopo, con Codex, in chiaro e in scuro: `a04-mandato-di-progetto/`.

## Limiti

- Con Codex il comando vietato è già partito quando Trama lo vede: Trama ferma il turno subito, ma non lo può rifiutare prima dell'avvio senza cambiare la politica di approvazione di Codex.
- OpenCode, Pi e Antigravity non eseguono comandi in Trama. Per le letture OpenCode blocca i file `.env`; gli altri file di segreti su questi provider restano coperti solo dal perimetro di lettura.
- Il riconoscimento dei comandi è per regole: un comando scritto in modo insolito, per esempio dentro uno script eseguito dopo, non viene riconosciuto.
- Una restrizione non ferma i turni in corso: finiscono come sono, e il lavoro fuori dal mandato ristretto non riparte.
