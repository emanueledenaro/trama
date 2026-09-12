# T08: Eseguire una modifica in un worktree dedicato

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Avviare dal piano una singola sessione Codex isolata, seguirne gli eventi e interromperla conservando il lavoro.

## Dipendenze

[T07](./07-decisioni-patto.md)

## Criteri di accettazione

- [ ] Delegare versioni delle decisioni, perimetro, base e verifiche richieste a un worktree identificabile.
- [ ] Modifiche locali preesistenti nel progetto sorgente restano byte-for-byte intatte; indice e branch originali restano preservati.
- [ ] Approvazioni di comandi, filesystem e rete seguono la politica effettiva del componente. Il worktree non viene presentato come sandbox.
- [ ] Ampliamenti di perimetro o nuove decisioni fermano le operazioni interessate prima della successiva azione non autorizzata.
- [ ] Stop, crash, base avanzata e riavvio mostrano lo stato effettivo; un comando già partito non viene dichiarato annullato senza conferma.
- [ ] Riprendere è un’azione esplicita; pulizia del worktree non elimina lavoro da revisionare o modifiche dell’utente.

## Prova di completamento

Eseguire una piccola modifica, interromperla, riaprire Trama e ritrovare diff e stato della sessione senza cambiamenti nel checkout originale.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
