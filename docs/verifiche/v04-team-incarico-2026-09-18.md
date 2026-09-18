# V04: team di progetto e incarico in worktree

Verifica del 18 settembre 2026 per #67. Base: `main` a `fb7c587` (V01, V02, V03 e V07 integrati); `main` è poi avanzato a `8ba959e` con soli documenti di pianificazione. Candidato sul branch `synara/project-team-worktree`, commit `ccb9f37`, `269008b`, `417b8c9` e `488db9d` (quest'ultimo è lavoro in corso). Componente reale: Codex CLI 0.154.0 con l'account ChatGPT del Mac.

## Stato

- Test automatici: verdi, 295 test Swift Testing in 34 suite e 112 test XCTest.
- CPU a riposo con le schede nuove: misurata, il thread principale resta in attesa di eventi.
- Prova diretta nell'app: **non eseguita**. L'account ChatGPT ha esaurito il limite di utilizzo di Codex e lo sblocca il 19 settembre 2026 alle 14:59. Vedi «Prova diretta nell'app».

## Test automatici

`swift test` sul candidato: 295 test Swift Testing in 34 suite e 112 test XCTest, nessun fallimento. Le suite nuove sono queste.

- `Project team`, il dominio del team senza Codex: una proposta vuole almeno uno specialista, con competenza e motivo, e nomi distinti; proporre non crea nessuno e una nuova proposta sostituisce quella in attesa; la conferma crea gli specialisti una volta sola e una seconda risposta è rifiutata; la correzione tiene solo gli specialisti scelti e registra chi è stato tolto e la nota; dopo la conferma si aggiunge uno specialista solo per lavoro nuovo, mai per un ruolo già libero; uno specialista tolto conserva la sua storia e non riceve incarichi; un incarico registra obiettivo, ticket, perimetro, dipendenze, modello, strumenti, verifiche richieste e versione del mandato; uno specialista occupato non prende un secondo incarico; il parallelismo richiede lavoro indipendente (nessun modulo in comune con lavoro attivo, nessuna dipendenza non conclusa) e non ha limite fisso; il ciclo del turno porta l'incarico da in preparazione a concluso conservando risultato e turni; l'arresto è prima richiesto e poi confermato; un turno che finisce da solo dopo la richiesta di arresto resta concluso; il lavoro senza runtime vivo viene fermato da Trama e l'arresto con rimozione fa uscire lo specialista dal team; la ripresa riparte nello stesso worktree e thread con il modello scelto dalla persona; un mandato più stretto o revocato dice quali incarichi attivi non copre più; gli aggiornamenti aspettano il Coordinatore finché non gli sono riportati; il team sopravvive a salvataggio e riapertura.
- `Coordinator team tools`, la cucitura degli strumenti senza Codex, un esito del mandato per test: `propose_team` mostra la scheda con mandato assente, concesso o revocato e non crea nessuno specialista, funziona solo nel turno del chiamante, rifiuta moduli sconosciuti e risponde `team_already_confirmed` dopo la conferma; `create_specialist` risponde `mandate_missing`, `mandate_revoked`, `outside_scope` (azione non concessa e modulo fuori perimetro), `team_not_confirmed`, `specialist_available` e, entro il mandato, aggiunge lo specialista; `assign_task` risponde `mandate_missing`, `mandate_revoked`, `person_required` per nuove funzioni e compromessi, `outside_scope`, `model_unavailable`, `specialist_busy`, `work_not_independent`, `dependencies_pending`, e entro il mandato registra l'incarico e fa partire lo specialista; un mandato revocato mentre l'incarico parte è rifiutato con il nuovo esito; `stop_specialist` risponde `mandate_missing`, `mandate_revoked`, `outside_scope`, `specialist_not_running`, chiede l'arresto entro il mandato e con `remove` fa uscire lo specialista dal team; `read_team` elenca proposta, specialisti, incarico corrente e l'esito che ogni azione del team otterrebbe adesso.
- `Specialist runtime`, il runtime dello specialista sul trasporto simulato più un repository Git vero: lo specialista lavora nel worktree creato da `WorkspaceSession` e il checkout principale, il suo indice, HEAD, il branch e lo stato restano identici; un incarico di sola lettura non crea worktree e apre un thread in sola lettura senza rete; la ripresa riusa worktree e thread e ripassa il modello; un thread che Codex non ha più viene sostituito; un modello vuoto è rifiutato prima di ogni richiesta; un server MCP ancora esposto ferma il thread prima del primo turno; il turno riporta comandi, modifiche di file, ragionamento, note e risposta finale; il briefing dice allo specialista i suoi limiti, i moduli e le verifiche richieste.
- `Team cards and specialist activities`: la scheda di proposta mostra ogni specialista con il suo motivo e si può rispondere una volta; dopo la risposta mostra gli specialisti creati; la scheda di incarico offre Ferma mentre il lavoro corre, Riprendi quando è fermo e il modello del turno successivo, e non offre nulla per uno specialista uscito dal team; le attività di un turno dello specialista formano una riga sola, aperta mentre il turno corre, con la durata quando è concluso; il resoconto al Coordinatore nomina specialista, esito e risultato una volta per cambiamento; la risposta della persona alla proposta arriva al Coordinatore come suo messaggio; le istruzioni del thread e il turno di apertura chiedono la proposta del team.
- Sandbox reale (salta senza Codex installato): con la forma di sandbox che Trama dichiara per lo specialista, la scrittura nel worktree riesce, quelle nel checkout principale e nel suo indice ricevono «Operation not permitted», e lo stato del checkout non cambia.
- Migrazione: un documento schema 5 scritto da V03 (mandato revocato, schede di mandato e decisione, conversazione) passa allo schema 6 senza perdite, con backup `v5-original.json` identico all'originale; i test di migrazione da schema 1, 2, 3 e 4 restano verdi.

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## CPU a riposo con le schede nuove

La correzione di V03 (`e8fb71c`) sostituisce il `LazyVStack` della chat con un `VStack`, perché scorrere in fondo con una scheda alta sopra l'area visibile faceva ristimare le altezze e portava l'app al 100% di CPU. Le schede di V04 (proposta del team, incarico, attività raccolte) sono alte quanto quella di V03, quindi la misura va rifatta.

Metodo. Un documento di prova con la scheda di proposta, due schede di incarico, un turno di specialista concluso e uno in corso è stato scritto con lo storage di Trama e aperto dall'app compilata dal candidato, con `CFFIXED_USER_HOME=/tmp/trama-v04-cpu-home` e `CODEX_HOME` vuoto per non avviare turni. La CPU è stata campionata con `top -pid <pid> -l 35 -s 1` e il thread principale con `sample <pid> 6`.

Esito. Il thread principale passa tutti i campioni in `mach_msg2_trap`, in attesa di eventi, senza `beginTransaction`, `flushTransactions` o aggiornamenti di SwiftUI. Non c'è nessun ciclo di layout. La CPU complessiva dell'app è 0% nella maggior parte dei secondi, con una punta di 8-9% ogni cinque secondi: il campione della punta mostra `ProjectStore.startWatcher()` che esegue `RepositoryScanner.scan` (metadati Git e SHA256 dei file) su un thread di background. Quel watcher esiste da `381ef99`, la prima versione nativa, ed è fuori dal perimetro di questo ticket. Lo stesso profilo si ottiene con e senza le schede nuove:

| Documento | Campioni | Media | Massimo | Sopra 2% |
| --- | --- | --- | --- | --- |
| Con le schede nuove | 35 | 1,81% | 9,40% | 9 |
| Senza le schede nuove | 35 | 1,71% | 8,70% | 7 |

Le schede nuove non aggiungono lavoro misurabile. La media resta fra 0% e 2%; le punte sono del watcher, fuori dal main actor.

## Prova diretta nell'app

**Non eseguita.** Il 18 settembre 2026 alle 01:04 il thread del Coordinatore della prova si è chiuso con l'errore `usage_limit_exceeded`: «You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 19th, 2026 2:59 PM.» Il rollout è `~/.codex/sessions/2026/09/18/rollout-2026-09-18T01-04-14-01a0b19d-0bda-7e82-b395-737ce0bed172.jsonl`, ultima riga `task_complete` con quell'errore. La stessa risposta arriva oggi da una chiamata minima:

```
$ codex exec --model gpt-5.6-luna --skip-git-repo-check "Rispondi solo con: ok"
ERROR: You've hit your usage limit. ... try again at Sep 19th, 2026 2:59 PM.
```

La prova richiede turni reali di Codex (proposta del team, mandato, incarico, turni dello specialista), quindi non può essere sostituita da fixture. Va ripetuta dopo lo sblocco.

## Ambiente della prova nell'app

L'app è compilata dal branch con un aggancio temporaneo (`V04Proof.swift`), che sparisce prima della PR. L'aggancio è una macchina a passi: si iscrive a `objectWillChange` dello store e, quando la condizione di un passo è vera, esegue il passo e pianifica una cattura con `DispatchQueue.main.asyncAfter`. Non c'è nessun ciclo di attesa sul main actor. La cattura usa `NSView.cacheDisplay`; come in V01, V02 e V03 la sessione non ha la registrazione dello schermo né l'accesso di assistenza, quindi nelle immagini la barra laterale e i pulsanti in alto restano bianchi.

Trama girava con `CFFIXED_USER_HOME=/tmp/trama-v04-home`. I dati reali in Application Support e `~/.codex/config.toml` non sono stati toccati. Il progetto era un clone del branch in `/tmp/trama-v04-proof/trama`, con `origin` su `github.com/emanueledenaro/trama`. Prima dell'apertura il documento conteneva soltanto `selectedModel: gpt-5.6-luna`.

## Esiti

Da completare con la prova diretta nell'app.

## Modelli usati

Da completare con la prova diretta nell'app.

## Revisione Standards e Spec

La revisione con due agenti in parallelo (skill `/code-review`) è bloccata dallo stesso limite di utilizzo di Codex, perché gli agenti di revisione girano su Codex. La revisione è stata fatta a mano sul diff `main...HEAD`.

Standards. Il codice nuovo è in inglese e i testi dell'interfaccia in italiano, come chiede `AGENTS.md`. Nessuna violazione dura. Rilievi di giudizio:

- `Sources/Trama/TeamView.swift` è rimasto il gruppo GitHub, mentre la sezione «Team» è `SpecialistsView`. Il nome del tipo non dice più cosa rende. Rinominarlo tocca `WorkspaceView` e altri punti: rimandato.
- `SpecialistSupervisor.receiveSpecialistTurnEvent` ripete otto volte la stessa chiamata ad `appendSpecialistActivity` con titolo e dettaglio diversi. Una tabella titolo/dettaglio per caso ridurrebbe la ripetizione; non fatta per non allargare il diff senza una necessità.
- Corretto: `ConversationTimeline.rows` aveva un binding morto (`if let assignmentID = turn.assignmentID { _ = assignmentID ... }`), ora è `if turn.assignmentID != nil` (`854c58c`).

Spec. I criteri risultano implementati e coperti dai test: i cinque strumenti con il controllo del mandato, lo specialista come entità persistita, il runtime in worktree con modello esplicito e sandbox ristretta, le schede di proposta e di incarico, le attività raccolte per turno, l'arresto in due passi, la sezione Team distinta dal Gruppo. Due scelte dichiarate che si discostano dalla lettera del criterio «tutti soggetti al mandato»:

- `propose_team` non chiede il mandato. Mostra una scheda e non crea nessuno, come `request_mandate`; chiedere un mandato per poter proporre un team sarebbe un giro a vuoto.
- `stop_specialist` controlla l'azione (`executeInWorktree`, o `composeTeam` con `remove`) ma non il perimetro dei moduli: un lavoro fuori perimetro dopo una correzione del mandato deve comunque poter essere fermato.

Resta fuori dalla revisione la prova diretta nell'app, che è il criterio non ancora soddisfatto.

## Limiti

- La prova diretta nell'app manca per il limite di utilizzo di Codex. Nessun criterio di #67 che dipende da quella prova è da considerarsi verificato.
- La misura della CPU è fatta su un documento scritto dallo storage di Trama, non sul documento prodotto dalla prova reale. Misura comunque la chat con le schede nuove, che è l'oggetto della verifica di V03.
