# V03: mandato e decisioni dalla conversazione

Verifica del 17 settembre 2026 per #66. Base: `main` a `b836f30`, dopo l'integrazione di V07 (#78). Candidato sul branch `claude/v03-mandate-decisions`: commit `ccd2f02`, `16eaa52` e `34cb89f` del thread precedente, più le correzioni di questa verifica. Componente reale: Codex CLI 0.154.0 con l'account ChatGPT del Mac.

## Test automatici

`swift test` sul candidato ribasato: 240 test Swift Testing in 30 suite e 112 test XCTest, nessun fallimento. Le suite nuove o estese sono queste.

- `Coordinator tool authorization`, la cucitura degli strumenti senza Codex, un esito per test:
  - senza mandato `prepare_plan` risponde `mandate_missing` e non pianifica nulla;
  - con mandato concesso risponde `authorized`, con la versione del mandato, e mette in coda un piano;
  - con mandato revocato risponde `mandate_revoked`, con `mandateVersion` 1 e `next: request_mandate`, e non pianifica nulla;
  - una funzione nuova o un compromesso rispondono `person_required` anche con mandato, con `next: request_decision`;
  - moduli fuori perimetro e azioni non concesse rispondono `outside_scope`, con `reason` `module_outside_scope` o `action_not_granted`;
  - un mandato revocato mentre l'azione parte viene rifiutato con il nuovo esito;
  - ogni rifiuto è un risultato con `isError: true`, HTTP 200 e l'id della richiesta, mai un errore JSON-RPC o HTTP;
  - gli strumenti d'azione richiedono il turno in corso del chiamante;
  - senza mandato, o con mandato revocato, nessuno strumento cambia il progetto e nessuno scrive il Patto; `prepare_plan` è l'unico strumento d'azione;
  - `request_mandate` e `request_decision` mostrano una scheda solo durante il turno del chiamante, e `request_decision` non tocca il Patto;
  - le scelte tecniche risolvibili (`category: technical`) non diventano domande per la persona;
  - `run_readonly_check` esegue un controllo noto senza mandato e riporta l'esito;
  - `read_mandate` elenca i moduli nel perimetro e l'esito di ogni azione.
- `Coordinator requests to the person`: un documento schema 4 passa allo schema 5 senza perdere richieste, conversazione, Patto, mandato e stato del Coordinatore, e un documento schema 4 scritto da V07 conserva incolla, allegati e stato del contesto; schede di mandato e di decisione sopravvivono a salvataggio e riapertura; validazione delle richieste; concessione, correzione e revoca risolvono tutte e sole le schede di mandato in attesa; un'alternativa crea una decisione alla versione 1 senza toccare le altre; una risposta libera che revisiona una decisione ne incrementa la versione e segna come da rivalutare i lavori dipendenti; una scheda già risposta, una risposta vuota o un'alternativa inesistente non registrano nulla; una decisione registrata a mano invalida gli stessi lavori dipendenti di una scheda risposta; le risposte arrivano al Coordinatore come messaggi in italiano; la motivazione ha un solo punto dopo il caso concreto.
- `Coordinator cards in the conversation`: la scheda di mandato offre concessione e correzione, e la revoca solo con un mandato concesso; dopo la concessione la stessa scheda offre correzione e revoca; la scheda di decisione mostra caso concreto e alternative e li nasconde dopo la risposta; concessione, correzione e revoca dalla scheda e dal pannello del mandato; una revoca dalla scheda blocca gli strumenti d'azione e lascia leggibile il mandato; una risposta libera diventa una decisione versionata e la scheda non accetta altre risposte.
- `Project mandate`: un lavoro su più moduli è autorizzato solo se ogni modulo è nel perimetro. Il test già presente sul mandato revocato resta verde.

I test sul rifiuto dopo la revoca, eseguiti da soli:

```
swift test --filter "CoordinatorToolAuthorizationTests|ProjectMandateTests"
✔ Test "A revoked mandate blocks new actions and keeps its record" passed
✔ Test "A revoked mandate refuses the action tool" passed
✔ Test "A mandate revoked while the action starts is refused with the new outcome" passed
✔ Test run with 24 tests in 2 suites passed
```

`swift build` completato. `bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## Ambiente della prova nell'app

Per i punti 1-6 l'app è stata compilata dal branch con un aggancio temporaneo (`V03Proof.swift`); per il rifiuto dopo la revoca con un secondo aggancio (`V03RefusalProof.swift`). Entrambi sono stati rimossi prima dei commit e nel branch non ne resta traccia. Il primo aggancio pilotava lo store, catturava la finestra con `NSView.cacheDisplay` e scriveva un resoconto testuale. Come in V01 e V02 la sessione non ha la registrazione dello schermo né l'accesso di assistenza: nelle catture la barra laterale e i pulsanti della barra in alto restano bianchi, e i testi sotto la sfocatura della barra sono poco leggibili.

Trama girava con `CFFIXED_USER_HOME=/tmp/trama-v03-home`. I dati reali in Application Support e `~/.codex/config.toml` non sono stati toccati. Il progetto era un clone del branch in `/tmp/trama-v03-proof/trama`. Prima dell'apertura il documento conteneva solo `selectedModel: gpt-5.6-luna`, e il resoconto conferma lo stesso modello nel documento e nel thread a ogni apertura.

## Esiti

1. All'apertura il Coordinatore studia il progetto e la prima riga della chat è la scheda «Studio del progetto» [01](v03/01-studio.png). La risposta dice che il mandato manca e che senza mandato il Coordinatore può leggere e proporre, ma non avviare modifiche.
2. Senza mandato, la persona chiede: «Voglio che tu pianifichi l'aggiunta del rimborso parziale sugli ordini già pagati. È una modifica al codice…». Il Coordinatore chiama `read_mandate`, che risponde `mandate_missing` per ogni azione, poi `request_mandate`, che risponde `status: asked` con l'id `M-243CD321`. In chat compaiono le attività «Ha letto il mandato» e «Ha chiesto un mandato» e la scheda «Mandato» con motivo, obiettivi, perimetro (`Sources/Trama`, `Sources/TramaCore`, `Tests`), azione «Pianificare ticket concordati», limiti e i pulsanti Concedi e Correggi [02](v03/02-mandate-card.png). La revoca non compare, perché non esiste ancora un mandato concesso.
3. Concedi dalla scheda scrive il mandato versione 1. La scheda diventa «Mandato concesso, versione 1.» con Correggi e il campo «Motivo della revoca» con Revoca; la barra in alto dice «Mandato v1» [03](v03/03-mandate-granted.png). Il messaggio «Ho concesso il mandato (versione 1).» arriva al Coordinatore, che nel turno successivo chiama `prepare_plan` con `kind: agreedTicket` nel perimetro concesso. Risposta: `authorization: authorized`, `mandateVersion: 1`, `status: queued`. Il pianificatore parte a fine turno e il piano compare in chat con i file coinvolti.
4. Dopo un riavvio dell'app, con thread ripreso, la persona chiede di porre la scelta di prodotto sulla rappresentazione dell'ordine prima di pianificare altro. La richiesta nomina esplicitamente `request_decision`: senza quel suggerimento la prova non aveva ancora mostrato una scheda. Il Coordinatore chiama `request_decision` con `category: product`, che risponde `status: asked` con `Q-C42ABCBD`. La scheda «Decisione», con l'etichetta «Scelta di prodotto», mostra domanda, caso concreto (un ordine pagato con due articoli, uno solo reso e accettato), due alternative con comportamento, esempio e conseguenza, e il campo «Oppure rispondi con parole tue» [04](v03/04-decision-card.png).
5. La persona sceglie la prima alternativa. Nel Patto del documento salvato c'è la decisione `D-570C973A` alla versione 1: «Conservare lo stato dell'ordine come pagato e registrare separatamente l'importo rimborsato e gli articoli rimborsati.», con esempio «Totale 100 euro, rimborso 40 euro, stato: pagato, residuo non rimborsato: 60 euro.». La scheda risposta mostra «Decisione D-570C973A · versione 1», il comportamento scelto e il pulsante «Apri nel Patto» [05](v03/05-mandate-revoked.png). La motivazione salvata aveva due punti di fila dopo il caso concreto; il difetto è corretto in `1c1a508` con un test. La decisione è stata scritta da Trama alla risposta della persona: il Coordinatore non ha chiamato strumenti che scrivono il Patto.
6. Revoca dalla scheda del mandato con motivo «Fine della prova V03». Il documento salvato ha il mandato `status: revoked`, con versione 1, chi ha revocato e il motivo; la richiesta `M-243CD321` risulta risolta come revocata. La barra in alto dice «Mandato revocato» [05](v03/05-mandate-revoked.png).

La cattura della sezione Patto è stata scartata: `cacheDisplay` ha disegnato titolo e pulsante, ma non l'elenco delle decisioni. La decisione nel Patto è provata dalla scheda risposta e dal documento salvato.

### Rifiuto dopo la revoca

La prima prova non aveva catturato il rifiuto: dopo la revoca l'app restava al 100% di CPU e il turno successivo non partiva. La causa era un difetto dell'app, non solo del primo aggancio (vedi «Ciclo di layout nella chat»).

La seconda prova parte dal documento salvato con il mandato già revocato. Il secondo aggancio, dopo l'apertura, accoda un solo messaggio e ritorna; nessun ciclo di attesa sul main actor. Un abbonamento a `objectWillChange` si accorge della fine di quel turno e pianifica una sola cattura con `DispatchQueue.main.asyncAfter`. Il messaggio chiede al Coordinatore di chiamare comunque `prepare_plan` con `kind: agreedTicket` sul modulo `Sources/TramaCore` e di riportare l'esito così com'è.

1. Prima esecuzione, alle 10:16. All'apertura il Coordinatore riceve prima i messaggi rimasti in attesa dalla prova precedente, cioè la risposta alla decisione e la revoca, e risponde che il mandato v1 è revocato e che non prepara piani. Poi riceve il messaggio della prova e chiama `mcp__trama__prepare_plan`. Il server degli strumenti risponde:

   ```
   {"error":{"code":"mandate_revoked","details":{"action":"plan.agreedTicket","authorization":"mandate_revoked","mandateVersion":1,"moduleIDs":["Sources/TramaCore"],"next":"request_mandate"},"message":"The person revoked the mandate. Act on nothing; if the work still needs it, ask with request_mandate."}}
   ```

   Codex marca la chiamata come fallita. In chat però la riga diceva «Ha ordinato un piano: non riuscito · trama · prepare_plan · non riuscito» invece del rifiuto. Codex 0.154.0 trasforma un risultato con `isError` in un elemento `mcpToolCall` con `status: failed`, e il `result` perde il campo `isError`; Trama cercava il codice solo quando `isError` era presente. Corretto in `a4d7cfb`, con il caso aggiunto al test del turno del Coordinatore sul trasporto simulato.
2. Seconda esecuzione con la correzione, alle 10:20, sullo stesso thread. Il risultato dello strumento è identico. In chat la riga dice «Azione rifiutata dal mandato · trama · prepare_plan · mandato revocato», la risposta del Coordinatore riporta il JSON di `mandate_revoked` e la barra in alto dice «Mandato revocato» [06](v03/06-action-refused.png). La cattura mostra le due esecuzioni una sotto l'altra: sopra la vecchia riga «non riuscito», sotto quella corretta.
3. Nessun piano in coda. Il resoconto dell'aggancio riporta `plansBefore=0` e `plansAfter=0`, con `isPlanning=false` e il mandato ancora `v1 revoked`. Nel documento l'unico evento «Piano ordinato dal Coordinatore» è quello del punto 3, quando il mandato era concesso. La richiesta della prova è in stato «Risposta disponibile», non «Piano pronto».
4. Dopo la cattura l'app è rimasta a 0% di CPU, e il campionamento del main thread lo trova fermo in attesa di eventi (`mach_msg2_trap`).

Nel rollout la chiamata passa dalla modalità codice di Codex (`exec` con `tools.mcp__trama__prepare_plan`), quindi l'uscita registrata è il testo del risultato. Il flag `isError` sul risultato MCP è provato dal test «A refusal is a tool result with isError and the request id, never a protocol or HTTP error» e, nell'app, dallo stato `failed` che Codex ha dato alla chiamata.

### Ciclo di layout nella chat

Con il documento della prova, l'app andava al 100% di CPU pochi secondi dopo l'apertura, prima di qualsiasi turno. Il campionamento del main thread mostrava un ciclo di aggiornamento di SwiftUI (`NSHostingView.beginTransaction`, `GraphHost.flushTransactions`, `AG::Subgraph::update`). Bisezione su copie del documento, con `CODEX_HOME` vuoto per non avviare turni:

- documento intero: 99-100% di CPU;
- senza la scheda di mandato: sotto il 17%, poi 0%;
- senza la scheda di decisione: 99-100%;
- senza i messaggi in attesa, cioè senza le righe in fondo che fanno scorrere la chat verso il basso all'apertura: 0%;
- togliendo `.textSelection` da tutta la chat il ciclo restava, spostato su `LazySubviewPlacements`;
- `main` a `b836f30`, con lo stesso documento riportato allo schema 4: 0-1%, perché lì la scheda di mandato è una riga generica bassa.

La causa è il `LazyVStack` della chat. Scorso in fondo, con la scheda di mandato alta sopra l'area visibile, continuava a stimare di nuovo le altezze delle righe. La chat ora usa un `VStack` (`e8fb71c`): con lo stesso documento la CPU resta tra 0% e 2%. Il difetto nasce con V03, perché su `main` la scheda non è alta. Non esiste un test automatico per questo layout; la verifica è la misura della CPU e il campionamento.

### Runtime

Nel rollout ogni turno del thread del Coordinatore riporta `approval_policy: never` e `sandbox_policy: read-only`. Gli strumenti Trama sono stati chiamati come `mcp__trama__read_mandate`, `request_mandate`, `prepare_plan` e `request_decision`.

### Modelli usati

Censimento dal rollout di Codex del thread creato dalla prova (`01a0ac6d-1af2-…`, l'unico con `cwd` `/tmp/trama-v03-proof/trama`).

| Thread | Uso | Turni |
| --- | --- | --- |
| `01a0ac6d-1af2-…` | punti 1-6 | 4 con `gpt-5.6-luna` |
| `01a0ac6d-1af2-…` | rifiuto dopo la revoca, prima esecuzione | 3 con `gpt-5.6-luna` (due messaggi in attesa e la prova) |
| `01a0ac6d-1af2-…` | rifiuto dopo la revoca, seconda esecuzione | 1 con `gpt-5.6-luna` |

Nessun turno ha usato `gpt-6-astra`: le 34 occorrenze del modello nel rollout sono tutte `gpt-5.6-luna`, e ogni turno riporta `approval_policy: never` e `sandbox_policy: read-only`. Anche le richieste di pianificazione nel documento riportano `gpt-5.6-luna`. Nessuna prova è stata rifatta.

## Deviazioni dal riferimento Synara

- I codici di rifiuto seguono `ProjectMandate.Authorization`: `mandate_missing`, `mandate_revoked`, `person_required`, `outside_scope`. `notInMandate` e `outsideScope` hanno lo stesso codice `outside_scope` e si distinguono con `details.reason` (`action_not_granted`, `module_outside_scope`), così il Coordinatore ha un solo modo di reagire: chiedere un mandato diverso.
- Ogni rifiuto porta `details.next` (`request_mandate` o `request_decision`), che Synara non ha: dice al modello lo strumento con cui proseguire.
- Il controllo del mandato avviene in un solo punto, prima del gestore dello strumento, e si ripete all'avvio dell'azione. Synara non ha un controllo di mandato.
- `run_readonly_check` ha un timeout di 600 secondi. Synara non ha timeout per chiamata. Nella configurazione del thread Trama alza `tool_timeout_sec` del server `trama` a 750 secondi, ricavati dal limite del controllo più le quattro letture Git del checkout e un margine, perché Codex interrompe le chiamate MCP dopo 60 secondi.
- `prepare_plan` ha `readOnlyHint: false` e `destructiveHint: false`, mentre in Synara gli strumenti di scrittura sono `destructive: true`. Lo strumento mette in coda un piano che la persona rivede prima di ogni esecuzione e non cambia file.
- Senza mandato scrivono ancora `write_memory`, `request_mandate` e `request_decision`, ma solo nello stato del Coordinatore (memoria e schede), mai nel codice, nel Patto o nel mandato. «Nessuno strumento scrive» è letto come nessuno strumento cambia il progetto.
- Il documento passa dallo schema 4 allo schema 5 per le schede di mandato e di decisione; un documento schema 4 si apre senza perdite con backup `v4-original.json`. V07 aveva aggiunto campi opzionali restando allo schema 4, quindi il numero 5 resta libero; i due test di V07 che davano lo schema 4 come corrente ora verificano la migrazione allo schema corrente.
- La risposta libera registra come esempio accettato il caso concreto della scheda, perché la persona scrive il comportamento e non un esempio.
- La revoca richiede un motivo anche dal pannello del mandato, come dalla scheda.
- Non esiste uno strumento separato alla `synara_context`: `read_mandate` riporta mandato, perimetro ed esito di ogni azione.

## Revisione Standards e Spec

La revisione sul branch intero rispetto a `main` non ha trovato violazioni degli standard documentati. Correzioni fatte:

- tolto il rifiuto di una scheda di mandato, che non aveva pulsanti né chiamanti;
- il timeout MCP di Codex deriva dal limite del controllo in sola lettura, invece di un valore fisso di 660 secondi che poteva scadere prima delle letture Git;
- `run_readonly_check` rifiuta come gli altri strumenti quando lo stato del progetto non è scrivibile;
- la conseguenza di un'alternativa usa il testo di supporto del design system;
- tolto un alias rimasto in `MandateView`;
- questo resoconto: nomi delle suite, test nuovi e deviazioni.

La prova del rifiuto ha poi trovato due difetti, corretti in commit separati: il ciclo di layout della chat (`e8fb71c`) e il codice di rifiuto perso con gli elementi falliti di Codex (`a4d7cfb`).

Restano come scelte di giudizio, senza modifiche: i campi del mandato che viaggiano insieme senza un tipo proprio, i codici di rifiuto come stringhe in tre punti, qualche duplicazione tra `CoordinatorSession` e `PactViews`, e lo stato del checkout vuoto per una cartella non Git (i progetti Trama sono sempre repository Git).

## Limiti

- La chat non è più pigra: con conversazioni molto lunghe tutte le righe vengono costruite all'apertura. Con i documenti delle prove non si vede un costo.
- Nella cattura 06 i gruppi di attività sono aperti dal secondo aggancio; nell'app restano chiusi finché la persona non li apre. Il testo del messaggio della persona non viene disegnato da `cacheDisplay` e il suo contenuto è riportato sopra.
- La scheda di decisione è comparsa dopo una richiesta che nominava `request_decision`. Se il modello ponga domande di prodotto da solo resta una scelta del modello, guidata dalle istruzioni del thread.
- La correzione del mandato dalla scheda e la risposta libera sono provate dai test, non nell'app.
- Le catture non includono la sezione Patto (vedi sopra).
- La CI usa Codex 0.148.0 e il trasporto simulato. Il comportamento reale è verificato solo su 0.154.0.
- La prova ha creato un thread persistente nella cartella `~/.codex/sessions` dell'account.
