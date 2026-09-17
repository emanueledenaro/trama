## NN. Provider Antigravity

Ticket: P08. Antigravity è l'adattatore che lancia la CLI `agy` in modalità print, un processo per turno, con `agy --conversation <id> --dangerously-skip-permissions --model <etichetta> --output-format stream-json --log-file <file> --print-timeout 30m -p <prompt>` (`apps/server/src/provider/Layers/AntigravityAdapter.ts:2425-2438`). Non c'è un canale bidirezionale: l'adattatore legge stdout in streaming e un file NDJSON scritto dagli hook di un plugin installato da Synara.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Services/AntigravityAdapter.ts` | Tag del servizio, `provider: "antigravity"` (`:7-13`) |
| `apps/server/src/provider/Layers/AntigravityAdapter.ts` | Adattatore intero: plugin, hook, processo del turno, transcript, catalogo (`:74-81`, `:2198-2798`) |
| `apps/server/src/provider/antigravityPrintResult.ts` | Parser incrementale dell'output `stream-json` (`:25-142`) |
| `apps/server/src/provider/Layers/ProviderHealth.ts` | Controllo di accesso Antigravity (`:1492-1587`) |
| `apps/server/src/agentGateway/mcpInjection.ts` | `mcp_config.json` del plugin di cattura (`:204-246`) |
| `apps/server/src/providerUsage/providers/antigravity.ts` | Canale separato delle quote di abbonamento (`:1-4`) |
| `packages/contracts/src/model.ts`, `orchestration.ts`, `settings.ts` | Opzioni, catalogo statico vuoto, binario predefinito |

### Trasporto

- Un processo `agy` per turno, avviato con `spawnPlatformProcess(..., { requireExecutable: true })` e `stdio: ["ignore", "pipe", "pipe"]` (`Layers/AntigravityAdapter.ts:2441-2460`). Niente stdin: il prompt viaggia come argomento `-p`.
- Il binario è `providerOptions.antigravity.binaryPath` o `"agy"` (`AntigravityAdapter.ts:2208`); lo stesso valore predefinito sta nelle impostazioni del server (`packages/contracts/src/settings.ts:33-36`).
- Prima del turno si crea una cartella temporanea `synara-antigravity-` con dentro `hooks.ndjson` (flusso degli hook) e `agy.log` (`AntigravityAdapter.ts:2347-2358`). La cartella si cancella su ogni uscita dal gestore di `close` (`:2599`).
- Stdout si accumula e passa a `createAntigravityPrintResultParser()`, che consuma riga per riga e tiene in sospeso la riga finale incompleta (`AntigravityAdapter.ts:2476-2484`; `antigravityPrintResult.ts:83-93`).
- Il file degli hook si rilegge ogni 75 ms finché il processo è vivo (`AntigravityAdapter.ts:77`, `:2486-2488`), avanzando l'offset solo oltre record JSONL completi (`:446-471`).
- `child.once("error")` produce un evento `runtime.error` con `class: "transport_error"` (`AntigravityAdapter.ts:2489-2501`). Stderr si accumula e diventa `runtime.error` con `class: "provider_error"` solo se il turno è fallito (`:2575-2582`).
- Il timeout interno della CLI è `--print-timeout 30m` (`AntigravityAdapter.ts:76`, `:2434-2435`). I processi ausiliari (`agy models`, `agy plugin install`) hanno 30 s e 45 s, con output limitato a 128 KiB tenendo la coda (`:78-80`, `:394-397`, `:418-436`).
- Su Windows un prompt oltre 24.000 caratteri viene rifiutato prima dello spawn, perché arriva come argomento di riga di comando (`AntigravityAdapter.ts:81`, `:623-631`, `:2329-2336`).

Grammatica dell'output `stream-json` (`antigravityPrintResult.ts`): gli eventi ammessi sono `init`, `step_update`, `result`, `error` (`:16`); gli stati del risultato sono `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING` (`:7-15`). Una riga non JSON marca `malformedRecord` solo se il flusso è già riconosciuto come strutturato o se la riga inizia con `{"event":` o `{"status":` (`:38-46`). `CANCELED` e `INTERRUPTED` danno stato `interrupted`, un errore di flusso o uno stato diverso da `SUCCESS` dà `failed` (`:98-105`).

### Controllo di accesso

Tutto in `checkAntigravityProviderStatus` (`apps/server/src/provider/Layers/ProviderHealth.ts:1494-1587`). Eseguibile predefinito `agy`, sovrascritto dalle impostazioni (`:1499`, `:2144-2145`, `:2344`).

| Passo | Esito | status / authStatus |
| --- | --- | --- |
| `agy --version` assente | "Antigravity CLI (\`agy\`) is not installed or is not on PATH." | `error` / `unknown`, `available: false` (`:1505-1517`) |
| `--version` fallito | "Antigravity CLI health check failed: ..." | `error` / `unknown`, `available: false` (`:1505-1517`) |
| `--version` in timeout (4 s) | "Antigravity CLI version check timed out." | `warning` / `unknown`, `available: true` (`:115`, `:1500-1503`, `:1518-1527`) |
| `--version` con exit non zero | dettaglio del comando, altrimenti "Antigravity CLI version check failed." | `error` / `unknown`, `available: false` (`:1528-1537`) |
| Versione sotto `1.0.12` | "Antigravity CLI <v> is too old for Synara. Upgrade to 1.0.12 or newer." | `error` / `unknown`, `available: false` (`:130`, `:1538-1553`) |
| `agy models` con exit 0 e stdout non vuoto (timeout 20 s) | "...installed, authenticated, and returned available models." | `ready` / `authenticated` (`:116`, `:1554-1572`) |
| `agy models` fallito, vuoto o in timeout | "...installed, but Synara could not verify login by listing models." | `warning` / `unknown`, `available: true` (`:1574-1582`) |

Non esiste un comando di login dedicato: l'autenticazione si deduce solo dal fatto che `agy models` risponda. La versione letta finisce nel campo `version` dello stato (`:1549`, `:1568`, `:1579`).

### Catalogo modelli

- Fonte a runtime: `agy models` lanciato come processo ausiliario con timeout 30 s; exit non zero è un errore (`AntigravityAdapter.ts:2719-2730`). Il risultato ha `source: "antigravity.cli"` e `cached: false` (`:2737-2741`).
- Il catalogo statico per Antigravity è vuoto di proposito: la lista viene solo dalla CLI (`packages/contracts/src/model.ts:692-694`).
- Parsing di una riga (`parseAntigravityCliModelLabel`, `AntigravityAdapter.ts:600-621`): si tolgono i codici ANSI; se c'è un tab si prende la colonna dopo il tab (righe `slug<TAB>Nome (Sforzo)` delle build nuove); si tolgono i prefissi `*`, `•`, `-`; il suffisso `(...)` diventa lo sforzo in minuscolo. Riga vuota o colonna vuota dopo il taglio: `null`, cioè scartata (`:604`, `:613`).
- Raggruppamento (`parseAntigravityModelLines`, `:633-666`): stessa etichetta modello unisce gli sforzi senza duplicati, ordinati per `low`, `medium`, `high`, `thinking` e poi il resto (`:590`, `:643-650`). `slug` e `name` sono entrambi l'etichetta visibile (`:653-654`).
- Sforzo predefinito: tabella fissa per nove modelli noti, da `Gemini 3.7 Flash` a `GPT-OSS 120B`, altrimenti il primo sforzo scoperto (`:578-588`, `:651`).
- Cache: l'adattatore tiene solo `defaultEffortByModel`, una mappa slug → sforzo aggiornata a ogni scoperta (`:2732-2735`) e riletta al dispatch (`:2342-2346`). Sopra c'è la cache comune del servizio: fresca 10 min, servita e rivalidata fino a 24 h, fallimenti per 30 s, tetto 45 s, 64 voci (`apps/server/src/provider/providerModelDiscoveryCache.ts:18-37`).
- Al dispatch l'etichetta si ricostruisce sempre da zero, per non propagare righe corrotte `slug\tNome (Sforzo)` scoperte da versioni vecchie (`resolveAntigravityCliModelLabel`, `:668-683`).

### Opzioni

```ts
// packages/contracts/src/model.ts:116-119
AntigravityModelOptions = { reasoningEffort?: TrimmedNonEmptyString }
// packages/contracts/src/orchestration.ts:134-139, 200-202
AntigravityModelSelection = { provider: "antigravity"; model: TrimmedNonEmptyString; options?: AntigravityModelOptions }
AntigravityProviderStartOptions = { binaryPath?: TrimmedNonEmptyString }
```

- Modello predefinito `Gemini 3.5 Flash` (`AntigravityAdapter.ts:75`, `:2240`, `:2340`).
- Precedenza dello sforzo: quello già scritto nell'etichetta, poi `options.reasoningEffort`, poi lo sforzo predefinito scoperto, poi la tabella fissa (`:675-679`).
- `runtimeMode` diverso da `full-access` fa fallire `startSession` con "Antigravity CLI print mode cannot pause for interactive approvals. Select Full access to use this provider." (`:2200-2207`). Di conseguenza la riga di comando porta sempre `--dangerously-skip-permissions` (`:2427`).
- Il prompt del turno è la policy dell'host di Synara più il testo dell'utente, separati da riga vuota (`buildAntigravityTurnPrompt`, `:564-576`), con gli allegati proiettati nel testo (`:2310-2315`).

### Capacità dichiarate

Oggetto `capabilities` (`AntigravityAdapter.ts:2764-2769`):

| Campo | Valore |
| --- | --- |
| `sessionModelSwitch` | `"restart-session"` |
| `conversationRollback` | `"restart-session"` |
| `supportsRuntimeModelList` | `true` |
| `supportsLiveTurnDiffPatch` | `false` |

Non ci sono altri campi. Capacità del composer (`:2783-2794`): `supportsSkillMentions: true`, `supportsSkillDiscovery: true`, `supportsNativeSlashCommandDiscovery: false`, `supportsPluginMentions: false`, `supportsPluginDiscovery: false`, `supportsRuntimeModelList: true`, `supportsThreadCompaction: false`, `supportsThreadImport: false`. Metodi oltre al minimo: `rollbackThread`, `listModels`, `getComposerCapabilities` (`:2770-2794`). `respondToRequest` e `respondToUserInput` esistono ma rispondono `unsupported` (`:2773-2774`); `didResumeSession`, `compactThread`, `forkThread`, `readExternalThread` non ci sono.

### Ciclo di vita e cursore di ripresa

- `startSession` installa prima il plugin di cattura, poi ferma una sessione già presente per lo stesso thread, uccide i suoi task in background e rilascia la lease del gateway (`:2209-2235`).
- Il cursore di ripresa è l'id di conversazione della CLI. Si accetta sia una stringa sia un oggetto con `conversationId`, `providerThreadId` o `id` (`resumeConversationId`, `:217-225`). Con un cursore si calcola anche il percorso del transcript, `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` (`:227-238`, `:2261-2263`).
- Alla partenza escono `session.started` (con `resume` se c'è il cursore) e `thread.started` (`:2284-2296`).
- `sendTurn` rifiuta un secondo turno mentre uno è attivo (`:2303-2308`) e genera un `turnId` con `crypto.randomUUID()` (`:2337`). Senza id di conversazione la riga di comando usa `--new-project` (`:2426`).
- L'id di conversazione si impara dagli hook: alla prima differenza si aggiorna `session.resumeCursor` e si emette un altro `thread.started` con `providerThreadId` (`:1946-1966`).
- Alla chiusura del processo l'adattatore cancella il turno sul gateway, rilascia la lease, drena un'ultima volta gli hook, chiude il parser e decide lo stato (`:2502-2598`). `interrupted` vince se il contesto è segnato interrotto, se il risultato dice `interrupted`, o se c'è un segnale e non è un fallimento certo (`:2566-2569`). `failed` copre exit non zero o risultato diverso da `completed` (`:2570-2574`).
- Il ripiego "stop hook": un turno senza uscita pulita può contare come completato solo se lo smontaggio è stato chiesto da Synara, il parser dichiara `completedResponse`, c'è già stato testo dell'assistente, stderr è vuoto e non restano strumenti o task in sospeso (`:2558-2565`).
- Se l'assistente non ha mai parlato ma c'è testo, si emette un ultimo elemento di testo con indice `Number.MAX_SAFE_INTEGER` (`:2538-2550`).
- `turn.completed` porta `resumeCursor` con l'id di conversazione (`:1423`).
- `rollbackThread` taglia i turni locali e cancella id di conversazione, transcript e `resumeCursor`: Antigravity non ha un cursore di rollback (`:2703-2717`).
- `interruptTurn` ignora un `turnId` che non è quello attivo, registrando `antigravity.stale_interrupt_ignored` (`:2609-2620`).

### Iniezione degli strumenti host

- `ensureCapturePlugin` scrive in `~/.gemini/antigravity-cli/plugins/synara-capture` quattro file: `plugin.json`, `capture.cjs` (modo `0o700`), `hooks.json` e, se c'è un proxy stdio, `mcp_config.json`; senza proxy il file MCP viene rimosso. Poi lancia `agy plugin install <cartella>` con timeout 45 s (`AntigravityAdapter.ts:476-529`).
- Il blocco MCP (`apps/server/src/agentGateway/mcpInjection.ts:228-246`) è un `mcpServers.synara` con comando e argomenti del proxy stdio, `disabled: false`, `disabledTools: []` e un `env` che contiene i riferimenti `$SYNARA_AGENT_GATEWAY_URL`, `$SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN` e `ELECTRON_RUN_AS_NODE: "1"`. Il token non sta nel file: nel file c'è solo il nome della variabile.
- I valori veri entrano nell'ambiente del singolo processo del turno, insieme a `SYNARA_ANTIGRAVITY_EVENTS` (percorso del file NDJSON) e `SYNARA_ANTIGRAVITY_HOOK_DECISION: "allow"` (`AntigravityAdapter.ts:531-562`).
- La lease del gateway si prende per turno, con un token di bootstrap monouso; se il token manca la lease si rilascia e il turno fallisce (`:2369-2383`). Alla chiusura del processo la lease si ritira subito, prima di ogni post-elaborazione, perché ogni `agy -p` possiede una sessione di gateway nuova (`:2519-2523`).
- Gli hook installati sono cinque: `PreToolUse` e `PostToolUse` con `matcher: "*"`, più `PreInvocation`, `PostInvocation` e `Stop` (`:379-392`).
- Il plugin è globale, quindi ogni hook deve restare neutro fuori dalle sessioni di Synara: `pre-tool` risponde `{"decision":"ask"}`, `pre-invocation` risponde `{"decision":"allow"}`, gli altri `{}` (`:269-273`). Il comando generato controlla `SYNARA_ANTIGRAVITY_EVENTS` e, se è vuoto, stampa la risposta neutra senza lanciare nulla (`:275-295`).

### Eventi d'uso

Antigravity non emette eventi d'uso dei token. Nell'adattatore non esistono `thread.token-usage.updated`, `normalize...TokenUsage` né campi `usage`, `tokens` o `costUsd`: la ricerca di `token`, `usage`, `Usage` in `apps/server/src/provider/Layers/AntigravityAdapter.ts` trova solo `turnTerminalEmitted`, `bootstrapToken` e il commento sul rilascio della lease. Questo conferma l'ADR (`docs/adr/0008-provider-di-synara-in-swift.md`, riga 11: "Antigravity non ha approvazioni interattive né eventi d'uso dei token, e i limiti si mostrano").

L'unico dato di consumo è fuori dal turno: `apps/server/src/providerUsage/providers/antigravity.ts:1-4` legge le credenziali OAuth di Gemini CLI o il file token di `agy`, le rinfresca e chiama `loadCodeAssist` e `retrieveUserQuota` di Cloud Code. È un canale di quota dell'abbonamento, non un contatore per turno.

Sulle approvazioni la conferma è doppia: `startSession` accetta solo `full-access` (`AntigravityAdapter.ts:2200-2207`) e `respondToRequest` / `respondToUserInput` rispondono `unsupported` (`:2773-2774`).

### Casi limite dai test

- `apps/server/src/provider/antigravityPrintResult.test.ts:19` ("honors the terminal ERROR after a response recovered within the first turn")
- `antigravityPrintResult.test.ts:40` ("does not allow stop-hook recovery after a later error step")
- `antigravityPrintResult.test.ts:53` ("parses records split across chunks and retains text before an incomplete final line")
- `antigravityPrintResult.test.ts:77` ("accepts DONE housekeeping after a completed response, but not pending tools")
- `antigravityPrintResult.test.ts:99` ("does not infer historical errors from the conversation turn count")
- `antigravityPrintResult.test.ts:112` ("retains text from a textless DONE update without overriding timeout errors")
- `antigravityPrintResult.test.ts:133` ("does not turn a malformed first protocol line into legacy text")
- `antigravityPrintResult.test.ts:140` ("retains a valid result after a malformed record without allowing stop-hook recovery")
- `antigravityPrintResult.test.ts:152` ("reads single-result JSON while leaving ordinary JSON answers as legacy text")
- `antigravityPrintResult.test.ts:159` ("does not discard explicit stream errors with an empty message")
- `apps/server/src/provider/Layers/AntigravityAdapter.output.test.ts:143` ("explicit user interruption remains interrupted and suppresses late raw stdout")
- `AntigravityAdapter.output.test.ts:153` ("normal SUCCESS with a trailing checkpoint preserves response text")
- `AntigravityAdapter.output.test.ts:167` ("keeps explicit timeout errors failed even after a stop hook")
- `AntigravityAdapter.output.test.ts:179` ("settles its own stop-hook teardown from a DONE response and checkpoint without a result")
- `AntigravityAdapter.output.test.ts:189` ("keeps a missing-result process failure failed and preserves only response text")
- `AntigravityAdapter.output.test.ts:194` ("preserves a valid result before an incomplete trailing record")
- `AntigravityAdapter.output.test.ts:211` e `:221` (stati `CANCELED`/`INTERRUPTED` e `INVALID`/`WAITING`/`RUNNING` come casi tabellari)
- `apps/server/src/provider/Layers/AntigravityAdapter.test.ts:61` ("collapses CLI model/effort labels into base models with effort ladders")
- `AntigravityAdapter.test.ts:114` ("collapses tab-separated slug/label rows from newer agy models output")
- `AntigravityAdapter.test.ts:153` ("rebuilds the exact CLI model label only at dispatch")
- `AntigravityAdapter.test.ts:176` ("accepts bullet-prefixed model output")
- `AntigravityAdapter.test.ts:187` ("discovers future CLI models without requiring a static catalog update")
- `AntigravityAdapter.test.ts:213` ("dispatches a discovered model with its discovered default effort")
- `AntigravityAdapter.test.ts:221` ("rotates the gateway lease per print turn and rejects a retained prior bootstrap")
- `AntigravityAdapter.test.ts:352` ("installs the generated Synara MCP plugin alongside the capture hooks")
- `AntigravityAdapter.test.ts:414` ("gives an Antigravity turn only its thread-scoped gateway credential")
- `AntigravityAdapter.test.ts:501` ("keeps the globally installed hook neutral outside Synara sessions")
- `AntigravityAdapter.test.ts:611` ("runs packaged Electron as Node only for Synara-managed sessions")
- `AntigravityAdapter.test.ts:660` ("guards Windows command-line limits before spawning the CLI")
- `AntigravityAdapter.test.ts:690` ("advances file offsets only past complete JSONL records")
- `AntigravityAdapter.test.ts:864` ("dedupes hook and transcript copies without collapsing repeated tool names")
- `AntigravityAdapter.test.ts:1321` ("terminates helper processes that exceed their timeout")
- `AntigravityAdapter.test.ts:1331` ("answers stop hooks with a neutral allow-exit payload")
- `AntigravityAdapter.test.ts:1494` ("unlocks Cancel without letting a late close settle the follow-up")
- `AntigravityAdapter.test.ts:1563` ("emits a terminal interrupted turn.completed so the stop button unlocks")
- `AntigravityAdapter.test.ts:3109` ("ignores the old stop hook after a transcript read outlives its turn")
- `AntigravityAdapter.test.ts:3331` ("ignores a hook poll that resumes after session replacement")
- `apps/server/src/provider/Layers/ProviderHealth.test.ts:2085` (versione `1.0.11` troppo vecchia), `:2106` ("returns ready when Antigravity lists authenticated models"), `:2135` ("uses the configured Antigravity binary")

### In Trama

- `AntigravityClient` implementa il `protocol ProviderAdapter` con `ProviderCapabilities` copiate dalla tabella: cambio modello solo riavviando la sessione, rollback solo riavviando, lista modelli a runtime sì, patch diff dal vivo no.
- Un `Process` per turno con `stdout` e `stderr` su `Pipe` e stdin chiuso. Il prompt va in `arguments`, non su stdin. Su macOS non serve la guardia dei 24.000 caratteri, ma conviene tenere un limite proprio.
- `actor AntigravityPrintParser` che porta `createAntigravityPrintResultParser` riga per riga: accumula i `Data` fino a `0x0A`, decodifica UTF-8, tiene lo stato `structured`, `streamed`, `malformedRecord`, la mappa dei passi e il risultato. I payload variabili restano `JSONValue`; i record noti sono `Codable`.
- Gli hook si leggono con un `AsyncStream<HookEvent>` alimentato da un `Task` che ogni 75 ms rilegge il file da `processedHookBytes` con `FileHandle`, si ferma al confine dell'ultima riga completa e avanza l'offset solo allora.
- Il plugin di cattura va riscritto: `FileManager` per la cartella `~/.gemini/antigravity-cli/plugins/synara-capture`, i quattro file, il permesso `0o700` sullo script, poi `agy plugin install`. Lo script hook resta JavaScript, perché lo esegue la CLI; in Trama serve un interprete disponibile al posto di `process.execPath` di Electron.
- Accesso: `struct AntigravityAccessProbe` con due `Process` (`agy --version` con 4 s, `agy models` con 20 s) e la stessa mappatura verso `ready`, `warning`, `error` e `authenticated` / `unknown`. Confronto semver contro `1.0.12`.
- Catalogo: `parseAntigravityModelLines` diventa una funzione pura Swift su `String`, con l'espressione regolare ANSI, il taglio sul tab, i prefissi puntati e il suffisso tra parentesi. La mappa degli sforzi predefiniti resta una costante.
- Cursore di ripresa: stringa opaca con l'id di conversazione, salvata nel documento del progetto e riaggiornata quando gli hook la rivelano.
- Niente coda di approvazioni e niente contatore di token: la UI deve mostrare il provider come "solo accesso completo" e nascondere l'indicatore di contesto.
- Gateway: `URLSession` non serve lato adattatore; basta passare URL e token di bootstrap in `Process.environment` e lasciare che il proxy stdio parli con il gateway.

### Da non portare

- `Effect`, `Layer`, `Queue.bounded`, `Stream.fromQueue`, `Effect.addFinalizer` dell'adattatore (`Layers/AntigravityAdapter.ts:2754-2760`, `:2795-2803`).
- Il ramo Windows del comando hook, con `cmd.exe`, `if not defined` e il divieto di virgolette doppie (`AntigravityAdapter.ts:282-292`), e `shellQuote` per `win32` (`:240-243`).
- `ELECTRON_RUN_AS_NODE` e l'uso di `process.execPath` come interprete degli hook (`AntigravityAdapter.ts:506-507`; `mcpInjection.ts:239`).
- Il limite del prompt su Windows (`AntigravityAdapter.ts:623-631`).
- La lettura delle quote OAuth di Cloud Code (`providerUsage/providers/antigravity.ts`): fuori dal verticale.
- La macchina dei task in background e delle conversazioni di subagente (`AntigravityAdapter.ts:798-953`, `:1731-1800`): utile ma non minima per P08.

### Non trovato

- Eventi d'uso dei token: cercati `token`, `usage`, `Usage`, `cost` in `Layers/AntigravityAdapter.ts`, nessuna corrispondenza legata al consumo del turno.
- Approvazioni interattive: cercati `approval`, `permission`, `request/respond`, `user-input` in `Layers/AntigravityAdapter.ts`; trovati solo il rifiuto di `runtimeMode` non `full-access` (`:2200-2207`), il flag `--dangerously-skip-permissions` (`:2427`) e i due metodi `unsupported` (`:2773-2774`).
- Un comando di login o di stato dell'account: cercato in `ProviderHealth.ts:1494-1587`, c'è solo `agy models` come prova indiretta.
- Catalogo statico di ripiego: la voce `antigravity` in `packages/contracts/src/model.ts:694` è un array vuoto, per scelta documentata nel commento sopra (`:692-693`).
- Trasporto HTTP o SSE: cercati `fetch`, `http`, `EventSource` in `Layers/AntigravityAdapter.ts`, nessuna corrispondenza; il canale è solo processo, stdout e file NDJSON.
- Paginazione o cursore nel catalogo: `agy models` si legge in una volta sola (`AntigravityAdapter.ts:2722-2731`).
