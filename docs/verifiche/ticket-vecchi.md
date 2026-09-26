# Verifica dei ticket vecchi rimasti aperti

Data: 26 settembre 2026. Base: `origin/main` a `cd6b021` (merge della PR #168).

Questo documento confronta i criteri di accettazione di tredici issue aperte con il codice, i test e le PR unite su `main`. Non chiude issue e non cambia codice: il coordinatore decide le chiusure partendo da qui.

## Metodo

- Ho letto ogni issue con i commenti e ho cercato ogni criterio nel codice di `app/`, nei test, in `app/scripts/ui-check.mjs`, negli ADR e nei registri di `docs/verifiche/`.
- Un commento nella issue non vale come prova. Alcuni commit citati nei commenti di UX01-UX07 (`e1c9f49`, `10b81ca`, `242f2b4`) non esistono nella cronologia di `main`: il codice di quei ticket è arrivato con la PR #110 (squash `b882012`) e la PR #116. Ho controllato il codice, non i commenti.
- Le citazioni di file e righe si riferiscono a `cd6b021`.

Categorie:

- **DONE**: tutti i criteri sono soddisfatti.
- **SUPERSEDED**: un ticket o una decisione più recente sostituisce il ticket.
- **PARTIAL**: una parte c'è, il resto è elencato.
- **TODO**: nessun criterio ha evidenza.

## Controlli eseguiti su `cd6b021`

In `app/`, su Linux:

- `npm ci`: riuscito.
- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 66 file, 584 test superati, 3 saltati. Uno dei saltati è il test UX01 del salvataggio fallito, che si salta quando il processo gira come root (commit `dc017f6`, issue #169).
- `npm run build` e poi `xvfb-run -a node scripts/ui-check.mjs`: **fallito**, due volte su due, allo stesso punto. A `ui-check.mjs:534` il clic su "Ferma" nel passo automatico "Prepara il piano" va in timeout. Il pulsante compare (la riga 531 passa), poi il clic non riesce. Sembra che il passo finisca prima del clic, ma non l'ho dimostrato. Sulla CI della PR (Ubuntu, `xvfb-run -a npm run ui-check`) lo stesso codice passa, quindi il fallimento dipende dai tempi di questo ambiente. Resta un passo sensibile ai tempi, da seguire in un ticket a parte.

## Riepilogo

| Issue | Titolo breve | Esito |
|---|---|---|
| #61 | Tastiera e scorciatoie | PARTIAL |
| #63 | Specifica: il Coordinatore vero | PARTIAL |
| #71 | V08: forma dell'adattatore provider | PARTIAL, con parti superate dall'ADR 0012 |
| #72 | V09: prova reale Trama su Trama | PARTIAL |
| #97 | Specifica: esperienza centrata su obiettivi | PARTIAL |
| #99 | UX01: creare e ritrovare obiettivi | PARTIAL, manca solo il processo |
| #100 | UX02: dialogo nel contesto dell'obiettivo | PARTIAL |
| #101 | UX03: panoramica dei progetti per attenzione | PARTIAL |
| #102 | UX04: decidere e vedere l'impatto | PARTIAL |
| #103 | UX05: team, incarichi e modelli | PARTIAL |
| #104 | UX06: valutare un risultato della versione precisa | PARTIAL |
| #105 | UX07: aprire un progetto e il primo obiettivo | PARTIAL |
| #106 | UX08: verificare l'esperienza completa | TODO |

Nessuna issue è DONE e nessuna è del tutto SUPERSEDED. Le specifiche più recenti (#118 metodo AI Hero, #137 ciclo di lavoro focalizzato) lavorano sopra gli obiettivi e il Coordinatore, ma non dichiarano di assorbire nessuno di questi ticket. Alcune parti dei testi sono però superate:

- i riferimenti a SwiftUI, all'app nativa macOS e a VoiceOver in #63, #71, #97 e UX01-UX08 sono superati dall'ADR 0011 (Electron) e dall'ADR 0012 (provider in TypeScript);
- "Codex come unico adattatore" in #71 è superato dall'ADR 0012 e dalla PR #110, che hanno portato nove adattatori.

Criteri che mancano in quasi tutti i ticket UX e V:

- prova con un Coordinatore reale registrata in `docs/verifiche/` (Codex è bloccato fino al 24 ottobre secondo `docs/verifiche/v09-trama-su-trama-2026-09-24.md`);
- revisione Standards e Spec registrata;
- prova con lettore di schermo.

Se il coordinatore vuole chiudere i ticket vecchi, una strada è riscrivere questi tre punti come ticket trasversali e riportare nei ticket nuovi solo le parti funzionali ancora aperte.

## #61 Tastiera e scorciatoie: sezioni, moduli in sidebar, focus sul campo

**Esito: PARTIAL.**

L'impianto è cambiato dopo il ticket (ADR 0007, PR #135): i moduli stanno nella Mappa dell'ispettore e la barra laterale contiene i pannelli. Il criterio sulle voci in sidebar va letto su questo impianto.

- **Moduli selezionabili con le frecce e sfondo di selezione: parziale.** La lista dei moduli ha `role="listbox"` e le frecce, Home e End spostano il focus (`app/src/renderer/components/inspector/MapView.tsx:34`, `:165-180`). Però `aria-selected` è sempre `false` (`MapView.tsx:39-40`) e la riga ha solo lo stile di hover (`MapView.tsx:8-9`). Nella barra laterale le voci hanno lo sfondo di selezione (`app/src/renderer/components/sidebar/Sidebar.tsx:44`, `:68`), ma non hanno le frecce né `aria-current`. Nessun test.
- **Scorciatoie e focus sul campo: presenti, senza test.** ⌘O apre un progetto (`app/src/main/main.ts:229`). ⌘1..⌘8 aprono Mappa, Patto, Mandato, Issue, Team, Lavoro, Gruppo e Memoria (`main.ts:258-265`, gestione in `app/src/renderer/App.tsx:69-72`). ⌘L porta il focus al composer (`main.ts:254`, `App.tsx:68`). `ui-check.mjs` prova solo Ctrl+K. Non c'è una scorciatoia per Obiettivi.
- **Prova con lettore di schermo: non fatta.**

**Manca:** stato di selezione visibile e annunciato nella Mappa e nella barra laterale, frecce nella barra laterale, un test o un passo di ui-check per le scorciatoie, la prova con lettore di schermo.

## #63 Specifica: il Coordinatore vero, incremento verticale

**Esito: PARTIAL.** Si valuta sui figli.

- Chiusi: V01 #64, V02 #65, V03 #66, V06 #69, V07 #70.
- Aperti: V04 #67, V05 #68, V08 #71 (PARTIAL, sotto), V09 #72 (PARTIAL, sotto).
- La specifica chiede per la chiusura tutte le prove, compresa quella reale. V09 non l'ha completata.
- La specifica prevede di chiudere #57-#61 come assorbiti; #61 è ancora aperto.
- Il testo di `docs/spec-coordinatore-verticale.md` parla ancora di app Apple (riga 44) e di provider riscritti in Swift (riga 62), mentre valgono gli ADR 0011 e 0012.

V04 e V05 non sono stati verificati criterio per criterio in questo documento: ne ho controllato solo lo stato.

**Manca:** chiusura di V04, V05, V08 e V09; aggiornamento del testo della specifica agli ADR 0011 e 0012; decisione su #61.

## #71 V08: Forma dell'adattatore provider con Codex come unico adattatore

**Esito: PARTIAL.** Una parte è superata dall'ADR 0012.

Il registro `docs/verifiche/v08-adattatore-provider-2026-09-18.md` descrive codice Swift (`ProviderConformance`, `ProviderStatusStore`, `ModelCatalogCache`, watchdog) che è stato tolto con i sorgenti SwiftUI. Non vale come prova dello stato attuale.

- **Interfaccia con capacità, stato di accesso e catalogo: quasi soddisfatto.** `AgentRuntime` in `app/src/main/core/providers/types.ts:70-82`; capacità in `app/src/shared/providers.ts:2-22`; stato di accesso con `blocked` e data di sblocco in `app/src/shared/codex.ts:4-10`. Manca un valore esplicito "sconosciuto": esiste solo come ripiego nell'interfaccia (`app/src/renderer/components/settings/SettingsView.tsx:223`).
- **Eventi normalizzati: soddisfatto.** `TurnEvent` in `codex.ts:33-46`, emesso da tutti i runtime tramite `onEvent` (`types.ts:54`); test in `app/src/main/core/codexClient.test.ts`.
- **Schermata dei collegamenti con la stessa forma: parziale.** Gli otto provider hanno stato, "Verifica" e pannello "Capacità" (`SettingsView.tsx:313-384`). La riga di ChatGPT e Codex (`SettingsView.tsx:263-285`) non ha il pannello delle capacità. "Codex unico adattatore" è superato: oggi ci sono nove adattatori (`app/src/main/core/providers/registry.ts:15-25`).
- **Controllo di conformità tra capacità e metodi: assente.** Nessun riferimento a `conformance` in `app/src`.
- **Infrastruttura comune: in gran parte assente.** C'è un solo controllo di accesso alla volta per provider (`app/src/main/controller.ts:620-627`, `:676-684`). Mancano lo stato dei provider salvato su disco e mostrato all'avvio, la cache dei modelli con aggiornamento in background (`listModels` viene chiamato a ogni verifica, `controller.ts:638`, `:701`) e la chiusura delle sessioni inattive.
- **Codex ottimizzato: parziale.** L'inizializzazione è unica anche con avvii concorrenti (`codexClient.ts:461-471`). La ripresa apre un thread nuovo su qualunque errore RPC, non solo quando il thread non esiste più (`codexClient.ts:320-329`). Non c'è il watchdog dei turni fermi. All'avvio a freddo si chiama `model/list`. `model_provider` è fisso a `"openai"` (`codexClient.ts:17`).
- **Nessuna regressione dal vivo e prova reale: non verificato.** Codex è bloccato fino al 24 ottobre.

**Manca:** controllo di conformità, capacità sulla riga Codex, stato dei provider su disco, cache dei modelli, chiusura delle sessioni inattive, watchdog, niente `model/list` all'avvio a freddo, ripresa limitata al thread inesistente, stato sconosciuto, prova reale con `gpt-5.6-luna`. In alternativa si può riscrivere il ticket dichiarando superate le parti Swift secondo l'ADR 0012.

## #72 V09: Prova reale Trama su Trama e chiusura dell'incremento

**Esito: PARTIAL.**

La prima prova reale è unita con la PR #112 (`docs/verifiche/v09-trama-su-trama-2026-09-24.md`). Il percorso completo non c'è.

- **Percorso di base per ogni provider collegato: non soddisfatto.** Pi ha fatto messaggio, lettura del mandato, interruzione, riavvio e ripresa (registro, righe 62-69). Claude ha fatto studio, team, mandato e incarico, senza interruzione, ripresa e candidato (righe 49-60). Codex non è stato eseguito (righe 40-47). Cursor, Antigravity, Grok, Devin e OpenCode non sono stati provati; Droid non è collegato.
- **Documento in `docs/verifiche`: parziale.** Esiste, ma non c'è il controllo fallito e poi corretto dentro Trama e non c'è un candidato dichiarato. Le prove reali di #34 restano da fare: `docs/verifiche/c02-streaming-fonti-2026-09-24.md` usa solo il Codex di prova.
- **Piano operativo aggiornato: non soddisfatto.** `docs/piano-operativo.md` è fermo al 20 settembre (`62d9ed7`), cita ancora ADR 0008 e Swift e indica P01 "in corso", mentre #80 è chiuso.
- **Percorso da clone pulito: parziale.** Su macOS `npm ci`, typecheck e build riescono (registro, righe 26-38). Il test UX01 è instabile (#169). Il ui-check è passato sulla CI ma è fallito nella sandbox di questa verifica a `ui-check.mjs:534` (vedi sopra).
- **Nessuna regressione su scanner, Patto, worktree, GitHub, monitor e modelli: solo nei test automatici** (`repositoryScanner.test.ts`, `pact.test.ts`, `workspace.test.ts`, `github.test.ts`, `monitor.test.ts` in `app/src/main/core/`). Le verifiche Node aggiunte dopo la prova (`app/src/main/core/checks.ts:64-80`, test in `checks.test.ts`) non sono state riprovate nel percorso reale.
- **Revisione Standards e Spec: non registrata.**

**Manca:** percorso completo con Codex e `gpt-5.6-luna` dopo lo sblocco; un candidato dichiarato e verificato con un controllo fallito e poi corretto; giro sugli altri provider collegati; piano operativo aggiornato; prove reali di #34; revisione.

## #97 Specifica: esperienza di Trama centrata su obiettivi e risultati

**Esito: PARTIAL.** Si valuta sui figli.

- UX00 #98 è chiuso come superato dall'ADR 0011.
- UX01-UX07 (#99-#105) sono PARTIAL, UX08 #106 è TODO (sezioni sotto).
- La specifica non è superata: la #137 costruisce sopra gli obiettivi (il task in focus è il lavoro di un obiettivo, `CONTEXT.md:55`) e W03 (PR #151) ha aggiunto archiviazione ed eliminazione degli obiettivi.
- Il testo cita ancora SwiftUI e l'app nativa macOS, superati dall'ADR 0011.

**Manca:** completare UX01-UX08 e aggiornare il testo della specifica a Electron.

## #99 UX01: Creare e ritrovare obiettivi con esempi verificabili

**Esito: PARTIAL.** Il comportamento c'è ed è testato. Mancano solo i criteri di processo.

- **Creazione e modifica con validazione, salvate prima dell'esito: fatto.** `app/src/main/core/goals.ts:25-52`; `app/src/main/controller.ts:2085-2101` e `saveGoalChange` a `:2154-2179` (scrittura prima della risposta, ritorno allo stato su disco se fallisce); test `goals.test.ts` "refuses invalid input" e `controller.test.ts:212`; il modulo resta aperto se il salvataggio fallisce (`GoalsView.tsx:173`).
- **Lista e dettaglio ritrovano lo stesso obiettivo, stati espliciti: fatto.** `GoalsView.tsx:246`, `:261`, `:432`; `goalWorkSummary` in `app/src/shared/goals.ts:115-124`; riavvio e riapertura in `ui-check.mjs:684-706`.
- **Relazioni con identità esplicite: fatto.** `goalLinks` in `shared/goals.ts:101-112`; `goalId` su richieste, eventi e incarichi (`shared/domain.ts:57`, `:79`, `:392`).
- **Migrazione senza obiettivi indovinati: fatto.** `goals.test.ts:126`, `:143`.
- **Creare un obiettivo non concede un mandato: fatto.** `goals.test.ts:94-96`, `controller.test.ts:118-130`.
- **Glossario e ADR: fatto, con una riserva.** `CONTEXT.md:77`, `:85`, `:87`; l'ADR 0013 è ancora nello stato "proposta".
- **Test e prova con la tastiera: fatto con limiti.** Il test del salvataggio fallito si salta da root ed è instabile (#169). La prova nell'app usa il Codex di prova.
- **Revisione Standards e Spec: manca.** Nella PR #116 la voce non è spuntata. Nessun registro in `docs/verifiche/`.

**Manca:** revisione registrata, registro di verifica legato a un commit, chiusura di #169, accettazione dell'ADR 0013.

## #100 UX02: Dialogare con il Coordinatore nel contesto dell'obiettivo

**Esito: PARTIAL.**

- **Due obiettivi con cronologie, bozze e allegati distinti: quasi fatto.** Test `controller.test.ts:132-194`; `ui-check.mjs:293-295`. Gli allegati non inviati restano solo in memoria (`app/src/renderer/components/chat/Composer.tsx:49-50`) e non sopravvivono al riavvio.
- **Destinatario visibile e fissato all'invio: fatto.** `ChatView.tsx:142`, `controller.ts:360`, `goals.test.ts:213`, `controller.test.ts:163-171`.
- **Un solo Coordinatore responsabile: fatto per scelta.** ADR 0013, riga 13.
- **Incarichi e risultati collegati all'obiettivo: parziale.** `goals.test.ts:303`; `candidateGoalId` in `shared/goals.ts:87-90`; `controller.test.ts:196`. Nessun test sugli eventi duplicati. La risposta a una richiesta di mandato va sempre al dialogo di progetto (`controller.ts:2293`) e `MandateRequest` non ha `goalId` (`shared/domain.ts:191`).
- **Selettore del modello per dialogo: fatto** (`controller.ts:1977`, `controller.test.ts:145-148`). Nessun test sul cambio di provider da un dialogo di obiettivo.
- **Test di risposta tardiva, autorizzazione tardiva, duplicato: in parte.** C'è solo il turno tardivo quando si lascia il progetto (`controller.test.ts:701`).
- **Prova con provider reale e revisione: mancano.**

**Manca:** prova reale registrata, test su autorizzazione tardiva e duplicati, allegati persistiti, destinazione della risposta al mandato chiesto da un obiettivo, revisione.

## #101 UX03: Aprire la panoramica dei progetti per attenzione

**Esito: PARTIAL.**

- **Panoramica con progetti e collegamenti agli obiettivi: fatto.** `app/src/main/core/overview.ts:13-67`, `OverviewView.tsx:95-125`, `ui-check.mjs:296-299`.
- **Ordinamento deterministico con le priorità esplicite della persona: parziale.** L'ordine è stabile (`overview.ts:94-97`, test `goals.test.ts:464`), ma usa solo categorie fisse (`overview.ts:5`). Le priorità della persona non entrano.
- **Aggiornamento e disponibilità delle fonti: fatto in parte.** `OverviewView.tsx:17-29`, `controller.ts:2191-2228`. I dati live non mostrano l'orario.
- **Selezione, bozze e C07: parziale.** L'apertura del progetto e dell'obiettivo c'è (`OverviewView.tsx:57-60`, `:108-111`). Un turno del Coordinatore lasciato in corso viene interrotto e la fine tardiva ignorata (`controller.test.ts:701`), non consegnata. C07 #39 è aperta.
- **Stesso remote, progetti distinti: probabile, non testato.** L'id dipende dal percorso (`controller.ts:729-754`).
- **Niente secondo archivio e niente furto del focus: fatto** (`controller.ts:2191`, `OverviewView.tsx:48-57`).
- **Test e prova reale con due progetti, tastiera e finestra stretta: parziale.** ui-check apre la panoramica con un solo progetto e con il mouse.

**Manca:** priorità esplicite nell'ordinamento, chiusura di C07 #39, test su priorità, risultati tardivi e stesso remote, prova con due progetti da tastiera e in finestra stretta, revisione.

## #102 UX04: Decidere e vedere l'impatto sui lavori dipendenti

**Esito: PARTIAL.**

- **Raccolta persistente delle decisioni aperte: fatto.** `PactView.tsx:66-72`, `GoalsView.tsx:373-383`, `shared/goals.ts:102-112`.
- **Scheda e dialogo con la stessa azione, niente doppia decisione: in gran parte.** `DecisionCard` è lo stesso componente in Patto e timeline (`PactView.tsx:69`, `TimelineRows.tsx:347`); la seconda risposta è rifiutata (`pact.ts:195`, test `pact.test.ts:30`). La modifica diretta (`pact:decide`, `pact.ts:18-42`) non controlla la versione attesa.
- **Dipendenti e conseguenze visibili: in gran parte.** `DecisionDependentsSection` in `PactView.tsx:153-207`; decisione mancante segnalata in `GoalsView.tsx`; test `goals.test.ts:379`.
- **Il cambio passa da C06 e sospende solo i dipendenti: parziale.** `stopWorkDependingOn` in `controller.ts:2232-2251`, `team.ts:803-825`, test `team.test.ts:255`; stati di arresto richiesto e confermato in `team.ts:709-716`. C06 #38 è aperto e l'interfaccia non ha uno stato "ricalcolo".
- **Evidenze precedenti storiche, esito tardivo: parziale.** `EVIDENCE_STALE` e `DECISION_CHANGED` in `candidates.ts:110-122`; nessun test sull'esito tardivo di un lavoro sospeso.
- **Conservare selezione e bozza alla chiusura: non testato.**
- **Test richiesti e prova reale: parziale.** Ci sono duplicato e due incarichi. Mancano risposta obsoleta, evento tardivo, riavvio e prova reale. ui-check non apre i lavori dipendenti.

**Manca:** chiusura di C06 #38, controllo di versione sulla modifica diretta, stato "ricalcolo", test mancanti, passo in ui-check, prova reale, revisione.

## #103 UX05: Comprendere team, incarichi e scelte dei modelli

**Esito: PARTIAL.** W09 #146 (PR #165) ha rifatto la vista Team ma non copre i criteri sulla scelta del modello. W05 #142 è aperto e si sovrappone.

- **Sintesi dell'agente: in gran parte.** `TeamView.tsx:191-335`; `AssignmentCard` in `Cards.tsx`.
- **Modello scelto distinto da quello eseguito: parziale.** `AssignmentTurn` in `shared/domain.ts:353-362`; avviso "Ultimo turno eseguito con" in `Cards.tsx`. Non c'è una cronologia per turno visibile. Un `provider` assente vale "codex" (`domain.ts:357`), quindi un dato mancante viene dedotto invece di restare assente.
- **Criteri, capacità e limiti della scelta: parziale.** C'è solo il testo libero `modelReason` (`domain.ts:389-390`, `team.ts:445`).
- **Il costo pesa solo fra i modelli adeguati: solo nel prompt** di `assign_task` (`coordinatorTools.ts:345`), senza regola nel codice né test.
- **Persona e Coordinatore intervengono conservando incarico e worktree: fatto.** `changeAssignmentProvider` in `team.ts:777-797`; `TeamView.tsx:410-459`; W13 e W15 con la PR #162.
- **ADR 0009 aggiornato: non fatto.** `docs/adr/0009-provider-a-runtime.md:16` dice ancora che gli specialisti partono dal modello più economico.
- **Test e prova reale: parziale.** `goals.test.ts:303`, `:345`. Mancano capacità e limiti, proposto diverso da eseguito, prova reale.

**Manca:** criteri, capacità e limiti strutturati; regola sul costo con test; ADR 0009; cronologia per turno; test elencati; prova reale.

## #104 UX06: Valutare e provare un risultato della versione precisa

**Esito: PARTIAL.** C09 #41 (prerequisito dichiarato) e W10 #147 (cancello dei revisori) sono aperti.

- **Esempi e verifiche del risultato: parziale.** `CandidateView.tsx:23-90`, `Cards.tsx:653-713`. Mancano le istruzioni per provare il comportamento.
- **Ogni evidenza legata a candidato e versione: in gran parte.** `exampleChecks` in `shared/goals.ts:166-174`; `inspectCandidate` in `candidates.ts:106-135`; test `goals.test.ts:412`. La riga della verifica in `Cards.tsx:683-691` mostra "superata" anche con evidenza obsoleta; l'obsolescenza compare solo in "Cosa manca".
- **Diff, output, revisione e cronologia delle prove: parziale.** Diff in `CandidateView.tsx:101-110`, revisione in `Cards.tsx:697-701`. L'output completo delle verifiche non è mostrato per i candidati reali e non c'è una cronologia delle prove.
- **Niente verde obsoleto dopo un cambio: parziale.** `candidates.ts:106-160`, test `candidates.test.ts:42`. Nessun controllo per un risultato senza modifiche.
- **Stato di integrazione con PR, CI, merge e disponibilità separati: non fatto.** C'è solo il collegamento alla PR (`Cards.tsx:731-739`).
- **Stato "da riconciliare": non fatto.**
- **Test richiesti e prova reale: parziale.** Ci sono evidenza obsoleta e verifica fallita (`candidates.test.ts:42`, `:72`). Mancano revisore distinto, merge sconosciuto, nessuna build e prova reale.

**Manca:** stati di integrazione, stato "da riconciliare", output e cronologia delle prove, istruzioni per provare, gestione del risultato senza modifiche, test elencati, prova reale.

## #105 UX07: Aprire un progetto e formulare il primo obiettivo

**Esito: PARTIAL.**

- **Studio in sola lettura con fonti e limiti: parziale.** `study.ts`, `repositoryScanner.test.ts:30`, `:47`. Nessun test su studio parziale o dati non disponibili.
- **Primo obiettivo subito, chiarimento se la richiesta è ambigua: fatto.** `ChatView.tsx:284-299`, `controller.ts:212-214`, test `controller.test.ts:118`, `ui-check.mjs:276-283`; chiarimento con M01 (PR #115) e W01 (PR #150).
- **Accessi mancanti con motivo e rimedio: parziale.** `shared/onboarding.ts:127-128`, `ChatView.tsx:264-273`. Nessun test.
- **Team e modelli proposti con motivazioni, mandato esplicito: parziale.** Il mandato resta vuoto (`controller.test.ts:118-130`), ma le motivazioni dipendono da UX05, che è parziale.
- **Mandato applicato prima delle modifiche, senza approvazioni ripetute: fatto.** `authorize` in `team.ts:742-754`; W04 #141 (PR #164).
- **Tornare al progetto conserva obiettivo, bozza e studio: in gran parte.** La bozza è salvata su disco (`Composer.tsx:57-105`); immagini e testi incollati restano solo in memoria.
- **Test e prova reale fino al primo incarico: parziale.** Mancano accessi mancanti, studio parziale e la prova reale.

**Manca:** test su accessi mancanti e studio parziale, prova reale dall'apertura al primo incarico autorizzato, motivazioni UX05, revisione.

## #106 UX08: Verificare l'esperienza completa nella build unificata

**Esito: TODO.**

È un ticket di sola verifica e dipende da UX03-UX07, che non sono completi. Non esiste un registro in `docs/verifiche/`. ui-check copre solo frammenti con il Codex di prova (`ui-check.mjs:276-300`, `:684`). W01-W15 e M01-M05 hanno cambiato l'esperienza (barra di focus, fase calcolata, team completo): la prova andrà fatta su una build che li include e confrontata anche con la specifica #137.

## Limiti di questa verifica

- Ho eseguito tsc, vitest e ui-check sulla base indicata. Non ho aperto l'app a mano e non ho fatto prove con provider reali.
- Il test UX01 del salvataggio fallito non è stato eseguito perché la macchina gira come root.
- Le valutazioni di V04 #67 e V05 #68 non sono in questo documento.
