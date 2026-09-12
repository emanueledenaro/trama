# Revisione dell’implementazione iniziale

La revisione è partita dalla patch rispetto a `d492830`, il commit iniziale della documentazione. Due agenti hanno esaminato separatamente convenzioni e requisiti. Il codice successivo è stato ricontrollato sui problemi segnalati.

## Convenzioni e correttezza dello stato

Tre problemi corretti e ricontrollati staticamente:

- Il piano poteva acquisire versioni nuove delle decisioni senza essere rielaborato. Le versioni vengono ora confrontate prima di registrare la conferma; modificare una decisione invalida lo stato delle richieste.
- Un setup ritardato del progetto precedente poteva lasciare disabilitata la pianificazione. Caricamento, setup e cleanup sono ora collegati a identificativi delle rispettive operazioni.
- Il cambio di identità del progetto prima di una sospensione poteva salvare un documento con l’identità sbagliata. Identità, progetto e documento vengono ora aggiornati dopo l’ultima attesa del catalogo.

Lo stato delle richieste usa ancora stringhe condivise tra più viste. Una macchina a stati tipizzata resta un miglioramento strutturale da valutare quando si estendono le transizioni.

## Rispondenza ai requisiti

La revisione ha rilevato quattro lacune:

- Mancavano commit, review e check: sono stati aggiunti all’API e alla vista delle attività GitHub.
- Mancava il polling condizionale: l’API ora conserva ETag e gestisce anche il codice di uscita nonzero con cui `gh api` restituisce HTTP 304.
- Il processo in background conservava solo le novità: ora prepara una notifica aggregata dopo nuovi eventi, se macOS la consente e l’app principale non è in esecuzione. La prova del servizio registrato resta da eseguire.
- Un poll poteva durare più del lease: la snapshot ha ora una scadenza complessiva inferiore a quella del lease; la lettura dell’account avviene prima di acquisirlo.

Queste correzioni non chiudono automaticamente i ticket. La matrice di accettazione resta in [stato-beta.md](stato-beta.md).

## Verifiche nell’app

La prova nativa ha rilevato un errore non coperto dai primi test dello scanner: chiamare `skipDescendants()` su `.gitignore` saltava la cartella `Sources` successiva. La regressione è stata riprodotta e corretta. L’app mostra ora i 7 moduli e i 12 file dell’esempio.

Gli hash di README e CONTEXT, quando sono file regolari sicuri nella radice, partecipano all’invalidazione del piano anche nei progetti senza sorgenti.
