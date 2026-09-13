# Raccordo della roadmap con il Coordinatore

Base pubblicata: `ad38e76`. L’elenco e i commenti di tutte le 22 issue sono stati riletti. Questa è una riconciliazione di prove già documentate, non una nuova esecuzione di test o prova UI.

[CI della base verificata](https://github.com/emanueledenaro/trama/actions/runs/34757062920). Le modifiche di design locali non sono comprese in questa CI.

Gli stati indicano: verificato nelle prove pregresse, parziale oppure da verificare. I riferimenti di ticket accompagnano ogni criterio ma non dimostrano automaticamente tutte le sue parti. Gli incrementi del Coordinatore dovranno ripetere le regressioni coinvolte.

## #1: specifica

Il piano iniziale è conservato nella storia e in un documento locale dedicato. La specifica documentale comprende Coordinatore e tutorial approvati. Pubblicazione GitHub: verificata. La specifica resta aperta fino alla verifica complessiva.

## #2: T01: Aprire Trama e ritrovare un progetto

Restano annullamento del selettore, cartella vuota/spostata, permesso negato e percorso completo da tastiera. I progetti persistono, ma la chat e il runtime multiprogetto non sono ancora implementati.

Nuovo percorso: Verificare guida facoltativa e ritorno al Coordinatore, conservando recenti, selezione e documenti legacy. Cambiare progetto non deve interrompere gli incarichi già autorizzati della nuova architettura.

Ticket collegati: [#33](https://github.com/emanueledenaro/trama/issues/33), [#39](https://github.com/emanueledenaro/trama/issues/39), [#44](https://github.com/emanueledenaro/trama/issues/44).

Fonti esaminate: [docs/verifiche/riavvio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/riavvio-2026-09-13.md), [docs/verifiche/responsive-secondo-passaggio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/responsive-secondo-passaggio-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | App compilabile e avviabile, con sidebar, toolbar, SF Symbols e tema di sistema. | Verificato nelle prove pregresse; da preservare |
| C2 | Primo avvio, selettore annullato, cartella vuota, cartella spostata e permesso negato hanno stati leggibili. | Da verificare nel perimetro completo |
| C3 | I progetti recenti persistono; il riavvio conserva la selezione senza riavviare agenti. | Verificato nelle prove pregresse; da preservare |
| C4 | La selezione della cartella legge la struttura senza eseguire script, installare dipendenze o modificare il codice. | Da verificare nel perimetro completo |
| C5 | La navigazione essenziale è utilizzabile da tastiera e ha etichette accessibili. | Da verificare nel perimetro completo |
| C6 | CI macOS minima attiva dal primo incremento, con build e test significativi disponibili. Ogni incremento successivo conserva questi controlli verdi. | Parziale |

## #3: T02: Riconoscere e collegare Codex di OpenAI

Account esistente e turni reali documentati; restano accesso assente/scaduto/annullato, account differente e percorso su Mac senza componente. I thread attuali non dimostrano una chat persistente.

Nuovo percorso: Collegare streaming, errori e ripresa della chat al componente ufficiale e verificare capacità reali di ogni modello. La guida riconosce o ripara il componente senza copiare credenziali.

Ticket collegati: [#34](https://github.com/emanueledenaro/trama/issues/34), [#43](https://github.com/emanueledenaro/trama/issues/43), [#44](https://github.com/emanueledenaro/trama/issues/44).

Fonti esaminate: [docs/codex-integration.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/codex-integration.md), [docs/verifiche/selezione-modelli-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/selezione-modelli-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Versione del componente ufficiale rilevata e protocollo verificato; provider OpenAI esplicito per il processo di Trama. | Verificato nelle prove pregresse; da preservare |
| C2 | account/read precede il login: un account disponibile viene riconosciuto senza ripetere OAuth o copiare token. | Verificato nelle prove pregresse; da preservare |
| C3 | Accesso assente, scaduto, annullato, account differente e API key hanno stati distinti; nessun passaggio automatico alla fatturazione API. | Da verificare nel perimetro completo |
| C4 | Motore assente o incompatibile produce un percorso di installazione/riparazione documentato. Il componente viene distribuito solo dopo verifica di licenza e aggiornamenti. | Da verificare nel perimetro completo |
| C5 | Timeout, risposta malformata e uscita del processo terminano la richiesta pendente senza lasciare un falso stato connesso. | Da verificare nel perimetro completo |
| C6 | Una sessione controllata restituisce una risposta minima reale in sola lettura; la pianificazione collegata alle fonti appartiene a T06. | Parziale |

## #4: T03: Riconoscere GitHub e verificare le operazioni disponibili

L'adapter GitHub e alcune letture reali sono presenti; la matrice completa di capacità e permessi dei collegamenti Codex resta distinta dal login di gh e non è completata.

Nuovo percorso: Mostrare nella guida e nella chat le capacità GitHub effettive, i prerequisiti mancanti e le fonti usate dal monitor; nessun nuovo collegamento dedotto dal solo login ChatGPT.

Ticket collegati: [#40](https://github.com/emanueledenaro/trama/issues/40), [#42](https://github.com/emanueledenaro/trama/issues/42), [#44](https://github.com/emanueledenaro/trama/issues/44).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md), [docs/verifiche/trama-su-trama-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/trama-su-trama-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Scoprire collegamenti installati, accessibili, abilitati e utilizzabili; non dedurre questi stati dal login di gh o da un remote Git. | Da verificare nel perimetro completo |
| C2 | Aprire il collegamento ufficiale restituito dal componente, poi rileggere lo stato al ritorno dal browser; cancellazione e riconnessione restano recuperabili. | Da verificare nel perimetro completo |
| C3 | Verificare su un repository di prova lettura di branch, commit, diff, PR, review, issue e check; documentare per ogni operazione quale interfaccia la espone. | Da verificare nel perimetro completo |
| C4 | Se il collegamento non espone i dati strutturati necessari al monitoraggio, completare un adapter GitHub autorizzato oppure dichiarare quella capacità non disponibile. Il solo login non chiude il ticket. | Da verificare nel perimetro completo |
| C5 | Repository privato non accessibile, SSO richiesto, API limitata e connessione revocata non vengono interpretati come repository eliminato. | Da verificare nel perimetro completo |
| C6 | I servizi aggiuntivi vengono consigliati solo quando pertinenti al progetto e con il beneficio spiegato. | Da verificare nel perimetro completo |

## #5: T04: Preparare automaticamente il metodo AI Hero

Bundle versionato, setup conservativo e riconoscimento delle skill sono documentati; manca il percorso completo di incompatibilità, aggiornamento e rollback offline.

Nuovo percorso: Preparare il metodo automaticamente dopo la scelta del progetto anche con GitHub rimandato. Le pratiche del team aggiornano solo parti gestite e reversibili senza sovrascrivere regole o controlli.

Ticket collegati: [#44](https://github.com/emanueledenaro/trama/issues/44), [#45](https://github.com/emanueledenaro/trama/issues/45), [#47](https://github.com/emanueledenaro/trama/issues/47).

Fonti esaminate: [docs/design-system.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/design-system.md), [docs/verifiche/risposte-e-perimetro-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/risposte-e-perimetro-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Usare un insieme versionato delle skill Matt Pocock, con provenienza, licenza MIT, attribuzione e versione consultabili. | Da verificare nel perimetro completo |
| C2 | Rilevare repository, tracker, etichette e documentazione esistenti; configurare solo ciò che manca con impostazioni di Trama dichiarate e reversibili. | Da verificare nel perimetro completo |
| C3 | Il secondo avvio non duplica file o sezioni. Personalizzazioni preesistenti sono preservate; ogni aggiunta gestita è riconoscibile nel diff. | Da verificare nel perimetro completo |
| C4 | Una configurazione incompatibile richiede una decisione mirata. Non sovrascrivere regole per riuscire a mostrare setup completato. | Da verificare nel perimetro completo |
| C5 | Distinguere mappatura delle etichette dalla loro esistenza remota; creare etichette solo nel perimetro autorizzato del progetto. | Da verificare nel perimetro completo |
| C6 | Con pacchetto locale disponibile il setup funziona offline; aggiornamento fallito conserva la versione funzionante e permette rollback. | Da verificare nel perimetro completo |
| C7 | Confermare con il catalogo skill di Codex che le skill richieste siano caricate. Il setup automatico non esegue tutte le skill. | Da verificare nel perimetro completo |
| C8 | Il setup locale si completa con GitHub non collegato; le sole operazioni remote restano in attesa senza segnare fallito il setup locale. | Da verificare nel perimetro completo |

## #6: T05: Esplorare una mappa collegata ai file reali

Mappa, albero e fonti provati in alcuni percorsi; restano variazioni della struttura, limiti, accesso negato e matrice di navigazione completa.

Nuovo percorso: Dalla chat e dal tutorial aprire modulo e fonte reale e tornare al messaggio senza perdere query o selezione; nessuna descrizione AI diventa una relazione verificata.

Ticket collegati: [#34](https://github.com/emanueledenaro/trama/issues/34), [#45](https://github.com/emanueledenaro/trama/issues/45).

Fonti esaminate: [docs/verifiche/responsive-primo-passaggio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/responsive-primo-passaggio-2026-09-13.md), [docs/verifiche/trama-su-trama-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/trama-su-trama-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Raggruppamento strutturale funzionante su cartelle; primo supporto semantico limitato e dichiarato per SwiftPM. Altri linguaggi mantengono l’esplorazione dei file senza promesse di analisi completa. | Da verificare nel perimetro completo |
| C2 | Ogni modulo ha riferimenti verificabili a file reali; descrizioni dedotte e relazioni non risolte sono distinguibili dai fatti rilevati. | Da verificare nel perimetro completo |
| C3 | Vista ad albero equivalente, ricerca, selezione, percorso di risalita e anteprima del codice sono utilizzabili. | Da verificare nel perimetro completo |
| C4 | Aggiunta, rinomina e rimozione di file aggiornano la mappa; una lettura precedente non può sovrascrivere lo snapshot più recente. | Da verificare nel perimetro completo |
| C5 | Segreti, file esclusi, symlink verso altri percorsi e traversal non entrano nell’indice o nel contesto inviato a Codex. | Da verificare nel perimetro completo |
| C6 | File grandi, repository oltre i limiti dichiarati, file non UTF-8 e accesso negato producono analisi parziale esplicita. | Da verificare nel perimetro completo |

## #7: T06: Passare da un modulo a un piano di Codex

Spiegazioni e saluti distinti dai piani eseguibili, fonti e persistenza provati. Restano errori/limiti, risposte tardive e modifica completa del piano nell'app.

Nuovo percorso: La chat riusa richieste e piani esistenti, conserva streaming e correlazione per progetto e distingue attesa per limiti da stop esplicito. Il modello di ogni attività resta registrato.

Ticket collegati: [#33](https://github.com/emanueledenaro/trama/issues/33), [#34](https://github.com/emanueledenaro/trama/issues/34), [#35](https://github.com/emanueledenaro/trama/issues/35), [#43](https://github.com/emanueledenaro/trama/issues/43).

Fonti esaminate: [docs/verifiche/risposte-e-perimetro-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/risposte-e-perimetro-2026-09-13.md), [docs/verifiche/riavvio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/riavvio-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Richiesta, progetto, modulo, snapshot e riferimenti alle fonti restano associati anche dopo il riavvio. | Verificato nelle prove pregresse; da preservare |
| C2 | La pianificazione usa lettura soltanto e non modifica file né avvia effetti esterni. | Parziale |
| C3 | Il piano mostra comportamento atteso, moduli coinvolti, limiti, ipotesi aperte e verifiche previste; può essere corretto dall’utente. | Da verificare nel perimetro completo |
| C4 | Streaming, annullamento, limite d’uso, assenza di rete ed errore del modello hanno stati espliciti e non perdono la richiesta. | Da verificare nel perimetro completo |
| C5 | Un cambiamento del repository durante l’analisi rende il piano da rivalutare; un risultato tardivo non sostituisce un piano più recente. | Da verificare nel perimetro completo |
| C6 | Le skill sono selezionate in base al compito; una richiesta semplice non avvia l’intero percorso di sviluppo. | Da verificare nel perimetro completo |

## #8: T07: Prendere una decisione e vedere quali lavori ne dipendono

PR #31 e prova Orders/Catalog dimostrano invalidazione selettiva. Restano il percorso completo delle alternative libere e tutte le presentazioni della simulazione; i team paralleli richiedono nuove prove.

Nuovo percorso: Porre le domande nella chat e fermare solo gli incarichi dipendenti; riusare storia e versioni del Patto. Il tutorial non promuove dimostrazioni o risposte AI a evidenze reali.

Ticket collegati: [#35](https://github.com/emanueledenaro/trama/issues/35), [#38](https://github.com/emanueledenaro/trama/issues/38), [#46](https://github.com/emanueledenaro/trama/issues/46).

Fonti esaminate: [docs/verifiche/dipendenze-decisioni-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/dipendenze-decisioni-2026-09-13.md), [docs/verifiche/risposte-e-perimetro-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/risposte-e-perimetro-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | La scheda contiene caso concreto, alternative correggibili, risposta libera, esempio accettato e motivazione. | Da verificare nel perimetro completo |
| C2 | Ogni variazione incrementa la versione; la cronologia conserva la scelta precedente. | Verificato nelle prove pregresse; da preservare |
| C3 | I lavori dipendenti diventano da riallineare, quelli indipendenti restano validi. | Verificato in incremento successivo; checklist GitHub aggiornata |
| C4 | Una simulazione è etichettata come tale; una spiegazione del modello non diventa risultato osservato. | Da verificare nel perimetro completo |
| C5 | Il porting Swift del motore viene completato e verificato con test di comportamento, senza assumere validi i risultati salvati del prototipo TypeScript. | Verificato nelle prove pregresse; da preservare |
| C6 | I dati persistiti vengono validati prima del ripristino; dati incompleti non autorizzano candidati. | Verificato nelle prove pregresse; da preservare |

## #9: T08: Eseguire una modifica in un worktree dedicato

Worktree e conservazione sorgente provati; restano autorizzazioni runtime complete, stop durante comando, crash e recupero/pulizia. Una sessione non equivale ancora a un team persistente.

Nuovo percorso: Ogni specialista di scrittura usa isolamento e delega identificabili. Cambio perimetro e stop conservano artefatti. La ripresa esplicita resta per stop/uscita; l'attesa di capacità in un runtime attivo segue C11.

Ticket collegati: [#36](https://github.com/emanueledenaro/trama/issues/36), [#37](https://github.com/emanueledenaro/trama/issues/37), [#38](https://github.com/emanueledenaro/trama/issues/38), [#43](https://github.com/emanueledenaro/trama/issues/43).

Fonti esaminate: [docs/verifiche-locali.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche-locali.md), [docs/verifiche/revisione-compatta-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/revisione-compatta-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Delegare versioni delle decisioni, perimetro, base e verifiche richieste a un worktree identificabile. | Verificato nelle prove pregresse; da preservare |
| C2 | Modifiche locali preesistenti nel progetto sorgente restano byte-for-byte intatte; indice e branch originali restano preservati. | Verificato nelle prove pregresse; da preservare |
| C3 | Approvazioni di comandi, filesystem e rete seguono la politica effettiva del componente. Il worktree non viene presentato come sandbox. | Da verificare nel perimetro completo |
| C4 | Ampliamenti di perimetro o nuove decisioni fermano le operazioni interessate prima della successiva azione non autorizzata. | Da verificare nel perimetro completo |
| C5 | Stop, crash, base avanzata e riavvio mostrano lo stato effettivo; un comando già partito non viene dichiarato annullato senza conferma. | Da verificare nel perimetro completo |
| C6 | Riprendere è un’azione esplicita; pulizia del worktree non elimina lavoro da revisionare o modifiche dell’utente. | Da verificare nel perimetro completo |

## #10: T09: Revisionare il comportamento su un candidato preciso

Il precedente difetto di invalidazione globale è corretto dalla PR #31. Restano indipendenza completa dalle attività remote estranee e ricontrollo immediato in tutti i percorsi.

Nuovo percorso: Conservare la revisione umana e aggiungere un via libera delegato distinto per mandato. Un Coordinatore non può impersonare la persona; candidato combinato e base devono essere verificati di nuovo prima del merge.

Ticket collegati: [#36](https://github.com/emanueledenaro/trama/issues/36), [#38](https://github.com/emanueledenaro/trama/issues/38), [#41](https://github.com/emanueledenaro/trama/issues/41).

Fonti esaminate: [docs/verifiche/revisione-compatta-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/revisione-compatta-2026-09-13.md), [docs/verifiche/dipendenze-decisioni-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/dipendenze-decisioni-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Il verificatore raccoglie esiti reali con comando, uscita, log, snapshot del candidato, base, versione delle decisioni e suite. | Verificato nelle prove pregresse; da preservare |
| C2 | Separare passato, fallito, non eseguito e non più attuale; le dichiarazioni dell’agente non possono creare evidenze o approvazioni. | Verificato nelle prove pregresse; da preservare |
| C3 | Cambio di candidato, base pertinente, decisione dipendente, suite o nuova esecuzione dei controlli revoca il precedente via libera. | Verificato nelle prove pregresse; da preservare |
| C4 | Decisioni indipendenti e attività remote estranee non invalidano revisioni non coinvolte. | Da verificare nel perimetro completo |
| C5 | Diff, spiegazione del comportamento ed evidenze sono navigabili; approvazione locale non equivale a merge o pubblicazione. | Da verificare nel perimetro completo |
| C6 | Il candidato viene ricontrollato immediatamente prima di un’operazione che usa la revisione; cambiamenti concorrenti impediscono di agire sulla vecchia approvazione. | Da verificare nel perimetro completo |

## #11: T10: Creare un progetto partendo da un’idea

Creazione cartella, README e richiesta iniziale presenti; generazione della struttura, errori e ripresa completi non sono provati.

Nuovo percorso: La guida e la chat offrono Crea progetto con cartella, idea, piano e mandato visibili. La generazione usa lo stesso percorso isolato, senza pubblicare automaticamente un remoto.

Ticket collegati: [#35](https://github.com/emanueledenaro/trama/issues/35), [#36](https://github.com/emanueledenaro/trama/issues/36), [#44](https://github.com/emanueledenaro/trama/issues/44).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Nome e cartella sono scelti dall’utente; cartelle non vuote e nomi in conflitto sono gestiti senza sovrascritture. | Da verificare nel perimetro completo |
| C2 | Scopo e struttura sono visibili prima della generazione; il bootstrap usa gli stessi piani, decisioni e autorizzazioni del flusso su repository esistente. | Da verificare nel perimetro completo |
| C3 | Il progetto generato entra nella mappa con riferimenti a file reali e nei recenti. | Da verificare nel perimetro completo |
| C4 | Errore o interruzione conserva il lavoro parziale e consente ripresa esplicita. | Da verificare nel perimetro completo |
| C5 | Creare un progetto locale non pubblica automaticamente un repository remoto. | Da verificare nel perimetro completo |

## #12: T11: Collegare una issue al lavoro e pubblicare una PR revisionata

Pubblicazione tramite componente e Markdown UI sono documentati. Discussione, permessi, retry e pubblicazione completa dalla finestra restano incompleti. Stato/tag aggiunti localmente in #22 non sono ancora pubblicati.

Nuovo percorso: Conservare l'anteprima e il percorso manuale senza merge implicito dell'adapter. Il merge delegato è una successiva azione esplicita del Coordinatore entro mandato. Allineare checklist e stato GitHub solo alle prove reali, con retry idempotenti.

Ticket collegati: [#41](https://github.com/emanueledenaro/trama/issues/41), [#42](https://github.com/emanueledenaro/trama/issues/42).

Fonti esaminate: [docs/verifiche/issue-markdown-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/issue-markdown-2026-09-13.md), [docs/verifiche-locali.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche-locali.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Titolo, descrizione, stato e discussione provengono da GitHub; modulo, decisioni e sessioni sono collegamenti di Trama. | Da verificare nel perimetro completo |
| C2 | L’utente vede destinatario, branch, diff e testo della PR prima della pubblicazione. | Da verificare nel perimetro completo |
| C3 | Login del connettore e permesso di push Git sono verificati separatamente; mancanza di uno non viene mascherata dall’altro. | Da verificare nel perimetro completo |
| C4 | Retry dopo timeout riconcilia l’eventuale PR già creata, senza duplicarla. | Da verificare nel perimetro completo |
| C5 | Fine dell’agente non chiude l’issue; pubblicazione, CI remota, merge e chiusura restano stati distinti. | Verificato nelle prove pregresse; da preservare |
| C6 | Una modifica tra revisione e pubblicazione richiede nuova verifica del candidato. | Verificato nelle prove pregresse; da preservare |

## #13: T12: Vedere le novità condivise dal gruppo

Snapshot, cache e checkpoint presenti; restano force push, fork, repository rinominato e consumo/paginazione nel percorso reale.

Nuovo percorso: Instradare eventi pubblicati al progetto corretto anche quando un'altra chat è selezionata. La fonte remota condivisa non fonde candidati o contesti di due cloni.

Ticket collegati: [#39](https://github.com/emanueledenaro/trama/issues/39), [#40](https://github.com/emanueledenaro/trama/issues/40), [#43](https://github.com/emanueledenaro/trama/issues/43).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md), [docs/verifiche/trama-su-trama-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/trama-su-trama-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Conservare snapshot per repository, branch, SHA, fonte e istante di sincronizzazione; mostrare separatamente checkout locale e stato remoto. | Da verificare nel perimetro completo |
| C2 | Gestire nuovi branch, branch eliminati, PR da fork, cambio della base, force push e paginazione senza riutilizzare analisi obsolete. | Da verificare nel perimetro completo |
| C3 | Polling efficiente con richieste condizionali e rispetto dei limiti; nessun modello chiamato per controlli senza novità. | Da verificare nel perimetro completo |
| C4 | Rete assente, revoca, repository rinominato, risposta incompleta e API limitata conservano l’ultimo stato marcato non aggiornato. | Da verificare nel perimetro completo |
| C5 | Un fetch aggiorna i riferimenti remoti senza checkout, pull, merge o modifica automatica del branch dell’utente. | Da verificare nel perimetro completo |
| C6 | Il lavoro non pubblicato dagli altri è indicato come non osservabile; l’autore di un commit non viene presentato automaticamente come persona attualmente al lavoro. | Da verificare nel perimetro completo |

## #14: T13: Ricevere un avviso per un conflitto Git riprodotto

Confronti Git isolati con casi compatibili e incompatibili coperti dai test; avviso nativo remoto completo e input cambiati durante la prova non sono ancora dimostrati in tutti i casi.

Nuovo percorso: Confrontare anche candidati degli specialisti, mantenendo base e snapshot di ciascun lavoro. Rendere avviso e prove raggiungibili dalla chat e marcare l'esercizio tutorial come prova controllata.

Ticket collegati: [#40](https://github.com/emanueledenaro/trama/issues/40), [#46](https://github.com/emanueledenaro/trama/issues/46).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md), [docs/verifiche-locali.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche-locali.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Il confronto usa base comune e snapshot precisi di entrambi i lavori, compreso il lavoro locale non committato che si dichiara di controllare. | Da verificare nel perimetro completo |
| C2 | La prova di integrazione non modifica checkout, indice, branch, hook o file dell’utente. | Da verificare nel perimetro completo |
| C3 | Toccare lo stesso file senza collisione produce attività collegata, non un falso conflitto. | Da verificare nel perimetro completo |
| C4 | L’avviso collega le parti incompatibili ai rispettivi branch e commit; base mancante o confronto incompleto produce esito non verificabile. | Da verificare nel perimetro completo |
| C5 | Lavoro modificato durante la prova rende obsoleto il risultato e provoca un nuovo confronto limitato alle parti interessate. | Da verificare nel perimetro completo |
| C6 | Ogni evidenza registra snapshot di entrambi i lavori, base comune, procedura o comando ed esito; un cambiamento di uno degli input la rende obsoleta. | Da verificare nel perimetro completo |

## #15: T14: Capire le conseguenze delle modifiche del gruppo

Adapter semantico e rifiuto di autorità inventata presenti; mancano fixture indipendenti e turni reali su incompatibilità, duplicazione e API cambiate.

Nuovo percorso: Le interpretazioni degli specialisti e del Coordinatore conservano fonti e livello di prova. La condivisione di metodi generali non trasferisce contenuti o decisioni private fra team.

Ticket collegati: [#40](https://github.com/emanueledenaro/trama/issues/40), [#47](https://github.com/emanueledenaro/trama/issues/47).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Analizzare diff, contesto del codice, issue, PR e decisioni; un messaggio di commit da solo non basta a dichiarare il comportamento. | Da verificare nel perimetro completo |
| C2 | Ogni interpretazione rimanda a fonti e SHA; fatti osservati e ipotesi sono distinguibili, senza percentuali di confidenza inventate. | Da verificare nel perimetro completo |
| C3 | Rilevare nei casi controllati incompatibilità tra file diversi, lavoro duplicato, API cambiate e piani superati. | Da verificare nel perimetro completo |
| C4 | Una possibile incoerenza diventa violazione verificata solo dopo uno scenario attendibile eseguito sul candidato combinato, con evidenza prodotta dal verificatore. | Da verificare nel perimetro completo |
| C5 | Testare casi positivi e negativi, fixture non viste nell’implementazione, errore del modello, input ambiguo e istruzioni malevole nei contenuti GitHub trattate come dati. | Da verificare nel perimetro completo |
| C6 | Richieste e risultati vecchi vengono cancellati o scartati quando cambia lo snapshot; nessun modello può promuovere da solo una propria conclusione a revisione umana. | Da verificare nel perimetro completo |

## #16: T15: Aggiornare il piano e avvisare solo quando serve

Deduplica e azioni UI presenti; raffiche equivalenti, budget visibili e ciclo completo di risoluzione non sono provati nell'app.

Nuovo percorso: Avvisi e blocchi compaiono nella chat del progetto e nella panoramica. Rivalutare solo dipendenti, conservare stop confermato distinto dalla richiesta e aggiornare ticket senza equiparare ignorato ad approvato.

Ticket collegati: [#38](https://github.com/emanueledenaro/trama/issues/38), [#40](https://github.com/emanueledenaro/trama/issues/40), [#42](https://github.com/emanueledenaro/trama/issues/42), [#43](https://github.com/emanueledenaro/trama/issues/43).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Separare attività collegata, possibile incoerenza, conflitto riprodotto e decisione richiesta. | Da verificare nel perimetro completo |
| C2 | Mostrare autore quando noto, PR/branch, fonti, conseguenza sul lavoro corrente e azioni Esamina, Rivedi piano, Segna come valutato. | Da verificare nel perimetro completo |
| C3 | Un nuovo evento rivaluta solo piani ed evidenze dipendenti; il lavoro non coinvolto continua. | Da verificare nel perimetro completo |
| C4 | Un conflitto verificato che blocca il patto impedisce la successiva integrazione; la sospensione di un agente segue il perimetro e preserva quanto già scritto. | Da verificare nel perimetro completo |
| C5 | Deduplicare avvisi e risultati, aggregare raffiche di commit, usare cache per SHA e limiti di concorrenza/uso dei modelli. | Da verificare nel perimetro completo |
| C6 | Raggiunti limiti del servizio o budget concordati, continuare raccolta deterministica disponibile e mostrare analisi AI in attesa; nessun fallback a pagamento non autorizzato. | Da verificare nel perimetro completo |
| C7 | La notifica si risolve o si aggiorna quando cambia la situazione; ignorare un avviso non equivale ad approvare il candidato. | Da verificare nel perimetro completo |

## #17: T16: Seguire il progetto a finestra chiusa

Helper e configurazione esistono, ma registrazione Apple reale e prove complete dopo Esci/sospensione non sono attestate. Un monitor GitHub non prova un Coordinatore AI sempre attivo.

Nuovo percorso: Chiudere la finestra lascia i runtime autorizzati attivi; Esci li ferma e lascia il monitor abilitato come osservatore. Riconciliare gli eventi nella chat al ritorno; nessuna operatività cloud implicita.

Ticket collegati: [#39](https://github.com/emanueledenaro/trama/issues/39), [#43](https://github.com/emanueledenaro/trama/issues/43).

Fonti esaminate: [docs/stato-beta.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/stato-beta.md), [docs/verifiche/distribuzione-prerequisiti-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/distribuzione-prerequisiti-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Attivazione, disattivazione e avvio al login sono visibili e passano dai meccanismi Apple appropriati. | Da verificare nel perimetro completo |
| C2 | Chiudere la finestra, terminare l’app, fermare il monitor e sospendere il Mac hanno comportamenti distinti e dichiarati. | Da verificare nel perimetro completo |
| C3 | Il monitor lavora soltanto sui progetti abilitati, con limiti energetici e di uso dei modelli; non riavvia sessioni di modifica del codice. | Da verificare nel perimetro completo |
| C4 | Un solo coordinatore gestisce eventi e coda quando UI e helper sono attivi; i lock e i cursori persistiti evitano doppie analisi. | Da verificare nel perimetro completo |
| C5 | Al risveglio o ritorno in rete riconciliare dal checkpoint agli SHA attuali, aggregare novità e mostrare l’ultimo aggiornamento effettivo. | Da verificare nel perimetro completo |
| C6 | Notifiche negate o suoni disabilitati mantengono tutti gli avvisi consultabili nell’app. | Da verificare nel perimetro completo |
| C7 | Al primo avvio monitor in background e avvio al login sono disattivati; nessun helper viene registrato prima dell’attivazione esplicita. Disattivare annulla la registrazione e la scelta persiste. La sincronizzazione in primo piano del progetto aperto resta distinta. | Da verificare nel perimetro completo |

## #18: T17: Verificare l’intero percorso con l’interfaccia Apple

Percorsi nativi parzialmente provati; manca l'intero flusso, accessibilità completa e misure 100/1000/10000 file. La nuova chat e Team devono entrare nell'accettazione finale.

Nuovo percorso: Il percorso dal primo avvio include tutorial, Coordinatore, Team, mandato, decisione, modifica, prove, integrazione e ritorno al progetto. Chiudere solo con tutti i nuovi ticket richiesti e #21/#22 verificati.

Ticket collegati: [#46](https://github.com/emanueledenaro/trama/issues/46), [#47](https://github.com/emanueledenaro/trama/issues/47), [#48](https://github.com/emanueledenaro/trama/issues/48).

Fonti esaminate: [docs/verifiche/responsive-secondo-passaggio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/responsive-secondo-passaggio-2026-09-13.md), [docs/verifiche/controlli-nativi-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/controlli-nativi-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Verificare dal doppio clic accesso, collegamenti, apertura/creazione, mappa, richiesta, decisione, esecuzione, revisione e ritorno al progetto. | Da verificare nel perimetro completo |
| C2 | Sidebar, toolbar, inspector, finestre, selettori e menu sono nativi; l’immagine iniziale ispira la composizione, il design Apple guida i controlli. | Da verificare nel perimetro completo |
| C3 | Tema chiaro/scuro, Riduci movimento, contrasto, navigazione completa da tastiera e VoiceOver: la vista ad albero offre un’alternativa alla mappa. | Da verificare nel perimetro completo |
| C4 | Stati vuoto, caricamento, parziale, errore, offline e ripristino verificati su finestre ridimensionate, senza controlli nascosti. | Da verificare nel perimetro completo |
| C5 | Nessun suono per token, lettura di file o test. Un suono discreto facoltativo accompagna solo avvisi utili, con preferenze persistenti e rispetto delle impostazioni di notifica. | Da verificare nel perimetro completo |
| C6 | Misurare reattività su fixture da 100, 1000 e 10000 file; UI utilizzabile durante indice e analisi, limiti espliciti e risultati documentati. | Da verificare nel perimetro completo |

## #19: T18: Consegnare una beta locale riproducibile dal codice pubblico

Clone/build/test e packaging ad hoc documentati. Restano README finale, licenze complete e percorso utente riprodotto; Developer ID, notarizzazione e secondo Mac non sono provati.

Nuovo percorso: La riproduzione da clone pulito comprende tutorial, chat e team oltre alle viste precedenti. Distinguere beta compilabile dal sorgente da app scaricabile firmata e notarizzata.

Ticket collegati: [#48](https://github.com/emanueledenaro/trama/issues/48).

Fonti esaminate: [docs/verifiche/distribuzione-prerequisiti-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/distribuzione-prerequisiti-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Clone pulito, compilazione Release, test e creazione dell’app riusciti in CI macOS; risorse necessarie incluse. | Verificato nelle prove pregresse; da preservare |
| C2 | README documenta requisiti verificati di macOS, Swift e Codex, onboarding, supporto dei repository e funzionamento del monitor. | Da verificare nel perimetro completo |
| C3 | Licenze e attribuzioni del progetto, skill AI Hero e componente Codex sono verificate prima di redistribuirli; nessuna dipendenza locale implicita. | Da verificare nel perimetro completo |
| C4 | Evidenze distinguono build locale, test, prova UI, CI remota, firma e notarizzazione. La firma ad hoc locale non viene presentata come distribuzione macOS verificata. | Da verificare nel perimetro completo |
| C5 | La beta pubblica scaricabile resta separata finché firma Developer ID, notarizzazione e installazione su un secondo Mac non sono verificate. | Da verificare nel perimetro completo |

## #21: T19: Adattare il layout alle dimensioni della finestra macOS

PR #25/#26/#30/#32 pubblicate. Le misure dei trascinamenti non completano la matrice con dimensioni indipendentemente verificate; mancano modali, tastiera/VoiceOver e schermate esportate.

Nuovo percorso: Applicare la stessa matrice a chat, Team, panoramica globale e tutorial. Nessuna riduzione del minimo, del carattere o dei percorsi esistenti per far entrare nuove schermate.

Ticket collegati: [#34](https://github.com/emanueledenaro/trama/issues/34), [#37](https://github.com/emanueledenaro/trama/issues/37), [#39](https://github.com/emanueledenaro/trama/issues/39), [#44](https://github.com/emanueledenaro/trama/issues/44), [#46](https://github.com/emanueledenaro/trama/issues/46).

Fonti esaminate: [docs/verifiche/responsive-primo-passaggio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/responsive-primo-passaggio-2026-09-13.md), [docs/verifiche/revisione-compatta-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/revisione-compatta-2026-09-13.md), [docs/verifiche/responsive-secondo-passaggio-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/responsive-secondo-passaggio-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Provare aree di contenuto di 720×640, 1040×700, 1280×800, 1440×900 e 1920×1080 punti; documentare la nuova dimensione minima supportata. | Da verificare nel perimetro completo |
| C2 | Sidebar e inspector si comprimono o si chiudono in modo prevedibile. I pulsanti per riaprirli restano disponibili e il contesto selezionato viene conservato. | Da verificare nel perimetro completo |
| C3 | La mappa usa colonne adattive. Titoli, percorsi e badge non si sovrappongono; selezione, ricerca e apertura dei file funzionano a ogni dimensione. | Da verificare nel perimetro completo |
| C4 | Le azioni principali restano visibili o raggiungibili con lo scorrimento. Nessun pulsante di conferma o annullamento viene tagliato nelle finestre modali. | Da verificare nel perimetro completo |
| C5 | Gli editor del piano, i dettagli delle issue e gli output si adattano senza ridurre artificialmente la dimensione del testo. Lo scorrimento orizzontale resta confinato ai contenuti che lo richiedono, come codice e diff. | Da verificare nel perimetro completo |
| C6 | Verificare testo lungo, nomi di branch e percorsi lunghi, liste vuote, caricamento, errore e contenuti numerosi. | Da verificare nel perimetro completo |
| C7 | Provare finestra affiancata, schermo intero, apertura e chiusura dell’inspector e passaggio tra le sezioni senza salti della selezione o dimensionamenti forzati. | Da verificare nel perimetro completo |
| C8 | Tutte le azioni restano utilizzabili da tastiera e con etichette accessibili. | Da verificare nel perimetro completo |

## #22: T20: Uniformare spazi, allineamenti e gerarchia visiva Apple

Fondazioni visive e Markdown pubblicati; ulteriori rifiniture, tag e label sono locali non committati. Le prove di contrasto/trasparenza locali non chiudono focus, modali, stati disabilitati e raccolta immagini.

Nuovo percorso: Chat, Team e tutorial riusano il sistema Apple e i componenti condivisi. Preservare etichette persistenti/accessibili, stato/tag Issue, temi, focus e distinzione fra fatti, simulazioni e prove.

Ticket collegati: [#34](https://github.com/emanueledenaro/trama/issues/34), [#37](https://github.com/emanueledenaro/trama/issues/37), [#44](https://github.com/emanueledenaro/trama/issues/44), [#46](https://github.com/emanueledenaro/trama/issues/46).

Fonti esaminate: [docs/design-system.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/design-system.md), [docs/verifiche/controlli-nativi-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/controlli-nativi-2026-09-13.md), [docs/verifiche/issue-markdown-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/issue-markdown-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Definire e documentare una scala di spaziatura riutilizzabile, coerente con i controlli di sistema. Sostituire i valori isolati che producono distanze diverse per lo stesso tipo di contenuto. | Da verificare nel perimetro completo |
| C2 | Allineare titoli, testi, icone, campi e pulsanti sulle stesse guide. Verificare margini laterali, spazi tra sezioni e baseline delle righe. | Da verificare nel perimetro completo |
| C3 | Distinguere titolo, sottotitolo, corpo e metadati con gli stili tipografici di sistema. Evitare testo troppo piccolo e conservare leggibilità con contenuti lunghi. | Da verificare nel perimetro completo |
| C4 | Uniformare dimensioni e peso degli SF Symbols, altezza dei campi, forme dei contenitori, separatori e stati dei pulsanti. | Da verificare nel perimetro completo |
| C5 | Rendere coerente la posizione delle azioni principali e secondarie. Conferma e annullamento restano riconoscibili; le etichette dei campi sono visibili anche quando i campi sono compilati. | Da verificare nel perimetro completo |
| C6 | Equilibrare densità delle liste e spazio delle aree di lavoro, senza grandi vuoti accidentali o gruppi troppo compressi. | Da verificare nel perimetro completo |
| C7 | Usare colori e materiali semantici di sistema. Verificare tema chiaro e scuro, aumento del contrasto, riduzione della trasparenza, focus da tastiera e stato disabilitato. | Da verificare nel perimetro completo |
| C8 | Selezione, caricamento, errore, verifica superata e verifica da ripetere hanno una presentazione coerente e comprensibile anche senza il solo colore. | Da verificare nel perimetro completo |
| C9 | Eseguire un controllo visivo comparato di tutte le sezioni e delle finestre modali con dati identici, includendo una finestra stretta e una ampia. | Da verificare nel perimetro completo |

## #23: T21: Selezionare i modelli OpenAI in Trama

PR #29 pubblicata; due modelli hanno risposto, una incompatibilità è rimasta errore senza fallback e la scelta è persistita. Restano esecuzione completa con due modelli, modello rimosso, accesso scaduto e VoiceOver. Per completare il criterio di persistenza serve anche una prova esplicita che la configurazione globale sia rimasta invariata.

Nuovo percorso: La persona sceglie il modello principale; il Coordinatore sceglie quelli degli specialisti rendendoli visibili per incarico. Catalogo e autorizzazione reale restano distinti e i limiti non autorizzano provider alternativi.

Ticket collegati: [#34](https://github.com/emanueledenaro/trama/issues/34), [#37](https://github.com/emanueledenaro/trama/issues/37), [#43](https://github.com/emanueledenaro/trama/issues/43).

Fonti esaminate: [docs/verifiche/selezione-modelli-2026-09-13.md](https://github.com/emanueledenaro/trama/blob/ad38e76d903cdd3f22b233f79c71b4cc1feb8048/docs/verifiche/selezione-modelli-2026-09-13.md).

| Criterio | Requisito originale | Esito della riconciliazione |
| --- | --- | --- |
| C1 | Leggere il catalogo dei modelli OpenAI esposto dal componente ufficiale Codex, verificando il contratto della versione supportata. Distinguere catalogo disponibile e reale autorizzazione dell’account all’uso di un modello. | Da verificare nel perimetro completo |
| C2 | Mostrare un selettore nativo macOS vicino alla richiesta, con nome del modello selezionato e descrizione quando disponibile. | Verificato in incremento successivo; checklist GitHub aggiornata |
| C3 | Conservare la scelta per progetto tra riavvii e ripristinarla senza modificare la configurazione globale di Codex. | Da verificare nel perimetro completo |
| C4 | Passare esplicitamente il modello scelto alla pianificazione e all’esecuzione; rendere visibile anche quale modello usa l’analisi delle attività del gruppo. | Da verificare nel perimetro completo |
| C5 | Registrare nella richiesta il modello usato. Cambiare selezione durante un’attività non cambia retroattivamente il modello di quella già avviata. | Da verificare nel perimetro completo |
| C6 | Gestire caricamento, catalogo vuoto, errore, accesso scaduto e modello non più disponibile. Non sostituire silenziosamente il modello scelto con un altro. | Da verificare nel perimetro completo |
| C7 | Conservare provider OpenAI, accesso ChatGPT gestito dal componente ufficiale e isolamento degli strumenti. Nessun passaggio automatico a credenziali API o a un altro provider. | Da verificare nel perimetro completo |
| C8 | Verificare accessibilità, nomi lunghi e comportamento del selettore nelle finestre strette, coordinandosi con #21 e #22. | Da verificare nel perimetro completo |
