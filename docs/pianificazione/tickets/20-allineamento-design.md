# T20: Uniformare spazi, allineamenti e gerarchia visiva Apple

Stato: pronto per implementazione. Richiesto dall’utente il 13 settembre 2026.

## Risultato

Le schermate di Trama devono condividere gli stessi criteri di spaziatura, allineamento, tipografia e presentazione delle azioni. L’interfaccia usa controlli e comportamenti nativi Apple e mantiene una gerarchia leggibile tra richiesta, stato, contenuto e azioni.

Base: prima implementazione nativa in #20. Coordinare con il ticket responsive T19. Entrambi precedono la chiusura della verifica completa dell’interfaccia #18.

## Perimetro

Sidebar e toolbar; intestazioni delle sezioni; ricerca e filtri; schede e liste; inspector; editor e moduli; finestre modali; stato di esecuzione, errori, verifiche e azioni di pubblicazione.

## Criteri di accettazione

- [ ] Definire e documentare una scala di spaziatura riutilizzabile, coerente con i controlli di sistema. Sostituire i valori isolati che producono distanze diverse per lo stesso tipo di contenuto.
- [ ] Allineare titoli, testi, icone, campi e pulsanti sulle stesse guide. Verificare margini laterali, spazi tra sezioni e baseline delle righe.
- [ ] Distinguere titolo, sottotitolo, corpo e metadati con gli stili tipografici di sistema. Evitare testo troppo piccolo e conservare leggibilità con contenuti lunghi.
- [ ] Uniformare dimensioni e peso degli SF Symbols, altezza dei campi, forme dei contenitori, separatori e stati dei pulsanti.
- [ ] Rendere coerente la posizione delle azioni principali e secondarie. Conferma e annullamento restano riconoscibili; le etichette dei campi sono visibili anche quando i campi sono compilati.
- [ ] Equilibrare densità delle liste e spazio delle aree di lavoro, senza grandi vuoti accidentali o gruppi troppo compressi.
- [ ] Usare colori e materiali semantici di sistema. Verificare tema chiaro e scuro, aumento del contrasto, riduzione della trasparenza, focus da tastiera e stato disabilitato.
- [ ] Selezione, caricamento, errore, verifica superata e verifica da ripetere hanno una presentazione coerente e comprensibile anche senza il solo colore.
- [ ] Eseguire un controllo visivo comparato di tutte le sezioni e delle finestre modali con dati identici, includendo una finestra stretta e una ampia.

## Aree iniziali del codice

Viste in `Sources/Trama`, con eventuali primitive condivise per layout e presentazione. Conservare i comportamenti di Codex, Patto Vivo e GitHub durante il lavoro visivo.

## Prova di completamento

Consegnare la scala adottata, schermate prima e dopo e un controllo degli allineamenti per ciascuna sezione. Verificare nell’app i temi di sistema e il focus da tastiera; correggere le differenze rilevate prima di chiudere il ticket.
