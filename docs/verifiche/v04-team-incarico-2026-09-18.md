# V04: team di progetto e incarico in worktree

Verifica iniziata il 18 settembre 2026 e completata il 19 settembre 2026 per #67. Base dei test automatici: `main` a `fb7c587` (V01, V02, V03 e V07 integrati), poi `8ba959e`. Il codice è entrato in `main` a `f11b23d` (PR #96) insieme a V05, V06 e V08. La prova diretta nell'app è stata eseguita il 19 settembre 2026 su `main` a `f11b23d`, con l'aggancio temporaneo della prova rimosso nel commit `61d187c`. Componente reale: Codex CLI 0.154.0 il 18 settembre e 0.155.1 il 19 settembre, con l'account ChatGPT del Mac. Ogni turno reale ha girato su `gpt-5.6-luna`, passato esplicitamente.

## Stato

- Test automatici: verdi su `main` a `f11b23d` con l'aggancio rimosso, 347 test Swift Testing in 40 suite e 165 test XCTest (`swift test`, 19 settembre 2026).
- CPU a riposo con le schede nuove: misurata, il thread principale resta in attesa di eventi.
- Prova diretta nell'app: **eseguita** il 19 settembre 2026 con turni Codex reali. Tutti i tredici passi della prova sono passati; le catture sono in `docs/verifiche/v04/` e il resoconto completo dell'aggancio in `docs/verifiche/v04/resoconto-prova.md`. Il checkout principale di Trama e quello del progetto sono rimasti identici (HEAD, albero, indice e stato). Vedi «Prova diretta nell'app».

## Test automatici

`swift test` sul candidato: 295 test Swift Testing in 34 suite e 112 test XCTest, nessun fallimento. Sul codice ormai in `main` a `f11b23d`, dopo la rimozione dell'aggancio, la stessa suite è cresciuta a 347 test Swift Testing in 40 suite e 165 test XCTest, tutti verdi. Le suite nuove di V04 sono queste.

- `Project team`, il dominio del team senza Codex: una proposta vuole almeno uno specialista, con competenza e motivo, e nomi distinti; proporre non crea nessuno e una nuova proposta sostituisce quella in attesa; la conferma crea gli specialisti una volta sola e una seconda risposta è rifiutata; la correzione tiene solo gli specialisti scelti e registra chi è stato tolto e la nota; dopo la conferma si aggiunge uno specialista solo per lavoro nuovo, mai per un ruolo già libero; uno specialista tolto conserva la sua storia e non riceve incarichi; un incarico registra obiettivo, ticket, perimetro, dipendenze, modello, strumenti, verifiche richieste e versione del mandato; uno specialista occupato non prende un secondo incarico; il parallelismo richiede lavoro indipendente (nessun modulo in comune con lavoro attivo, nessuna dipendenza non conclusa) e non ha limite fisso; il ciclo del turno porta l'incarico da in preparazione a concluso conservando risultato e turni; l'arresto è prima richiesto e poi confermato; un turno che finisce da solo dopo la richiesta di arresto resta concluso; il lavoro senza runtime vivo viene fermato da Trama e l'arresto con rimozione fa uscire lo specialista dal team; la ripresa riparte nello stesso worktree e thread con il modello scelto dalla persona; un mandato più stretto o revocato dice quali incarichi attivi non copre più; gli aggiornamenti aspettano il Coordinatore finché non gli sono riportati; il team sopravvive a salvataggio e riapertura.
- `Coordinator team tools`, la cucitura degli strumenti senza Codex, un esito del mandato per test: `propose_team` mostra la scheda con mandato assente, concesso o revocato e non crea nessuno specialista, funziona solo nel turno del chiamante, rifiuta moduli sconosciuti e risponde `team_already_confirmed` dopo la conferma; `create_specialist` risponde `mandate_missing`, `mandate_revoked`, `outside_scope` (azione non concessa e modulo fuori perimetro), `team_not_confirmed`, `specialist_available` e, entro il mandato, aggiunge lo specialista; `assign_task` risponde `mandate_missing`, `mandate_revoked`, `person_required` per nuove funzioni e compromessi, `outside_scope`, `model_unavailable`, `specialist_busy`, `work_not_independent`, `dependencies_pending`, e entro il mandato registra l'incarico e fa partire lo specialista; un mandato revocato mentre l'incarico parte è rifiutato con il nuovo esito; `stop_specialist` risponde `mandate_missing`, `mandate_revoked`, `outside_scope`, `specialist_not_running`, chiede l'arresto entro il mandato e con `remove` fa uscire lo specialista dal team; `read_team` elenca proposta, specialisti, incarico corrente e l'esito che ogni azione del team otterrebbe adesso.
- `Specialist runtime`, il runtime dello specialista sul trasporto simulato più un repository Git vero: lo specialista lavora nel worktree creato da `WorkspaceSession` e il checkout principale, il suo indice, HEAD, il branch e lo stato restano identici; un incarico di sola lettura non crea worktree e apre un thread in sola lettura senza rete; la ripresa riusa worktree e thread e ripassa il modello; un thread che Codex non ha più viene sostituito; un modello vuoto è rifiutato prima di ogni richiesta; un server MCP ancora esposto ferma il thread prima del primo turno; il turno riporta comandi, modifiche di file, ragionamento, note e risposta finale; il briefing dice allo specialista i suoi limiti, i moduli e le verifiche richieste.
- `Team cards and specialist activities`: la scheda di proposta mostra ogni specialista con il suo motivo e si può rispondere una volta; dopo la risposta mostra gli specialisti creati; la scheda di incarico offre Ferma mentre il lavoro corre, Riprendi quando è fermo e il modello del turno successivo, e non offre nulla per uno specialista uscito dal team; le attività di un turno dello specialista formano una riga sola, aperta mentre il turno corre, con la durata quando è concluso; il resoconto al Coordinatore nomina specialista, esito e risultato una volta per cambiamento; la risposta della persona alla proposta arriva al Coordinatore come suo messaggio; le istruzioni del thread e il turno di apertura chiedono la proposta del team.
- Sandbox reale (salta senza Codex installato): con la forma di sandbox che Trama dichiara per lo specialista, la scrittura nel worktree riesce, quelle nel checkout principale e nel suo indice ricevono «Operation not permitted», e lo stato del checkout non cambia.
- Migrazione: un documento schema 5 scritto da V03 (mandato revocato, schede di mandato e decisione, conversazione) passa allo schema corrente senza perdite, con backup `v5-original.json` identico all'originale; i test di migrazione da schema 1, 2, 3 e 4 restano verdi.

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## CPU a riposo con le schede nuove

La correzione di V03 (`e8fb71c`) sostituisce il `LazyVStack` della chat con un `VStack`, perché scorrere in fondo con una scheda alta sopra l'area visibile faceva ristimare le altezze e portava l'app al 100% di CPU. Le schede di V04 (proposta del team, incarico, attività raccolte) sono alte quanto quella di V03, quindi la misura è stata rifatta sul codice di V04.

Metodo. Un documento di prova con la scheda di proposta, due schede di incarico, un turno di specialista concluso e uno in corso è stato scritto con lo storage di Trama e aperto dall'app compilata dal candidato, con `CFFIXED_USER_HOME=/tmp/trama-v04-cpu-home` e `CODEX_HOME` vuoto per non avviare turni. La CPU è stata campionata con `top -pid <pid> -l 35 -s 1` e il thread principale con `sample <pid> 6`.

Esito. Il thread principale passa tutti i campioni in `mach_msg2_trap`, in attesa di eventi, senza `beginTransaction`, `flushTransactions` o aggiornamenti di SwiftUI. Non c'è nessun ciclo di layout. La CPU complessiva dell'app è 0% nella maggior parte dei secondi, con una punta di 8-9% ogni cinque secondi: il campione della punta mostra `ProjectStore.startWatcher()` che esegue `RepositoryScanner.scan` (metadati Git e SHA256 dei file) su un thread di background. Quel watcher esiste da `381ef99`, la prima versione nativa, ed è fuori dal perimetro di questo ticket. Lo stesso profilo si ottiene con e senza le schede nuove:

| Documento | Campioni | Media | Massimo | Sopra 2% |
| --- | --- | --- | --- | --- |
| Con le schede nuove | 35 | 1,81% | 9,40% | 9 |
| Senza le schede nuove | 35 | 1,71% | 8,70% | 7 |

Le schede nuove non aggiungono lavoro misurabile. La media resta fra 0% e 2%; le punte sono del watcher, fuori dal main actor.

## Prova diretta nell'app

**Eseguita** il 19 settembre 2026, dalle 15:28 alle 15:48, sull'app compilata da `main` a `f11b23d`. Il 18 settembre la prova era stata rinviata perché l'account ChatGPT aveva esaurito il limite di utilizzo di Codex (`usage_limit_exceeded`, sblocco il 19 settembre alle 14:59). Il 19 settembre una chiamata minima `codex exec --model gpt-5.6-luna --skip-git-repo-check "Rispondi solo con: ok"` ha risposto `ok`, e la prova è stata eseguita.

Metodo. L'aggancio temporaneo `Sources/Trama/V04Proof.swift` pilota lo store: si iscrive a `objectWillChange`, e quando la condizione di un passo è vera esegue il passo e pianifica una cattura con `DispatchQueue.main.asyncAfter`. Non c'è nessun ciclo di attesa sul main actor. La cattura usa `NSView.cacheDisplay`. L'aggancio è stato rimosso nel commit `61d187c`, prima della PR.

Comandi eseguiti:

```
bash scripts/build-app.sh release /tmp/trama-v04-proof2/Trama.app
CFFIXED_USER_HOME=/tmp/trama-v04-proof2/home TRAMA_V04_PROOF=1 /tmp/trama-v04-proof2/Trama.app/Contents/MacOS/Trama
```

Ambiente. Trama girava con `CFFIXED_USER_HOME=/tmp/trama-v04-proof2/home`; i dati reali in Application Support e `~/.codex/config.toml` non sono stati toccati. Il progetto era un clone pulito di `main` a `f11b23d` in `/tmp/trama-v04-proof2/trama`, con `origin` su `github.com/emanueledenaro/trama`. Prima dell'apertura il documento conteneva solo `{"schemaVersion":7,"requests":[],"selectedModel":"gpt-5.6-luna"}`. Ogni turno Codex ha usato `gpt-5.6-luna`, passato esplicitamente dal Coordinatore o dall'incarico; il provider è quello Codex predefinito dell'account ChatGPT del Mac.

Come in V01, V02 e V03 la sessione non ha la registrazione dello schermo né l'accesso di assistenza, quindi nelle catture la barra laterale e i pulsanti in alto restano bianchi. Il resoconto testuale dell'aggancio, con lo stato di ogni passo, è in [resoconto-prova.md](v04/resoconto-prova.md).

## Esiti

1. All'apertura il Coordinatore studia il progetto e la prima riga della chat è la scheda «Studio del progetto». Alla fine dello studio propone tre specialisti con competenza e motivo: esperienza Trama (SwiftUI e flussi del Coordinatore), runtime provider (Swift concurrency e Codex App Server), verifiche e integrazione (test, evidenze e rilascio). La scheda «Proposta del team» è in [01](v04/01-proposta-team.png); il documento salvato non ha ancora nessuno specialista.
2. La persona conferma il team. Trama crea i tre specialisti, che restano `available`, e manda al Coordinatore il messaggio con i nomi e le competenze. La scheda risposta è in [02](v04/02-team-confermato.png).
3. La persona chiede una modifica piccola con il mandato: creare `docs/verifiche/v04-nota-specialista.md` con una riga, nel worktree, con modello `gpt-5.6-luna`. Il Coordinatore chiama `request_mandate` e chiede un mandato limitato al modulo `root`, che nello studio contiene la cartella `docs`. La scheda «Richiesta di mandato» è in [03](v04/03-scheda-mandato.png).
4. La persona concede il mandato versione 1, con una sola azione autorizzata e perimetro `root`. La barra in alto e il documento dicono `v1 granted`.
5. Il Coordinatore assegna l'incarico `A-2F300F14` allo specialista verifiche `S-5B650EF7`, modello `gpt-5.6-luna`. Trama crea il worktree, apre il thread dello specialista e lo fa partire. La scheda «Incarico a Specialista verifiche e integrazione» è in [04](v04/04-scheda-incarico.png).
6. Le attività dello specialista arrivano raccolte per turno: nota dello specialista, avvio del turno, comandi eseguiti, file modificato. La riga del turno è aperta mentre il turno corre e mostra la durata quando è concluso. La cattura è in [05](v04/05-attivita-specialista.png).
7. La persona ferma lo specialista. Il documento registra prima «Arresto richiesto» da Product Owner e poi «Arresto confermato», con il turno `interrupted` e la cronologia conservata. La scheda con l'esito è in [06](v04/06-arresto-confermato.png).
8. La persona riprende lo specialista. Trama riparte nello stesso worktree e nello stesso thread con il modello scelto, e apre un secondo turno. La cattura è in [07](v04/07-ripresa-specialista.png).
9. Il secondo turno si conclude: lo specialista verifica che il file esista e contenga la riga richiesta, poi chiude l'incarico come `completed`. La scheda dell'incarico concluso è in [08](v04/08-incarico-concluso.png).
10. La sezione Team mostra gli specialisti del progetto con stato, competenza, modello e motivo, distinti dai collaboratori GitHub del Gruppo. La cattura è in [09](v04/09-sezione-team.png).

### Checkout principale e indice

Il checkout principale di Trama e il clone del progetto sono stati misurati prima e dopo la prova con HEAD, albero, indice e stato di Git. I due valori sono identici, e lo specialista ha scritto solo nel proprio worktree.

| Repository | HEAD | Albero | Indice | Stato |
| --- | --- | --- | --- | --- |
| Checkout principale di Trama | `18feca1` | `2acf2b6` | `e06cf69` | 0 file modificati o non tracciati |
| Clone del progetto | `f11b23d` | `92ae3cc` | `4ae4d0c` | 0 file modificati o non tracciati |

Lo specialista ha lavorato in `.../Application Support/Trama/Worktrees/AF95D310-E92C-4ADA-89EF-0C7835B99670`, sul branch `trama/specialista-verifiche-e-integrazione-a-2-af95d310`, con HEAD `f11b23d`. L'unica differenza nel worktree è il file non tracciato `docs/verifiche/v04-nota-specialista.md`, con la riga esatta richiesta:

```
Nota scritta dallo specialista durante la prova V04
```

## Modelli usati

Tutti i turni reali hanno girato su `gpt-5.6-luna`, passato esplicitamente:

- thread del Coordinatore `01a0b9da-bddc-7200-83be-af766807b2e6`, modello `gpt-5.6-luna` in ogni turno;
- incarico `A-2F300F14`, modello `gpt-5.6-luna` registrato sull'incarico e su ogni turno;
- turno 1 dello specialista `01a0b9ea-288a-7291-80cf-96e22389074d` (`interrupted` per l'arresto), turno 2 `01a0b9ea-9a02-7750-812c-1e2bd20075af` (`completed`), thread dello specialista `01a0b9ea-27f7-7ff3-b6d5-b136f4fc4547`.

Nessun turno ha usato `gpt-6-astra`.

## Revisione Standards e Spec

La revisione con due agenti in parallelo (skill `/code-review`) è bloccata dallo stesso limite di utilizzo di Codex, perché gli agenti di revisione girano su Codex. La revisione è stata fatta a mano sul diff `main...HEAD`.

Standards. Il codice nuovo è in inglese e i testi dell'interfaccia in italiano, come chiede `AGENTS.md`. Nessuna violazione dura. Rilievi di giudizio:

- `Sources/Trama/TeamView.swift` è rimasto il gruppo GitHub, mentre la sezione «Team» è `SpecialistsView`. Il nome del tipo non dice più cosa rende. Rinominarlo tocca `WorkspaceView` e altri punti: rimandato.
- `SpecialistSupervisor.receiveSpecialistTurnEvent` ripete otto volte la stessa chiamata ad `appendSpecialistActivity` con titolo e dettaglio diversi. Una tabella titolo/dettaglio per caso ridurrebbe la ripetizione; non fatta per non allargare il diff senza una necessità.
- Corretto: `ConversationTimeline.rows` aveva un binding morto (`if let assignmentID = turn.assignmentID { _ = assignmentID ... }`), ora è `if turn.assignmentID != nil` (`854c58c`).

Spec. I criteri risultano implementati e coperti dai test: i cinque strumenti con il controllo del mandato, lo specialista come entità persistita, il runtime in worktree con modello esplicito e sandbox ristretta, le schede di proposta e di incarico, le attività raccolte per turno, l'arresto in due passi, la sezione Team distinta dal Gruppo. Due scelte dichiarate che si discostano dalla lettera del criterio «tutti soggetti al mandato»:

- `propose_team` non chiede il mandato. Mostra una scheda e non crea nessuno, come `request_mandate`; chiedere un mandato per poter proporre un team sarebbe un giro a vuoto.
- `stop_specialist` controlla l'azione (`executeInWorktree`, o `composeTeam` con `remove`) ma non il perimetro dei moduli: un lavoro fuori perimetro dopo una correzione del mandato deve comunque poter essere fermato.

La prova diretta nell'app, che il 18 settembre mancava, è stata eseguita il 19 settembre 2026 (vedi «Prova diretta nell'app»): ogni criterio di #67 ha ora una prova, automatica o diretta.

## Limiti

- La misura della CPU è fatta su un documento scritto dallo storage di Trama, non sul documento prodotto dalla prova reale. Misura comunque la chat con le schede nuove, che è l'oggetto della verifica di V03. Non è stata rifatta perché il codice delle schede non è cambiato dopo la misura.
- Nelle catture la barra laterale e i pulsanti in alto restano bianchi: la sessione non ha la registrazione dello schermo. Lo stato delle schede è provato anche dal documento salvato e dal resoconto dell'aggancio.
- Il 18 settembre i test automatici sono girati con Codex CLI 0.154.0; la prova diretta del 19 settembre con 0.155.1. La differenza non ha richiesto modifiche al codice.
- Tra la fine di un turno Codex e la sua lettura da parte di Trama i primi due turni (studio e conferma del team) hanno impiegato fra cinque e otto minuti, i turni successivi pochi secondi. La causa non è stata isolata: nel periodo iniziale l'app legge il repository, aggiorna GitHub e avvia il watcher. Il ritardo non ha cambiato l'esito, ma va tenuto presente.
- Il provider dell'incarico non è ancora registrato: è il lavoro dovuto segnalato sul ticket e non entra in questa verifica, perché aggiungere un campo allo schema mentre si verifica invaliderebbe la verifica stessa.
