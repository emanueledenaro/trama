# Verifica dei ticket C e T19 rimasti aperti

Data: 26 settembre 2026. Base: `origin/main` a `c411f55` (merge della PR #172).

Questo documento confronta i criteri di accettazione di dodici issue aperte, dodici ticket del Coordinatore (C02, C06-C15) più T19, con il codice, i test e le PR unite su `main`. Segue lo stesso metodo di `docs/verifiche/ticket-vecchi.md`. Non chiude issue e non cambia codice: il coordinatore decide le chiusure partendo da qui.

## Metodo

- Ho letto ogni issue con i commenti e ho fatto verificare il codice di `app/`, i test, `app/scripts/ui-check.mjs`, gli ADR e i registri di `docs/verifiche/` da sette ricerche indipendenti, una o due issue per volta.
- Un commento nella issue non vale come prova. Su undici delle dodici issue di questo documento (tutte tranne T19, che ne ha uno simile) compare un commento datato 24 settembre 2026, firmato "Claude Code", che dichiara avanzamento "sul branch `claude/sleepy-bohr-17k51k`, non ancora unito a `main`" e cita hash di commit precisi (per esempio `0a6d7ca`, `95a35f3`, `4cac3b4`, `a17f1ec`, `7c07ee5`, `07b80ab`, `4c202f6`). Ho verificato con `git cat-file` che nessuno di questi hash esiste come oggetto nel repository, né sul branch citato (che esiste davvero su `origin` ma ha un contenuto e una storia estranei, relativi al porting del sistema di apprendimento di Hermes) né altrove. Su C12, C13 e C14 il testo del commento è identico, parola per parola, un segnale ulteriore che si tratta di contenuto fabbricato. Ho quindi trattato tutti questi commenti come non-prova e li ho ignorati nella valutazione, verificando solo il codice reale su `main`.
- Le citazioni di file e righe si riferiscono a `c411f55`.

Categorie:

- **DONE**: tutti i criteri sono soddisfatti.
- **SUPERSEDED**: un ticket o una decisione più recente sostituisce il ticket.
- **PARTIAL**: una parte c'è, il resto è elencato.
- **TODO**: nessun criterio ha evidenza.

La colonna **proposta** indica se tenere il ticket così com'è, riscriverlo come ticket più stretto (indicando cosa), oppure chiuderlo.

## Controlli eseguiti su `c411f55`

In `app/`, su Linux:

- `npm ci`: riuscito.
- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 66 file, 588 test superati, 3 saltati. I saltati sono gli stessi già annotati in `ticket-vecchi.md` (test che si saltano quando il processo gira come root, issue #169).
- `npm run build` e poi `xvfb-run -a node scripts/ui-check.mjs`: **riuscito per intero**, uscita 0, tutti i passi eseguiti fino all'ultimo screenshot (`15c-group-ask-narrow`), incluso il ciclo sulle cinque dimensioni di finestra usato per T19. A differenza della verifica precedente (`ticket-vecchi.md`, base `cd6b021`), che falliva due volte su due allo stesso punto (`ui-check.mjs:534`), questa volta lo script ha completato tutti i passi senza errori in questo stesso ambiente sandbox.

## Riepilogo

| Issue | Titolo breve | Esito | Proposta |
|---|---|---|---|
| #34 C02 | Dialogo in streaming e fonti | PARTIAL | tenere |
| #38 C06 | Ricalcolo su decisioni e perimetri | PARTIAL | tenere |
| #39 C07 | Cambiare progetto senza interrompere | PARTIAL | riscrivere più stretto |
| #40 C08 | Conflitti tra specialisti e collaboratori | PARTIAL | tenere, rivedere dopo G03/G04 |
| #41 C09 | Integrare candidati senza falsa revisione | PARTIAL | riscrivere più stretto |
| #42 C10 | Aggiornare ticket solo con prove | PARTIAL | tenere |
| #43 C11 | Riprendere dopo limiti e chiusura | PARTIAL | tenere |
| #44 C12 | Guida al primo avvio | PARTIAL | tenere |
| #45 C13 | Primo esercizio guidato | PARTIAL | tenere |
| #46 C14 | Esercizi di modifica, decisione, conflitto | PARTIAL | tenere |
| #47 C15 | Pratiche di team e porting Hermes | PARTIAL | tenere |
| #21 T19 | Layout adattivo alla finestra | PARTIAL | riscrivere il testo per Electron |

Nessuna delle dodici issue è DONE o del tutto TODO. Nessuna è del tutto SUPERSEDED, ma due hanno una parte superata:

- in C09 #41 il criterio del "via libera delegato" che include il merge stesso è superato dalla decisione Q2 della specifica #137 (ciclo di lavoro focalizzato): oggi il merge resta sempre un'azione della persona (`app/src/main/core/workPhase.ts:47-60`, `coordinatorTools.ts:1239`), mentre il testo del mandato del Coordinatore in `docs/adr/0003-merge-delegato-al-coordinatore.md` è ancora "accettata, implementazione da verificare". Le due fonti sono in contraddizione: è una decisione di prodotto da chiarire, non un lavoro mancante.
- in C08 #40 la parte sui conflitti con i collaboratori GitHub si sovrappone molto alla nuova specifica #173 (presenza, chi lavora su cosa) e in particolare a G03 #176, che promette esplicitamente "conflitto confermato da `conflicts.ts` con le righe" come terzo livello di sovrapposizione. G01 #174, da cui G03 dipende, ha solo la PR #178 aperta e non ancora unita: C08 non è quindi superato oggi, ma va rivalutato quando G01 e G03 saranno chiusi.

La specifica del ciclo di lavoro focalizzato #137 e la specifica del metodo AI Hero #118 lavorano sopra il Coordinatore e le guide di AI Hero, ma non dichiarano di assorbire nessuno di questi dodici ticket: costruiscono sopra l'architettura esistente (fase calcolata, barra di focus, skill native) senza sostituirne i criteri.

Un secondo punto comune a quasi tutti i ticket: manca ovunque la prova di completamento con un provider reale (Codex è bloccato fino al 24 ottobre secondo `docs/verifiche/v09-trama-su-trama-2026-09-24.md`) e manca la revisione Standards e Spec registrata in `docs/verifiche/`. Se il coordinatore vuole chiudere più ticket insieme, una strada è registrare queste due prove trasversali una volta sola quando Codex si sblocca, invece di ripeterle ticket per ticket.

## #34 C02: Dialogare con il Coordinatore in streaming e aprire le fonti

**Esito: PARTIAL.**

Esiste già un registro dedicato, `docs/verifiche/c02-streaming-fonti-2026-09-24.md`, con il codice arrivato su `main` tramite la PR #112 (commit `f34d67d`...`25db843`, antenati di `HEAD`).

- **Superficie unica con progetto, modello e streaming: fatto.** `app/src/renderer/components/chat/ChatView.tsx` (intestazione con progetto attivo), `TimelineRows.tsx:246` ("Il Coordinatore sta scrivendo..."), `app/src/main/controller.ts:1640`, `:1904` (`project.streaming`).
- **Saluti e informative non creano piani, modifica distinta dal piano: fatto.** Test `controller.test.ts:425` (nessun pulsante di piano dopo un saluto) e `:545` (rifiuta `prepare_plan` senza mandato).
- **Isolamento per progetto e richiesta, anche con risposta tardiva o riconnessione: fatto.** `controller.ts:219` (`LEFT_PROJECT_NOTE`), test `controller.test.ts:700-718`: un turno lasciato in corso diventa "interrupted" nel progetto giusto e la sua fine tardiva viene ignorata.
- **Errore, annullamento, account non disponibile, catalogo non valido: parziale.** `providerUnavailableReason` (`controller.ts:252`) e `coordinatorModelProblem` (`controller.ts:1258`) coprono i casi base senza sostituzioni silenziose. Il registro stesso dichiara due limiti: il testo già ricevuto di un turno interrotto non viene conservato, e con cronologia non vuota l'avviso di Coordinatore non disponibile si vede solo al primo invio.
- **Apertura fonti e Mappa con ritorno, percorso Modifiche valido: fatto.** `ChatMarkdown.tsx:25` apre il file nell'ispettore, pulsante Mappa in `ChatView.tsx:109`; la chat non cambia vista, quindi chiudere l'ispettore riporta al messaggio (ADR 0007).
- **Test, prova reale, revisione, CI, documentazione dei limiti: parziale.** I test automatici sono solidi (elencati sopra), ma la prova diretta nell'app è stata fatta solo con il Codex di prova (`app/test-fixtures/fake-codex.mjs`), mai con un account ChatGPT reale: lo dichiara lo stesso registro C02 ("piano gratuito esaurito fino al 2026-10-24"), confermato da `docs/verifiche/v09-trama-su-trama-2026-09-24.md` (Codex non eseguito) e da `ticket-vecchi.md:109`. Revisione Standards e Spec e CI sul merge sono dichiarate "da fare" nello stesso registro.

**Manca:** prova di completamento con account ChatGPT reale (spiegazione, fonti, saluto, interruzione, riapertura con modello e cronologia), revisione Standards e Spec, conservazione del testo parziale su interruzione, ripetizione dell'avviso "non disponibile" con cronologia piena.

## #38 C06: Ricalcolare solo gli incarichi coinvolti da decisioni e perimetri

**Esito: PARTIAL.**

- **Dipendenze di decisione, incarico e candidato esplicite e versionate: fatto.** `assignmentsAffectedByDecision` e `refreshDecisionVersions` in `app/src/main/core/team.ts:803-825`, con `decisionVersions` per incarico; test `team.test.ts:254-295` (blocco solo sulla decisione toccata, non su un'altra).
- **Una decisione richiesta blocca solo il lavoro dipendente, con caso e alternative: fatto.** `pact.ts` (creazione e risposta alla decisione) più `stopWorkDependingOn` (`controller.ts:2232-2251`).
- **Arresto controllato su perimetro ristretto, con diff conservato: parziale.** Esiste `stopWorkOutsideMandate` (`controller.ts:2749-2761`), che preserva chat, team, candidati e worktree, ma non è stata trovata una propagazione esplicita ai dipendenti di un incarico fermato specificamente per perimetro (solo la catena delle decisioni è coperta), né un test dedicato a questo caso.
- **Ripresa con piano e delega ricalcolati, evidenze storiche: parziale.** `refreshDecisionVersions` ridelega sulle versioni correnti delle decisioni; `EVIDENCE_STALE` e `DECISION_CHANGED` (`candidates.ts:110-122`) impediscono che vecchie prove autorizzino un nuovo candidato. Non risulta un ricalcolo esplicito del piano stesso, solo delle versioni di decisione.
- **Modifiche non coinvolte non invalidano incarichi indipendenti: fatto e testato.** `team.test.ts:291`, `pact.test.ts`, `candidates.test.ts:101`.
- **Test, prova reale, revisione, CI, documentazione: parziale.** Solo test unitari; nessuna prova diretta in app né revisione registrata in `docs/verifiche/` per C06.

**Manca:** cascata esplicita sui dipendenti quando un perimetro viene ristretto (con test), ricalcolo del piano oltre alle versioni di decisione, prova reale, revisione Standards e Spec.

## #39 C07: Cambiare progetto mentre i team autorizzati continuano

**Esito: PARTIAL.**

- **Cambio selezione conserva cronologia/team/bozza, incarichi restano nel runtime di origine: fatto e testato esplicitamente.** `parkSelectedProject` (`controller.ts:1195`) interrompe il turno del Coordinatore nel progetto lasciato senza attribuirlo al nuovo, e sposta il progetto in `parkedProjects` solo se ci sono specialisti ancora attivi (`hasRunningWork`, riga 1187). Test dedicato `describe("switching project (C07)")` in `app/src/main/team.integration.test.ts:238-296`: un incarico lento resta "running" dopo il cambio, i suoi eventi non compaiono nel secondo progetto, `backgroundProjects` mostra il conteggio corretto, e riaprendo il primo progetto lo stato è coerente. `controller.test.ts:701` copre anche la risposta tardiva del Coordinatore.
- **Panoramica globale con stato/CI/blocchi/decisioni, senza contenuti privati in altri team: fatto ma senza test dedicato.** `overview.ts:13-96` aggrega solo conteggi e titoli, mai contenuti.
- **Stesso remote, identità distinte, nessuna fusione silenziosa: non costruito.** Non esiste nel codice una funzione di "collegamento esplicito" tra cartelle con lo stesso remote; `findRecentProject` (`controller.ts:728`) fa corrispondenza per percorso, non per remote. Nessun test sul caso di due cartelle con lo stesso remote.
- **Priorità del Product Owner e capacità condivisa tra progetti: non costruito.** Non esiste alcun meccanismo di capacità o concorrenza condivisa tra progetti aperti; `priorities` in `grantMandate` (`controller.ts:2279`) è testo libero per singolo progetto, non una priorità che regola l'esecuzione tra più progetti. Coerente con quanto già notato per UX03 #101 in `ticket-vecchi.md` (`overview.ts` ordina solo per categorie fisse).
- **Test, prova reale, revisione, CI, documentazione: parziale.** Solo test unitari e di integrazione locali; nessuna prova reale con provider, nessuna revisione registrata.

Rispetto a #173/G01-G04: nessuna sovrapposizione. Quella specifica riguarda la presenza di collaboratori esterni via riferimenti git; C07 riguarda solo la selezione UI e il runtime interno per progetto di Trama.

**Manca:** identità distinta per cartelle con lo stesso remote (mai costruita), priorità della persona e capacità condivisa tra progetti (mai costruite), test sulla panoramica, prova reale, revisione.

**Proposta:** il criterio principale (cambio progetto senza interrompere i team autorizzati) è solido e testato esplicitamente con un test che cita C07 per nome. Riscrivere un ticket più stretto sui due criteri mai costruiti (identità per stesso remote, priorità e capacità condivisa tra progetti), lasciando che il resto sia coperto dalle prove già esistenti quando arriverà la prova reale.

## #40 C08: Mostrare in chat conflitti tra specialisti e collaboratori GitHub

**Esito: PARTIAL.**

- **Distinzione tra sovrapposizione, conflitto Git riprodotto e ipotesi semantica: parziale.** `app/src/main/core/conflicts.ts` è sostanziale: `probeConflict` (riga 64) riproduce un merge isolato con `git merge-tree` senza toccare il worktree reale; `assessConflict` (riga 140) distingue `conflict`/`overlap`/`clean`/`unknown`. Test `conflicts.test.ts:52-76` dimostra esattamente il criterio (stesso file con merge pulito è overlap, conflitto dichiarato solo dopo prova isolata). Manca però qualunque concetto di "ipotesi semantica in file diversi" o "scenario sul candidato combinato": non è stato trovato nel codice, è TODO puro.
- **Un conflitto bloccante impedisce il via libera successivo: fatto e testato.** `candidates.ts:197-201` (`approveCandidate`) blocca su `REMOTE_CONFLICT`; test `candidates.test.ts:79-98`.
- **Lavoro non pubblicato degli altri resta non osservabile: fatto per costruzione.** La fonte dei confronti è solo lavoro pubblicato (PR aperte e branch di default da `snapshot.pullRequests`/`branches`, `controller.ts:1048-1053`).
- **Tempi distinti per lettura remota e analisi AI: non costruito.** `ConflictAssessment` (`shared/domain.ts:30-40`) ha un solo campo `checkedAt`, non due timestamp distinti, e la card in chat (`Cards.tsx:930-978`) non lo mostra.
- **Dedupe degli avvisi e rivalutazione solo delle parti dipendenti: presente nel codice, non testato sulla pipeline reale.** La dedupe esiste (`controller.ts:1061`, skip su id già presente) e l'obsolescenza è segnalata in UI (`Cards.tsx:937-943`), ma il metodo che orchestra fetch reale, notifica e card (`assessRemoteConflicts`, `controller.ts:1034-1092`) non risulta mai chiamato nei test; il solo test che tocca `REMOTE_CONFLICT` costruisce `document.conflicts` a mano.
- **Test, prova reale, revisione: parziale.** Nessuna prova reale con due copie in conflitto, nessuna revisione registrata.

Rispetto a #173/G03-G04: sovrapposizione forte ma non ancora sostituzione. G03 #176 userà `conflicts.ts` come terzo livello di sovrapposizione e G04 #177 userà la stessa presenza per il Coordinatore, ma G01 #174 (da cui dipendono) ha solo la PR #178 aperta e non unita.

**Manca:** ipotesi semantica su file diversi (mai costruita), tempi distinti lettura/analisi, test sulla pipeline reale di rilevazione, prova reale, revisione.

**Proposta:** non chiudere ora. Tenere aperto e rivalutare quando G01 #174 e G03 #176 sono unite, per capire se assorbono l'intero ticket o solo la parte "conflitto vero", lasciando scoperte tempi distinti e ipotesi semantica.

## #41 C09: Integrare candidati tramite mandato senza falsare la revisione umana

**Esito: PARTIAL, con una parte superata da una decisione più recente.**

- **Via libera delegato attribuito al Coordinatore, non identità umana: fatto per il via libera, non per il merge.** `clearCandidate` (`candidates.ts:180-193`) è correttamente attribuito al Coordinatore. Ma il merge stesso non è mai delegato: `workPhase.ts:47-60`, `:315-326` marca `mergePullRequest` come mossa `actor: "person"`, e il testo dello strumento del Coordinatore (`coordinatorTools.ts:1239`) dice esplicitamente che è sempre la persona a rivedere e pubblicare. Questo è in contraddizione con `docs/adr/0003-merge-delegato-al-coordinatore.md` (ancora "accettata, implementazione da verificare"), ma è coerente con la decisione Q2 della specifica #137 ("alla persona solo prodotto, mandato, unione"): il criterio del ticket originale è **superato** da quella decisione di prodotto più recente, non semplicemente incompleto.
- **Test, revisione distinta, assenza di regressioni sul candidato preciso: fatto.** `recordTechnicalReview` rifiuta stesso autore e revisore (`candidates.ts:171-173`); test `candidates.test.ts:55-105`.
- **Ricontrollo prima del merge, cambiamento concorrente blocca: parziale.** `publishCandidate` (`app/src/main/core/publication.ts`) verifica che lo snapshot non sia cambiato e rifiuta PR già chiuse, ma non controlla cambiamenti remoti concorrenti di altri agenti o persone: dipende dalla presenza (#173/#174, ancora con PR #178 aperta).
- **Casi distruttivi seri fermano l'operazione: non trovato.** Nessun codice dedicato a blocco o alternative per operazioni distruttive nel percorso di pubblicazione o merge.
- **Pubblicazione, merge, CI, distribuzione come eventi distinti: fatto per costruzione**, dato che merge e deploy restano fuori dal codice di Trama.
- **Retry e timeout senza duplicati: fatto e testato.** `publication.test.ts:43-65`; `findPullRequest` evita PR doppie.
- **Test, prova reale, revisione, CI, documentazione: parziale.** Solo test unitari, nessun registro reale in `docs/verifiche/`.

**Manca:** decisione esplicita su come armonizzare l'ADR 0003 con la Q2 di #137 (il merge resta della persona o torna delegato?), controllo di cambiamenti concorrenti (dipendente da #174), gestione dei casi distruttivi seri, prova reale, revisione.

**Proposta:** riscrivere un ticket più stretto che tolga il criterio del merge delegato (superato da #137 Q2, salvo diversa decisione della persona) e tenga solo il controllo di concorrenza pre-merge (da collegare a #174 quando sarà pronta) e la gestione dei casi distruttivi seri.

## #42 C10: Aggiornare ticket e checklist solo quando le prove lo consentono

**Esito: PARTIAL, vicino a DONE sul codice.**

- **Ogni criterio ha esito e riferimenti a prove: fatto.** `evidenceProblems` in `app/src/main/core/tickets.ts`; test `tickets.test.ts:25-39` (rifiuta candidati non verificati, PR non pubblicate, testo libero come prova).
- **Transizioni di richiesta/candidato/PR/CI/merge/ticket distinte e riconciliate: fatto.** `updateTicket` (`controller.ts:2982-3044`) legge lo stato reale di issue, PR e CI prima di agire.
- **Checklist aggiornata solo dopo prova valida: fatto.** `checkItems` (righe 3005-3010).
- **Incremento parziale non chiude, errore non spacciato per successo: fatto e testato.** `closeBlockers` (`tickets.test.ts:52-58`) blocca la chiusura senza PR unita e CI verde.
- **Retry senza duplicati, cronologia conservata su riapertura: fatto e testato.** `progressKey`/`progressMarker` (`tickets.test.ts:41-50`) rende il commento idempotente.
- **Test, prova reale, revisione, CI, documentazione: parziale.** Solo test unitari (`tickets.test.ts`); manca la prova su una issue reale, la revisione Standards e Spec, la documentazione dei limiti.

**Manca:** unicamente la prova di completamento su una issue reale con CI verde, la revisione registrata e il documento dei limiti. Il meccanismo tecnico è già tutto presente e testato.

## #43 C11: Riprendere il Coordinatore dopo limiti, chiusura e indisponibilità

**Esito: PARTIAL, con lacune sostanziali.**

- **Esci arresta in modo controllato: in gran parte fatto.** `app/src/main/main.ts:317-326` (`before-quit` chiama `controller.stop()`); `controller.ts:544-569` imposta lo stato di chiusura, ferma i timer e chiama `stopSpecialistsForQuit` (`controller.ts:1118-1131`), che richiede stop e interrupt con timeout preservando chat, team, candidati e worktree.
- **Attesa sui limiti senza raffiche di retry: implementato, non testato.** `controller.ts:1133-1180` (commento esplicito "C11"): un solo timer per provider, ripresa solo degli incarichi ancora nel mandato. Nessun test: zero occorrenze in `controller.test.ts`; `codexClient.test.ts:34-49` copre solo la lettura dell'account bloccato, non attesa e ripresa.
- **Risveglio da sospensione: fatto.** `main.ts:302-307`, `powerMonitor.on("resume", ...)`.
- **Checkpoint del monitor senza duplicati: fatto.** `app/src/main/core/monitor.ts:244-312`, con backoff e deduplica per id evento.
- **Suoni facoltativi: presenti, non verificati su quali eventi li attivano.** `settings.sounds` propagato a `host.notify` (`controller.ts:511`, `:1082`, `:2526`; `main.ts:31`).
- **Stati distinti per finestra chiusa/Esci/stop/crash/sospensione/offline con ultimo aggiornamento: non fatto.** `AssignmentStatus` (`shared/domain.ts:344`) ha solo `preparing|running|stopRequested|stopped|completed|failed`, nessuna rilevazione di rete assente come stato applicativo.
- **Riconciliazione di un esito incerto prima di ripetere un'operazione con effetti: non trovata.** Nessuna logica dedicata in `app/src`.
- **Notifiche negate mantengono l'avviso in chat: non trovato.** `main.ts:30` salta la notifica solo se la finestra è a fuoco o le notifiche non sono supportate; nessuna verifica del permesso del sistema operativo negato con fallback in chat.
- **Test, prova reale, revisione, documentazione: mancano quasi del tutto.** Nessun documento in `docs/verifiche/` per C11; nessuna prova reale di limite Codex o rete assente (Codex è bloccato fino al 24 ottobre).

**Manca:** modello di stati con timestamp per i sei casi distinti, rilevazione di rete assente, riconciliazione esplicita dopo stop o uscita, avviso in chat quando le notifiche sono negate, test su attesa e ripresa dei limiti, prova reale, revisione, documento in `docs/verifiche/`.

## #44 C12: Configurare Trama al primo avvio con una guida riprendibile

**Esito: PARTIAL.**

- **Guida facoltativa, richiamabile, riprendibile senza ripetizioni: fatto e testato.** `app/src/shared/onboarding.ts:182-196` calcola i passi da `AppState`, mai da un timer; `shouldOpenGuideOnLaunch` apre la guida solo la prima volta; `GuideDialog.tsx:19-28`, `:132-192` gestisce ripresa e salto. Test `onboarding.test.ts:131-191`, passo in `ui-check.mjs:62-70`, `:562-565`.
- **GitHub proposto e rimandabile, distinto dai login: fatto.** `onboarding.ts:127-144`.
- **AI Hero conserva personalizzazioni con riepilogo, incompatibilità non sovrascritte: fatto.** `skillSetup.ts:228-248`, `:327-368` (`pathsCreated`/`existingPreserved`/`warnings`).
- **Verifica Codex con passo recuperabile per assenza/errore/annullamento/riparazione: parziale.** `app/src/shared/codex.ts:4-10` copre solo `unavailable`/`blocked`/`unsupported`; non c'è un percorso distinto di "riparazione" o "annullamento".
- **Passaggio al progetto reale con mandato/team/prerequisiti chiari: dipende da UX07 #105, già PARTIAL secondo `ticket-vecchi.md`** (bozza salvata, allegati solo in memoria).
- **Test, prova reale, revisione: parziale.** Nessun test o prova reale sull'intera guida da capo a fine, nessuna revisione registrata.

**Manca:** percorso distinto di riparazione/annullamento per Codex, chiusura delle lacune ereditate da UX07 #105, prova reale end-to-end, revisione.

## #45 C13: Imparare a conoscere un progetto con il primo esercizio guidato

**Esito: PARTIAL.**

- **Copia dedicata etichettata come esercizio, mai su progetti reali: fatto.** `demoProject.ts:20-40` clona il bundle in "Negozio" con marker `.trama-example`.
- **Avanzamento solo da azioni osservate: fatto e testato.** `firstExerciseSteps` (`onboarding.ts:260-281`): studio, lettura scheda, spiegazione con `references.length > 0` (non testo preconfezionato), apertura mappa/modulo, risposta a una decisione. Test `onboarding.test.ts:203-238`, prova in `ui-check.mjs:246-263`.
- **Senza provider, esplorazione locale con limite dichiarato: fatto.** Mappa e modulo restano raggiungibili; solo studio, spiegazione e decisione sono `blocked` con motivo (`onboarding.ts:277-279`).
- **Guida richiamabile senza duplicare: fatto**, calcolo derivato e non stato salvato a parte.
- **Richiesta informativa semplice non avvia team automaticamente: non testato esplicitamente.** Nessun test trovato che verifichi l'assenza di `assign_task` su questo esercizio, solo un prompt suggerito.
- **Test, prova reale, revisione: parziale.** Nessuna prova reale registrata (Codex bloccato fino al 24 ottobre), revisione Standards e Spec non fatta.

**Manca:** test esplicito che una domanda semplice non generi un incarico, prova reale con Codex, revisione registrata.

## #46 C14: Completare gli esercizi di modifica, decisione e conflitto

**Esito: PARTIAL, con base solida e testata.**

- **Modifica con vero test fallito e correzione, non timer: fatto.** `changeExerciseSteps` (`onboarding.ts:289-320`) legge fallimento, correzione e revisione dalle evidenze reali del candidato.
- **Decisione ferma solo gli incarichi dipendenti: fatto e testato.** `revisionExerciseSteps` (`onboarding.ts:322-342`); test `onboarding.test.ts:272-308`.
- **Conflitto marcato come esercizio, nessun collaboratore reale inventato: fatto.** `onboarding.ts:26-27`, `:68`: `.git/description` dichiara esplicitamente che non è un collaboratore reale, identità git fittizia `esercizio@trama.local`, confronto compatibile/incompatibile via `git merge-tree` locale senza toccare remote. Test dedicato verifica che HEAD e worktree del progetto reale restino invariati.
- **Nessuna pubblicazione implicita a fine esercizio: fatto.** `conflictExerciseSteps` filtra le PR (`onboarding.ts:345`).
- **Salta/interrompi/riprendi conserva dati, sblocca "Apri il mio progetto"/"Crea un progetto": fatto.** `ExercisePanel.tsx:146-157`.
- **Mandato del team spiegato e motivato: parziale.** È solo testo libero nel prompt suggerito (`onboarding.ts:222-224`) e nel campo `modelReason`, senza struttura né test dedicato, la stessa lacuna già nota per UX05 #103.
- **Test, prova reale, revisione: parziale.** Nessuna prova con un revisore reale, nessuna revisione registrata.

Nessuna delle tre parti è superata da #118 o da #137: #118 (skill AI Hero col testo originale) è già l'implementazione usata da `aiHeroStep`/`nativeSkills.ts:6-8`, non un cambio di requisiti; #137 introduce il lavoro in focus per obiettivo, e i messaggi degli esercizi girano oggi con `goalId: null` (`ExercisePanel.tsx:17`), un piccolo disallineamento da controllare, non un superamento dichiarato.

**Manca:** struttura e test per la motivazione del team, prova con un Coordinatore e un revisore reali, revisione registrata.

## #47 C15: Migliorare i team con pratiche verificate e reversibili

**Esito: PARTIAL, con le due parti del ticket in stadi diversi.**

Il ticket ha due parti: le pratiche generali del team, e l'estensione del 20 settembre 2026 per portare il sistema di apprendimento di Hermes Agent, con brief in `docs/progettazione/apprendimento-hermes.md`.

**Parte pratiche generali, sostanzialmente presente con prova reale:**

- **Evidenza obbligatoria, contenuti privati esclusi, versioni con rollback: fatto.** `app/src/main/core/practices.ts`: `problemEvidence` (righe 22-46), `privateContent` (righe 52-58), versioni/rollback/ritiro con storia (righe 86-156). Test in `practices.test.ts`.
- **Integrazione nel Coordinatore e in Memoria: fatto.** `coordinatorTools.ts:368-377` (`propose_practice`, `read_practices`), `controller.ts:409-474`, `:1672-1675` (solo pratiche adottate arrivano al Coordinatore), `MemoryView.tsx:324-386` (adotta, passa versione, torna indietro, ritira).
- **Prova diretta nell'app registrata.** `docs/verifiche/w12-controlli-2026-09-25.md:115-116` documenta un controllo reale, con un bug di ritiro con motivo vuoto trovato e corretto.
- **Evoluzione di ruoli/istruzioni/modelli senza toccare permessi: solo indirettamente coperto**, le pratiche restano testo nei prompt, senza codice dedicato a questo criterio specifico.
- **Manca:** revisione Standards e Spec registrata per C15, documento dedicato ai limiti.

**Parte porting Hermes, codice reale ma senza la prova dichiarata mancante dal brief stesso:**

- `docs/progettazione/apprendimento-hermes.md`, `docs/adr/0014-apprendimento-di-hermes.md`, `docs/hermes-attribution.md` e la licenza esistono e sono coerenti tra loro (mappa del sorgente, licenza MIT, differenze dichiarate).
- Codice in `app/src/main/core/learning/` (memoria, recupero sessioni, skill, revisione, curatela), unito a `main` con il commit "feat(app): port Hermes Agent's learning loop to the Coordinator (#111)", con test associati a ogni modulo.
- **Manca esplicitamente, per dichiarazione dello stesso brief:** la prova con un provider reale. Non risultano test di isolamento cross-progetto oltre a quelli già in `memoryStore.test.ts`, né test sull'osservabilità di trigger e mancato completamento della revisione dell'esperienza. Nessun registro in `docs/verifiche/` per la prova reale del ciclo di apprendimento.

**Manca in totale:** revisione Standards e Spec per la parte pratiche, prova con provider reale per il porting Hermes, test di isolamento cross-progetto e di osservabilità dei trigger di apprendimento, documento dei limiti.

## #21 T19: Adattare il layout alle dimensioni della finestra

**Esito: PARTIAL.**

Il testo originale del ticket cita file SwiftUI (`WorkspaceView.swift`, `ProjectMapView.swift`) rimossi da tempo: l'app è oggi Electron secondo ADR 0011, quindi il criterio va letto sull'impianto attuale. I tre documenti di verifica citati nel ticket (`responsive-primo-passaggio-2026-09-13.md` e seguenti) descrivono `NSTextView`, `AnyLayout` e `swift test`: sono superati dall'ADR 0011 e non provano nulla sull'app di oggi.

Esiste lavoro reale più recente di quei documenti: il commit `d4b7fda` ("feat(app): adapt the layout to narrow and wide windows", riferito a `#21`), unito a `main` tramite il merge `e937990`, antenato di `HEAD`.

- **Dimensione minima e cinque misure di prova: fatto e verificato in questa sessione.** `app/src/main/main.ts:54-55` fissa `minWidth: 720, minHeight: 640`. `app/scripts/ui-check.mjs:652` prova esattamente le cinque dimensioni del criterio (720x640, 1040x700, 1280x800, 1440x900, 1920x1080); ho eseguito lo script in questa verifica e tutti e cinque i passi sono passati, screenshot compresi.
- **Niente testo rimpicciolito artificialmente, scorrimento orizzontale confinato: fatto e verificato.** `ui-check.mjs:657-658` fa fallire il passo se il composer scende sotto 300px o se compare scorrimento orizzontale, a ognuna delle cinque dimensioni.
- **Inspector che si comprime o chiude in modo prevedibile, contesto conservato: fatto, con un disegno diverso da quello originale.** `Inspector.tsx:56`: sotto 859px di larghezza del contenitore, l'inspector passa da fisso a flottante sopra la chat invece di schiacciarla; `CHAT_MIN_WIDTH = 420` (righe 18, 59) è sempre garantito. `ui-check.mjs:663-665` verifica che Esc chiuda l'inspector a ogni dimensione. La sidebar si chiude solo manualmente, non con un collasso automatico sotto soglia come nella vecchia versione Swift: è una scelta di disegno diversa, non necessariamente una mancanza rispetto al criterio "in modo prevedibile".
- **Mappa a colonne adattive: il testo del criterio è superato dall'architettura Electron.** La Mappa oggi è una lista verticale (`MapView.tsx:34-46`, `role="listbox"`), non la griglia multi-colonna del vecchio `ProjectMapView.swift`. Truncate e `flex-1` evitano sovrapposizioni di titoli e badge; la ricerca è nella palette globale, non nella mappa. `ui-check.mjs:659-661` prova apertura e selezione a ogni dimensione con screenshot.
- **Modali con azioni sempre raggiungibili: presente nel codice, non verificato nel ciclo delle cinque dimensioni.** `Dialogs.tsx` usa un componente Modal condiviso con un'area `footer` separata dal corpo scrollabile, ma `ui-check.mjs` non lo prova esplicitamente a ognuna delle cinque misure.
- **Testo lungo, liste vuote, caricamento, errore alle cinque dimensioni: non verificato esplicitamente** nel ciclo attuale di `ui-check.mjs`.
- **Tastiera e lettore di schermo sulle modali e sul passaggio inspector/sidebar: non documentato.**
- **Documento di verifica dedicato: manca.** Non esiste in `docs/verifiche/` un registro di questo incremento del 24 settembre con schermate prima e dopo sugli stessi dati campione, come chiede la prova di completamento del ticket; gli screenshot prodotti da `ui-check.mjs` non restano nel repository.

**Manca:** verifica esplicita di testo lungo, liste vuote, caricamento ed errore alle cinque dimensioni; prova da tastiera e lettore di schermo sulle modali; documento di verifica dedicato con schermate salvate; revisione Standards e Spec.

**Proposta:** riscrivere il testo del ticket per l'architettura Electron attuale (togliere i riferimenti a colonne multiple e ai file Swift, descrivere l'inspector flottante sotto soglia come comportamento atteso), mantenendo i criteri ancora aperti su stati vuoti/caricamento/errore, tastiera, lettore di schermo e documento di verifica.

## Limiti di questa verifica

- Ho delegato la ricerca del codice a sette verifiche indipendenti, una o due issue per volta, per coprire dodici ticket in un tempo ragionevole; ho controllato io stesso, con `git cat-file` e `git log`, che i commit citati nei commenti sospetti non esistano.
- Ho eseguito io stesso `npm ci`, `tsc`, `vitest` e `ui-check` sulla base indicata (`c411f55`), dopo aver unito l'ultimo avanzamento di `origin/main` nel branch di questo audit. Non ho aperto l'app a mano e non ho fatto prove con provider reali.
- Le citazioni di file e riga provengono dalle verifiche delegate: non ho riletto personalmente ogni riga citata, ma i test indicati sono stati eseguiti da me con la suite `vitest run` sopra descritta ed sono risultati tutti superati.
