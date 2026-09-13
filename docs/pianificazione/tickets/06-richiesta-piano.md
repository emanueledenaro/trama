# T06: Passare da un modulo a un piano di Codex

Stato: parzialmente verificato. Ticket ancora aperto.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Selezionare un modulo, formulare una richiesta e ricevere un piano reale associato a quel contesto.

## Dipendenze

[T02](./02-collegare-codex.md), [T04](./04-setup-aihero.md), [T05](./05-mappa-viva.md)

## Criteri di accettazione

- [ ] Richiesta, progetto, modulo, snapshot e riferimenti alle fonti restano associati anche dopo il riavvio.
- [ ] La pianificazione usa lettura soltanto e non modifica file né avvia effetti esterni.
- [ ] Il piano mostra comportamento atteso, moduli coinvolti, limiti, ipotesi aperte e verifiche previste; può essere corretto dall’utente.
- [ ] Streaming, annullamento, limite d’uso, assenza di rete ed errore del modello hanno stati espliciti e non perdono la richiesta.
- [ ] Un cambiamento del repository durante l’analisi rende il piano da rivalutare; un risultato tardivo non sostituisce un piano più recente.
- [ ] Le skill sono selezionate in base al compito; una richiesta semplice non avvia l’intero percorso di sviluppo.

## Prova di completamento

Chiedere una modifica al modulo Ordini e aprire i file che sostengono il piano ottenuto.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.

Prove e criteri residui: [riconciliazione della roadmap](../../verifiche/roadmap-a8d9515.md).
