## NN. Provider Cursor

Ticket: P03. Cursor è la CLI di Anysphere; Synara la avvia come `cursor-agent acp` e ci parla in ACP su stdio (`apps/server/src/provider/acp/CursorAcpSupport.ts:88-108`, `apps/server/src/provider/acp/CursorAcpCommand.ts:20`). Il runtime generico è descritto nella sezione Runtime ACP condiviso; qui c'è solo ciò che è proprio di Cursor. Tutti i percorsi sono relativi alla radice di Synara.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Layers/CursorAdapter.ts` | adattatore completo (sessioni, turni, eventi, modelli, fork), 1919 righe |
| `apps/server/src/provider/Services/CursorAdapter.ts` | interfaccia del servizio, `provider: "cursor"` (righe 11-17) |
| `apps/server/src/provider/acp/CursorAcpCommand.ts` | risoluzione dell'eseguibile e ambiente headless |
| `apps/server/src/provider/acp/CursorAcpSupport.ts` | spawn, fabbrica del runtime, catalogo e selezione del modello |
| `apps/server/src/provider/acp/CursorAcpExtension.ts` | codec e proiezione dei metodi `cursor/*` |
| `apps/server/src/provider/cursorSkillsDiscovery.ts` | skill dalle cartelle native di Cursor |
| `apps/server/src/provider/Layers/ProviderHealth.ts:1585-1787` | stato di accesso |
| `apps/server/src/agentGateway/mcpInjection.ts:264-291` | voci `mcpServers` per ACP |
| `packages/contracts/src/model.ts`, `orchestration.ts`, `settings.ts` | opzioni, selezione, impostazioni |

Test: `Layers/CursorAdapter.test.ts` (26 righe, solo la politica host), `acp/CursorAcpCommand.test.ts`, `acp/CursorAcpSupport.test.ts` (1599 righe), `acp/CursorAcpExtension.test.ts`, `acp/CursorAcpCliProbe.test.ts`, `cursorSkillsDiscovery.test.ts`, tutti sotto `apps/server/src/provider/`.

### Trasporto

- Eseguibile: un `binaryPath` configurato diverso da `agent` e da `cursor-agent` vince; altrimenti si cerca `cursor-agent` sul PATH; altrimenti il percorso Windows sotto LocalAppData; altrimenti `cursor-agent` (`apps/server/src/provider/acp/CursorAcpCommand.ts:239-258`, `:61-68`).
- Se il comando risolto è il launcher dell'editor `cursor`, si prova prima `cursor-agent` sul PATH, poi un `cursor-agent` fratello del launcher, poi il vecchio `agent` fratello ma solo se la cartella appartiene a Cursor (`/cursor.app/`, `/programs/cursor/`, `/cursor/resources/app/`, `/cursor-agent/`), altrimenti si lancia `cursor agent` (`apps/server/src/provider/acp/CursorAcpCommand.ts:83-130`, `:140-148`, `:161-169`). Un fratello `.ps1` viene avvolto in `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` (`apps/server/src/provider/acp/CursorAcpCommand.ts:228-236`).
- Argomenti della sessione: `-e <apiEndpoint>` se configurato, poi `acp` (`apps/server/src/provider/acp/CursorAcpSupport.ts:93-97`).
- Ambiente: quello filtrato per il provider `cursor`, con `NO_BROWSER=true` e `BROWSER=www-browser` per non aprire browser durante l'avvio (`apps/server/src/provider/acp/CursorAcpCommand.ts:23-26`; `apps/server/src/provider/acp/CursorAcpSupport.ts:102-106`). Le sonde di stato aggiungono `CI=true` e `DEBIAN_FRONTEND=noninteractive` (`apps/server/src/provider/acp/CursorAcpCommand.ts:27-31`, `:281-289`). L'unica credenziale passata è `CURSOR_API_KEY` (`apps/server/src/providerChildEnvironment.ts:59`).
- Il client dichiara `clientInfo` `Synara` e le capacità `_meta.parameterizedModelPicker: true` (`apps/server/src/provider/Layers/CursorAdapter.ts:762`; `apps/server/src/provider/acp/CursorAcpSupport.ts:36-40`, `:134`).

Tempi propri di Cursor:

| Costante | Valore | Riga |
| --- | --- | --- |
| `initialize` | 20 s | `apps/server/src/provider/Layers/CursorAdapter.ts:152` |
| `authenticate` | 30 s | `apps/server/src/provider/Layers/CursorAdapter.ts:153` |
| setup di sessione | 20 s | `apps/server/src/provider/Layers/CursorAdapter.ts:154` |
| avvio totale | 60 s | `apps/server/src/provider/Layers/CursorAdapter.ts:155` |
| fork e resume per il fork | 30 s | `apps/server/src/provider/Layers/CursorAdapter.ts:147` |
| scoperta modelli | 15 s | `apps/server/src/provider/Layers/CursorAdapter.ts:144` |
| turno senza attività | 600 s, `SYNARA_CURSOR_TURN_IDLE_TIMEOUT_MS` | `apps/server/src/provider/Layers/CursorAdapter.ts:160-163` |
| controllo del watchdog | 15 s | `apps/server/src/provider/Layers/CursorAdapter.ts:164` |

Il commento spiega la scelta: `cursor-agent` si autentica contro il portachiavi di macOS e può restare appeso se il prompt del portachiavi non può comparire, perciò `authenticate` ha il budget più largo (`apps/server/src/provider/Layers/CursorAdapter.ts:148-150`).

### Controllo di accesso

Autenticazione ACP: `authMethodId` fisso `"cursor_login"` con `_meta: { headless: true }` (`apps/server/src/provider/acp/CursorAcpSupport.ts:132-133`). Non c'è scelta fra metodi, né politica on-demand.

Stato mostrato: `makeCheckCursorProviderStatus` (`apps/server/src/provider/Layers/ProviderHealth.ts:1587-1787`) esegue fino a tre comandi, tutti con l'ambiente headless e timeout `DEFAULT_TIMEOUT_MS` di 4 s (`apps/server/src/provider/Layers/ProviderHealth.ts:115`, `:691-703`): `cursor-agent --version`, poi `cursor-agent status`, poi `cursor-agent models`.

| Esito | status | available | authStatus | Messaggio |
| --- | --- | --- | --- | --- |
| eseguibile assente | `error` | false | `unknown` | "Cursor Agent CLI (`cursor-agent`) is not installed or not on PATH." (`:1601-1613`) |
| errore di avvio | `error` | false | `unknown` | "Failed to execute Cursor Agent CLI health check: ..." (`:1609-1611`) |
| timeout di `--version` | `error` | false | `unknown` | "...failed to run. Timed out while running command." (`:1615-1626`) |
| uscita non zero | `error` | false | `unknown` | "...failed to run." più il dettaglio (`:1628-1641`) |
| `status` fallisce o scade | `warning` | true | `unknown` | "Could not verify Cursor Agent authentication status..." (`:1649-1676`) |
| `status` non autenticato | dalla tabella sotto | true | `unauthenticated`/`unknown` | `:1677-1688` |
| `models` fallisce o scade | `warning` | true | `authenticated` | "...but model discovery failed/timed out..." (`:1695-1723`) |
| `models` dice "no models available" | `error` | false | `authenticated` | "...it reports no models available for this account." (`:1738-1750`) |
| `models` esce non zero | `warning` | true | `authenticated` | "...but model discovery failed." più il dettaglio (`:1751-1762`) |
| `models` senza righe `slug - nome` | `warning` | true | `authenticated` | "...returned no recognizable model rows." (`:1764-1775`) |
| tutto bene | `ready` | true | `authenticated` | nessuno (`:1777-1785`) |

`parseCursorAuthStatusFromOutput` legge stdout e stderr insieme, in minuscolo (`apps/server/src/provider/Layers/ProviderHealth.ts:705-767`): "unknown command", "unrecognized command", "unexpected argument" danno `warning`/`unknown` con "authentication status command is unavailable in this Cursor Agent version"; "authentication required", "not logged in", "not authenticated", "unauthenticated", "login required", "run 'agent login'", "run \`agent login\`", "run cursor-agent login" danno `error`/`unauthenticated` con l'invito a `cursor-agent login`; "logged in", "login successful", "authenticated" danno `ready`/`authenticated`; uscita zero senza frasi riconosciute dà `warning`/`unknown`; il resto dà `warning`/`unknown` con il dettaglio. Il riconoscimento dei modelli è per riga contenente `" - "` (`:769-771`), l'assenza è la frase "no models available" (`:773-775`). L'aggiornamento è `cursor-agent update` con chiave di lock `cursor-agent`, senza pacchetto npm (`apps/server/src/provider/Layers/ProviderHealth.ts:2172-2183`).

### Catalogo modelli

- Fonte preferita: una sessione ACP usa e getta che chiama il metodo di estensione `cursor/list_available_models` (`apps/server/src/provider/acp/CursorAcpSupport.ts:433`, `:557-574`; `apps/server/src/provider/Layers/CursorAdapter.ts:1695-1711`). Il risultato ha `source: "cursor.acp"` (`apps/server/src/provider/Layers/CursorAdapter.ts:1730-1735`).
- Ogni modello porta i propri `configOptions`: da lì escono sforzi di ragionamento, finestra di contesto, `thinking` e `fast` (`apps/server/src/provider/acp/CursorAcpSupport.ts:471-536`). L'id ACP `default` diventa lo slug Synara `auto` (`:437`, `:478`). Voci senza valore o con slug ripetuto vengono scartate (`:474-477`, `:541-551`). Una risposta che non decodifica diventa `AcpRequestError.parseError` e fa cadere sul ripiego (`:563-569`).
- Ripiego: `cursor-agent models` con ambiente headless (`apps/server/src/provider/Layers/CursorAdapter.ts:1634-1662`), analizzato da `parseCursorCliModelList` (`apps/server/src/provider/acp/CursorAcpSupport.ts:368-421`): salta righe vuote, "Available models" e quelle che iniziano con "Tip:", separa su `" - "`, scarta slug o nome vuoti e slug ripetuti, toglie il suffisso `(default)`/`(current)`. Il risultato ha `source: "cursor.cli"` (`apps/server/src/provider/Layers/CursorAdapter.ts:1738-1748`).
- Entrambe le vie hanno timeout 15 s e messaggi distinti ("Timed out while discovering Cursor models via ACP." / "via CLI.") (`apps/server/src/provider/Layers/CursorAdapter.ts:1673-1686`, `:1714-1727`). Una lista vuota è un errore, non un successo (`:1663-1669`, `:1704-1710`).
- Il fornitore a monte si deduce dal gruppo dell'opzione select, altrimenti dal testo dello slug: `claude` → Anthropic, `gemini` → Google, `grok` → xAI, `kimi` → Moonshot AI, `deepseek`, `qwen` → Alibaba, `llama` → Meta, `mistral`, `nemotron` → NVIDIA, `gpt`/`codex`/`o1`/`o3`/`o4` → OpenAI, il resto Cursor (`apps/server/src/provider/acp/CursorAcpSupport.ts:291-344`).
- Nessuna cache: entrambi i rami restituiscono `cached: false` (`apps/server/src/provider/Layers/CursorAdapter.ts:1734`, `:1744`).
- Catalogo statico nei contratti: 33 voci, la prima `auto` (`packages/contracts/src/model.ts:900-1097`), predefinito `auto` (`packages/contracts/src/model.ts:1141`), alias di migrazione perché Cursor risponde `-32602` agli slug ritirati (`packages/contracts/src/model.ts:1214-1247`). L'adattatore non lo importa.

### Opzioni

- `CursorModelOptions`: `reasoningEffort` (stringa libera non vuota), `fastMode`, `thinking`, `contextWindow` (`packages/contracts/src/model.ts:132-138`). Selezione `CursorModelSelection` con `provider: "cursor"` (`packages/contracts/src/orchestration.ts:127-132`); opzioni di avvio `binaryPath` e `apiEndpoint` (`packages/contracts/src/orchestration.ts:204-207`); impostazioni con predefiniti `cursor-agent` e stringa vuota (`packages/contracts/src/settings.ts:51-56`).
- Cursor accetta id di modello parametrizzati come `modello[context=1m,effort=high,fast=false]`: `parseCursorModelParameters` legge le coppie, `buildCursorParameterizedModelSlug` le riscrive (`apps/server/src/provider/acp/CursorAcpSupport.ts:212-245`). La chiave dello sforzo è `effort` per Claude e Grok, `reasoning` altrove (`:635-640`).
- `applyCursorAcpModelSelection` (`apps/server/src/provider/acp/CursorAcpSupport.ts:1306-1391`): legge le config option, appiattisce le scelte, fonde le opzioni richieste con quelle dedotte dallo slug CLI, risolve il valore ACP, chiama `setModel` e poi scrive le config option rimaste. Ordine di scrittura: `fast` (predefinito `false`), `thinking`, `context`, infine `effort`, perché le varianti fast di Cursor abbassano lo sforzo (`:995-1004`).
- La risoluzione degrada e non abortisce mai: `Resolved`, `Fallback` (si tiene il modello corrente della sessione o `auto`), `Unavailable` (`:1163-1245`). Un rifiuto `-32602` di `setModel` produce una nota, non un errore (`:66-72`, `:1341-1356`). Dopo un `Fallback` le opzioni richieste non vengono applicate, per non mutare la configurazione di un modello diverso (`:1358-1364`). Le note diventano un evento `runtime.warning` e un log `cursor.acp.model_selection_degraded` (`apps/server/src/provider/Layers/CursorAdapter.ts:503-533`).
- Dopo `setModel` le config option si rileggono, perché `auto` spesso non espone `fast`/`effort` (`apps/server/src/provider/acp/CursorAcpSupport.ts:1366-1378`).
- Modalità per turno: alias Plan `plan`, `architect`; implement `code`, `agent`, `default`, `chat`, `implement`; approvazione `ask` (`apps/server/src/provider/Layers/CursorAdapter.ts:165-172`), risolti da `resolveRequestedAcpSessionModeId` e scritti con `setMode` (`:392-416`). In Plan il testo riceve il prefisso `CURSOR_PLAN_MODE_PROMPT_PREFIX` (`:173-178`, `:292-304`).

### Capacità dichiarate

Oggetto `capabilities` (`apps/server/src/provider/Layers/CursorAdapter.ts:1888-1891`):

```ts
{ sessionModelSwitch: "in-session", supportsRuntimeModelList: true }
```

`getComposerCapabilities` (`apps/server/src/provider/Layers/CursorAdapter.ts:1592-1605`): `supportsSkillMentions: true`, `supportsSkillDiscovery: true`, `supportsNativeSlashCommandDiscovery: false`, `supportsPluginMentions: false`, `supportsPluginDiscovery: false`, `supportsRuntimeModelList: true`, `supportsThreadCompaction: false`, `supportsThreadImport: true`. Metodi esposti: `forkThread`, `respondToUserInput`, `listSkills`, `listModels`; mancano `compactThread`, `listCommands`, `listPlugins`, `readExternalThread` (`apps/server/src/provider/Layers/CursorAdapter.ts:1886-1908`).

Le skill si leggono dal filesystem: `~/.cursor/skills-cursor`, `~/.cursor/skills` e le cartelle di progetto `.cursor`, con origini in ordine `cursor`, `agents`, `claude`, `codex` (`apps/server/src/provider/cursorSkillsDiscovery.ts:18-28`; `apps/server/src/provider/skillsCatalog.ts:427-432`, `:477`). Il risultato ha `source: "cursor.filesystem"` e `cached: false` (`apps/server/src/provider/Layers/CursorAdapter.ts:1607-1625`).

### Ciclo di vita e cursore di ripresa

- Cursore: `{ schemaVersion: 1, sessionId }`; si scarta se la versione è diversa o l'id è vuoto (`apps/server/src/provider/Layers/CursorAdapter.ts:143`, `:310-315`, `:991-994`).
- Avvio sotto blocco per thread: valida il provider, risolve la cartella, ferma la sessione precedente, registra i gestori di estensione e di permesso, poi `acp.start()` (`apps/server/src/provider/Layers/CursorAdapter.ts:688-980`). Le impostazioni di sessione fondono quelle del layer con `providerOptions.cursor` (`:741-755`).
- Un fallimento di avvio non passa per `mapAcpToAdapterError`: il testo dell'agente viene conservato da `cursorAcpFailureDetail`, compreso il campo `data` del JSON-RPC (`apps/server/src/provider/Layers/CursorAdapter.ts:341-359`, `:968-979`).
- La sessione viene registrata prima che il replay si chiuda; l'attesa di `awaitLoadReplayReady` gira senza il blocco, così uno stop la sblocca subito (`apps/server/src/provider/Layers/CursorAdapter.ts:1164-1178`). Poi, sotto blocco, si applica la configurazione, si risolve `sessionConfigReady` e si emettono `session.started`, `session.state.changed` `ready` e `thread.started` (`:1180-1229`).
- Turno: attende `sessionConfigReady`, applica modello e modalità, unisce testo, allegati e immagini, rifiuta un prompt vuoto (`apps/server/src/provider/Layers/CursorAdapter.ts:1241-1316`). La politica host di Synara si antepone una sola volta (`:135-142`, `:1317-1323`). Il prompt gira in una fibra nello scope della sessione, con i tre esiti fallito, completato e annullato (`:1348-1458`).
- Watchdog: `forkAcpTurnIdleWatchdog` diretto, in pausa mentre ci sono approvazioni o domande in sospeso; allo scadere emette `turn.completed` `failed` con "Cursor stopped responding (no activity for Ns); the turn was timed out.", logga `cursor.acp.turn_idle_timeout`, manda `session/cancel` e interrompe la fibra (`apps/server/src/provider/Layers/CursorAdapter.ts:572-616`, `:1463-1474`).
- Interruzione: un `turnId` vecchio viene ignorato con un log `cursor.acp.stale_interrupt_ignored`; altrimenti chiude approvazioni e domande, manda `session/cancel` e interrompe la fibra (`apps/server/src/provider/Layers/CursorAdapter.ts:1483-1514`).
- Piano: la richiesta `cursor/create_plan` diventa `turn.proposed.completed`; se la modalità è Plan e il testo del piano è nuovo, il turno si chiude subito come `completed` (`apps/server/src/provider/Layers/CursorAdapter.ts:535-567`, `:829-864`).
- Rollback: taglia gli ultimi N turni ritenuti in memoria, senza cursore nativo (`apps/server/src/provider/Layers/CursorAdapter.ts:1558-1571`). Fork: `session/fork` sulla sessione attiva o su una ripresa temporanea; rifiutato con un turno in corso; restituisce solo il nuovo cursore (`:1773-1873`).
- Stop: rilascia la lease del gateway, chiude approvazioni e domande, sblocca `sessionConfigReady`, interrompe la fibra delle notifiche, chiude lo scope ed emette `session.exited` (`apps/server/src/provider/Layers/CursorAdapter.ts:660-686`).

### Iniezione degli strumenti host

- Con credenziali del gateway l'adattatore prende una lease per thread e passa `buildMcpServers` al runtime (`apps/server/src/provider/Layers/CursorAdapter.ts:720-724`, `:764-773`). Il runtime la chiama dopo `initialize` e mette il risultato in `session/new`, `session/resume` o `session/load` (`apps/server/src/provider/acp/AcpSessionRuntime.ts:1788`, `:1873`, `:1900`, `:1927`).
- `buildAcpSynaraMcpServers`: se `agentCapabilities.mcpCapabilities.http` è vero, voce HTTP `synara` con header `Authorization: Bearer <token>`; altrimenti voce stdio con il proxy e le variabili `SYNARA_AGENT_GATEWAY_URL` e `SYNARA_AGENT_GATEWAY_TOKEN` (`apps/server/src/agentGateway/mcpInjection.ts:264-291`).
- La lease si rilascia allo stop e all'uscita del processo; ogni fine turno annulla le richieste del gateway per quel turno (`apps/server/src/provider/Layers/CursorAdapter.ts:665`, `:787`, `:544`, `:578`, `:1358`, `:1392`).

### Eventi d'uso

- `UsageUpdated` registra il costo cumulativo di sessione e pubblica l'evento di uso token con il turno attivo (`apps/server/src/provider/Layers/CursorAdapter.ts:272-281`, `:1125-1144`).
- Il costo resta cumulativo, senza inventare delta per turno, e viene allegato a ogni `turn.completed` (`apps/server/src/provider/Layers/CursorAdapter.ts:283-290`, `:1421-1423`).
- Attribuzione dei segmenti: `assistantItemTurnIds` lega ogni `itemId` al turno in cui è comparso, così un `item.completed` in ritardo resta sul turno d'origine (`apps/server/src/provider/Layers/CursorAdapter.ts:245-270`).
- Ogni evento in arrivo, di qualunque tipo, aggiorna l'orologio del watchdog (`apps/server/src/provider/Layers/CursorAdapter.ts:1028-1030`).
- I metodi `cursor/*` e `session/request_permission` vengono anche scritti nel log nativo NDJSON con sorgente `acp.cursor.extension` o `acp.jsonrpc` (`apps/server/src/provider/Layers/CursorAdapter.ts:475-499`).

### Casi limite dai test

- `apps/server/src/provider/Layers/CursorAdapter.test.ts:11` (delivers scoped MCP host context exactly once per fresh/load/fork session)
- `apps/server/src/provider/Layers/CursorAdapter.test.ts:21` (stays truthful without a scoped gateway connection)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:25` (maps the old ambiguous agent default to cursor-agent)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:35` (discovers native Windows Cursor Agent installs outside PATH)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:46` (keeps PATH precedence over the native Windows fallback)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:116` (does not use adjacent generic agent commands for bare cursor launchers)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:152` (prefers PATH cursor-agent over sibling legacy agent commands)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:164` (uses bundled sibling agent commands for Cursor-owned editor paths)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:227` (prefers safer Windows shims but accepts PowerShell-only Cursor agent siblings)
- `apps/server/src/provider/acp/CursorAcpCommand.test.ts:327` (forces Cursor probe subprocesses into headless mode while preserving the base env)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:180` (includes the configured api endpoint when present)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:247` (reads Cursor ACP model picker options including grouped choices)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:289` (parses Cursor CLI model output with provider grouping metadata)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:361` (does not infer 1M context for Opus 4.7 Cursor aliases)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:420` (maps Cursor auto to legacy ACP default model values named Auto)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:504` (maps unsupported false boolean parameters to an available Cursor ACP model value)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:546` (sets the base model before applying separate config options)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:590` (keeps GPT-5.4 fast=true after switching away from Auto)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:795` (maps Cursor's namespaced Grok CLI id to the unprefixed ACP model value)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:845` (keeps Cursor Grok fast mode off even when ACP advertises fast=true)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:1005` (does not inherit advertised low effort when enabling Cursor Grok fast mode)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:1054` (does not apply requested Grok options to a fallback model)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:1116` (applies Cursor Grok effort after fast so the fast variant keeps HIGH)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:1330` (drops stale Cursor context traits that are no longer exposed by ACP)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:1387` (repairs stale parameterized Cursor model strings against ACP choices)
- `apps/server/src/provider/acp/CursorAcpSupport.test.ts:1588` (maps the ACP 'default' model id to Synara's 'auto' slug and skips empty option sets)
- `apps/server/src/provider/acp/CursorAcpExtension.test.ts:41` (defaults ask-question multi-select to false when Cursor omits allowMultiple)
- `apps/server/src/provider/acp/CursorAcpExtension.test.ts:86` (projects todo updates into a plan shape and drops invalid entries)
- `apps/server/src/provider/cursorSkillsDiscovery.test.ts:17` (discovers project, nested, and user Cursor skill folders)
- `apps/server/src/provider/cursorSkillsDiscovery.test.ts:75` (keeps the provider scope when the cwd lives under the home dir)
- `apps/server/src/provider/acp/CursorAcpCliProbe.test.ts:24`, `:52`, `:103`: sonda facoltativa contro una installazione reale, attiva solo con `SYNARA_CURSOR_ACP_PROBE=1` (`apps/server/src/provider/acp/CursorAcpCliProbe.test.ts:23`).

### In Trama

Cursor diventa un profilo del client ACP condiviso, senza un secondo runtime:

```swift
struct CursorACPProfile: ACPProviderProfile {
    let kind: ProviderKind = .cursor
    func spawn(settings: CursorSettings, cwd: URL) -> ACPSpawn   // cursor-agent [-e endpoint] acp, env browserless
    var authMethodId: String { "cursor_login" }
    var authenticateMeta: [String: JSONValue] { ["headless": true] }
    var clientCapabilities: ClientCapabilities { .init(meta: ["parameterizedModelPicker": true]) }
    var startupTimeouts: ACPStartupTimeouts { .init(initialize: .seconds(20), authenticate: .seconds(30), setup: .seconds(20), total: .seconds(60)) }
    func mcpServers(initialize: ACPInitializeResult, lease: GatewayLease) -> [ACPMcpServer]
    func register(on: ACPConnection) async   // cursor/ask_question, cursor/create_plan, cursor/update_todos
}
```

- La risoluzione dell'eseguibile diventa una funzione pura `resolveCursorBinary(configured:fileExists:)` su `URL`, provata con un finto filesystem come fa `CursorAcpCommand.test.ts`. Su macOS servono solo i rami POSIX: il launcher `cursor` dentro `Cursor.app` e il fratello `cursor-agent`.
- Lo slug parametrizzato è un tipo: `struct CursorModelID { var base: String; var parameters: [String: String] }` con `init?(rawValue:)` e `description`, così parsing e ricostruzione stanno in un posto solo e si provano senza ACP.
- `applyCursorAcpModelSelection` diventa `CursorModelResolver`, funzione pura da (config option, scelte, opzioni richieste) a un `enum Outcome { none, resolved(String), fallback(String, requested: String), unavailable(requested: String) }`. L'attore applica l'esito e pubblica le note come `runtime.warning`.
- `CursorAdapter` è un attore che tiene per thread `CursorSessionContext`: turno attivo, `assistantItemTurnIds` come dizionario, impronte del piano, `sessionConfigReady` come continuation.
- Catalogo: `CursorModelDiscovery` prova prima la sessione ACP usa e getta con `cursor/list_available_models`, poi `cursor-agent models`; entrambe con timeout 15 s e nessuna cache, come oggi.
- Stato di accesso: stessa catena `--version`, `status`, `models` con timeout 4 s; il riconoscimento delle frasi è una funzione pura su `String` con gli stessi casi della tabella sopra.

### Da non portare

- La ricerca dei fratelli Windows e l'avvolgimento PowerShell (`apps/server/src/provider/acp/CursorAcpCommand.ts:59-68`, `:199-236`): Trama gira solo su macOS.
- La meccanica Effect di `Layer`, `Scope`, `Deferred`, `Fiber` e `Effect.forkIn` (`apps/server/src/provider/Layers/CursorAdapter.ts:1152`, `:1456`): in Swift diventa concorrenza strutturata.
- I codec `Schema` di `CursorAcpExtension.ts:10-56`: in Swift bastano tipi `Codable`.
- Il logger NDJSON nativo e `logNative` (`apps/server/src/provider/Layers/CursorAdapter.ts:475-499`), se Trama non replica il formato dei log di Synara.
- L'aggiornamento `cursor-agent update` (`apps/server/src/provider/Layers/ProviderHealth.ts:2172-2183`), fuori da P03.

### Non trovato

- Una cache dei modelli Cursor: entrambe le vie restituiscono `cached: false` e non c'è mappa di cache nell'adattatore. Cercati `cache`, `Cache` e `ttl` in `CursorAdapter.ts`.
- Un uso lato server del catalogo statico Cursor dei contratti: nessun import di `MODEL_OPTIONS_BY_PROVIDER` o `getModelCapabilities` in `CursorAdapter.ts` e `CursorAcpSupport.ts`.
- Una compattazione nativa: `supportsThreadCompaction: false` e nessun `compactThread` (`apps/server/src/provider/Layers/CursorAdapter.ts:1603`, `:1886-1908`).
- Un elenco nativo di comandi slash o di plugin: `supportsNativeSlashCommandDiscovery` e `supportsPluginDiscovery` sono `false` e non esistono `listCommands` o `listPlugins`.
- Un import di cronologia da file di Cursor: `supportsThreadImport: true` ma non c'è un `readExternalThread` nell'adattatore; cercati `readExternalThread` e `SessionHistory` in `CursorAdapter.ts`.
- Un gestore di elicitation o `freshSessionRetry` per Cursor: cercati `handleElicitation` e `freshSessionRetry` in `CursorAdapter.ts` e `CursorAcpSupport.ts`, nessun risultato.
- Test di ciclo di vita completo dell'adattatore Cursor: `CursorAdapter.test.ts` ha 26 righe e prova solo la consegna della politica host.
