## NN. Runtime ACP condiviso

Ticket: P03 (usato anche da P04, P05, P06).

### Percorsi dei file

Tutto sta in `apps/server/src/provider/acp/`. La libreria è `@agentclientprotocol/sdk` fissata alla versione esatta `1.2.1` (`apps/server/package.json:29`). Viene caricata in modo pigro alla prima sessione, perché l'import al boot costa circa 32 ms (`AcpSdk.ts:10-19`); gli altri moduli la importano solo come tipo.

| File | Ruolo |
|---|---|
| `AcpSessionRuntime.ts` | Processo figlio, connessione JSON-RPC, avvio, stato di sessione, flusso eventi (2615 righe) |
| `AcpRuntimeModel.ts` | Parser puro di `session/update` e delle richieste di permesso |
| `AcpCoreRuntimeEvents.ts` | Costruttori degli eventi normalizzati `ProviderRuntimeEvent` |
| `AcpNotificationDispatcher.ts` | Coda limitata delle notifiche prima dei gestori |
| `AcpLoadReplayGate.ts` | Soppressione del replay dopo `session/load` |
| `AcpTurnIdleWatchdog.ts` | Watchdog di inattività del turno |
| `AcpElicitationSupport.ts` | Da form di elicitation a domande della UI e ritorno |
| `acpFork.ts` | `forkViaAcpRuntime`, fork nativo con controlli |
| `AcpAdapterSupport.ts` | Errori, scelta delle opzioni di permesso, esito del turno |
| `AcpAdapterSessionSupport.ts` | Contabilità di sessione comune agli adattatori |
| `AcpErrors.ts`, `AcpExtensions.ts` | Errori tipizzati e codec delle config option |
| `AcpNativeLogging.ts` | Log NDJSON nativi con redazione dei segreti |

Non esiste un file `AcpJsonRpcConnection.ts`. La connessione vive in `makeOfficialSdkClient` (`AcpSessionRuntime.ts:600-925`); il nome sopravvive solo nel test `AcpJsonRpcConnection.test.ts`, che prova `AcpSessionRuntime` contro l'agente finto `apps/server/scripts/acp-mock-agent.ts:1-5`. Un secondo agente, `apps/server/scripts/acp-conformance-agent.ts:1-2`, usa l'SDK ufficiale per la suite `AcpSdkConformance.test.ts`.

### Connessione JSON-RPC

- Avvio del processo: `spawner.spawn(makeEffectProcessCommand(command, args, { cwd, env }))` (`AcpSessionRuntime.ts:1454-1470`). Un errore diventa `AcpSpawnError` con il comando (`AcpSessionRuntime.ts:1463-1469`). L'ambiente passato dall'adattatore è un insieme esatto e non viene fuso con `process.env` (`AcpSessionRuntime.ts:1447-1453`).
- Chiusura: un finalizzatore chiama `teardownAcpChildProcess`, che fallisce come difetto se non prova la morte dell'albero di processi (`AcpSessionRuntime.ts:571-585`, `1472`).
- stderr viene sempre letto, riga per riga, anche senza tap: una pipe non letta blocca il figlio. Errori del tap vengono ingoiati (`AcpSessionRuntime.ts:172-199`, `1477-1481`).
- Uscita: coda `outgoing` limitata a 256 blocchi verso `child.stdin` (`AcpSessionRuntime.ts:684-694`). Entrata: coda di 64 frame (`AcpSessionRuntime.ts:50`, `695-736`).
- Limite di frame: 8 MiB per riga, contati tra un `\n` e l'altro anche su blocchi spezzati; oltre il limite `AcpTransportError` (`AcpSessionRuntime.ts:53`, `262-288`).
- Codifica: `acpSdk.ndJsonStream(output, input)` e `clientApp.connect(...)`, creati alla prima richiesta (`AcpSessionRuntime.ts:788-792`). Un JSON per riga.
- Normalizzazione opzionale in entrata: ogni riga viene letta, passata a `normalizeIncomingMessage` e riscritta; se il parse fallisce la riga passa invariata (`AcpSessionRuntime.ts:201-241`, `738-740`). La usa solo Devin.
- Ogni richiesta porta un `cancellationSignal`: interrompere la fibra annulla la richiesta con `$/cancel_request` dell'SDK (`AcpSessionRuntime.ts:800-822`; `AcpSdkConformance.test.ts:309`).
- Errori SDK: `RequestError` diventa `AcpRequestError` con `code`, `message`, `data`; il resto `AcpTransportError` (`AcpSessionRuntime.ts:587-598`).

Metodi agente usati (`AcpSessionRuntime.ts:841-876`):

| Metodo | Chi lo chiama | Nota |
|---|---|---|
| `initialize` | `startOnce` (`:1764-1778`) | `protocolVersion: 1`, `clientInfo` dell'adattatore |
| `authenticate` | `runAuthenticate` (`:1791-1821`) | `methodId` fisso o risolto, `_meta` opzionale |
| `session/new` | `runSessionSetup` (`:1920-1944`) | `cwd`, `mcpServers`, `_meta` |
| `session/resume` | se `sessionCapabilities.resume` (`:1876-1895`) | preferito a load |
| `session/load` | se `loadSession === true` (`:1896-1912`) | attiva il gate di replay |
| `session/prompt` | `prompt` (`:2132-2170`) | attende lo svuotamento delle notifiche dopo la risposta (`:870-873`) |
| `session/cancel` | `cancel` (`:2171-2173`) | notifica, non richiesta |
| `session/set_config_option` | `setConfigOption` (`:1691-1737`) | inviato con `raw.request` |
| `session/fork` | `forkSession` (`:2235-2252`) | dopo il gate di replay |
| `session/close` | sessione sonda scartata (`:1852-1857`) | solo se `sessionCapabilities.close` |
| metodi arbitrari | `request`, `notify` (`:2253-2255`) | es. `cursor/list_available_models` (`CursorAcpSupport.ts:433`, `561`) |

`session/set_mode` e `session/set_model` non vengono mai inviati: `setMode` e `setModel` passano per `session/set_config_option` (vedi Modelli e modalità). `logout` e `listSessions` sono definiti (`AcpSessionRuntime.ts:846`, `856-857`) ma nessun codice non di test li chiama sul runtime.

Metodi client registrati (`AcpSessionRuntime.ts:742-778`): `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`, `elicitation/create` come richieste; `session/update` ed `elicitation/complete` come notifiche. Senza gestore la risposta è `methodNotFound` (`AcpSessionRuntime.ts:675-682`).

Capacità client dichiarate (`AcpSessionRuntime.ts:1566-1578`): `fs.readTextFile` e `fs.writeTextFile` a `false`, `terminal` a `false`, più `auth`, `elicitation` e `_meta` solo se l'adattatore li passa. Nei quattro adattatori non ci sono chiamate a `handleReadTextFile`, `handleWriteTextFile` o `handleCreateTerminal`, quindi fs e terminale restano spenti.

### Sessione

Avvio in `startOnce` (`AcpSessionRuntime.ts:1759-2046`):

1. Apre i registri provvisori di permessi ed elicitation (`:1760-1761`).
2. `initialize` con timeout, poi `validateInitializeResult` se presente (`:1770-1782`).
3. `buildMcpServers(initializeResult)` sceglie i server MCP in base alle capacità dichiarate; `cwd` passa per `resolveAcpSessionCwd`, che converte i percorsi UNC di WSL (`:1788-1789`, `297-306`).
4. Con `authPolicy` `"always"` (default): `authenticate`, poi setup. Con `"on-demand"`: setup, e solo se fallisce con errore di autenticazione verificato, `authenticate` e un secondo setup (`:2006-2015`).
5. Setup: se c'è `resumeSessionId` prova resume, poi load; se l'agente non offre nessuno dei due, errore `-32601`. Un fallimento qui è terminale e non ricade su `session/new`, per non creare una seconda conversazione (`:1869-1918`).
6. Per `session/new`, `freshSessionRetry` ripete una volta la richiesta se il predicato lo consente, dopo `delayMs` (`:308-334`, `1930-1941`).
7. In on-demand, `authSetupHeuristic` può dichiarare inutilizzabile il risultato: la sessione viene scartata con `cleanupDiscardedAcpSession` e l'errore `-32000` avvia l'autenticazione (`:1947-1963`, `1823-1858`).
8. `setSessionEpoch` installa id, modalità e config option, poi riapplica le notifiche arrivate in anticipo (`:1986-1993`).

Timeout di avvio (`AcpSessionRuntime.ts:80-85`): `initialize` 20 s, `authenticate` 30 s, setup 20 s, totale 60 s. Il totale è volutamente minore della somma (`:71-72`, `2048-2050`). Lo scadere produce `AcpRequestError` con codice `-32001` e `data.reason = "acp-startup-timeout"` (`:87-113`). `start()` è idempotente: chiamate concorrenti attendono lo stesso `Deferred`; se fallisce torna a `NotStarted` (`:2052-2079`).

Epoca di sessione: ogni sostituzione incrementa `generation`; ogni scrittura di stato ricontrolla l'epoca, così un gestore in ritardo non tocca la sessione nuova (`AcpSessionRuntime.ts:243-260`, `1239-1251`). Prima che l'id sia noto le notifiche restano in un buffer per id provvisorio: al massimo 512 per sessione e 2048 in totale, scartando le più vecchie (`:55-56`, `1201-1237`, `1513-1521`). Gli eventi senza consumatore restano in un buffer di 2048 (`:57`, `1358-1369`). `getEvents()` apre il gate, svuota il buffer nella coda da 2048 e restituisce lo stream (`:1128`, `2097-2115`).

`sessionUpdatesEnqueuedCount` conta gli eventi consegnabili; l'adattatore lo confronta con quelli già gestiti tramite `waitForAcpQueuedTurnEventsDrained`, con attesa limitata, prima di chiudere il turno (`AcpSessionRuntime.ts:493-498`; `AcpAdapterSessionSupport.ts:189-210`).

### Eventi

`processSessionUpdate` (`AcpSessionRuntime.ts:2345-2469`) riceve ogni `session/update`. `parseSessionUpdateEvent` (`AcpRuntimeModel.ts:620-725`) lo traduce in `AcpParsedSessionEvent` (`AcpRuntimeModel.ts:58-93`). L'adattatore poi chiama i costruttori di `AcpCoreRuntimeEvents.ts`.

| `sessionUpdate` | Evento interno | Evento normalizzato |
|---|---|---|
| `agent_message_chunk` testo non vuoto | `ContentDelta` `assistant_text`, `itemId` da `messageId` (`AcpRuntimeModel.ts:679-691`) | `content.delta` (`AcpCoreRuntimeEvents.ts:230-257`) |
| `agent_thought_chunk` | `ContentDelta` `reasoning_text` (`AcpRuntimeModel.ts:692-704`) | `content.delta` |
| `tool_call` | `ToolCallUpdated`, stato di ripiego `pending` (`:655-667`) | `item.started`/`item.updated`/`item.completed` (`AcpCoreRuntimeEvents.ts:74-86`, `177-206`) |
| `tool_call_update` | `ToolCallUpdated` (`:668-678`) | come sopra |
| `plan` con voci | `PlanUpdated`, passo vuoto diventa `Step N` (`:639-654`) | `turn.tasks.updated` (`AcpCoreRuntimeEvents.ts:144-175`) |
| `usage_update` | `UsageUpdated` con `usedTokens`, `maxTokens`, `usedPercent`, `compactsAutomatically: true`, `cost` (`:203-220`, `705-719`) | `thread.token-usage.updated` (`AcpCoreRuntimeEvents.ts:259-283`) |
| `current_mode_update` | `ModeChanged` e aggiornamento di `currentModeId` (`:629-638`; `AcpSessionRuntime.ts:2395-2402`) | a carico dell'adattatore |
| `available_commands_update` | solo stato (`AcpSessionRuntime.ts:2380-2384`) | nessuno |
| `config_option_update` | fusione per id e sblocco dei waiter (`AcpSessionRuntime.ts:2386-2393`) | nessuno |
| altri tipi | ignorati (`AcpRuntimeModel.ts:720-721`) | nessuno |

Segmenti del messaggio: il runtime sintetizza `AssistantItemStarted` e `AssistantItemCompleted`. Un tool call chiude il segmento aperto; il testo successivo apre un segmento nuovo con id `assistant:<sessionId>:<runtimeInstanceId>:segment:<n>`, dove `runtimeInstanceId` sono 8 caratteri di UUID per istanza (`AcpSessionRuntime.ts:1137-1139`, `2503-2615`). Se l'agente manda un `messageId`, quello vince (`:2539-2543`). Il segmento si chiude anche prima e dopo ogni `session/prompt` (`:2143-2165`). Il ragionamento non apre segmenti e il testo di soli spazi non ne apre uno nuovo (`:2439-2451`). Il costruttore dà `item.started`/`item.completed` con `itemType: "assistant_message"` (`AcpCoreRuntimeEvents.ts:208-228`).

Tool call: lo stato si fonde per `toolCallId` con `mergeToolCallState` (`AcpRuntimeModel.ts:565-591`) e si scarta a `completed` o `failed` (`AcpSessionRuntime.ts:2418-2428`). Un aggiornamento esce solo se cambia stato, titolo o dettaglio, o se è terminale (`:2484-2501`). Il titolo generico ("Tool", "Terminal", "Read file") è sostituito da un titolo d'azione ("Reading"/"Read", "Ran command") (`AcpRuntimeModel.ts:319-334`, `385-408`). Il comando viene da `rawInput.command`, da `executable` più `args`, o dal testo tra backtick nel titolo (`:222-259`). Un `rawInput._toolName` pari a `task`, `agent` o `subagent` diventa un subagente con kind `agent` (`:360-383`; `AcpAdapterSupport.ts:19-23`).

Tipi canonici (`AcpAdapterSupport.ts:25-41`): `agent` diventa `collab_agent_tool_call`, `execute` `command_execution`, `edit`/`delete`/`move` `file_change`, `fetch` `web_search`, il resto `dynamic_tool_call`. Gli stati `pending`/`in_progress` diventano `inProgress` (`AcpCoreRuntimeEvents.ts:58-72`).

`stampAcpRuntimeEventLifecycleGeneration` aggiunge `lifecycleGeneration` all'evento (`AcpCoreRuntimeEvents.ts:31-36`).

### Modelli e modalità

- Le modalità arrivano da `modes` nella risposta di setup; id e nome vengono ripuliti e le voci vuote scartate (`AcpRuntimeModel.ts:141-170`).
- L'id del modello è la prima config option con `category === "model"` (`AcpRuntimeModel.ts:105-114`). `setModel` fallisce con `-32602` se manca (`AcpSessionRuntime.ts:2212-2234`).
- `setMode(modeId)`: se è già attiva non fa nulla; altrimenti cerca una option `select` con categoria o id `mode` che contenga il valore e chiama `setConfigOption` (`AcpSessionRuntime.ts:2174-2196`).
- `setConfigOption` attende il gate di replay, valida il valore (booleano, stringa, valore ammesso, altrimenti `-32602`), salta la scrittura se il valore è già corrente e poi invia (`AcpSessionRuntime.ts:1591-1638`, `1691-1737`).
- Se l'agente risponde `{}`, il runtime aspetta fino a 5 s una `config_option_update` con il valore chiesto, altrimenti `AcpTransportError` (`AcpSessionRuntime.ts:49`, `1648-1684`, `2316-2334`). Una risposta piena viene decodificata con `SetSessionConfigOptionResponse` (`AcpExtensions.ts:50-53`).
- Le option `select` possono essere raggruppate; `flattenSessionConfigSelectOptions` e `collectSessionConfigOptionValues` le appiattiscono (`AcpSessionRuntime.ts:2293-2300`; `AcpRuntimeModel.ts:130-139`).
- Scelta della modalità per turno: `resolveRequestedAcpSessionModeId` cerca per alias esatti, poi parziali: Plan con gli alias `plan`, approvazione con `approval`, poi `implement`, poi la prima non Plan, poi la corrente (`AcpAdapterSessionSupport.ts:22-102`). Un turno senza modalità vale `default`, mai Plan ereditato (`:65-70`).
- `withAcpPlanModePrompt` antepone un prefisso al testo solo in Plan (`AcpAdapterSessionSupport.ts:243-254`).

### Watchdog di inattività

`forkAcpTurnIdleWatchdog` (`AcpTurnIdleWatchdog.ts:122-153`) si sveglia ogni `checkIntervalMs` e decide con la funzione pura `evaluateAcpTurnIdleTick` (`:75-88`): `stop` se il turno non è più attivo, `touch` se si attende un umano (approvazione o input in sospeso), `timeout` se `idleMs >= idleTimeoutMs`, altrimenti `continue`. Al timeout chiama `onIdleTimeout(idleMs)` una volta ed esce. `currentIdleTimeoutMs` permette una soglia variabile (`:46-47`, `130`).

Contano come progresso solo `ContentDelta`, `ToolCallUpdated`, `PlanUpdated`, `AssistantItemStarted`, `AssistantItemCompleted`; modalità, comandi e uso no (`AcpTurnIdleWatchdog.ts:24-41`). La soglia si legge da una variabile d'ambiente; valori vuoti, non numerici o non positivi ricadono sul default (`:90-106`). `forkAcpAdapterTurnIdleWatchdog` collega il watchdog al contesto dell'adattatore (`AcpAdapterSessionSupport.ts:212-241`).

| Provider | Soglia di default | Intervallo | Variabile |
|---|---|---|---|
| Cursor | 600 000 ms (`CursorAdapter.ts:160-163`) | 15 000 ms (`:164`) | `SYNARA_CURSOR_TURN_IDLE_TIMEOUT_MS` |
| Grok | 600 000 ms (`GrokAdapter.ts:163-166`) | 15 000 ms (`:167`) | `SYNARA_GROK_TURN_IDLE_TIMEOUT_MS` |
| Droid | 600 000 ms, 3 600 000 ms con task annidati attivi (`DroidAdapter.ts:151-156`, `1729-1732`) | 15 000 ms (`:155`) | `SYNARA_DROID_TURN_IDLE_TIMEOUT_MS` |
| Devin | 30 min turno, 60 min con tool attivo (`DevinAdapter.ts:333-350`, `1263-1273`) | `min(5000, turno, tool)` (`:1315`) | `SYNARA_DEVIN_TURN_IDLE_TIMEOUT_MS`, `SYNARA_DEVIN_TOOL_IDLE_TIMEOUT_MS` |

Tutti i percorsi di questa tabella sono sotto `apps/server/src/provider/Layers/`. Cursor aggiorna l'orologio a ogni evento (`CursorAdapter.ts:1026-1030`); Grok solo sugli eventi di progresso (`GrokAdapter.ts:1336-1339`).

### Elicitation e permessi

- Registro provvisorio: permessi ed elicitation arrivati durante l'avvio restano in coda (massimo 256) finché `start` non finisce e l'adattatore non ha registrato il gestore. In caso di fallimento, nuova generazione o annullamento ricevono la risposta sicura: `{ outcome: "cancelled" }` per i permessi, `{ action: "decline" }` per le elicitation. Oltre il limite, errore `-32000` (`AcpSessionRuntime.ts:938-1114`, `1157-1168`, `2030-2043`).
- `parsePermissionRequest` ricava kind e dettaglio dal `toolCall` della richiesta (`AcpRuntimeModel.ts:593-618`). `makeAcpRequestOpenedEvent` produce `request.opened` con tipo `exec_command_approval` (execute), `file_read_approval` (read), `file_change_approval` (edit, delete, move) o `unknown` (`AcpCoreRuntimeEvents.ts:43-56`, `88-119`). `makeAcpRequestResolvedEvent` chiude con la decisione (`:121-142`).
- `selectAcpPermissionOptionId` sceglie l'`optionId` reale: `acceptForSession` preferisce `allow_always`, `accept` preferisce `allow_once`, il rifiuto `reject_once`; `cancel` non sceglie nulla (`AcpAdapterSupport.ts:97-119`).
- `resolveAcpPermissionPolicy`: in Plan rifiuta sempre; senza turno attivo annulla; in `full-access` accetta senza chiedere, o annulla se non c'è opzione di consenso; altrimenti `undefined`, cioè chiedi alla persona (`AcpAdapterSupport.ts:139-164`).
- Elicitation: solo `mode: "form"` con `requestedSchema` oggetto (`AcpElicitationSupport.ts:25-31`). Ogni proprietà diventa una domanda; le opzioni vengono da `oneOf`, `enum`, `items.enum`, `items.anyOf`, o Sì/No per i booleani; gli array sono a scelta multipla (`:33-94`). Le risposte tornano al tipo nativo: booleano da `true/yes/1/on` e `false/no/0/off`, numeri e interi validati, valori non validi omessi; l'esito è sempre `action: "accept"` (`:100-146`).
- Alla chiusura, approvazioni in sospeso diventano `cancel` e input in sospeso risposte vuote (`AcpAdapterSessionSupport.ts:135-161`).

### Fork

`forkViaAcpRuntime` (`acpFork.ts:20-57`) fallisce con `ProviderAdapterValidationError` se l'agente non dichiara `sessionCapabilities.fork` o non sa riaprire una sessione (né resume né load); il chiamante allora ricostruisce il fork dalla trascrizione di Synara (`acpFork.ts:12-17`, `32-45`). Poi attende il gate di replay e solo dopo applica il timeout RPC dell'adattatore, con `mcpServers: []` e la `cwd` di destinazione (`:46-55`). Le capacità vengono lette da `supportsSessionFork` e `supportsSessionRecovery` (`AcpSessionRuntime.ts:2198-2211`).

### Replay al caricamento

Dopo `session/load` l'agente può riprodurre tutta la trascrizione. Il runtime crea un `AcpLoadReplayGate` con quiete 350 ms e tetto 30 s, modificabili con `loadReplayPolicy` (`AcpSessionRuntime.ts:51-52`, `1965-1984`). `session/resume` non attiva il gate (`:443-444`).

Stati del gate (`AcpLoadReplayGate.ts:29-47`): `WaitingForConsumer`, `Suppressing`, `Ready`, `Released`. Gli orologi partono solo quando un consumatore si collega (`:149-170`). Ogni aggiornamento soppresso sposta `lastSuppressedAt` (`:171-183`). `settle` controlla al massimo ogni 50 ms e apre quando c'è quiete o si raggiunge il tetto; al tetto chiama `onHardTimeout`, che logga `acp.session_load_replay_quiet_wait_timeout` (`:8`, `81-146`; `AcpSessionRuntime.ts:1975-1982`). `release` sblocca tutti i waiter alla chiusura, con esito `released` che diventa errore `-32603` (`AcpLoadReplayGate.ts:67-79`; `AcpSessionRuntime.ts:1171-1189`, `1473-1475`).

Durante la soppressione gli eventi di trascrizione non escono, ma comandi, config option e modalità sì (`AcpSessionRuntime.ts:1555-1557`, `2379-2406`). Anche le notifiche arrivate prima dell'epoca, per una sessione ripresa, applicano solo lo stato limitato (`:1986-1993`). `prompt`, `forkSession`, `setConfigOption`, `getModeState`, `getConfigOptions` e `getAvailableCommands` aspettano il gate (`:1190-1194`, `1695`, `2135`, `2242`).

### Errori e log nativi

- `AcpErrors.ts:6-45`: `AcpSpawnError` (comando, causa), `AcpTransportError` (dettaglio, causa), `AcpRequestError` (codice, messaggio, dati). Codici usati dal runtime: `-32700` parse, `-32602` parametri, `-32601` metodo assente, `-32603` chiusura durante il replay, `-32000` autenticazione o overflow, `-32001` timeout di avvio.
- Autenticazione richiesta: codice `-32000` e un messaggio che corrisponde a frasi come "not authenticated", "invalid api key", "token expired" (`AcpSessionRuntime.ts:127-147`).
- `mapAcpToAdapterError` trasforma tutto in `ProviderAdapterRequestError`. Se il messaggio è generico ("Internal error", "agent error") usa `data.detail`; per codici `FS_*` concatena messaggio e dettaglio (`AcpAdapterSupport.ts:43-86`).
- Esito del turno: `stopReason` diverso da `cancelled` vale completato; `cancelled` con un tool fallito vale fallito con quel dettaglio, altrimenti annullato (`AcpAdapterSupport.ts:172-198`).
- Dispatcher delle notifiche: al massimo 2048 notifiche e 32 MiB in attesa; oltre, chiude la connessione con "ACP notification backlog exceeded its memory budget" (`AcpSessionRuntime.ts:650-664`; `AcpNotificationDispatcher.ts:19-41`). Consegna in ordine, una dopo l'altra (`AcpNotificationDispatcher.ts:30-39`).
- Log di protocollo: `protocolLogging` registra frame grezzi e decodificati in entrata e uscita (`AcpSessionRuntime.ts:149-153`, `633-646`); `requestLogger` registra `started`, `succeeded`, `failed` per metodo (`:427-433`, `1416-1445`).
- `makeAcpNativeLoggers` scrive NDJSON per thread con `kind` `request` o `protocol` (`AcpNativeLogging.ts:292-317`, `409-440`). `makeAcpDebugLoggers` aggiunge warning nel log del server solo per richieste fallite e frame in entrata filtrati, e nasconde sempre il payload di `session/prompt` (`:346-407`).
- `redactAcpLogSecrets` visita oggetti, stringhe, byte, errori e URL, e sostituisce con `[REDACTED]` chiavi sensibili, credenziali negli URL, parametri di query, header `Bearer`/`Cookie` e assegnazioni `NOME=valore`. I contatori come `prompt_tokens` restano (`AcpNativeLogging.ts:12-290`, `131-135`).

### Punti di estensione per provider

Percorsi relativi a `apps/server/src/provider/`. "No" significa che grep non trova l'uso.

| Punto di estensione | Cursor | Grok | Droid | Devin |
|---|---|---|---|---|
| Fabbrica sul runtime | `makeCursorAcpRuntime` `acp/CursorAcpSupport.ts:124-142` | `makeGrokAcpRuntime` `acp/GrokAcpSupport.ts:193-214` | `makeDroidAcpRuntime` `acp/DroidAcpSupport.ts:163-180` | `makeDevinAcpRuntime` `acp/DevinAcpSupport.ts:420-456` |
| `authMethodId` / `resolveAuthMethodId` | `"cursor_login"` `CursorAcpSupport.ts:132` | `GrokAcpSupport.ts:201` | `DroidAcpSupport.ts:171` | `DevinAcpSupport.ts:441-442` |
| `authenticateMeta` | `{ headless: true }` `CursorAcpSupport.ts:133` | `GrokAcpSupport.ts:202` | `DroidAcpSupport.ts:172` | `DevinAcpSupport.ts:427-447` |
| `authPolicy`, `validateInitializeResult` | No | No | No | `"on-demand"` `DevinAcpSupport.ts:440-446` |
| `freshSessionRetry` | No | 100 ms `GrokAcpSupport.ts:47`, `203-206` | No | No |
| `normalizeIncomingMessage` | No | No | No | `normalizeDevinGetOutputToolCall` `DevinAcpSupport.ts:69`, `448` |
| `clientCapabilities` | `_meta.parameterizedModelPicker` `CursorAcpSupport.ts:36-40`, `134` | No | `elicitation.form` `Layers/DroidAdapter.ts:825` | `elicitation.form` `Layers/DevinAdapter.ts:1905` |
| `sessionMeta` | No | `GROK_SESSION_META` `Layers/GrokAdapter.ts:230`, `1081` | No | No |
| `startupTimeouts` | `Layers/CursorAdapter.ts:151-156`, `763` | No | No | No |
| `buildMcpServers` | `Layers/CursorAdapter.ts:766` | `Layers/GrokAdapter.ts:1084` | `Layers/DroidAdapter.ts:829` | No |
| `onChildStderrLine` | No | No | No | `Layers/DevinAdapter.ts:1877-1896`, `1908` |
| `handleExtRequest` | `cursor/ask_question`, `cursor/create_plan`, `cursor/update_todos` `Layers/CursorAdapter.ts:789`, `829`, `885` | `x.ai/hooks/run`, ask e exit plan `Layers/GrokAdapter.ts:1101`, `1105`, `1142`; `acp/GrokAcpExtension.ts:4-7`, `79` | No | No |
| `handleExtNotification` | `cursor/update_todos` `Layers/CursorAdapter.ts:888-892` | No | No | No |
| `handleRequestPermission` | `Layers/CursorAdapter.ts:893` | `Layers/GrokAdapter.ts:1193` | `Layers/DroidAdapter.ts:847` | `Layers/DevinAdapter.ts:1918` |
| `handleElicitation` | No | No | `Layers/DroidAdapter.ts:934` | `Layers/DevinAdapter.ts:1989` |
| `request` personalizzata | `cursor/list_available_models` `acp/CursorAcpSupport.ts:561` | No | No | No |
| `setMode` | `Layers/CursorAdapter.ts:409` | No | `acp/DroidAcpSupport.ts:229-230` | `Layers/DevinAdapter.ts:613` |
| `setModel` / `setConfigOption` | `acp/CursorAcpSupport.ts:1341`, `1380` | No | `acp/DroidAcpSupport.ts:203`, `209`, `230` | No |
| `forkViaAcpRuntime` | `Layers/CursorAdapter.ts:1786` | `Layers/GrokAdapter.ts:2502` | `Layers/DroidAdapter.ts:1889` | No |
| Watchdog | `forkAcpTurnIdleWatchdog` diretto `Layers/CursorAdapter.ts:1463-1465` | `forkAcpAdapterTurnIdleWatchdog` `Layers/GrokAdapter.ts:2044` | idem `Layers/DroidAdapter.ts:1725` | idem `Layers/DevinAdapter.ts:2965` |
| `waitForAcpQueuedTurnEventsDrained` | No | `Layers/GrokAdapter.ts:915` | `Layers/DroidAdapter.ts:726` | `Layers/DevinAdapter.ts:1564` |
| `resolveRequestedAcpSessionModeId` | `Layers/CursorAdapter.ts:392` | No | No | No |
| `resolveAcpPermissionPolicy` | `Layers/CursorAdapter.ts:901` | `Layers/GrokAdapter.ts:1196` | `Layers/DroidAdapter.ts:850` | `Layers/DevinAdapter.ts:1922` |
| Costruttori `makeAcp*Event` (tool call) | `Layers/CursorAdapter.ts:1094` | `Layers/GrokAdapter.ts:1468` | `Layers/DroidAdapter.ts:1132` | `Layers/DevinAdapter.ts:2232` |
| `scopeAcpToolCallStateForTurn` | No | `Layers/GrokAdapter.ts:438` | `Layers/DroidAdapter.ts:367` | `Layers/DevinAdapter.ts:666` |
| `recordAcpSessionCost` | No | `Layers/GrokAdapter.ts:1543` | `Layers/DroidAdapter.ts:1245` | `Layers/DevinAdapter.ts:2313` |
| `makeAcpThreadLock` | `Layers/CursorAdapter.ts:457` | `Layers/GrokAdapter.ts:727` | `Layers/DroidAdapter.ts:429` | `Layers/DevinAdapter.ts:1363` |
| `makeAcpDebugLoggers` | No (solo nativi, `:736`) | `Layers/GrokAdapter.ts:1038` | `Layers/DroidAdapter.ts:786` | `Layers/DevinAdapter.ts:1835` |

### Casi limite dai test

Percorsi relativi a `apps/server/src/provider/acp/`.

- `AcpJsonRpcConnection.test.ts:31` (merges custom initialize client capabilities): fs e terminal restano `false`, `_meta` si aggiunge.
- `AcpJsonRpcConnection.test.ts:74` e `:443` (forwards provider session metadata): `_meta` arriva a `session/new` e `session/load`.
- `AcpJsonRpcConnection.test.ts:116` (retries one matching fresh session setup failure).
- `AcpJsonRpcConnection.test.ts:165` (discards the first probe session and fences orphan updates for on-demand auth).
- `AcpJsonRpcConnection.test.ts:259` (suppresses late load replay before an immediate first prompt).
- `AcpJsonRpcConnection.test.ts:316` (settles load replay before checking whether a mode write is a no-op).
- `AcpJsonRpcConnection.test.ts:516` (resumes across a runtime restart and accepts a follow-up prompt).
- `AcpJsonRpcConnection.test.ts:563` (prefers session/resume when the agent advertises it).
- `AcpJsonRpcConnection.test.ts:600` (does not call session/load when the agent does not advertise it).
- `AcpJsonRpcConnection.test.ts:678` (rejects fork cursors when the ACP agent cannot reopen sessions).
- `AcpJsonRpcConnection.test.ts:779` (preserves the fork RPC timeout after replay reaches its hard cap).
- `AcpJsonRpcConnection.test.ts:828` (assigns distinct fallback assistant item ids across separate runtime instances).
- `AcpJsonRpcConnection.test.ts:921` (segments assistant text around ACP tool calls).
- `AcpJsonRpcConnection.test.ts:983` (preserves upstream assistant message ids across ACP tool-call segments).
- `AcpJsonRpcConnection.test.ts:1078` (does not open assistant segments for reasoning chunks before tool calls).
- `AcpJsonRpcConnection.test.ts:1173` (skips no-op session config writes).
- `AcpJsonRpcConnection.test.ts:1255` (rejects invalid config option values before sending session/set_config_option).
- `AcpSessionRuntime.test.ts:142` e `:150` (frame guard): limite su blocchi spezzati, azzerato a ogni newline; frame senza fine rifiutato.
- `AcpSessionRuntime.test.ts:161` (keeps ACP scope closure pending until the owned root exit settles).
- `AcpSessionRuntime.test.ts:302` (uses the matching config update for an empty response).
- `AcpSessionRuntime.test.ts:349` (preserves config retained from replay when setup omits configOptions).
- `AcpSessionRuntime.test.ts:441` (answers dispatches from a previous generation with the default).
- `AcpSessionRuntime.test.ts:470` (delivers each buffered dispatch exactly once when register races complete).
- `AcpSessionRuntime.test.ts:512` (rejects dispatches once the buffer is exhausted).
- `AcpSessionRuntime.test.ts:544` (does not treat a bare api-key mention as an auth challenge).
- `AcpSessionRuntime.test.ts:651` (does not create a session when initialize validation fails).
- `AcpSessionRuntime.test.ts:780`, `:802`, `:827` (timeout di initialize, authenticate e setup con `acp-startup-timeout` e chiusura del figlio).
- `AcpSessionRuntime.epoch.test.ts:92` (applies a session/update that arrives during the transition window exactly once).
- `AcpSessionRuntime.epoch.test.ts:158` (counts only retained pending events when the pre-consumer buffer overflows).
- `AcpSdkConformance.test.ts:206` (fails pending work when the official-SDK subprocess exits).
- `AcpSdkConformance.test.ts:224` (uses the official SDK malformed-line policy without a second parser).
- `AcpSdkConformance.test.ts:278` e `:309` (annullamento di un prompt con `session/cancel` e di una richiesta di estensione con `$/cancel_request`).
- `AcpSdkConformance.test.ts:502` (decodes JSON lines split inside UTF-8 code points and across partial lines).
- `AcpNotificationDispatcher.test.ts:5` (rejects overflow by bytes/count and releases a stalled backlog).
- `AcpLoadReplayGate.test.ts:67` (starts its quiet and hard-cap clocks only after the consumer attaches).
- `AcpLoadReplayGate.test.ts:92` (releases every blocked waiter when startup fails or the session stops).
- `AcpTurnIdleWatchdog.test.ts:19` (does not treat heartbeats or unknown tags as progress).
- `AcpTurnIdleWatchdog.test.ts:94` (rejects non-positive overrides so a typo cannot disable the backstop).
- `AcpAdapterSupport.test.ts:68` (keeps Plan above Full Access and releases the gate for the next default turn).
- `AcpAdapterSupport.test.ts:132` (classifies provider-cancelled turns with failed tools as failed).
- `AcpAdapterSessionSupport.test.ts:94` (does not inherit Plan when the next turn omits its interaction mode).
- `AcpAdapterSessionSupport.test.ts:289` (bounds the wait so a stalled consumer cannot block settlement).
- `AcpElicitationSupport.test.ts:64` (coerces submitted text back to the ACP property's native type).
- `AcpNativeLogging.test.ts:187` (keeps usage-count tokens and benign headers intact).

### In Trama

- `actor ACPConnection` possiede un `Process` con tre `Pipe`. Legge stdout in un `Task` che accumula byte fino a `\n`, applica il limite di 8 MiB per riga e smista richieste, risposte e notifiche. stderr si legge sempre, anche senza consumatore.
- Codifica con `Codable`: `enum JSONRPCMessage { case request(id, method, params), response(id, result|error), notification(method, params) }`, un `JSONEncoder` per riga. Le risposte in attesa stanno in `[JSONRPCID: CheckedContinuation]`; l'annullamento del `Task` manda `$/cancel_request` e chiude la continuation.
- API dell'actor come in `AcpSessionRuntimeShape`: `start() async throws -> ACPStartResult`, `prompt`, `cancel`, `setMode`, `setModel`, `setConfigOption`, `forkSession`, `request(method:params:)`, `notify`. `start` idempotente con un `Task` condiviso e i tre timeout più il totale.
- `events: AsyncStream<ACPSessionEvent>` con `bufferingPolicy: .bufferingNewest(2048)`. `ACPSessionEvent` ricalca `AcpParsedSessionEvent`. Il parser di `session/update` è una funzione pura e statica, provata con JSON di esempio presi dai test di Synara.
- Epoca di sessione come `UInt64` dentro l'actor; ogni mutazione la ricontrolla dopo un `await`, per la rientranza degli actor.
- Il gate di replay e il watchdog sono piccoli tipi a parte con un `Clock` iniettato (`ContinuousClock` in produzione, un orologio di test nei test), così i 350 ms, i 30 s e i 15 s si provano senza attese reali.
- Trasporto simulato: `protocol ACPTransport { func send(_ line: Data) async throws; var lines: AsyncThrowingStream<Data, Error> { get } }`, con `ProcessTransport` e `InMemoryTransport`. Il secondo sostituisce `acp-mock-agent.ts` e permette di scrivere le sequenze dei casi limite sopra.
- Estensioni dei provider: `protocol ACPProviderExtension { var spawn: ACPSpawn; var clientCapabilities: ClientCapabilities; func resolveAuthMethod(_: InitializeResponse) throws -> String?; var authPolicy: ACPAuthPolicy; var sessionMeta: JSONObject?; func normalizeIncoming(_: JSONValue) -> JSONValue; func register(on: ACPConnection) async }`, con implementazioni di default vuote. Cursor, Grok, Droid e Devin implementano solo quello che la tabella sopra segna.
- `ACPError` come enum `spawn`, `transport`, `request(code:message:data:)`, con `isAuthRequired` e `isStartupTimeout`. La redazione dei log diventa una funzione pura su `JSONValue` con gli stessi test.

### Da non portare

- Effect: `Layer`, `ServiceMap`, `Scope`, `Ref`, `Deferred`, `Fiber`, `Queue`. In Swift bastano actor, `Task` e continuation.
- Il caricamento pigro dell'SDK (`AcpSdk.ts`): in Swift non c'è un costo di import a runtime.
- La traduzione tra `ReadableStream`/`WritableStream` e `Stream` di Effect (`AcpSessionRuntime.ts:684-740`) e l'adattamento `runHandler` tra promesse ed Effect (`:668-674`).
- I codec `Schema` e i controlli di compatibilità dei tipi (`AcpErrors.ts:47-49`, `AcpExtensions.ts:55-60`).
- I seam di test `__testTransitionReached` e `__testTransitionPause` (`AcpSessionRuntime.ts:416-424`): in Swift si ottiene lo stesso con il trasporto in memoria.
- La conversione dei percorsi WSL (`AcpSessionRuntime.ts:297-306`): Trama gira solo su macOS.
- `logout` e `listSessions` sul runtime, mai usati.

### Non trovato

- Un file `AcpJsonRpcConnection.ts`: non esiste. La connessione è `makeOfficialSdkClient` in `AcpSessionRuntime.ts:600-925`.
- Chiamate a `session/set_mode` e `session/set_model`: il runtime usa solo `session/set_config_option`.
- Gestori `fs/*` e `terminal/*` registrati dai quattro adattatori: nessuno, e le capacità restano `false`.
- Gestione di `user_message_chunk` e degli altri tipi di `session/update` fuori tabella: cadono nel `default` e vengono ignorati.
- Uso di `handleElicitationComplete` da parte degli adattatori.
- Un timeout generico per `session/prompt` nel runtime: esiste solo il watchdog degli adattatori; per il fork il timeout lo passa l'adattatore.
- Il valore di `DEVIN_WEDGE_SUPERVISOR_INTERVAL_MS` e i dettagli del supervisore dei blocchi di Devin: sono propri di Devin e non sono stati letti.
