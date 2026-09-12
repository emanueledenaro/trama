# T05: Esplorare una mappa collegata ai file reali

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Navigare dalla mappa al file e vedere la struttura aggiornarsi quando il progetto cambia localmente.

## Dipendenze

[T01](./01-avvio-nativo.md)

## Criteri di accettazione

- [ ] Raggruppamento strutturale funzionante su cartelle; primo supporto semantico limitato e dichiarato per SwiftPM. Altri linguaggi mantengono l’esplorazione dei file senza promesse di analisi completa.
- [ ] Ogni modulo ha riferimenti verificabili a file reali; descrizioni dedotte e relazioni non risolte sono distinguibili dai fatti rilevati.
- [ ] Vista ad albero equivalente, ricerca, selezione, percorso di risalita e anteprima del codice sono utilizzabili.
- [ ] Aggiunta, rinomina e rimozione di file aggiornano la mappa; una lettura precedente non può sovrascrivere lo snapshot più recente.
- [ ] Segreti, file esclusi, symlink verso altri percorsi e traversal non entrano nell’indice o nel contesto inviato a Codex.
- [ ] File grandi, repository oltre i limiti dichiarati, file non UTF-8 e accesso negato producono analisi parziale esplicita.

## Prova di completamento

Modificare e rinominare un file con l’editor e vedere mappa, ricerca e riferimenti aggiornati senza riaprire il progetto.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
