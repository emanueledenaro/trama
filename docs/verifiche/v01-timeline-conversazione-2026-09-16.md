# V01: timeline degli eventi della conversazione

Verifica del 16 settembre 2026 per #64. Base: `main` a `cb20757`. Il candidato aggiunge `ConversationEvent` e `ConversationTimeline` in `TramaCore`, porta il documento allo schema 3 e fa rendere la chat del Coordinatore da `ConversationTimeline.rows`.

## Test automatici

`swift test` sul candidato: 113 test Swift Testing in 13 suite e 96 test XCTest, nessun fallimento.

La suite `Conversation timeline` copre:

- un documento schema 2 scritto a mano nel formato precedente (piano, spiegazione con fonti, analisi fallita, richiesta importata dallo schema 1). Dopo la migrazione la cronologia coincide con quella della vista precedente, scritta come elenco atteso. Richieste, selezione, bozza e modello restano invariati e le richieste che contano come modifiche sono le stesse. Il backup `v2-original.json` coincide byte per byte con l'originale e si decodifica ancora. Alla riapertura la timeline è identica;
- un documento schema 1 migrato direttamente allo schema 3, con il suo backup `v1-original.json`;
- l'invio di una richiesta, che produce l'evento della persona e una riga di risposta in attesa;
- una nuova analisi dello stesso turno, che sostituisce la risposta, e un chiarimento, che apre un turno nuovo;
- il piano modificato dalla persona, che aggiorna il testo della risposta senza spostarla;
- le attività tecniche. Il gruppo parte dal messaggio della persona e raccoglie tutte le attività del turno, mentre schede e risposte restano fuori. Un turno in corso non si raccoglie mai. La durata va dalla prima attività alla fine della risposta; senza risposta la durata manca e la riga si chiama «Dettagli». Il formato è in millisecondi sotto il secondo, con un decimale sotto i dieci secondi, in secondi interi sotto il minuto, poi «Xm Ys»;
- le otto schede con tipo, correlazione e ordine, e la codifica e decodifica degli eventi.

I test esistenti di `ProjectDocumentTests` restano verdi. L'unica modifica è la versione attesa dopo la migrazione, ora `ProjectDocument.currentSchemaVersion`.

## Copie di documenti reali, senza app

Ho copiato in `/tmp/trama-v01` i due documenti schema 2 salvati sul Mac di sviluppo, senza toccare gli originali. Un test temporaneo, non incluso nel commit, ha confrontato la cronologia costruita come faceva la vista precedente con le righe della timeline dopo la migrazione e una riapertura:

```
PROOF a.json: requests 12, rows 24, sameChronology true, requestsEqual true, pactEqual true, mandateEqual true, changeRequests 3->3, backupIdentical true, reopenStable true, schema 3
PROOF b.json: requests 7, rows 14, sameChronology true, requestsEqual true, pactEqual true, mandateEqual true, changeRequests 2->2, backupIdentical true, reopenStable true, schema 3
```

## Prova nell'app

L'app è stata compilata dal branch e avviata con `CFFIXED_USER_HOME=/tmp/trama-home`. Quella home conteneva una copia dei dati di Trama del Mac (documenti dei progetti, esempio Negozio e catalogo). Il catalogo copiato puntava a un clone del branch in `/tmp/trama-proof/trama`. I documenti e il checkout principale non sono stati toccati. L'accesso a Codex è quello reale dell'account ChatGPT del Mac.

Il sistema non concede a questa sessione la registrazione dello schermo, per cui `screencapture` risponde «could not create image from display». Non concede nemmeno l'accesso di assistenza: `osascript` risponde «non ammette l'accesso di assistenza» (-1728). Per questo un aggancio temporaneo, rimosso prima del commit, ha pilotato lo store e catturato la finestra con `NSView.cacheDisplay`. In quella cattura la barra laterale e i pulsanti della barra in alto risultano bianchi, perché i materiali traslucidi di sistema non vengono disegnati.

Esiti:

1. Il progetto trama (documento schema 2, 12 richieste) si apre migrato allo schema 3. La chat mostra 24 righe, uguali per ordine e testo alla cronologia ricavata dal backup `v2-original.json`. Il backup coincide con il file prima dell'apertura (SHA-256 `ce2cb53507d970f4…`). [01](v01/01-trama-migrated-chat.png)
2. Mappa, Modifiche, Decisioni, Gruppo e Issue funzionano sullo stesso documento migrato. [02](v01/02-trama-mappa.png) [03](v01/03-trama-modifiche.png) [04](v01/04-trama-decisioni.png) [05](v01/05-trama-gruppo.png) [06](v01/06-trama-issue.png)
3. Richiesta inviata a Codex (`gpt-5.6-luna`, sola lettura). Durante il turno l'evento della persona compare subito, l'attività «Analisi avviata» è elencata senza raccoglitore e la risposta è in attesa. [07](v01/07-trama-turn-running.png)
4. A turno concluso le attività sono in una riga chiusa, «Ha lavorato per 12 s», e la risposta segue con stato «Risposta disponibile». [08](v01/08-trama-turn-concluded-closed.png) Aperta, la riga mostra «Analisi avviata» e «Risposta ricevuta». [09](v01/09-trama-turn-concluded-open.png)
5. Il progetto Negozio (documento schema 2, 7 richieste) si apre migrato. Le 14 righe coincidono con la cronologia del suo backup (SHA-256 `4ab9434ce272e2d2…`, uguale al file prima dell'apertura). Restano visibili l'etichetta delle richieste importate e le azioni del piano proposto. [10](v01/10-negozio-migrated-chat.png)
6. Dopo l'uscita e un nuovo avvio, trama mostra le stesse 27 righe con gli stessi identificativi, compresa la riga delle attività con la sua durata. Il confronto dei due elenchi di righe non ha differenze. [21](v01/21-restart-trama-chat-activities-open.png)

Le richieste precedenti appaiono «Da rivalutare» perché il clone ha un'istantanea diversa da quella registrata. È il comportamento esistente dell'app. Durante la prova la sezione Gruppo ha avviato da sola la valutazione di impatto di #74, in sola lettura.

## Build

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## Limiti

- Le attività tecniche sono passi registrati da Trama (analisi avviata, risposta ricevuta, analisi interrotta o non completata, modello non disponibile). Gli eventi degli strumenti di Codex arrivano con il thread persistente e gli strumenti dei ticket successivi. Non esistono ancora testi intermedi del Coordinatore da raccogliere nel gruppo.
- Il testo in streaming resta in memoria e diventa un evento solo quando la risposta è completa.
- Nessun flusso produce ancora schede. Il modello e la resa ci sono, i produttori arrivano con studio, team, mandato e incarichi. L'avviso di contesto è una scheda del metodo richiesta dal ticket. Gli eventi di uso del contesto non esistono ancora e non diventano righe.
- Il gruppo delle attività sta nella posizione della prima attività del turno, prima della risposta. Se una nuova analisi riparte dopo la risposta, durante l'esecuzione le nuove attività compaiono sotto la risposta precedente. A turno concluso la risposta passa in fondo.
- Lo stato aperto o chiuso di ogni riga vive nella vista: si riapre chiuso quando si cambia progetto o si riavvia.
- Nella prova, l'attività «Risposta ricevuta» riporta «1 fonti». Il plurale è stato corretto in «1 fonte» dopo la prova; l'evento già salvato conserva il testo di allora.
- Le versioni precedenti dell'app rifiutano lo schema 3 e propongono il recupero. Se la persona lo accetta in una versione precedente, la nuova versione trova un backup che non coincide più con il file e chiede a sua volta il recupero esplicito. Il backup originale resta conservato.
