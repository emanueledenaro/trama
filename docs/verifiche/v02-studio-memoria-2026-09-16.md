# V02: il Coordinatore studia il progetto e lo ricorda

Verifica del 16 settembre 2026 per #65. Base: `main` a `98ab84e`. Candidato sul branch `synara/coordinator-project-memory`, PR #76. Componente reale: Codex CLI 0.154.0 con l'account ChatGPT del Mac.

## Test automatici

`swift test` sul candidato: 149 test Swift Testing in 18 suite e 107 test XCTest, nessun fallimento. Le suite nuove sono queste.

- `Coordinator state`: un documento schema 3 scritto a mano nel formato V01 passa allo schema 4 senza cambiare la conversazione (identificativi, sequenze con un buco, scheda), le richieste e il Patto. Il backup `v3-original.json` coincide byte per byte. Senza la correzione dello storage la conversazione veniva ricostruita dalle richieste e perdeva eventi: il test lo ha mostrato prima della correzione. Thread, memoria e studio sopravvivono a salvataggio e riapertura. La memoria rifiuta oltre 16 KiB in byte UTF-8 e conserva il testo precedente.
- `Project study`: lo studio contiene codice, file di istruzione, catalogo, GitHub, monitor, Patto, mandato, richieste e cronologia. Esclude un token `ghp_`, una chiave privata, un file binario, un collegamento simbolico e un file con `secret` nel nome. Ogni file ha un estratto limitato e c'è un tetto complessivo. Si ricalcola per parti: una decisione del Patto riscrive solo `pact`; un commit riscrive solo `code`, e anche `instructions` se AGENTS.md cambia; un branch locale riscrive `code`; un branch di un collega o una issue riscrivono solo `github`. Un thread esistente riceve solo le parti che non ha visto, mai la cronologia.
- `Coordinator tool server`, come funzione da richiesta a risposta, senza Codex:
  - Nessun token, schema diverso da Bearer, token errato, token con un carattere in più o token revocato danno 401 con `caller_session_inactive`, e nessuno strumento viene eseguito.
  - Rifiuti di trasporto: 405, 404, 413 (dichiarato e reale), 400 con -32700 e batch non validi.
  - `initialize`, `ping` e `tools/list` rispondono, con i sei strumenti e le loro annotazioni.
  - I metodi sconosciuti danno -32601; nome mancante e strumento sconosciuto danno -32602.
  - Le notifiche non ricevono risposta.
  - Letture di studio, Patto, mandato (assente e concesso), issue (elenco, filtro, singola con corpo filtrato, numero inesistente) e cronologia (limite e sequenza).
  - `write_memory` scrive solo durante il turno del chiamante e rispetta il limite.
  - Un id di turno arrivato dopo la fine del turno non concede nulla.
  - La fine del turno e una notifica `notifications/cancelled` in un POST successivo annullano la richiesta in corso.
  - Un progetto chiuso risponde `project_unavailable` con l'id della richiesta.
- `Loopback HTTP server`: POST reale su 127.0.0.1 con URLSession. Il corpo oltre il limite riceve 413 con errore JSON-RPC e non arriva al gestore. Dietro il loopback, il server degli strumenti rifiuta senza token e risponde con token valido. Un server fermato non accetta connessioni.
- `Coordinator briefing`: istruzioni del thread, primo turno con studio e memoria, avviso del thread sostituito, aggiornamento con sole parti cambiate e memoria una volta per ripresa, fonti ricavate dai percorsi citati nella prosa.
- `CodexClientTests` ha 11 test nuovi sul trasporto simulato:
  - thread persistente ristretto con il server `trama` nella configurazione del thread;
  - ripresa con la stessa configurazione;
  - ripiego su «no rollout found» e nessun ripiego per altri errori;
  - ripresa che restituisce un altro thread;
  - server MCP diversi da `trama`;
  - turno in prosa con eventi di turno, note e strumenti;
  - input vuoto;
  - token solo nell'ambiente del processo;
  - server globale chiamato `trama`;
  - modello esplicito su apertura, ripresa e turno, con modello vuoto rifiutato prima di ogni richiesta.

  I 19 test precedenti del trasporto simulato restano verdi.

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`. La CI della PR è verde sul commit `7f14905`: https://github.com/emanueledenaro/trama/actions/runs/35149447635/job/104973730945. Il primo passaggio era rosso: la toolchain del runner non riusciva a verificare in tempo un'espressione di `ProjectStudy.swift`, corretta in `711f866` insieme ad altre simili.

## Fatti verificati sul componente reale

Prima del codice, un server MCP di prova in Python e `codex app-server` 0.154.0 hanno stabilito questi fatti. I turni dei probe hanno usato `gpt-5.6-luna`.

- Il client MCP di Codex invia `Authorization: Bearer …` letto da `bearer_token_env_var`, sia con l'override di processo sia con `config` del thread.
- Con `approvalPolicy: "never"` una chiamata a uno strumento senza `readOnlyHint` fallisce con «MCP tool call requires approval, but approval policy is never». Con `readOnlyHint: true` va a buon fine; con `default_tools_approval_mode = "approve"` sul server va a buon fine anche la scrittura.
- Un thread non effimero ripreso con `thread/resume` in un nuovo processo ricorda il turno precedente.
- Un id sconosciuto dà «no rollout found for thread id …»; un id malformato dà «invalid session id …».
- Nella prima esecuzione dell'app la verifica di isolamento ha fermato l'avvio: `cloudflare-docs` e `node_repl` risultavano esposti. Un probe ha confermato la causa. Una tabella `mcp_servers` nel `config` del thread sostituisce gli override di processo che spengono i server globali; la chiave puntata `mcp_servers.trama` li conserva. Correzione in `0b43a35`.

## Ambiente della prova nell'app

L'app è stata compilata dal branch con un aggancio temporaneo, rimosso prima di ogni commit. L'aggancio pilotava lo store (invio di messaggi, attese, scorrimento), catturava la finestra con `NSView.cacheDisplay` e scriveva un resoconto testuale di righe e stato. Per la diagnosi registrava anche le richieste al gateway, senza il valore del token. Come in V01 la sessione non ha la registrazione dello schermo né l'accesso di assistenza. Nelle catture la barra laterale e i pulsanti della barra in alto restano bianchi.

Trama girava con `CFFIXED_USER_HOME=/tmp/trama-v02-home`. I dati reali in Application Support non sono stati né modificati né copiati. Il catalogo della home isolata registrava tre cloni del branch con `origin` su `github.com/emanueledenaro/trama`:

- `/tmp/trama-v02-proof/luna/trama`, progetto appena aperto. Il suo documento conteneva soltanto il modello scelto, `gpt-5.6-luna`, come dopo una scelta dal menu del modello.
- `/tmp/trama-v02-proof/legacy/trama`, con la copia del documento trama in schema 3 scritto dall'app durante la prova V01: 13 richieste e 28 eventi.
- `/tmp/trama-v02-proof/trama`, primo progetto appena aperto. Le sue prove sono andate su `gpt-6-astra` e sono state rifatte con Luna; vedi «Modelli usati».

## Esiti

### Progetto appena aperto

1. All'apertura Trama avvia il server degli strumenti, apre un thread Codex non effimero (`01a0ac01-df55-…`) e lo registra nel documento. Lo studio arriva in streaming dentro la scheda [01](v02/01-studio-in-streaming.png). La prima riga della chat è la scheda «Studio del progetto» [02](v02/02-studio-primo-messaggio.png). La scheda descrive stack, stato, rischi e cosa manca. L'input del primo turno era di 54.644 byte: studio completo più memoria vuota.
2. «Cosa manca per la beta?» riceve la risposta in prosa, in streaming [03](v02/03-risposta-in-streaming.png). La risposta finale è un elenco: V02, V03 «mandato e decisioni gestiti dalla conversazione», V04 e i successivi [04](v02/04-risposta-beta.png). L'attività del turno riporta «aggiornamento: github, monitor»: sono le parti ricalcolate dopo lo studio, quando le 54 issue e gli eventi del monitor sono arrivati, e sono state inviate al thread prima della domanda.
3. Dopo l'uscita e un nuovo avvio, Trama riprende lo stesso thread con `thread/resume`, e la chat dice «Thread ripreso: il Coordinatore ricorda la conversazione». Con l'app aperta, un POST senza token e uno con un token inventato ricevono `HTTP/1.1 401 Unauthorized` con `caller_session_inactive`; un GET riceve 405. «E il secondo punto?» riceve «Il secondo punto è V03, issue #66: mandato e decisioni gestiti dalla conversazione», coerente con l'elenco di prima del riavvio [05](v02/05-riavvio-secondo-punto.png).
4. Alla richiesta di salvare una priorità, il Coordinatore chiama `write_memory`: la memoria passa alla revisione 1, 111 byte, «Dopo la prova reale, Emanuele considera il mandato gestito dalla chat la seconda priorità della beta di Trama.». La riga delle attività mostra la nota del Coordinatore e «Ha aggiornato la memoria · trama · write_memory». Dopo un altro riavvio il primo messaggio porta «aggiornamento: memoria», e il rollout di Codex conferma che l'input conteneva la sezione «La tua memoria» con quel testo. «Quali priorità hai in memoria per questo progetto?» riceve proprio quella priorità [06](v02/06-memoria-scritta-e-riletta.png).

### Documento V01 in schema 3

5. Il documento si apre migrato allo schema 4 con le sue 13 richieste e 28 eventi. `v3-original.json` ha lo stesso SHA-256 del documento copiato (`27c3aacb64b7724e…`). Senza thread salvato, il Coordinatore ne apre uno nuovo e aggiunge la scheda dello studio in fondo alla cronologia esistente [07](v02/07-documento-v01-studio-in-coda.png). Lo studio (61 KB) include la cronologia V01.
6. Dopo un riavvio, con thread ripreso, una richiesta esplicita fa chiamare `write_memory` (revisione 1, 227 byte) e `read_mandate` («mandato assente»). Le due chiamate compaiono come attività [08](v02/08-strumenti-memoria-mandato.png) e come `tools/call` con token nel registro del gateway. In una prova precedente, la richiesta implicita «Ricordati per le prossime volte…» non aveva portato alla chiamata dello strumento.
7. In questo progetto «E il secondo punto?» è stato chiesto dopo un messaggio intermedio sulla priorità, e il Coordinatore ha chiesto a quale elenco ci si riferisse. La sequenza del ticket senza messaggi intermedi è quella del punto 3.

### Thread non più disponibile

8. Nella copia del documento l'id del thread è stato sostituito con uno che Codex non conosce. All'apertura Codex risponde «no rollout found for thread id ed7a2295-…». Trama apre un nuovo thread e lo dichiara in chat con la scheda «Nuovo thread del Coordinatore», che riporta il motivo, seguita da un nuovo studio [09](v02/09-nuovo-thread-dichiarato.png). L'input di apertura (61.621 byte) conteneva studio, cronologia e memoria. «Qual è la mia priorità per la beta?» riceve la priorità salvata in memoria [10](v02/10-memoria-nel-nuovo-thread.png).

### Runtime ristretto

9. Nei rollout di Codex ogni turno dei thread del Coordinatore riporta `approval_policy: never`, `sandbox_policy: read-only` e rete `restricted`.
10. Mentre l'app era aperta, il processo del Coordinatore aveva questi argomenti: `--disable apps --disable plugins --disable hooks --disable multi_agent` e un override spento per ciascuno degli 11 server MCP globali. Solo quel processo aveva `TRAMA_COORDINATOR_TOKEN` nell'ambiente; il controllo è stato fatto senza stampare il valore. Il processo di discovery non l'aveva.
11. Il client MCP di Codex si è collegato al gateway con il token di sessione (`initialize`, `notifications/initialized`, `tools/list`) a ogni avvio o ripresa del thread.

### Modelli usati

Censimento dai rollout di Codex dei thread creati da prove e probe.

| Thread | Uso | Turni |
| --- | --- | --- |
| `01a0abcd-2887-…`, `-ba9a-…`, `-e519-…` | probe | 4 con `gpt-5.6-luna` |
| `01a0abe9-ff20-…` | documento V01, punti 5-7 | 5 con `gpt-5.6-luna` |
| `01a0abef-0e36-…` | thread sostitutivo, punto 8 | 2 con `gpt-5.6-luna` |
| `01a0ac01-df55-…` | progetto appena aperto, punti 1-4 | 5 con `gpt-5.6-luna` |
| `01a0abec-a679-…` | primo progetto appena aperto | 4 con `gpt-6-astra`, 1 con `gpt-5.6-luna` |

L'ultimo thread della tabella ha usato `gpt-6-astra` per studio, domanda sulla beta, secondo punto e scrittura della memoria. Il documento di quel progetto non aveva un modello scelto, e Trama ha preselezionato il modello predefinito del catalogo Codex dell'account (comportamento di #23). Quelle prove sono state rifatte con Luna (punti 1-4) e le loro schermate non sono nel resoconto. Gli altri probe hanno solo aperto thread effimeri, senza turni. In due avvii dello stesso progetto il modello selezionato è passato da Astra a Luna qualche secondo dopo l'apertura. Due avvii successivi con una traccia su ogni scrittura del modello non l'hanno riprodotto. Nel codice nessun percorso sceglie Luna da solo, quindi il cambio viene da fuori dai passi della prova, probabilmente da una scelta nella finestra visibile.

### Ricalcolo per parti nell'app

12. Nelle prove si sono ricalcolate da sole le parti `github` (issue lette dopo lo studio), `catalogue` (modelli e skill caricati) e `monitor`. Il monitor è cambiato quando il branch della PR ha ricevuto un push. Le parti ricalcolate sono state inviate al thread con il messaggio successivo. Commit, branch locale e Patto sono provati dai test, non nell'app.

## Limiti

- Lo studio di apertura può partire prima che GitHub abbia restituito le issue. Nel primo progetto lo studio lo ha notato («Mancano inoltre le issue nello studio»). La parte arriva al thread con il messaggio successivo.
- La memoria torna nel thread con il primo messaggio dopo ogni ripresa, perché `thread/resume` non accetta input. Se la persona non scrive, il thread non la riceve.
- Scrivere la memoria resta una scelta del modello. Con una richiesta implicita il modello non l'ha scritta; con una richiesta esplicita sì.
- Il thread sostitutivo riceve la cronologia come parte dello studio (ultimi 30 eventi, 600 caratteri ciascuno), non la trascrizione completa.
- Gli strumenti non controllano ancora il mandato: leggono, oppure scrivono le note del Coordinatore. Il controllo prima di ogni strumento che agisce arriva con V03. Non esiste uno strumento «leggi contesto» separato: `read_mandate` dice mandato e significato.
- Stop interrompe il turno, chiude l'autorità di scrittura e annulla le richieste in corso, ma non revoca il token. Il token vale finché vive il processo del progetto e viene revocato quando si apre un altro progetto. Non c'è un timeout per singola chiamata.
- Un progetto senza modello scelto preseleziona il modello predefinito del catalogo Codex, che su questo account è `gpt-6-astra`, e il Coordinatore lo usa subito per lo studio. Il modello passa sempre in modo esplicito ad apertura, ripresa e turno; la preselezione è però una scelta di prodotto ancora aperta.
- Il server loopback serve una richiesta per connessione e chiude la connessione.
- Il runtime ristretto carica comunque le istruzioni utente di Codex (`~/.codex/AGENTS.md`). In una prova il Coordinatore ha letto un file di skill fuori dal progetto; la sandbox in sola lettura lo consente.
- Nella chat l'origine del messaggio della persona mostra il modulo selezionato nel composer («Root»), come prima di V02.
- Il pulsante «Prepara un piano» riporta al pianificatore JSON esistente per non perdere il percorso piano, worktree e verifica finché V03-V05 non lo trasformano in schede di incarico. Compare solo sull'ultima risposta.
- Il popover della memoria non è nelle catture, perché `cacheDisplay` non include le finestre separate. Il contenuto della memoria è riportato dai resoconti testuali.
- La CI usa Codex 0.148.0 e il trasporto simulato. Il comportamento reale è verificato solo su 0.154.0.
- Le prove hanno creato thread persistenti nella cartella `~/.codex/sessions` dell'account.
