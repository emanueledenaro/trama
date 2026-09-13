# Risposte e perimetro: verifica del 13 settembre 2026

Correzioni collegate ai casi segnalati nei ticket #7 e #9.

## Richiesta senza un obiettivo operativo

Prima della correzione, la richiesta `ciao` nel progetto di esempio aveva prodotto un piano sugli ordini, ricavato da una decisione precedente. La risposta è stata conservata prima della nuova prova.

Nella build QA, la stessa richiesta rielaborata con il modello reale ha prodotto `Richiesta da chiarire` e una domanda sull’obiettivo. La finestra mostra un campo per rispondere e non offre l’avvio di modifiche. Nei dati persistiti, `replyKind` è `clarification`; proposta e sessione sono assenti.

## Risposta al chiarimento

È stata chiesta una spiegazione di `requestReview`, senza modificare file. La risposta reale ha:

- mantenuto la stessa identità della richiesta e conservato il saluto originale nel contesto;
- prodotto `Risposta disponibile`, con `replyKind` uguale a `explanation`;
- citato quattro file nella sezione Fonti consultate; la fonte principale è stata aperta nell’app;
- descritto correttamente la differenza tra il codice attuale e la decisione sull’idempotenza;
- lasciato assenti proposta e sessione di modifica.

L’hash canonico del Patto Vivo prima e dopo il chiarimento è identico. Il chiarimento non ha quindi registrato una nuova decisione.

## Perimetro proposto dal modello

Da una nuova richiesta nel contesto Orders è stato chiesto un piano con perimetro proposto `project`, per verificare il caso che prima nascondeva il controllo.

La conferma mostra Intero progetto selezionato. Deselezionandolo, senza altri moduli scelti, Conferma e avvia diventa disabilitato. Selezionando Orders, la conferma torna disponibile e Intero progetto resta deselezionato. La prova termina con Annulla: non è stata avviata una nuova modifica.

## Verifiche del codice

Quattro test dedicati controllano chiarimento senza proposta, spiegazione con fonti note, rifiuto di proposte o approvazioni nascoste e validazione del piano sullo snapshot. Il primo test è stato eseguito prima dell’implementazione e risultava rosso.

La suite completa eseguita durante il lavoro ha superato 67 test XCTest e 86 test Swift Testing. La revisione separata di convenzioni e requisiti ha individuato un caso durante il setup: l’invio del chiarimento ora è bloccato prima di modificare la richiesta, sia nel metodo sia nel pulsante.

I [dati della prova](risposte-e-perimetro-2026-09-13.json) distinguono risposta, proposta, sessione e Patto Vivo. Queste prove non chiudono gli altri criteri dei ticket #7 e #9.
