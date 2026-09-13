# Cronologia del Coordinatore e compatibilità dei documenti

Verifica del 13 settembre 2026 per #33 e #51. Base pubblicata: `481910364ee928db049ddea8bf9ba23ff5c7ce22`. Il candidato conserva i modelli `WorkRequest` e `ProjectDocument` nel nucleo condiviso, aggiunge schema 2 e una cronologia derivata dalle richieste salvate. Streaming e team autonomi appartengono ai ticket successivi.

## Migrazione e isolamento

Prima delle prove sono state conservate copie dei documenti reali di Trama e Negozio. L’app ha migrato rispettivamente 4 e 7 richieste. Il confronto JSON prima/dopo ha trovato invariati richieste, piani, modelli delle richieste, Patto Vivo, versioni delle decisioni, approvazioni e riferimenti ai worktree. Le copie `.v1-original.json` coincidono byte per byte con i documenti precedenti.

Ogni archivio resta identificato dal progetto del catalogo, distinto per cartella. La migrazione salva l’elenco delle richieste importate e non costruisce conversazioni o agenti inesistenti. Il contenuto storico può includere risposte AI, piani modificati dalla persona e messaggi locali: la vista usa l’etichetta neutra «Contenuto salvato della richiesta».

Prova UI: scritte due bozze diverse, prima in Trama e poi in Negozio, senza inviarle. Il secondo progetto non ha ricevuto la bozza del primo. Dopo Esci e riapertura, Negozio ha ripristinato Coordinatore, richiesta selezionata, bozza e modello Terra. Tornando a Trama sono ricomparsi la richiesta selezionata in Modifiche, la sua bozza e il modello Sol. Le sole bozze di prova sono state poi cancellate. Il salvataggio uscente viene ripetuto dopo la lettura asincrona, prima di cambiare l’identità di progetto, per conservare anche eventuali modifiche digitate durante il caricamento.

Il test automatico di due cartelle con lo stesso remote verifica identità separate e ripristino di bozze e selezioni. La prova UI sopra usa due progetti reali distinti; non simula due collaboratori connessi.

## Recupero

I test coprono documento non leggibile, rifiuto di sovrascrittura, copia interrotta e schema futuro. L’originale resta invariato quando la migrazione fallisce. Il recupero esplicito conserva un’ulteriore copia e crea un documento senza richieste, Patto o candidati.

Prova UI eseguita su una cartella di prova separata con schema 99: l’app ha mostrato l’avviso e il comando «Riprendi conservando il file originale». Dopo la scelta, Coordinatore mostrava «Nessuna richiesta registrata». La verifica del file ha confermato schema 2, assenza di richieste, Patto e candidato, e copia originale identica. Nessun documento reale è stato corrotto per questa prova. Non è stato simulato uno spegnimento fisico durante una scrittura.

## Viste esistenti e crash dell’inspector

Verificati direttamente: cronologia importata; apertura della stessa richiesta in Modifiche; piano precedente; worktree, diff e stato delle verifiche pregresse; decisione del Patto Vivo in versione 2; Mappa; modelli distinti per progetto. Le verifiche pregresse da ripetere restano indicate come tali.

Durante questa prova è stato riprodotto il crash #51 passando da Panoramica a File nell’inspector. AppKit interrompeva il processo con `NSGenericException` durante aggiornamenti ripetuti dei vincoli della finestra. Il difetto è stato riprodotto anche nella base pubblicata, compilata in un worktree isolato. Quella versione ha rifiutato correttamente lo schema 2, conservandolo: il suo inspector è stato provato senza richieste caricate. Il difetto non dipende quindi dalla cronologia importata.

La correzione applica l’inspector all’esterno di `NavigationSplitView`, mantenendo intervallo di larghezze, contenuti, comandi e presentazione compatta. Apple documenta entrambe le posizioni dell’inspector; il confronto locale ha verificato che quella esterna evita il ciclo in questa app. [Inspectors in SwiftUI, WWDC23](https://developer.apple.com/videos/play/wwdc2023/10161/).

Dopo la correzione: cinque passaggi fra File, Panoramica e Decisioni su Catalog senza crash; apertura di `Catalogue.swift` e ritorno con Escape; apertura dei file di Orders; finestra affiancata con il comando macOS Move & Resize > Left; riapertura dell’inspector compatto; anteprima di `CancelPaidOrder.swift`; cambio delle tre schede e ritorno con Escape. Modulo, bozza e modello sono rimasti presenti. La cronologia è stata osservata anche nella finestra affiancata, con testo a capo, scorrimento e compositore raggiungibile. Ripristinata poi la dimensione precedente con il comando macOS.

Gli screenshot sono stati osservati durante la prova, senza esportare una raccolta. La verifica non chiude l’intera matrice di dimensioni, temi e VoiceOver dei ticket #21 e #22. Non è stato aggiunto un test unitario di dimensioni costanti: non riprodurrebbe l’eccezione AppKit.

## Controlli

- Base: 80 XCTest e 86 Swift Testing, tutti passati.
- Candidato finale: 85 XCTest e 86 Swift Testing, tutti passati. Cinque nuovi test esercitano il salvataggio usato dall’app.
- Build macOS debug riuscita e usata per le prove dirette.
- Revisione C01: risolti il rischio di perdita della bozza al cambio progetto e l’attribuzione impropria a Codex. Standards e Spec hanno confermato queste correzioni.

La revisione aggiuntiva della correzione #51 si è conclusa senza nuovi finding Standards o Spec. [CI del candidato](https://github.com/emanueledenaro/trama/actions/runs/34769650479) e [CI del merge](https://github.com/emanueledenaro/trama/actions/runs/34769855169) concluse con successo. PR #52 integrata in `cf47ba31bf51097773616a23b2680cb452efb904`; checklist #33 e #51 aggiornate e issue chiuse dopo rilettura. Firma, notarizzazione, altro Mac e comportamento 24/7 restano fuori da questo incremento.
