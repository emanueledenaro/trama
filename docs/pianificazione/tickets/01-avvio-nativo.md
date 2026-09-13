# T01: Aprire Trama e ritrovare un progetto

Stato: parzialmente verificato. Ticket ancora aperto.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Dal doppio clic aprire una finestra macOS, scegliere una cartella o un esempio e ritrovare il progetto al riavvio.

## Dipendenze

Nessuna

## Criteri di accettazione

- [x] App compilabile e avviabile, con sidebar, toolbar, SF Symbols e tema di sistema.
- [ ] Primo avvio, selettore annullato, cartella vuota, cartella spostata e permesso negato hanno stati leggibili.
- [ ] I progetti recenti persistono; il riavvio conserva la selezione senza riavviare agenti.
- [ ] La selezione della cartella legge la struttura senza eseguire script, installare dipendenze o modificare il codice.
- [ ] La navigazione essenziale è utilizzabile da tastiera e ha etichette accessibili.

- [ ] CI macOS minima attiva dal primo incremento, con build e test significativi disponibili. Ogni incremento successivo conserva questi controlli verdi.

## Prova di completamento

Una persona apre un progetto, chiude Trama, la riapre e ritrova quel progetto.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.

Prove e criteri residui: [riconciliazione della roadmap](../../verifiche/roadmap-a8d9515.md).
