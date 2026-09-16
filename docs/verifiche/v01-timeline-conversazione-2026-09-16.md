# V01: timeline degli eventi della conversazione

Verifica del 16 settembre 2026 per #64. Base: `main` a `cb20757`. Il candidato aggiunge `ConversationEvent` e `ConversationTimeline` in `TramaCore`, porta il documento allo schema 3 e fa rendere la chat del Coordinatore da `ConversationTimeline.rows`.

## Test automatici

`swift test` sul candidato: 110 test Swift Testing in 13 suite e 96 test XCTest, nessun fallimento.

La suite `Conversation timeline` copre:

- un documento schema 2 scritto a mano nel formato precedente (piano, spiegazione con fonti, analisi fallita, richiesta importata dallo schema 1). Dopo la migrazione la cronologia coincide con quella della vista precedente, scritta come elenco atteso. Richieste, selezione, bozza e modello restano invariati e le richieste che contano come modifiche sono le stesse. Il backup `v2-original.json` coincide byte per byte con l'originale e si decodifica ancora. Alla riapertura la timeline è identica;
- un documento schema 1 migrato direttamente allo schema 3, con il suo backup `v1-original.json`;
- l'invio di una richiesta, che produce l'evento della persona e una riga di risposta in attesa;
- una nuova analisi dello stesso turno, che sostituisce la risposta, e un chiarimento, che apre un turno nuovo;
- il piano modificato dalla persona, che aggiorna il testo della risposta senza spostarla;
- le attività tecniche: aperte mentre il turno è in corso, raccolte in una riga apribile a turno concluso. Durante una nuova analisi l'avanzamento compare sotto le attività;
- le otto schede con tipo, correlazione e ordine, e la codifica e decodifica degli eventi.

I test esistenti di `ProjectDocumentTests` restano verdi. L'unica modifica è la versione attesa dopo la migrazione, ora `ProjectDocument.currentSchemaVersion`.

## Copie di documenti reali

Ho copiato in `/tmp/trama-v01` i due documenti schema 2 salvati sul Mac di sviluppo. I file originali in Application Support non sono stati toccati. Un test temporaneo, non incluso nel commit, ha confrontato la cronologia costruita come faceva la vista precedente con le righe della timeline dopo la migrazione e una riapertura:

```
PROOF a.json: requests 12, rows 24, sameChronology true, requestsEqual true, pactEqual true, mandateEqual true, changeRequests 3->3, backupIdentical true, reopenStable true, schema 3
PROOF b.json: requests 7, rows 14, sameChronology true, requestsEqual true, pactEqual true, mandateEqual true, changeRequests 2->2, backupIdentical true, reopenStable true, schema 3
```

Mappa, Modifiche, Decisioni, Gruppo e Issue leggono `requests`, `pact` e `mandate`, che restano identici dopo la migrazione. Questa è una prova sui dati, non una prova delle schermate.

## Build

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## Limiti

- La prova diretta nell'app non è stata eseguita. Dalla sessione dell'agente `screencapture` risponde «could not create image from display» e non c'è modo di comandare la finestra. Restano da fare a mano: aprire due progetti con documenti precedenti, confrontare la chat, inviare una richiesta, vedere il suo evento, riavviare e ritrovare la stessa timeline. Mappa, Modifiche, Decisioni, Gruppo e Issue vanno controllate sulle stesse schermate.
- Le attività tecniche sono passi registrati da Trama (analisi avviata, risposta ricevuta, analisi interrotta o non completata, modello non disponibile). Gli eventi degli strumenti di Codex arrivano con il thread persistente e gli strumenti dei ticket successivi.
- Il testo in streaming resta in memoria e diventa un evento solo quando la risposta è completa.
- Nessun flusso produce ancora schede. Il modello e la resa ci sono, i produttori arrivano con studio, team, mandato e incarichi.
- Le versioni precedenti dell'app rifiutano lo schema 3 e propongono il recupero. Se la persona lo accetta in una versione precedente, la nuova versione trova un backup che non coincide più con il file e chiede a sua volta il recupero esplicito. Il backup originale resta conservato.
