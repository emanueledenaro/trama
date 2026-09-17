# V04: team di progetto e incarico in worktree

Verifica del 18 settembre 2026 per #67. Base: `main` a `fb7c587` (V01, V02, V03 e V07 integrati). Candidato sul branch `synara/project-team-worktree`. Componente reale: Codex CLI 0.154.0 con l'account ChatGPT del Mac.

## Test automatici

`swift test` sul candidato: 294 test Swift Testing in 34 suite e 112 test XCTest, nessun fallimento. Le suite nuove sono queste.

- `Project team`, il dominio del team senza Codex: una proposta vuole almeno uno specialista, con competenza e motivo, e nomi distinti; proporre non crea nessuno e una nuova proposta sostituisce quella in attesa; la conferma crea gli specialisti una volta sola e una seconda risposta è rifiutata; la correzione tiene solo gli specialisti scelti e registra chi è stato tolto e la nota; dopo la conferma si aggiunge uno specialista solo per lavoro nuovo, mai per un ruolo già libero; uno specialista tolto conserva la sua storia e non riceve incarichi; un incarico registra obiettivo, ticket, perimetro, dipendenze, modello, strumenti, verifiche richieste e versione del mandato; uno specialista occupato non prende un secondo incarico; il parallelismo richiede lavoro indipendente (nessun modulo in comune con lavoro attivo, nessuna dipendenza non conclusa) e non ha limite fisso; il ciclo del turno porta l'incarico da in preparazione a concluso conservando risultato e turni; l'arresto è prima richiesto e poi confermato; un turno che finisce da solo dopo la richiesta di arresto resta concluso; il lavoro senza runtime vivo viene fermato da Trama e l'arresto con rimozione fa uscire lo specialista dal team; la ripresa riparte nello stesso worktree e thread con il modello scelto dalla persona; un mandato più stretto o revocato dice quali incarichi attivi non copre più; gli aggiornamenti aspettano il Coordinatore finché non gli sono riportati; il team sopravvive a salvataggio e riapertura.
- `Coordinator team tools`, la cucitura degli strumenti senza Codex, un esito del mandato per test: `propose_team` mostra la scheda con mandato assente, concesso o revocato e non crea nessuno specialista, funziona solo nel turno del chiamante, rifiuta moduli sconosciuti e risponde `team_already_confirmed` dopo la conferma; `create_specialist` risponde `mandate_missing`, `mandate_revoked`, `outside_scope` (azione non concessa e modulo fuori perimetro), `team_not_confirmed`, `specialist_available` e, entro il mandato, aggiunge lo specialista; `assign_task` risponde `mandate_missing`, `mandate_revoked`, `person_required` per nuove funzioni e compromessi, `outside_scope`, `model_unavailable`, `specialist_busy`, `work_not_independent`, `dependencies_pending`, e entro il mandato registra l'incarico e fa partire lo specialista; un mandato revocato mentre l'incarico parte è rifiutato con il nuovo esito; `stop_specialist` risponde `mandate_missing`, `mandate_revoked`, `outside_scope`, `specialist_not_running`, chiede l'arresto entro il mandato e con `remove` fa uscire lo specialista dal team; `read_team` elenca proposta, specialisti, incarico corrente e l'esito che ogni azione del team otterrebbe adesso.
- `Specialist runtime`, il runtime dello specialista sul trasporto simulato più un repository Git vero: lo specialista lavora nel worktree creato da `WorkspaceSession` e il checkout principale, il suo indice, HEAD, il branch e lo stato restano identici; un incarico di sola lettura non crea worktree e apre un thread in sola lettura senza rete; la ripresa riusa worktree e thread e ripassa il modello; un thread che Codex non ha più viene sostituito; un modello vuoto è rifiutato prima di ogni richiesta; un server MCP ancora esposto ferma il thread prima del primo turno; il turno riporta comandi, modifiche di file, ragionamento, note e risposta finale; il briefing dice allo specialista i suoi limiti, i moduli e le verifiche richieste.
- `Team cards and specialist activities`: la scheda di proposta mostra ogni specialista con il suo motivo e si può rispondere una volta; dopo la risposta mostra gli specialisti creati; la scheda di incarico offre Ferma mentre il lavoro corre, Riprendi quando è fermo e il modello del turno successivo, e non offre nulla per uno specialista uscito dal team; le attività di un turno dello specialista formano una riga sola, aperta mentre il turno corre, con la durata quando è concluso; il resoconto al Coordinatore nomina specialista, esito e risultato una volta per cambiamento; la risposta della persona alla proposta arriva al Coordinatore come suo messaggio; le istruzioni del thread e il turno di apertura chiedono la proposta del team.
- Sandbox reale (salta senza Codex installato): con la forma di sandbox che Trama dichiara per lo specialista, la scrittura nel worktree riesce, quelle nel checkout principale e nel suo indice ricevono «Operation not permitted», e lo stato del checkout non cambia.
- Migrazione: un documento schema 5 scritto da V03 (mandato revocato, schede di mandato e decisione, conversazione) passa allo schema 6 senza perdite, con backup `v5-original.json` identico all'originale; i test di migrazione da schema 1, 2, 3 e 4 restano verdi.

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## Ambiente della prova nell'app

L'app è stata compilata dal branch con un aggancio temporaneo (`V04Proof.swift`), rimosso prima del commit. L'aggancio è una macchina a passi: si iscrive a `objectWillChange` dello store e, quando la condizione di un passo è vera, esegue il passo e pianifica una cattura con `DispatchQueue.main.asyncAfter`. Non c'è nessun ciclo di attesa sul main actor. La cattura usa `NSView.cacheDisplay`; come in V01, V02 e V03 la sessione non ha la registrazione dello schermo né l'accesso di assistenza, quindi nelle immagini la barra laterale e i pulsanti in alto restano bianchi.

Trama girava con `CFFIXED_USER_HOME=/tmp/trama-v04-home`. I dati reali in Application Support e `~/.codex/config.toml` non sono stati toccati. Il progetto era un clone del branch in `/tmp/trama-v04-proof/trama`, con `origin` su `github.com/emanueledenaro/trama`. Prima dell'apertura il documento conteneva soltanto `selectedModel: gpt-5.6-luna`.

## Esiti

Da completare con la prova.

## Modelli usati

Da completare con la prova.

## Limiti

Da completare con la prova.
