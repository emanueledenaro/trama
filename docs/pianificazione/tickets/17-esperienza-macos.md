# T17: Verificare l’intero percorso con l’interfaccia Apple

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Percorrere il prodotto da primo avvio a revisione e avviso del gruppo con UI accessibile e stati coerenti.

## Dipendenze

[T04](./04-setup-aihero.md), [T10](./10-nuovo-progetto.md), [T11](./11-issue-pull-request.md), [T16](./16-background-ripresa.md)

Ulteriori prerequisiti: [T19 responsive](./19-responsive-macos.md) e [T20 allineamento design](./20-allineamento-design.md), richiesti il 13 settembre 2026.

## Criteri di accettazione

- [ ] Verificare dal doppio clic accesso, collegamenti, apertura/creazione, mappa, richiesta, decisione, esecuzione, revisione e ritorno al progetto.
- [ ] Sidebar, toolbar, inspector, finestre, selettori e menu sono nativi; l’immagine iniziale ispira la composizione, il design Apple guida i controlli.
- [ ] Tema chiaro/scuro, Riduci movimento, contrasto, navigazione completa da tastiera e VoiceOver: la vista ad albero offre un’alternativa alla mappa.
- [ ] Stati vuoto, caricamento, parziale, errore, offline e ripristino verificati su finestre ridimensionate, senza controlli nascosti.
- [ ] Nessun suono per token, lettura di file o test. Un suono discreto facoltativo accompagna solo avvisi utili, con preferenze persistenti e rispetto delle impostazioni di notifica.
- [ ] Misurare reattività su fixture da 100, 1000 e 10000 file; UI utilizzabile durante indice e analisi, limiti espliciti e risultati documentati.

## Prova di completamento

Registrare il percorso completo e verificare gli stessi comandi con sola tastiera e VoiceOver.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
