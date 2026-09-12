# Verifiche locali del 13 settembre 2026

## App nativa

Prove effettuate nella finestra macOS di Trama, con il progetto di esempio copiato dall’app in una cartella gestita:

1. Avvio, riapertura del progetto e ripristino della selezione.
2. Mappa con 7 moduli e 12 file, vista ad albero e lettura dei sorgenti.
3. Account ChatGPT esistente riconosciuto senza un nuovo login.
4. Piano reale di Codex, restituito con schema strutturato e riferimenti ai file dell’esempio.
5. Revisione di passi, comportamento, esempio e perimetro nella schermata nativa.
6. Esecuzione in un worktree dedicato. Codex ha aggiunto il controllo sullo stato dell’ordine e il test della seconda chiamata.
7. Due test dell’esempio superati dal verificatore di Trama, con uscita 0 e snapshot invariato.
8. Stato `Revisionato localmente` registrato dall’interfaccia.
9. Modifica temporanea del candidato: Trama ha revocato la revisione e mostrato `Da rivalutare` e `Verifiche precedenti: da ripetere`.
10. Ripristino dei byte originali del candidato, nuova esecuzione dei test e nuova revisione locale riusciti.

Lo snapshot finale verificato è `dcaddd87d7b591413dcc7a2d5dd33f8a769558c66af54e15f211a030230922d6`. Il sorgente originale dell’esempio non ha modifiche nei file `Sources` e `Tests`.

Il percorso ha fatto emergere due difetti corretti: l’esclusione di una directory dopo un file nascosto nello scanner e la creazione di temporanei Swift nella radice del candidato. La suite include regressioni per entrambi. I temporanei della prima prova sono stati conservati nella cache del worktree.

## GitHub nell’interfaccia

La lettura autenticata del repository pubblico Trama ha mostrato il branch `main`, il commit iniziale, l’assenza di check su quel commit e le 18 issue operative più la specifica. Le attività GitHub rimangono distinte dalle verifiche del candidato locale.

## Componenti e suite

La suite completa precedente all’ultima correzione del filtro `.swiftpm` comprendeva 63 test XCTest e 86 test Swift Testing, tutti superati. La correzione successiva mantiene nel candidato le configurazioni SwiftPM e dispone di una regressione mirata superata. La CI sul commit pubblicato è il riferimento per il risultato finale.

Le prove comprendono anche una vera esecuzione SwiftPM nella sandbox, senza `.gitignore`: uscita 0 e snapshot prima e dopo invariato. Le scritture su un file adiacente e le connessioni loopback sono negate nella sandbox. I test Git controllano che indici, riferimenti e file originali siano conservati.

## Prove ancora da eseguire

- Registrazione del monitor tramite macOS e comportamento dopo logout, sospensione e riavvio.
- Notifiche autorizzate o negate sul servizio registrato.
- VoiceOver completo e misure su repository di grandi dimensioni.
- Firma Developer ID, notarizzazione e installazione su un secondo Mac.

Il monitor non è stato abilitato sul Mac di sviluppo durante queste prove.
