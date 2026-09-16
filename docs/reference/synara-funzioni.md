# Riferimento funzionale: come Synara risolve ciò che il verticale deve costruire

Data: 16 settembre 2026. Fonte: repository pubblico [Emanuele-web04/synara](https://github.com/Emanuele-web04/synara), commit `dd88d9272f97e4dda5735281e73ce14de388ad25`. I percorsi sotto sono relativi alla radice di quel repository; i numeri di riga valgono per quel commit.

## Perché esiste

Chi implementa un ticket V01-V09 parte dal ticket con un contesto pulito. La [specifica del verticale](../spec-coordinatore-verticale.md) dice che da Synara si portano i comportamenti e la forma del collegamento ai provider, ma non dice come Synara li realizza. Senza questo documento ogni implementatore dovrebbe rileggere Synara da capo o, peggio, reinventare regole che Synara ha già messo alla prova: dove finisce un turno, come si fondono le attività di uno strumento, cosa conta come uso della finestra di contesto, come si rifiuta una chiamata MCP.

La regola è una: portiamo logica e comportamento, non codice Electron/React/Effect. Ogni sezione dice cosa Synara fa, con quali forme di dati, dove sta nel codice, come si traduce in Trama e cosa lasciare fuori. Le deviazioni da quanto descritto qui sono ammesse, ma vanno motivate nella pull request del ticket.

Il riferimento estetico resta la [app Codex](design-app-codex.md): colori, font e misure vengono da lì. Da Synara arrivano solo i comportamenti.

Convenzioni:

- I tipi TypeScript sono ridotti ai campi utili. In Synara molti sono schemi Effect (`Schema.Struct`), qui scritti come interfacce.
- "In Trama" indica la traduzione proposta verso Swift e i tipi esistenti (`CodexClient`, `RequestState`, `ProjectMandate`, `PactEngine`, `DesignSystem`). Non descrive codice già scritto, salvo dove è detto.
- Dove un rapporto di ricerca non ha trovato qualcosa, il documento lo dice. Non va dedotto.

Sezioni: [1 timeline](#1-timeline-e-raggruppamento-delle-attività) (V01, V06), [2 canale MCP](#2-canale-agente-host-mcp) (V02, V03), [3 finestra di contesto](#3-finestra-di-contesto) (V07), [4 composer](#4-composer) (V07), [5 adattatore provider](#5-adattatore-provider) (V08, V02), [6 aspetto della chat](#6-aspetto-della-chat-come-comportamenti) (V06).

## 1. Timeline e raggruppamento delle attività

### Dove sta in Synara

La catena ha cinque passi:

1. L'evento del provider normalizzato (`ProviderRuntimeEvent`) viene proiettato dal server in attività persistite (`OrchestrationThreadActivity`): `apps/server/src/orchestration/providerRuntimeActivityProjection.ts`, funzione `projectProviderRuntimeActivities` (righe 543-1293).
2. Il client ricava le righe di lavoro (`WorkLogEntry`) con `deriveWorkLogEntries`: `apps/web/src/workLog.ts`.
3. `deriveAgentActivityTimelineState` compatta il ragionamento consecutivo: `apps/web/src/components/chat/agentActivity.logic.ts`.
4. `deriveTimelineEntries` fonde lavoro, messaggi e piani: `apps/web/src/workLog.ts` (righe 2443-2581).
5. `deriveMessagesTimelineRows` raggruppa e chiude i turni conclusi: `apps/web/src/components/chat/MessagesTimeline.logic.ts` (righe 555-929).

Altri file: `apps/web/src/session-logic.ts` (formattazione delle durate e stato del turno), `apps/web/src/components/chat/toolCallGroup.logic.ts` (sottoriepiloghi "Ran N commands"), `apps/web/src/components/ChatView.tsx` e `ChatView.logic.ts` (ritardo di chiusura), `apps/web/src/components/chat/useChatWorkLog.ts` (turni visibili).

### Forme dei dati

```ts
// packages/contracts/src/orchestration.ts
interface OrchestrationMessage {           // :523-539
  id: MessageId; role: "user" | "assistant" | "system"; text: string;
  textSegments?: { sequence: number; startedAt: IsoDate; endedAt: IsoDate; text: string }[];
  startsNewTurn?: boolean; turnId: TurnId | null; streaming: boolean;
  dispatchMode; createdAt: IsoDate; updatedAt: IsoDate;
}
interface OrchestrationThreadActivity {    // :623-632
  id: EventId; tone: "info" | "tool" | "approval" | "error";
  kind: string; summary: string; payload: Json;
  turnId: TurnId | null; sequence?: number; createdAt: IsoDate;
}
interface OrchestrationLatestTurn {        // :643-651
  turnId; state: "running" | "interrupted" | "completed" | "error";
  requestedAt; startedAt: IsoDate | null; completedAt: IsoDate | null;
  assistantMessageId: MessageId | null;
}
```

Il `ChatMessage` del client (`apps/web/src/types.ts:108-125`) aggiunge `completedAt?`, che è la fine della durata "Worked for".

```ts
// apps/web/src/workLog.ts:71-126
interface WorkLogEntry {
  id: string; createdAt: string; sequence?: number; turnId?: TurnId | null;
  label: string; detail?: string; command?: string; preview?: string;
  changedFiles?: string[];
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string; toolName?: string; toolCallId?: string; toolStatus?: ...;
  liveActivity?: WorkLogLiveActivity; toolDetails?: WorkLogToolDetails;
  itemType?: ToolLifecycleItemType; activityKind?: string; nativeEventType?: string;
}
interface WorkLogLiveActivity {
  state: "starting" | "thinking" | "running_tool" | "waiting" | "streaming"
       | "completed" | "failed" | "cancelled";
  label: string; startedAt?: string; lastActivityAt: string;
  detail?: string; progress?: ...; elapsedSeconds?: number;
}

// apps/web/src/components/chat/MessagesTimeline.logic.ts:36-38
type CollapsedTurnItem =
  | { kind: "work"; id: string; entry: WorkLogEntry }
  | { kind: "narration"; id: string; message: ChatMessage };
```

Le righe della timeline (`MessagesTimelineRow`, logic.ts:216-276) sono: `work`, `message` (con `leadingWorkEntries`, `inlineWorkEntries`, `collapsedTurnItems`, `collapsedWorkElapsed`, `durationStart`), `message-segment`, `proposed-plan`, `working`, `working-header`, `worktree-setup`.

### Algoritmo

Raggruppamento prima della chiusura (`deriveMessagesTimelineRows`, logic.ts:555-755):

- Le voci di lavoro consecutive formano un gruppo in attesa.
- Se subito dopo arriva un messaggio dell'assistente, il gruppo diventa il suo lavoro iniziale (`leadingWorkEntries`), reso sopra il testo.
- Un messaggio della persona svuota il gruppo: se la riga precedente è un messaggio dell'assistente, il gruppo gli si attacca come lavoro in coda (`inlineWorkEntries`), reso sotto il testo; altrimenti diventa una riga `work` a sé.
- Un piano proposto o un segmento di messaggio svuota il gruppo senza attaccarlo.
- Il lavoro rimasto in fondo si attacca all'ultimo messaggio dell'assistente, così la chat non finisce mai con un log di strumenti staccato.

Chiusura dei turni conclusi (`collapseSettledTurns`, logic.ts:794-929):

1. Il gruppo appartiene al messaggio terminale dell'assistente: l'ultimo messaggio dell'assistente prima del messaggio successivo non dell'assistente, o prima della fine (`deriveTerminalAssistantMessageIds`, :528-550).
2. Da quella riga si scorre all'indietro e si raccolgono le righe `work`, i messaggi precedenti dell'assistente (preamboli e narrazione) e i segmenti non in streaming.
3. Un piano proposto viene saltato: resta visibile e la scansione prosegue.
4. Qualsiasi altra riga ferma la scansione. In pratica è il messaggio della persona. Il commento alle righe 839-841 lo spiega: "Provider mini-turns can have distinct turnIds inside one assistant answer, so the user message boundary is the stable UI grouping point."
5. Ordine della lista chiusa: per ogni messaggio raccolto, il suo lavoro iniziale, poi eventuali elementi già chiusi, poi la narrazione, poi il lavoro in coda. Un messaggio segmentato entra una sola volta, come narrazione al primo segmento. Il lavoro iniziale e in coda della riga terminale va per ultimo. I riepiloghi dei file modificati dei messaggi raccolti confluiscono nella riga terminale.
6. Se la lista è vuota, non si chiude nulla.

Quando un turno resta aperto (logic.ts:821-837):

- Mai mentre il messaggio terminale ha `streaming`.
- Mai mentre è il turno attivo: `activeTurnInProgress` e (`turnId === activeTurnId` oppure il messaggio è il terminale in coda). `findTailTerminalAssistantMessageId` restituisce null se in coda c'è un messaggio della persona più recente.
- Ogni altro turno concluso è chiuso. La persona controlla solo aperto o chiuso della riga, non se il turno si raccoglie.

Ritardo alla fine del turno (`ChatView.tsx:1514-1586`, `ChatView.logic.ts:1579-1591`): `activeTurnInProgress = activeTurnLayoutLive || keepSettledActiveTurnLayout`, con `activeTurnLayoutLive = isWorking || !latestTurnSettled`. Al passaggio da vivo a concluso, e solo se `latestTurnStartedAt` esiste, l'impianto vivo resta per `ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS = 180` ms, poi si chiude. Un cambio di thread o di turno azzera l'attesa. Per i provider che azzerano `activeTurnId` sugli eventi terminali si usa l'ultimo turno noto (`ChatView.tsx:1450-1454`).

`isLatestTurnSettled` (session-logic.ts:133-145): falso senza `startedAt` o `completedAt`; vero se lo stato è `interrupted` o `error`; altrimenti falso finché la sessione è `running`.

Durata di "Worked for" (logic.ts:876-915):

- L'inizio parte da `durationStart` della riga terminale e scende al più vecchio fra `createdAt` delle righe di lavoro raccolte, `createdAt` dei segmenti e `durationStart` dei messaggi raccolti. Le date non leggibili sono ignorate.
- La fine è `completedAt` del messaggio terminale.
- `computeMessageDurationStart` (:348-365): un messaggio della persona fissa il confine al proprio `createdAt`; un messaggio dell'assistente completato lo sposta al proprio `completedAt`.

Formattazione (session-logic.ts:84-125):

```ts
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}
// formatElapsed(start, end): null se manca la fine, non è leggibile o end < start
```

L'etichetta è `Worked for ${elapsed}` oppure "Details" se la durata non si calcola. Esempi: "Worked for 1.0s", "Worked for 42s", "Worked for 3m 5s". Non c'è l'unità ore.

Intestazione dal vivo: la riga `working-header` compare subito dopo l'ultimo messaggio della persona solo con `isWorking && activeTurnStartedAt`. Dice "Working for" più un timer al secondo, con un formattatore diverso (`formatClockDuration`, session-logic.ts:96-106: secondi interi, poi "Mm Ss", poi "Hh Mm"). Non si apre. In coda alla conversazione una riga `working` mostra "Thinking" con effetto shimmer. La regola (logic.ts:721-729) è che questo sia l'unico stato vivo: le righe di lavoro sono storia e non lo sostituiscono.

Sottoriepiloghi dentro un gruppo (`toolCallGroup.logic.ts`):

- Si raccolgono solo sequenze di almeno 2 voci riassumibili (`MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2`). Riassumibile vuol dire `tone === "tool"` e non creazione di thread, automazione o subagente.
- Categorie in ordine fisso: comando "Ran N command(s)", modifica "Edited N file(s)", lettura "Read N file(s)", ricerca "Searched N file(s)", agente "Ran N agent task(s)", strumento "Used N tool(s)", altro "Ran N tool call(s)" se da solo, altrimenti "N other tool call(s)". Le parti si uniscono con ", ".
- Modifica e lettura contano file distinti.
- I confini delle sequenze sono le voci non riassumibili: ragionamento, informazioni, errori, schede ricche.
- Una sequenza resta aperta finché ha una voce `running` o è l'ultima della coda dal vivo. Si chiude a metà turno appena la segue una narrazione.
- Tetti di righe aperte: 6 per le righe `work` a sé (tiene le ultime), 4 per le righe in coda a un messaggio (le ultime mentre il turno è vivo, le prime a turno concluso), con "+N more tool calls" e "Show less".

Attività nascoste (workLog.ts:286-343):

- Tipi scartati: `task.started/updated/completed`; `turn.completed` e `turn.aborted` salvo tono errore; `account.rate-limits.updated`; `context-window.*`; "Checkpoint captured"; aggiornamenti di ExitPlanMode; `tool.started` di comando senza comando, azione o nome.
- Si tengono solo le attività il cui turno appartiene a un messaggio dell'assistente o all'ultimo turno. Restano sempre: `provider.context.changed`, `context-compaction` a livello di thread, `automation.created`, `checkpoint.revert.failed`. Se l'insieme è vuoto si usa l'ultimo turno.
- Il server non trasforma mai in attività `hook.started`, `hook.progress` e le richieste `tool_user_input`.

Fusione e deduplica (workLog.ts:1004-1282):

- Il ciclo di vita di uno strumento (`tool.started`, `tool.updated`, `tool.completed`) si fonde per `collapseKey = "tool:<toolCallId>"` a prescindere dalla posizione. Serve per le chiamate parallele che emettono tutti gli avvii prima dei completamenti.
- `toolCallId` si legge da `data.toolCallId ?? toolUseId ?? callID ?? callId ?? item.id`.
- Senza `toolCallId` si fondono solo voci adiacenti con la stessa chiave e comando o file compatibili. Un `tool.completed` non assorbe mai una voce successiva.
- La voce fusa tiene id, `createdAt` e `sequence` della prima e il contenuto più recente. Uno stato terminale non torna mai in corso.
- Elenco di attività del piano: una riga per turno (`taskList:<turnId>`), contenuto sostituito, posizione fissata al primo arrivo, etichetta "X out of N tasks completed".
- Avvisi `runtime.warning` identici nello stesso turno diventano "N notices - msg".
- Una riga "Compacting context" assorbe la sua riga terminale.
- Il server salta gli aggiornamenti `tool.updated` e `task.progress` con la stessa impronta del precedente (`providerRuntimeActivityProjection.ts:1295-1334`).

Ordinamento:

- Attività: prima `sequence` (quelle senza vengono prima di quelle con), poi `createdAt` come stringa, poi il rango del ciclo di vita (avviato, aggiornato, completato), poi l'avanzamento della compattazione prima della sua riga terminale, poi id (workLog.ts:2231-2285).
- Voci della timeline: ogni voce riceve l'indice del "blocco persona", cioè quanti messaggi della persona che aprono un turno ci sono fino a lei. Una riga di lavoro o di piano usa il minimo fra il blocco del suo turno e il blocco cronologico, così una riproduzione tardiva non scivola sotto un messaggio più recente. Dentro un blocco si ordina per `sequence`, poi `createdAt`. `startsNewTurn` vale per difetto `dispatchMode !== "steer" || turnId != null`.
- Un messaggio completato con più `textSegments` diventa più righe `message-segment` poste al `startedAt` di ciascun segmento, intercalate con gli strumenti. Durante lo streaming resta una riga sola. Segmenti adiacenti senza righe in mezzo si riuniscono.

Ispettore dell'attività (due superfici):

- Vista a tutto riquadro, `apps/web/src/components/chat/AgentActivityDetailView.tsx`. Sostituisce la conversazione mentre è aperta. Si apre solo per attività d'agente (`itemType === "collab_agent_tool_call"`) o ragionamento. Modello:

  ```ts
  interface AgentActivityDetail {          // agentActivity.logic.ts:9-15
    id: string; title: string; summary: string | null;
    primaryEntry: WorkLogEntry; entries: WorkLogEntry[];
  }
  ```

  Dall'alto: "Back", intestazione con titolo, pillola "N updates" e riepilogo, sezione "Prompt", sezione "Result", sezione "Activity" con una riga per voce. Lo stato aperto si azzera al cambio di thread e quando l'id sparisce. Il ragionamento consecutivo senza `toolCallId` si fonde in una riga "Reasoning trace" con anteprima "N updates - latest"; il ragionamento senza anteprima è nascosto.
- Dettaglio in linea per riga di strumento, `TimelineWorkEntryRow.tsx:951-1052` e `ToolCallDetailsDialog.tsx`. Disponibile quando la voce ha `toolDetails`, `liveActivity` o `providerContextLifecycle`. Sezioni: comando con output, file, diff, modifiche prima e dopo, contenuto scritto. Le righe di lettura aprono il file; le righe di modifica mostrano "+N/-M" e aprono il diff del turno.

  ```ts
  interface WorkLogToolDetails {           // apps/web/src/lib/toolCallDetails.ts:12-35
    kind: "command" | "file-change"; title: string; command?: string;
    output?: { output?; stdout?; stderr?; exitCode?: number; truncated?: boolean };
    diff?: string; content?: string;
    edits?: { path?; oldText?; newText? }[]; files?: string[];
  }
  ```

  Metatesto della riga (`liveActivityPresentation.ts:144-180`): niente per le righe completate; per quelle in corso "Active now", "Active Xs ago" o "No activity for X" oltre 30 s; poi durata e avanzamento uniti da " · ".

### Casi limite

- Turno interrotto o fallito: le righe ancora in corso si chiudono contro `turn.completed` (tono errore diventa fallito) o `turn.aborted` (annullato), oppure contro lo stato e `completedAt` dell'ultimo turno. Le righe in corso fuori dal turno attivo diventano annullate (workLog.ts:1339-1455). Resta visibile solo `turn.completed` con tono errore, etichettato "Turn failed".
- Strumento fallito: `toolStatus: "failed"`, l'output sostituisce il dettaglio. Le righe con tono errore non entrano nei sottoriepiloghi.
- Nessuna attività: niente "Worked for", salvo narrazione raccolta. Un messaggio vuoto non in streaming mostra "(empty response)".
- Approvazioni: il tono `approval` del server diventa `info` nel client, quindi righe di stato mai riassunte.
- Riconnessione e riproduzione: coperte da ordinamento per `sequence`, ancoraggio al blocco persona e deduplica. Non esiste una regola specifica di riconnessione nella timeline.
- `turn.aborted` è ancora gestito dal client ma il server non lo produce più: dati legacy.

### In Trama

- V01 chiede un modello di evento con identificativo, ordine, progetto, origine e correlazione. `OrchestrationThreadActivity` è il modello da imitare per le attività tecniche: `id`, `tone`, `kind`, `summary`, `payload`, `turnId`, `sequence`, `createdAt`. I messaggi restano un tipo a sé con `turnId`, `streaming`, `completedAt` e segmenti opzionali. Le schede (studio, team, mandato, incarico, decisione, candidato, conflitto, avviso di contesto) sono un terzo tipo che Synara non ha.
- La funzione pura da eventi a righe richiesta da V01 corrisponde a `deriveTimelineEntries` più `deriveMessagesTimelineRows` più `collapseSettledTurns`. In Swift: `enum TimelineRow` con i casi sopra, una funzione `rows(from events: [ConversationEvent], liveState: TurnLiveState) -> [TimelineRow]`, provata con documenti di esempio. `formatDuration` e `formatClockDuration` sono funzioni pure da portare con i loro test.
- Le richieste e i `RequestState` esistenti si migrano in eventi con `sequence` crescente e un messaggio della persona che apre ogni blocco, così l'ancoraggio al blocco persona funziona anche sui documenti vecchi.
- Il ritardo di 180 ms è un dettaglio dell'interfaccia: in SwiftUI è un `Task.sleep` annullabile legato all'identità del turno, non va dentro la funzione pura.
- L'ispettore dell'attività in V06 è l'ispettore a destra con il caso "gruppo": `AgentActivityDetail` e `WorkLogToolDetails` danno i campi da mostrare.
- Le etichette in Trama sono in italiano ("Ha lavorato per…", come in [design-app-codex.md](design-app-codex.md)). La regola di calcolo resta quella di Synara.

### Da non portare

- Virtualizzazione LegendList, condivisione strutturale delle righe (`computeStableMessagesTimelineRows`, logic.ts:933-1223, esiste solo per i memo di React), cache WeakMap, animazioni `DisclosureRegion`, `flushSync`, timer con requestAnimationFrame.
- Classi Tailwind, variabili CSS, attributi `data-*`, note del React Compiler.
- Proiezione event-sourced su SQLite: Trama persiste nel documento del progetto.

### Rischi e scelte aperte

- Il confine del gruppo è il messaggio della persona, non `turnId`. Un raggruppamento per turno in Swift sembra più naturale ma diverge da Synara sui mini-turni del provider e sui messaggi di steer. V01 deve usare il messaggio della persona o motivare la scelta contraria.
- `formatDuration` non ha le ore e produce valori come "75m". Decidere se copiarla identica o aggiungere le ore, e scriverlo.
- Il parsing di `payload.data` (id dello strumento, stati, azioni dei comandi) in Synara si basa su forme poco tipizzate che variano per provider (`workLog.ts:1574-2224`, `toolCallDetails.ts`). Il rapporto le ha solo sfiorate: per Codex vanno ricontrollate sugli eventi reali del componente.
- Le schede di Trama non esistono in Synara. Va deciso se una scheda ferma la scansione all'indietro come un piano proposto (resta visibile e la scansione prosegue) o come un messaggio della persona. La scelta più vicina a Synara è trattarle come il piano proposto.

Ticket: V01, V06

## 2. Canale agente-host MCP

### Dove sta in Synara

Synara ospita un solo endpoint MCP streamable HTTP senza stato (`POST /mcp`) dentro il proprio server. File in `apps/server/src/agentGateway/`:

`protocol.ts` (forma JSON-RPC e MCP pura), `mcpTransport.ts` (autenticazione, batch, smistamento, annullamento), `httpRoute.ts` (rotte e limiti del corpo), `Services/` e `Layers/AgentGateway*.ts` (elenco strumenti, credenziali, registro delle sessioni), `sessionLease.ts` (credenziale di ogni runtime), `mcpInjection.ts` (configurazione per provider), `toolRuntime.ts` e `toolInput.ts` (tipi, errori, lettori degli argomenti), `inFlightRequestRegistry.ts`, `bearerToken.ts`, `sanitizeToolInputSchema.ts`, `harnessPolicy.ts`, `threadReadTools.ts`. Contratti in `packages/contracts/src/agentGateway.ts`.

### Forme dei dati

```ts
// protocol.ts:24-79
interface McpToolDefinition {
  name: string; description: string;
  inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>;
  annotations?: { title?; readOnlyHint?; destructiveHint?; idempotentHint?; openWorldHint? };
}
interface McpToolCallResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

// toolRuntime.ts:43-64
interface ToolContext {
  principal: { kind: "provider-session"; sessionKey; threadId; provider; turnId };
  callerThreadId: string; callerSessionKey: string; callerProvider: ProviderKind;
  callerCapabilities: ReadonlySet<AgentGatewayCapability>;
  callerTurnId: string | null;
  assertCallerTurnActive: () => Effect<void, GatewayToolError>;
  jsonRpcRequestId: JsonRpcId;
}
interface ToolEntry {
  definition: McpToolDefinition;
  handler: (args: Record<string, unknown>, context: ToolContext) => Effect<McpToolCallResult>;
  requiredCapability: AgentGatewayCapability;
  requiresActiveTurn?: boolean;            // true per gli strumenti di scrittura
}

// Services/AgentGatewaySessionRegistry.ts:4-37
type AgentGatewayCapability = "thread:read" | "thread:write" | "automation:write"
  | "diagnostics:read" | "browser:control" | "device:control";
interface AgentGatewaySessionIdentity {
  sessionKey: string; threadId: ThreadId; provider: ProviderKind; issuedAt: number;
  capabilities: ReadonlySet<AgentGatewayCapability>;
}
interface AgentGatewayWriteAuthority { sessionKey; threadId; provider; turnId: string }

// packages/contracts/src/agentGateway.ts:19-45
type SynaraGatewayErrorCode = "caller_session_inactive" | "caller_turn_inactive"
  | "capability_denied" | "provider_unavailable" | "model_unavailable"
  | "model_option_unavailable" | "idempotency_conflict" | "creation_plan_locked"
  | "creation_limit_exceeded" | "thread_not_found" | "wait_timed_out" | "operation_failed";
type SynaraGatewayErrorResult = { error: { code; message; details? } };
```

Rifiuto strutturato (`toolRuntime.ts:75-97`):

```ts
function gatewayToolErrorResult(error) {
  return { ...mcpToolResultJson({ error: { code, message, ...(details ? { details } : {}) } }),
           isError: true as const };
}
```

### Algoritmo

Trasporto:

- `POST /mcp` risponde sempre con un solo `application/json`, mai SSE. Non usa né emette `Mcp-Session-Id`. `GET /mcp` e `DELETE /mcp` rispondono 405.
- L'URL è `http://127.0.0.1:<porta>/mcp`, su loopback. La porta si aggiorna dopo il bind dinamico.
- Corpo massimo 1 MiB, controllato su Content-Length e durante la lettura. Oltre il limite: HTTP 413 con errore JSON-RPC -32600. JSON non valido: HTTP 400 con -32700.
- Metodi: `initialize`, `ping` (risponde `{}`), `tools/list`, `tools/call`. Ogni altro metodo: -32601. Le notifiche non hanno risposta; si usa solo `notifications/cancelled`, `notifications/initialized` è accettata in silenzio. Le risposte dal client sono ignorate. Messaggi non validi: -32600.
- Versione del protocollo: default `2025-06-18`, supportate `2025-06-18`, `2025-03-26`, `2024-11-05`; una versione non supportata ricade sul default. Il risultato di `initialize` è `{ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name, title, version }, instructions }`. Le `instructions` sono una frase sola, perché i client MCP le antepongono a ogni definizione di strumento; la politica completa va nelle istruzioni per lo sviluppatore del thread.
- Batch: array fino a 50 messaggi; batch vuoto o id duplicati: 400. Tutte le richieste partono prima di attenderne una, così un `notifications/cancelled` nello stesso batch trova il bersaglio. Risposte nell'ordine d'ingresso. Se non c'è nessuna risposta (solo notifiche o richieste interrotte): HTTP 202 con corpo vuoto.

Autenticazione:

- Token: `sagw_session_${randomUUID()}` e una chiave di sessione separata non segreta `gateway-session:${randomUUID()}`, usata nei log e nel registro, così il segreto non compare mai lì.
- I token vivono solo in memoria, non sopravvivono al riavvio, non scadono. Ogni runtime del provider riceve un token nuovo, anche per lo stesso thread, così lo smontaggio del runtime uscente non revoca il successore.
- Validazione: `/^Bearer\s+(.+)$/i`, poi `sessions.get(token)`. Avviene due volte, nella rotta e nel trasporto. Il trasporto verifica anche che il thread esista ancora e che il provider vivo del thread sia quello del token.
- Token non valido: HTTP 401 con `{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"caller_session_inactive: Missing, revoked, or invalid provider-session credential."}}`. È un errore di trasporto, non un risultato di strumento.
- Autorità di scrittura per turno: all'ingresso, se l'ultimo turno del thread chiamante è `running`, la richiesta si lega a quel `turnId`; altrimenti l'autorità è nulla. `retireWriteAuthority(token, turnId)` è irreversibile: dopo il turno terminale quel token non scrive più, ma legge ancora.
- Revoca: `revokeSessionToken` cancella il token e annulla tutte le richieste in corso della sessione.

Registrazione nel thread Codex (`mcpInjection.ts:44-53`):

```toml
[mcp_servers.synara]
url = "http://127.0.0.1:3773/mcp"
bearer_token_env_var = "SYNARA_AGENT_GATEWAY_TOKEN"

[shell_environment_policy]
exclude = ["SYNARA_AGENT_GATEWAY_TOKEN"]
```

Synara aggiunge questa sezione a un `config.toml` in una copia di `CODEX_HOME`, avvia un processo `codex app-server` per sessione di thread e mette il token nell'ambiente di quel processo. L'esclusione in `shell_environment_policy` tiene il token fuori dai sottoprocessi dei comandi. Nessun segreto finisce nel file. Synara non usa `http_headers`, `env_http_headers` né un override `config` su `thread/start`.

Giro di una chiamata:

1. Il client MCP di Codex invia `tools/call` con `Authorization: Bearer ...`.
2. La rotta controlla il token e legge il corpo.
3. Il trasporto riverifica la sessione, controlla thread e provider, cattura l'autorità di scrittura e costruisce il `ToolContext`.
4. La richiesta entra nel registro delle richieste in corso con chiave (sessionKey, turnId, requestId) prima che il gestore parta. Se il turno è già segnato come chiuso, viene annullata subito.
5. `tools/call`: nome mancante o strumento sconosciuto danno -32602. `arguments` diventa un dizionario o `{}`. Capacità mancante: risultato `isError` con `capability_denied`. Con `requiresActiveTurn`, `assertCallerTurnActive()` restituisce `caller_turn_inactive` (nessuna autorità all'ingresso, o turno non più in corso o diverso) o `caller_session_inactive` (autorità revocata o ritirata). Tutti come risultati `isError`.
6. Il gestore valida gli argomenti a mano (`readStringArg`, `readNumberArg`) o con uno schema che rifiuta proprietà in eccesso. Errori di validazione e di dominio diventano risultati `isError`. Gli strumenti di scrittura chiamano anche `assertCallerMayDriveThread`, che rifiuta di guidare un thread con più privilegi del chiamante: è la cosa più vicina a un controllo di mandato.
7. Il risultato torna come HTTP 200 JSON.

Riepilogo della mappa degli errori: JSON-RPC solo per problemi di protocollo; HTTP 401 per credenziali; tutto ciò che riguarda lo strumento, compresi rifiuti e difetti, come risultato con `isError: true`. Una richiesta interrotta non produce risposta.

Annullamento: tre inneschi, `notifications/cancelled {requestId}` nella sessione, `lease.cancelTurn` o `retireTurn` dall'adattatore (necessario perché i client MCP possono non mandare la notifica), `revokeSessionToken`. Su Stop della persona Synara segna il turno come chiuso, revoca l'intera credenziale prima dell'interruzione nativa e attende al massimo 2 s che le richieste in corso finiscano. Non c'è un timeout globale per chiamata.

Strumento da copiare: `synara_context` (`threadReadTools.ts:80-117`), in sola lettura, dice all'agente chi è, quale thread e turno sta servendo e cosa può fare adesso, prima che provi.

Annotazioni predefinite: lettura `readOnly: true, destructive: false, idempotent: true, openWorld: false`; scrittura `readOnly: false, destructive: true, idempotent: false, openWorld: false`.

`sanitizeToolInputSchema` si applica solo a `tools/list`: incorpora i riferimenti `#/$defs/X` aciclici, sostituisce quelli ciclici con `{type:"object"}` e toglie `$defs`, perché alcuni client rifiutano schemi ricorsivi.

Synara non usa gli strumenti dinamici di Codex: `item/tool/call` riceve -32601 "Unsupported server request". Tutti gli strumenti dell'host passano da MCP.

### Casi limite

- Il thread legato al token non esiste più: 401.
- Il provider vivo del thread è cambiato: 401 `caller_session_inactive`.
- Chiamata di scrittura dopo la fine del turno: `caller_turn_inactive` come risultato, non come errore.
- Fallimento non dovuto a interruzione: `jsonRpcResult(null, mcpToolResultError(...))` con id null, che sembra un piccolo bug di Synara. In Trama la risposta deve portare l'id della richiesta.
- Dopo un turno terminale Codex rifiuta un nuovo turno finché il runtime non riprende con una credenziale nuova (`codexAppServerManager.ts:1331-1335`): in pratica un token per processo per turno.

### In Trama

- V02: un server HTTP locale su loopback dentro l'app (per esempio con `Network.framework`), un solo endpoint POST in JSON, i limiti di Synara (1 MiB, 50 messaggi, 202 per sole notifiche) e un `actor` come registro delle sessioni.
- Token: 32 byte da `SecRandomCopyBytes`, in base64url, con un prefisso leggibile. Confronto a tempo costante (per esempio confrontando i digest SHA-256 dei due valori con un ciclo senza uscita anticipata). Chiave di sessione separata per log e registro.
- Registrazione nel thread: `bearer_token_env_var` richiede una variabile d'ambiente per processo. Se Trama fa girare più thread (Coordinatore e specialisti) sullo stesso app-server, serve un altro veicolo, per esempio `http_headers` nella configurazione del singolo thread; con un processo per thread basta la variabile d'ambiente, come in Synara. È una scelta di V02 da provare sul componente reale.
- Il `ToolContext` di Trama porta progetto, thread del Coordinatore, turno all'ingresso e mandato letto in quel momento. Il chiamante si ricava solo dal token, mai dagli argomenti.
- V03: `ProjectMandate.Authorization` esiste già con `authorized`, `mandateMissing`, `revoked`, `personRequired`, `notInMandate`, `outsideScope`. Ogni rifiuto diventa un risultato `isError: true` con `{ "error": { "code", "message", "details" } }`, dove `code` è il caso di `Authorization`. È il modello di `gatewayToolErrorResult`. HTTP e JSON-RPC restano per token e protocollo.
- Una `ToolEntry` Swift: definizione, gestore `async`, requisito (capacità o controllo di mandato) e `requiresActiveTurn`. Il controllo avviene prima del gestore, in un solo punto, così la cucitura "strumenti del Coordinatore" della specifica si prova senza Codex.
- Uno strumento "leggi contesto" alla `synara_context` risponde con mandato, perimetro e azioni disponibili.
- Istruzioni: una frase in `initialize.instructions`, la politica completa nelle istruzioni del thread.
- Annullamento: `Task` per richiesta registrato prima del gestore, con chiave (sessione, turno, id); Stop revoca e attende un tempo limitato.

### Da non portare

- Macchina Effect-TS: `ServiceMap.Service`, `Layer`, `Effect.gen`, fiber, gate `Deferred`, `Effect.catchDefect`, `Cause.pretty`, `Schema.decodeUnknownSync`. In Swift: concorrenza strutturata, annullamento di `Task`, validazione con `Codable`.
- `node:crypto.randomUUID`, `process.execPath` con `ELECTRON_RUN_AS_NODE`, il proxy stdio `.mjs` con la rotta `/mcp/bootstrap` (serve solo a client che non parlano HTTP; Codex lo parla).
- La copia con link simbolici di `CODEX_HOME` in `codexProcessEnv.ts`.
- Strumenti browser, dispositivi e automazioni: fuori dal verticale.
- Il prodotto "External MCP" di `docs/external-mcp.md`, che è un'altra cosa.

### Rischi e scelte aperte

- Synara confronta i token con una ricerca in `Map`, non a tempo costante, e usa UUID v4 (circa 122 bit). Trama usa confronto a tempo costante e 32 byte casuali. È una deviazione voluta.
- Nei token di Synara non c'è scadenza. Trama lega il token alla vita del thread e lo revoca alla chiusura del progetto e allo Stop; una scadenza ulteriore è una scelta aperta.
- Veicolo del token con app-server condiviso: variabile d'ambiente per processo contro `http_headers` per thread. Synara non ha un precedente per il secondo caso.
- Synara non ha un controllo di mandato: ha capacità fisse per sessione (oggi tutte e sei concesse) e `assertCallerMayDriveThread`. Il controllo del mandato prima di ogni strumento è nuovo in Trama.
- `outputSchema` e `structuredContent` sono ammessi dal tipo ma Synara risponde sempre con JSON in testo. Trama può fare lo stesso; usare `structuredContent` va provato con il client MCP di Codex.
- Nessun timeout globale per chiamata in Synara. Trama deve decidere se serve per strumenti lunghi come il controllo in sola lettura.

Ticket: V02, V03

## 3. Finestra di contesto

### Dove sta in Synara

- Normalizzazione dell'uso token: `apps/server/src/provider/Layers/CodexAdapter.ts:278-334` (`normalizeCodexTokenUsage`) e 1305-1319 (mappatura della notifica).
- Tipo normalizzato: `packages/contracts/src/providerRuntime.ts:319-354`.
- Utilità: `apps/server/src/provider/tokenUsage.ts`.
- Proiezione in attività: `apps/server/src/orchestration/providerRuntimeActivityProjection.ts:373-403, 977-995`.
- Derivazione del misuratore: `apps/web/src/lib/contextWindow.ts`.
- Anello: `apps/web/src/components/chat/ContextWindowMeter.tsx`.
- Compattazione: `CodexAdapter.ts:1250-1290`, `codexAppServerManager.ts:2024-2088, 3170-3180`, `apps/web/src/workLog.ts:1159-1180`.

### Forme dei dati

Notifica Codex `thread/tokenUsage/updated`, l'unica che porta l'uso. Si legge `params.tokenUsage`, con ripiego su `params`:

```
tokenUsage: {
  total: { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
  last:  { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
  modelContextWindow: number
}
```

Sono accettati anche `total_token_usage`, `last_token_usage`, `model_context_window` e i nomi in snake_case.

```ts
// providerRuntime.ts:319-350, evento "thread.token-usage.updated" con payload { usage }
interface ThreadTokenUsageSnapshot {
  usedTokens: number;                    // obbligatorio
  maxTokens?: number;
  usedPercent?: number;                  // 0..100, Codex non lo imposta
  totalProcessedTokens?: number;
  cumulativeUsage?: { inputTokens; outputTokens; cachedInputTokens?; cacheCreationInputTokens? };
  inputTokens?; cachedInputTokens?; outputTokens?; reasoningOutputTokens?;
  lastUsedTokens?; lastInputTokens?; lastCachedInputTokens?; lastOutputTokens?; lastReasoningOutputTokens?;
  compactsAutomatically?: boolean;       // sempre true per Codex
}
```

### Algoritmo

Normalizzazione:

- Usato = `last.totalTokens` (ingresso con cache più uscita dell'ultima richiesta). Se `last` manca, `total.totalTokens`.
- Se l'usato manca o è minore o uguale a zero, l'evento si scarta.
- Massimo = `modelContextWindow`.
- I campi di dettaglio vengono da `last`; `cumulativeUsage` da `total`, solo se ingresso e uscita totali ci sono entrambi. `totalProcessedTokens` solo se maggiore dell'usato.
- Le notifiche d'uso e di compattazione dei thread figli (subagenti) sono ignorate per il thread padre (`codexAppServerManager.ts:3968`).

Deduplica e conservazione: l'evento diventa un'attività `context-window.updated`. Gli aggiornamenti identici al precedente per (thread, provider) non si salvano; ogni aggiornamento diverso si aggiunge in coda. Per Trama basta tenere l'ultima istantanea per thread più un segno di compattazione.

Derivazione (`deriveLatestUsageContextWindowState`, contextWindow.ts:70-140), scorrendo le attività dalla più recente:

1. Una compattazione completata (`kind === "context-compaction"` con `payload.state === "compacted"` o `payload.status === "completed"`) restituisce `{ snapshot: null, invalidatedByCompaction: true }`.
2. Vince il primo `context-window.updated` con usato maggiore di zero, una percentuale o una finestra maggiore di zero.
3. Calcolo:

   ```ts
   usedPercentage = usedPercent ?? (maxTokens > 0 ? Math.min(100, usedTokens / maxTokens * 100) : null);
   remainingTokens = maxTokens !== null && reliable ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
   remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;
   ```

   `reliable` vale: usato presente e (usato maggiore di zero, oppure nessuna percentuale nel payload, oppure finestra maggiore di zero).

Per Codex la dimensione della finestra viene solo da `modelContextWindow` sull'evento. Il campo `contextWindowTokens` del catalogo modelli non alimenta il misuratore.

Visualizzazione (`deriveContextWindowMeterDisplay`, :267-287):

- Percentuale limitata fra 0 e 100.
- Etichetta percentuale: sotto 10 una cifra decimale senza ".0" ("4.5%", "3%"), altrimenti arrotondata ("42%").
- Token (`formatContextWindowTokens`, :382-396): null o non finito diventa "0"; sotto 1000 l'intero; sotto 10k una cifra decimale più "k" senza ".0"; sotto un milione arrotondato più "k"; oltre, una cifra decimale più "m".
- Etichetta accessibile: "Context window {pct} used" oppure "Context window {tokens} tokens used".
- Prima del primo evento d'uso, per Codex, il misuratore non si mostra.

Anello: cerchio 16x16, raggio 6, tratto 2, partenza a ore 12, transizione di 500 ms. Traccia in tono attenuato, riempimento nel colore principale. Nessuna soglia: un solo colore da 0 a 100%.

Popover al passaggio del puntatore, in ordine:

1. "Context window".
2. Con percentuale e rapporto affidabile: "{pct} ⋅ {used}/{max} context used"; con percentuale senza rapporto affidabile: "{pct} context used"; senza percentuale: "{used} tokens used so far".
3. Con finestra nota: "Model window: {max} tokens".
4. Se `totalProcessedTokens > usedTokens`: "Total processed: {n} tokens".
5. Con `compactsAutomatically`: "Automatically compacts its context when needed.", sempre vero per Codex.
6. Le righe su sessione in attesa, prossimo turno e costo sono solo per Claude o per provider con costi.

Compattazione per Codex:

| Segnale Codex | Evento normalizzato | Riepilogo |
| --- | --- | --- |
| `thread/compacting`, emesso da Synara prima di `thread/compact/start` | `item.updated` con `itemType: "context_compaction"`, `status: "inProgress"` | "Compacting context" |
| `thread/compacted` | `thread.state.changed` con `state: "compacted"` | "Context compacted manually" |
| elemento `contextCompaction`, `item/started` o `item/updated` | `item.*` con `context_compaction` | "Compacting context" |
| elemento `contextCompaction`, `item/completed` | idem | "Context compacted" |
| elemento `contextCompaction`, `item/completed` con `status: "failed"` | idem | "Context compaction failed", tono errore |

- La compattazione manuale è la chiamata `thread/compact/start { threadId }`.
- Su `thread/compacted` senza turno attivo, la sessione torna da `running` a `ready`.
- Nella timeline le righe di compattazione con `turnId` nullo restano sempre visibili; la riga in corso e quella terminale si fondono; le attività `context-window.*` non compaiono.
- Dopo una compattazione completata il misuratore sparisce, non mostra 0%, e ricompare al successivo `thread/tokenUsage/updated`. Una compattazione in corso non lo azzera.

### Casi limite

- `modelContextWindow` assente: si mostra il testo dei token usati senza percentuale; l'anello resta a 0.
- Usato zero o assente: evento scartato.
- Thread figli: ignorati.
- L'etichetta "manually" si applica a ogni `thread/compacted`, anche se Codex potrebbe emetterla per una compattazione automatica.

### In Trama

- V07: `CodexClient` riceve `thread/tokenUsage/updated` e produce un `ContextUsageSnapshot` (usato, massimo, dettaglio) con la stessa normalizzazione. La timeline riceve l'evento normalizzato, non la notifica grezza.
- Il documento del progetto conserva l'ultima istantanea del thread del Coordinatore e il segno dell'ultima compattazione, sufficienti a ridisegnare il misuratore dopo un riavvio.
- Misuratore: `Circle().trim(from: 0, to: pct)` ruotato di -90 gradi, con `accessibilityLabel` e `accessibilityValue` in italiano. Popover con le righe sopra, tradotte.
- Formattatori di percentuale e token come funzioni pure con test.
- Compattazione: gli eventi di compattazione diventano righe della timeline come in Synara. La compattazione resta del provider: Trama la osserva e la mostra.
- Soglia e avviso: nuovi, vedi sotto. La scheda "avviso di contesto" di V01 è il punto di arrivo.

### Da non portare

- Popover, classi Tailwind, tecnica SVG con dash offset, `useMemo`, livelli di impaginazione del piè del composer, esclusione durante la registrazione vocale.
- Riparazione SQL legacy di `cumulativeUsage` (`ProjectionSnapshotQuery.ts`).
- Contabilità dei token di Claude (`claudeTokenUsage.ts`, `docs/claude-token-accounting.md`), finestre 200k/1m e selettore di compattazione automatica: solo Claude.

### Rischi e scelte aperte

- Synara non ha soglie per Codex: nessuna soglia configurabile, nessun avviso, nessun cambio di colore. La soglia impostata dalla persona e l'avviso in chat di V07 sono nuovi. Vanno decisi: valore predefinito, dove si imposta (per progetto o globale), se l'avviso si ripete dopo una compattazione e se l'anello cambia aspetto sopra soglia (ricordando che il codice colore dei tre stati è l'unico colore di identità).
- Le sole soglie esistenti in Synara sono avvisi fissi lato server per Claude (0,8 del budget, 50k di ingresso non in cache, prompt oltre 200k). Non si applicano a Codex.
- Dopo la compattazione Synara nasconde il misuratore. Trama può invece tenere l'ultimo valore con uno stato "compattato". È una scelta di prodotto da scrivere nella PR.
- L'etichetta "manually" su `thread/compacted` può essere sbagliata: in Trama conviene un testo neutro ("Contesto compattato").

Ticket: V07

## 4. Composer

### Dove sta in Synara

Trigger in `apps/web/src/composer-logic.ts`. Menzioni in `apps/web/src/lib/composerMentions.ts` e `apps/web/src/composer-editor-mentions.ts`. Ricerca in `apps/web/src/components/chat/useComposerDiscovery.ts`, `apps/server/src/workspaceEntries.ts`, `apps/web/src/lib/providerDiscovery.ts`, `apps/web/src/hooks/useComposerCommandMenuItems.ts`. Comandi e skill in `apps/web/src/composerSlashCommands.ts` e `apps/server/src/provider/codexDiscoveryCatalog.ts`. Allegati e testo incollato in `apps/web/src/lib/composerSend.ts`, `composerImagePreparation.ts`, `composerPastedText.ts`, `apps/server/src/codexTurnInput.ts`, `apps/server/src/provider/attachmentProjection.ts`. Modello e sforzo in `packages/contracts/src/model.ts`, `apps/web/src/composerDraftModels.ts`, `apps/web/src/lib/codexReasoningEffort.ts`, `composerProviderRegistry.tsx`, `apps/server/src/codexServiceTier.ts`.

Nota: `packages/contracts/src/agentMentions.ts` e `packages/shared/src/agentMentions.ts` non riguardano i file. Implementano la delega `@alias(task)` a subagenti e non servono al verticale.

### Forme dei dati

```ts
// composer-logic.ts:9-16
type ComposerTriggerKind = "mention" | "slash-command" | "slash-model" | "skill";
interface ComposerTrigger { kind; query: string; rangeStart: number; rangeEnd: number }

// composer-editor-mentions.ts:22-61 (ridotto)
type ComposerPromptSegment =
  | { type: "text"; text: string }
  | { type: "mention"; path: string; kind?: "path" | "plugin" | "thread"; threadId?: string; tokenLength?: number }
  | { type: "skill"; name: string; prefix?: string }
  | { type: "slash-command"; command: ComposerSlashCommand }
  | { type: "link"; url: string };

// codexTurnInput.ts, ordine: testo, allegati, skill, menzioni
type CodexTurnInputItem =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "localImage"; path: string }
  | { type: "image"; url: string }          // presente nel tipo, mai prodotto per Codex
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

// composerPastedText.ts:10
interface PastedTextDraft { id; createdAt; text; lineCount; charCount }

// model.ts:99 e orchestration.ts:111
interface CodexModelOptions { reasoningEffort?: string; fastMode?: boolean }
interface CodexModelSelection { provider: "codex"; model: string; options?: CodexModelOptions }
```

Limiti (`orchestration.ts:317-324`): testo 120.000 caratteri; 8 allegati in tutto; immagine 10 MiB; immagine importabile 32 MiB (oltre i 10 viene ricodificata); file 25 MiB.

### Algoritmo

Rilevamento del trigger (`detectComposerTrigger(text, cursor)`, :305), a ogni battuta sul testo semplice:

1. Si limita il cursore e si trova l'inizio della riga.
2. Comando: l'ultima `/` della riga a inizio riga o dopo uno spazio. Se il testo fino al cursore corrisponde a `^\/(\S*)$`: una query che contiene `/` non apre il menu (percorsi digitati); `/model` dà `slash-model`; il resto dà `slash-command`.
3. Token: dall'ultimo spazio al cursore. Se inizia con `$` è `skill`.
4. Menzione fra virgolette: `@"` sulla riga senza virgoletta di chiusura dopo (con escape tramite backslash) dà `mention` con la query decodificata; può contenere spazi.
5. Altrimenti il token deve iniziare con `@`. Così gli indirizzi email non attivano nulla, perché in `user@host` la parola non inizia con `@`. Il trigger si ancora all'ultima `@` della parola e l'ultimo pezzo deve corrispondere a `^@[^()\s@]*$`.

La sostituzione passa da `replaceTextRange(text, start, end, replacement)`, che restituisce testo e cursore.

Ricerca dei file:

- Attesa di 120 ms sulla query, limite 80 risultati, cache di 15 s, query vuote saltate.
- Indice in memoria da `git ls-files` filtrato da gitignore; senza git si visita l'albero escludendo `.git`, `node_modules`, `dist`, `build`, `out`, `.cache` e simili. Le directory vengono dagli antenati dei file. Tetto di 25.000 voci.
- Query normalizzata togliendo `@`, `.` e `/` iniziali e portandola in minuscolo.
- `scoreEntry` (più basso è meglio, a parità conta la profondità minore, poi il percorso):

| Punteggio | Corrispondenza |
| --- | --- |
| 0 | nome uguale alla query |
| 1 | percorso uguale |
| 2 | nome inizia con la query |
| 3 | nome contiene la query |
| 100 + fuzzy | nome come sottosequenza |
| 1000 | percorso inizia con la query |
| 1001 | percorso contiene `/query` |
| 1002 | percorso contiene la query |
| 1100 + fuzzy | percorso come sottosequenza |
| 0 o 1 | query vuota: directory 0, file 1 |

  Fuzzy: `firstIdx*2 + gaps*3 + span + min(64, lengthDiff)`.

- Le voci non di percorso si ordinano con `rankProviderDiscoveryItems`: esatto 0, prefisso 10, prefisso di parola 20 + i, confine 30 + i, sottostringa 40 + i, copertura dei token da 80, sottosequenza da 120; i pesi dei campi si sommano.
- Gruppi del menu in ordine: plugin, chat (massimo 20), radice locale, percorsi (etichetta = nome del file, descrizione = cartella), agenti.
- Due chat con lo stesso titolo si distinguono come `Titolo (Progetto)`, poi con un suffisso dell'id, perché i chip si risolvono per nome.

Serializzazione:

```ts
function composerMentionPathNeedsQuoting(path) { return /[\s()@"'`$\\]/.test(path); }
function formatComposerMentionToken(path: string): string {
  const p = path.startsWith("@") ? path.slice(1) : path;
  return composerMentionPathNeedsQuoting(p) ? `@"${p.replace(/["\\]/g, "\\$&")}"` : `@${p}`;
}
// parsing durante la scrittura: (^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s@]+))(?=\s)
// parsing in sola lettura:       ...(?=\s|$)
```

- Un file scelto diventa solo testo `@percorso ` nel prompt. Nessun elemento strutturato: Codex legge il percorso dal testo.
- Plugin e chat: lo stesso token più un riferimento `{name, path}` nella bozza. I percorsi sono `plugin://nome@marketplace` e `thread://<id>`. Un riferimento con lo stesso nome viene sostituito.
- All'invio `filterPromptProviderMentionReferences` tiene solo i riferimenti il cui token `@` è ancora nel testo (senza distinzione di maiuscole, senza doppioni per percorso). Cancellare un chip cancella il riferimento.
- Lato server le menzioni di chat diventano un blocco di testo `<mentioned_thread_context>` con tetti: 20 messaggi, 1.500 caratteri per messaggio, 8.000 per thread, 16.000 in tutto. Gli altri riferimenti diventano elementi `mention` di Codex.

Dal testo ai chip (`collectInlineTokenMatches`, :178), con priorità: prima gli URL (una `@` in un URL non è una menzione), poi `@alias(`, poi le menzioni `@`, poi le skill `$nome` o `/nome`. Durante la scrittura un token diventa chip solo quando lo segue uno spazio; in sola lettura vale anche a fine testo. Il tipo di chip: `thread://` o riferimento corrispondente dà chat; `plugin://` dà plugin; il resto è un percorso.

Cursore: ogni chip conta come un carattere nell'editor ma occupa N caratteri nel testo. `expandCollapsedComposerCursor` e `collapseExpandedComposerCursor` (composer-logic.ts:78, 184) convertono fra le due posizioni; le menzioni fra virgolette usano `tokenLength`. Backspace accanto a un chip cancella il chip intero e mette il cursore al suo inizio (`isCollapsedCursorAdjacentToInlineToken`, :277).

Comandi e skill:

- Comandi integrati di Synara: clear, compact, model, plan, debug, default, review, fork, side, status, subagents, fast, export, goal, rename, feedback, automation. Sono azioni dell'app, non testo per il provider.
- `parseComposerSlashInvocationForCommands` confronta l'intero prompt con `^\/([a-z-]+)(?:\s+([\s\S]*))?$` e restituisce comando e argomenti.
- Il menu del trigger `slash-command` elenca integrati, comandi nativi del provider, skill, con lo stesso ordinamento; la descrizione pesa 200.
- Le skill si chiedono quando il trigger è `skill` o `slash-command` e il provider dichiara la scoperta delle skill. Codex: `skills/list { cwds: [cwd], forceReload? }` con ripiego su `{ cwd }`; dalla risposta si prende la voce con `cwd` corrispondente e se ne leggono le `skills[]` ordinate per nome. Forma: `{ name, path, enabled, description?, scope?, interface?: { displayName?, shortDescription? } }`.
- Codex ignora le skill con percorso fuori dalle radici note; Synara registra la propria radice con `skills/extraRoots/set`.
- Scegliere una skill inserisce `/nome `, aggiunge `{name, path}` alla bozza e all'invio tiene solo le skill ancora presenti nel testo. Per Codex il server riscrive `/nome` in `$nome`, perché Codex si aspetta il testo `$skill` accanto all'elemento strutturato `{ type: "skill", name, path }`.

Allegati:

- Immagini: fino a 10 MiB passano; oltre 32 MiB rifiutate; in mezzo ricodificate (obiettivo 8 MiB, qualità 0,92, lato massimo 8192 px, 24 MP, 3 tentativi). Oltre l'ottavo allegato: rifiuto.
- A Codex l'immagine arriva come `{ type: "localImage", path }`, con il file salvato su disco.
- I file non immagine non diventano elementi: si aggiungono al testo:

  ```
  <attached_files>
  The user attached the following file(s), saved on disk. Read/extract them with your tools as needed; do not assume their contents.
  - "name.pdf" - application/pdf - 1.2 MB - /abs/path
  </attached_files>
  ```

- Coda di preparazione seriale con contatore di generazione: al cambio di thread i lavori vecchi si scartano.
- Testo vuoto con immagini allegate: il testo diventa un prompt di avvio predefinito.

Testo incollato:

- Soglie: `PASTED_TEXT_MIN_CHARS = 4000`, `PASTED_TEXT_MIN_LINES = 25`. Si normalizzano CRLF e CR in LF, senza togliere spazi.
- Se il clipboard ha file, decide la zona di rilascio. Altrimenti, sopra soglia, si blocca l'incolla e si crea una scheda: titolo = prima riga non vuota tagliata a 140 caratteri; conteggio "N lines" se più di una riga, altrimenti "N chars".
- All'invio: `${prompt.trim()}\n\n<pasted_text>\n${JSON.stringify([{text}, ...])}\n</pasted_text>`. `extractTrailingPastedTexts` fa il percorso inverso con `/\n*<pasted_text>\n([\s\S]*?)\n<\/pasted_text>\s*$/`.

Modello e sforzo per turno:

- Sforzi Codex statici `["low", "medium", "high", "xhigh"]`, ma il tipo è una stringa aperta, perché la scoperta a runtime aggiunge valori.
- `model/list { cursor: null, limit: 50, includeHidden: false }`, con cache. Per ogni modello: id, nome, `supportedReasoningEfforts` (stringhe o oggetti), `defaultReasoningEffort` tenuto solo se è nella lista, `supportsFastMode` (anche da `additionalSpeedTiers` con `"fast"`). La lista a runtime sostituisce quella statica.
- Selezione salvata per bozza di thread, per provider, più una copia globale "ultima usata". Una nuova bozza parte da quella. Ordine di risoluzione: bozza, thread, progetto, modello predefinito. Un turno in coda fotografa modello e sforzo al momento dell'accodamento.
- `classifyProviderReasoningEffortSupport`: con sforzi a runtime, supportato o no in base a quella lista; senza livelli statici, sconosciuto; altrimenti la tabella statica. Al cambio di modello lo sforzo si toglie se non è supportato e l'interfaccia torna al predefinito.
- Invio:

  ```ts
  const reasoningEffort = rawEffort && support !== "unsupported" && rawEffort !== defaultReasoningEffort
    ? rawEffort : undefined;
  ```

  Lo sforzo predefinito e quelli non supportati non si inviano. Parametri di `turn/start`: `threadId`, `input`, `summary: "auto"`, politiche di approvazione e sandbox, `model?`, `serviceTier?`, `effort?`, e `collaborationMode?: { mode, settings: { model, reasoning_effort: effort ?? "medium", developer_instructions } }` quando c'è una modalità d'interazione.
- `serviceTier` vale "fast" o "default" solo se `fastMode` è definito; altrimenti si tiene il livello precedente.

### Casi limite

- Email: nessun trigger.
- `@foo@bar`: si sostituisce solo `@bar`.
- `/percorso/digitato`: nessun menu.
- Percorsi con spazi, parentesi, virgolette, `$` o backslash: forma fra virgolette con escape. La regex fra virgolette è scritta perché un backslash possa corrispondere solo al ramo di escape (niente backtracking catastrofico).
- Nomi di comandi integrati che coincidono con comandi nativi: l'integrato si nasconde.
- Modello sconosciuto: i valori di sforzo a runtime passano comunque.

### In Trama

- V07: `detectComposerTrigger`, `formatComposerMentionToken`, le regex di parsing, la mappatura del cursore, `scoreEntry`, `rankProviderDiscoveryItems`, il serializzatore del testo incollato, la costruzione degli elementi di input e la classificazione dello sforzo sono funzioni pure da portare in `TramaCore` con i loro casi di test.
- Menzioni di Trama: moduli, file, issue e decisioni. Synara non ha fonti per issue e decisioni. Il modello più vicino è la menzione di chat: un percorso con schema (per esempio `module://`, `issue://`, `decision://`, nomi da definire nel ticket), un nome reso univoco, un riferimento salvato nella bozza e filtrato all'invio, un blocco di contesto limitato costruito da Trama. I file restano testo `@percorso`, come in Synara.
- Le fonti dei candidati ci sono già: `RepositoryScanner` e il catalogo per moduli e file, `GitHubIssues` per le issue, `PactEngine` per le decisioni. La ricerca file può usare l'indice dello scanner invece di `git ls-files`, con lo stesso punteggio.
- Skill: `CodexClient` chiama già `skills/list`. Il menu `/` elenca le skill caricate; l'invio manda `$nome` nel testo e l'elemento `skill`.
- Allegati: `localImage` con file su disco nella cartella dati dell'app, gli stessi limiti, `NSImage` o ImageIO per la ricodifica.
- Selettore: `CodexClient.listModels()` usa già `model/list`. Il selettore scrive un override per turno su `turn/start`; il modello del Coordinatore resta quello scelto dalla persona.
- Editor: un `NSTextView` con attachment per i chip o un campo SwiftUI con segmenti; in entrambi i casi la mappatura del cursore e la cancellazione del chip intero sono comportamenti da provare.

### Da non portare

- Nodi e plugin Lexical, React Query, debounce di `@tanstack/react-pacer`, store Zustand, componenti Base UI dei selettori.
- URL blob, `FileReader`, rotta HTTP di caricamento.
- Wrapper Effect-TS.
- Tutto ciò che è Claude, Pi, Cursor, OpenCode o Droid (prefisso Ultrathink, `/skill:`, varianti), `@alias(task)`, i comandi integrati che non esistono in Trama (fork, side, automation e simili).

### Rischi e scelte aperte

- Sforzo omesso e `collaborationMode`: quando la persona sceglie lo sforzo predefinito del modello, `turn/start` non ha `effort` ma `collaborationMode.settings.reasoning_effort` diventa "medium". Per i modelli il cui predefinito non è medium (il gpt-5 statico ha high) i due valori non coincidono. Trama deve decidere se inviare sempre uno sforzo esplicito; la scelta più sicura è inviarlo sempre quando si usa `collaborationMode`.
- I nomi degli schemi per moduli, issue e decisioni e il formato del blocco di contesto sono nuovi.
- Le soglie del testo incollato (4000 caratteri, 25 righe) e i tetti delle menzioni sono valori di Synara, non misure fatte su Trama.
- Il testo di `<attached_files>` è in inglese perché è rivolto al modello; in Trama può restare in inglese, come i prompt.

Ticket: V07

## 5. Adattatore provider

### Dove sta in Synara

Interfacce in `apps/server/src/provider/Services/` (`ProviderAdapter.ts`, `CodexAdapter.ts`, `ProviderAdapterRegistry.ts`, `ProviderService.ts`, `ProviderHealth.ts`, `ProviderSessionDirectory.ts`); controlli in `enabledProviderAdapter.ts` e `providerAdapterConformance.ts`. Codex in `Layers/CodexAdapter.ts`, `apps/server/src/codexAppServerManager.ts`, `codexDiscoveryCatalog.ts`. Stato di accesso in `Layers/ProviderHealth.ts`, `providerStatusCache.ts`, `apps/web/src/components/chat/ProviderHealthBanner.tsx`. Contratti in `packages/contracts/src/` (`provider.ts`, `providerRuntime.ts`, `providerDiscovery.ts`, `model.ts`, `server.ts`, `orchestration.ts`). Persistenza in `apps/server/src/persistence/Layers/ProviderSessionRuntime.ts`.

### Forme dei dati

```ts
// ProviderAdapter.ts:69-316 (ridotto)
interface ProviderAdapterCapabilities {
  sessionModelSwitch: "in-session" | "restart-session" | "unsupported";
  conversationRollback?: "native" | "restart-session";
  supportsSkillMentions?; supportsSkillDiscovery?; supportsNativeSlashCommandDiscovery?;
  supportsPluginMentions?; supportsPluginDiscovery?; supportsRuntimeModelList?;
  supportsTurnSteering?; supportsLiveTurnDiffPatch?;
}
interface ProviderAdapterShape {               // Effect sostituito da Promise per leggibilità
  provider: ProviderKind; capabilities: ProviderAdapterCapabilities;
  startSession(input: ProviderSessionStartInput): Promise<ProviderSession>;
  didResumeSession?(input, session): boolean;
  sendTurn(input: ProviderSendTurnInput): Promise<ProviderTurnStartResult>;
  steerTurn?(input); interruptTurn(threadId, turnId?, providerThreadId?);
  respondToRequest(threadId, requestId, decision); respondToUserInput(threadId, requestId, answers);
  stopSession(threadId);                        // idempotente
  listSessions(); hasSession(threadId); readThread(threadId); rollbackThread(threadId, numTurns);
  compactThread?(threadId); forkThread?(input); stopAll();
  streamEvents: Stream<ProviderRuntimeEvent>;   // eventi normalizzati
  getComposerCapabilities?(); listSkills?(); listCommands?(); listModels?(); ...
}

// provider.ts
type ProviderSessionStatus = "connecting" | "ready" | "running" | "error" | "closed";
interface ProviderSession { provider; status; runtimeMode; cwd?; model?; threadId;
  resumeCursor?: unknown; activeTurnId?; createdAt; updatedAt; lastError? }
interface ProviderSessionStartInput { threadId; provider?; cwd?; modelSelection?;
  resumeCursor?: unknown; forkSourceResumeCursor?: unknown; approvalPolicy?; sandboxMode?;
  providerOptions?; runtimeMode }
interface ProviderSendTurnInput { threadId; input?; attachments?; skills?; mentions?;
  modelSelection?: ModelSelection; interactionMode? }
interface ProviderTurnStartResult { threadId; turnId; resumeCursor?: unknown }

// server.ts:39-88
type ServerProviderStatusState = "ready" | "warning" | "error";
type ServerProviderAuthStatus  = "authenticated" | "unauthenticated" | "unknown";
interface ServerProviderStatus { provider; status; available: boolean; authStatus;
  authType?; authLabel?; version?: string | null; checkedAt; message? }

// orchestration.ts
type ModelSelection =
  | { provider: "codex"; model: string; options?: { reasoningEffort?: string; fastMode?: boolean } }
  | { provider: "claudeAgent"; model: string; options?: ClaudeModelOptions }
  | ...;

// providerDiscovery.ts:279-307
interface ProviderModelDescriptor { slug; resolvedModel?; name; description?;
  supportedReasoningEfforts?; defaultReasoningEffort?; supportsFastMode?; ... }
interface ProviderListModelsResult { models; source?; cached?; error? }

// providerRuntime.ts:262-274, base di ogni evento normalizzato
interface ProviderRuntimeEventBase {
  eventId; provider; threadId; createdAt;
  turnId?; parentTurnId?; itemId?; requestId?; lifecycleGeneration?;
  providerRefs?: { providerThreadId?; providerTurnId?; providerItemId?; providerRequestId?; ... };
  raw?: { source: "codex.app-server.notification" | "codex.app-server.request" | ...; method?; payload };
}
```

Valori Codex (`CodexAdapter.ts:2467-2477`): `sessionModelSwitch: "in-session"`, scoperta skill e plugin sì, comandi nativi no, lista modelli a runtime sì, steering sì, patch del diff dal vivo sì. `conversationRollback` omesso significa rollback nativo.

### Algoritmo

Registro e controlli:

- `ProviderAdapterRegistry` è una ricerca per tipo di provider, senza ciclo di vita.
- `ensureProviderEnabled` rifiuta un provider disattivato nelle impostazioni prima di dare l'adattatore.
- `assertProviderAdapterConformance` all'avvio lega i flag ai metodi: `supportsTurnSteering` richiede `steerTurn`, `supportsSkillDiscovery` richiede `listSkills`, `supportsRuntimeModelList` richiede `listModels`, e così via. Un flag vero senza metodo è un errore: "Provider adapter "<p>" has invalid capabilities: <flag> requires <method>()".

Stato di accesso di Codex (`makeCheckCodexProviderStatus`, ProviderHealth.ts:827-993), tramite la CLI e non tramite app-server:

1. `codex --version`. Eseguibile assente: `available: false`. Errore o timeout: avviso. Versione sotto il minimo: messaggio di aggiornamento.
2. Se `config.toml` (in `~/.codex` o `$CODEX_HOME`) imposta un `model_provider` diverso da `openai`, il controllo di login si salta: `ready` con `unknown`.
3. `codex -c mcp_servers={} login status` con timeout. Errore di avvio o timeout: `warning` con `unknown`.
4. Parsing dell'output, in ordine: "unknown command", "unrecognized command" o "unexpected argument" danno `warning`/`unknown`; "not logged in", "login required", "authentication required" o "run `codex login`" danno `error`/`unauthenticated`; JSON con un booleano di autenticazione dà `ready`/`authenticated` o `error`/`unauthenticated`, e senza marcatore `warning`/`unknown`; exit 0 dà `ready`/`authenticated`; altrimenti `warning`/`unknown` con il dettaglio di stderr.
5. Tipo e etichetta dell'account vengono dal piano letto nell'output.

`account/read` su app-server serve solo a filtrare i modelli per piano (Spark bloccato su free, go e plus); un suo errore si registra e si ignora.

Cache dello stato: l'ultimo stato per provider è salvato in un file e servito all'avvio, mai considerato più autorevole di un controllo fresco. Un solo aggiornamento alla volta, con un flag "serve un altro giro". I cambiamenti arrivano su un flusso.

Interfaccia: il banner non compare se lo stato è `ready`; altrimenti avviso o errore con titolo "<Provider> provider status" e il `message`, tagliato a 3 righe. Il banner guarda solo `status`, non `authStatus`.

Catalogo modelli:

- Le opzioni restano separate per provider grazie all'unione discriminata `ModelSelection`. Gli adattatori controllano il tag: per esempio `codexModelSelectionOverrides` restituisce `{}` se `provider !== "codex"`.
- Sforzo di Codex: stringa aperta. Sforzo di Claude: enumerazione chiusa.
- `serviceTier` di Codex viene da `fastMode`, solo se definito.
- Lista a runtime: `model/list` con cache "stale-while-revalidate" a volo singolo; provider disattivato dà `{ models: [], source: "disabled" }`, adattatore senza `listModels` dà `source: "unsupported"`. Le voci malformate si scartano con un avviso. `model/list` non si chiama all'avvio a freddo della sessione. Esiste un catalogo statico di ripiego.

Normalizzazione degli eventi: `mapToRuntimeEvents(event, threadId)` (`CodexAdapter.ts:1073-1875`). Un evento nativo produce zero, uno o più eventi normalizzati. L'unione ha 51 tipi. Mappatura Codex essenziale:

| Codex | Normalizzato |
| --- | --- |
| richiesta `item/tool/requestUserInput` | `user-input.requested` (scartato senza domande) |
| altre richieste di approvazione | `request.opened` con `requestType` |
| `item/requestApproval/decision`, `serverRequest/resolved` | `request.resolved` |
| `thread/started` | `thread.started` |
| `thread/status/changed`, `thread/archived`, `thread/closed`, `thread/compacted` | `thread.state.changed` |
| `thread/name/updated` | `thread.metadata.updated` |
| `thread/tokenUsage/updated` | `thread.token-usage.updated` |
| `turn/started` | `turn.started { model, effort }` (serve `turnId`) |
| `turn/completed` | `turn.completed { state }` |
| `turn/plan/updated` | `turn.tasks.updated` |
| `turn/diff/updated` | `turn.diff.updated` |
| `item/started`, `item/completed` | `item.started`, `item.completed` (piano: `turn.proposed.completed`) |
| `item/agentMessage/delta` | `content.delta` con `assistant_text` |
| `item/reasoning/textDelta`, `summaryTextDelta` | `content.delta` con `reasoning_text`, `reasoning_summary_text` |
| `item/commandExecution/outputDelta`, `item/fileChange/outputDelta` | `content.delta` con `command_output`, `file_change_output` |
| `item/mcpToolCall/progress` | `tool.progress` |
| `model/rerouted`, `configWarning`, `deprecationNotice` | `model.rerouted`, `config.warning`, `deprecation.notice` |
| `account/updated`, `account/rateLimits/updated` | `account.updated`, `account.rate-limits.updated` |
| notifica `error` | `runtime.warning` se `willRetry` o non fatale, altrimenti `runtime.error` |
| qualsiasi altro | `event.unmapped { nativeType, detail, data }` |

Dettagli: il tipo nativo dell'elemento si porta in minuscolo, si separa sul camelCase e si confronta per sottostringhe ("command" diventa `command_execution`, "file change", "patch" o "edit" diventano `file_change`, "mcp" diventa `mcp_tool_call`); gli `item.started` e `item.completed` di tipo sconosciuto si scartano. Del ragionamento entra nel dettaglio solo il riepilogo scritto dal provider. `turn.steered` lo emette l'adattatore dopo una risposta positiva a `turn/steer`.

Ciclo di vita della sessione Codex:

1. Avvio del processo, `session/connecting`.
2. `initialize`, poi la notifica `initialized`, poi la registrazione della radice delle skill.
3. `account/read` (errore ignorato), normalizzazione del modello rispetto all'account.
4. Override di sessione: modello, `serviceTier`, `cwd`, politica di approvazione, sandbox.
5. Scelta del metodo (`buildCodexThreadOpenRequest`): `thread/fork` se c'è un cursore di fork, altrimenti `thread/resume { threadId }` se c'è un cursore di ripresa, altrimenti `thread/start`. Chiedere insieme ripresa e fork è un errore.
6. Ripiego sulla ripresa: se `thread/resume` fallisce con un messaggio che contiene "not found", "missing thread", "no such thread", "unknown thread" o "does not exist", si emette `session/threadResumeFallback` e si chiama `thread/start`. Ogni altro errore emette `session/threadResumeFailed` e interrompe.
7. L'id del thread si legge da `response.thread.id` o `response.threadId`.
8. Sessione pronta con `resumeCursor: { threadId }`.

Invio del turno: l'id del thread del provider viene dal cursore; se manca, errore "Session is missing provider resume thread id.". L'id del turno viene da `response.turn.id`.

Interruzione: risolve l'id del thread, annulla il turno sul canale MCP e rilascia la credenziale, poi `turn/interrupt { threadId, turnId }`. Le richieste del server in sospeso si chiudono a parte, perché `turn/interrupt` da solo non le chiude. Un turno fermo viene abbandonato da un watchdog (intervallo di 15 s).

Stop: idempotente. Rifiuta le richieste JSON-RPC in sospeso, risponde alle approvazioni parcheggiate entro una scadenza, chiude stdin, stato `closed`. Il contesto resta nella mappa finché lo smontaggio non finisce, così un avvio concorrente non crea un processo doppio.

Persistenza: per ogni thread un legame con provider, modalità, stato, generazione, `resumeCursor` e opzioni del provider. Lo stop conserva il cursore. Al riavvio si usa il cursore dell'ingresso o, se il provider coincide, quello salvato. Se la ripresa nativa fallisce ma c'era un cursore, il servizio registra un "prior transcript bootstrap" che reinietta la cronologia locale nel thread nuovo.

### Casi limite

- `model_provider` personalizzato: stato di accesso `unknown`, non `unauthenticated`.
- Evento d'uso con usato zero: scartato (vedi sezione 3).
- Metodo nuovo del protocollo: resta visibile come `event.unmapped` invece di sparire.
- Ripresa fallita per thread inesistente: nuovo thread e evento dichiarato; per altri errori, nessun ripiego silenzioso.

### In Trama

- V08: un `protocol ProviderAdapter` con `capabilities`, `accessStatus`, `listModels()`, `startSession`, `sendTurn`, `interruptTurn`, `stopSession` e un `AsyncStream<ProviderEvent>`. `CodexClient` diventa l'implementazione Codex. `Effect<A, E>` diventa `async throws -> A`, `Stream` diventa `AsyncStream`.
- Capacità dichiarate richieste da V08: thread persistente, ripresa, strumenti host, override per turno, uso token. Synara non ha nessuno di questi flag: vanno definiti da Trama come `struct ProviderCapabilities` con booleani espliciti. Si porta il controllo di conformità: un flag vero senza il metodo corrispondente è un errore all'avvio o nei test.
- Stato di accesso: `enum ProviderAccessStatus { authenticated, unauthenticated, unknown }`, come `ServerProviderAuthStatus`, più uno stato di disponibilità e un messaggio. Oggi `CodexClient` ricava `AccountStatus` (`signedOut`, `chatGPT`) da `account/read`. La mappatura verso i tre stati è diretta; `unknown` copre errori e provider personalizzati.
- Opzioni per provider: `enum ModelSelection { case codex(model: String, options: CodexModelOptions?) }`, con `reasoningEffort: String?` aperto. Il caso Claude arriverà con il suo ticket.
- Eventi normalizzati: `enum ProviderEvent` con la base (id, provider, thread, data, turno, elemento, richiesta, riferimenti del provider, grezzo) e i casi che il verticale usa davvero: sessione, thread, uso token, turno, elementi, delta di contenuto, richieste, avvisi ed errori, `unmapped`. Non servono i 51 tipi; serve la tabella sopra per i metodi che `CodexClient` già riceve. `CodexTransportEvent` è il punto da cui partire.
- V02: il cursore di ripresa si salva nel documento del progetto come JSON opaco del provider (`Data` o un `JSONValue`), non come stringa tipizzata Codex, così il cursore di Claude ci starà. Ripiego su `thread/start` solo per gli errori "thread inesistente", dichiarato in chat; il "prior transcript bootstrap" di Synara corrisponde a "alimentato con studio e memoria" della specifica.
- Un `actor` per thread serializza avvio, invio, interruzione e stop, al posto dei lock Effect.
- Schermata dei collegamenti: stessa forma per ogni provider (nome, stato di accesso, capacità), con un avviso solo quando lo stato non è pronto.

### Da non portare

- `Effect.Effect`, `Stream.Stream`, `ServiceMap.Service`, `Layer`, `Schema.Struct`, `PubSub`, `Ref`, `Cache.make`, `Scope`, `Fiber`.
- `ChildProcessSpawner`, `NodeJS.ProcessEnv`, il mutex a catena di promise, lo smontaggio dell'albero dei processi Node.
- Il journal persistente degli eventi e la tabella SQLite `provider_session_runtime`: Trama salva nel documento.
- Markup di `ProviderHealthBanner.tsx`.
- Contabilità e controllo di accesso di Claude (`claude auth status`, lock FIFO, cursore ricco): utili solo per il ticket del secondo adattatore.
- Tabelle statiche dei modelli di Synara: Trama usa `model/list`.

### Rischi e scelte aperte

- Synara non dichiara capacità per thread persistente, ripresa, strumenti host, override per turno e uso token: la ripresa è implicita nel cursore, gli strumenti host passano dal gateway, l'uso token è implicito nell'evento. I flag di V08 sono un progetto di Trama.
- Accesso: Synara lo rileva con la CLI (`codex login status`), non con app-server. Trama oggi usa `account/read`. Tenere `account/read` è una scelta di Trama senza precedente in Synara; va motivata, e il caso `model_provider` personalizzato va gestito come `unknown`.
- `didResumeSession` vale vero per difetto in Synara. Trama deve sapere con certezza se la ripresa è riuscita per dirlo in chat: la risposta di `thread/resume` va controllata, non presunta.
- Il watchdog di 15 s per i turni fermi è un valore di Synara. Il Coordinatore di Trama può avere turni lunghi con strumenti; il valore va misurato.
- Normalizzare solo i metodi usati oggi lascia fuori eventi futuri: `unmapped` deve arrivare alla timeline come riga leggibile, non essere scartato.

Ticket: V08, V02

## 6. Aspetto della chat come comportamenti

### Dove sta in Synara

In `apps/web/src/components/chat/`: `MessagesTimeline.tsx` (messaggi, disclosure, timer), `chatTypography.ts` (spaziature, interlinea), `ChatEmptyStateHero.tsx` e `ChatTranscriptPane.tsx` (stato vuoto), `useChatTranscriptScroll.ts` (auto-follow). Poi `apps/web/src/components/ChatView.tsx`, `ChatView.logic.ts` e la regola in `AGENTS.md:24`.

I colori e le misure non vengono da qui ma da [design-app-codex.md](design-app-codex.md).

### Comportamenti

Messaggio della persona (MessagesTimeline.tsx:1576-1757):

- Allineato a destra, colonna al massimo all'80% della larghezza (piena durante la modifica).
- Blocco largo quanto il contenuto, sfondo dedicato, angoli di 1 rem, padding orizzontale 14 px e verticale 10 px.
- Il bordo esiste sempre ma è trasparente, così la geometria non cambia quando diventa visibile (per esempio per i thread temporanei). A vista: nessun bordo.
- Chip (allegati, modalità) sopra il blocco, fuori.
- Sotto il blocco: ora, copia, modifica, ripristino, visibili al passaggio del puntatore.
- Testo lungo richiudibile.

Risposta del Coordinatore:

- Nessuna bolla: markdown semplice senza sfondo, bordo o raggio, a tutta larghezza della colonna.
- Colonna condivisa da tutte le righe, centrata, con larghezza massima (46 rem in Synara; Trama usa i 42 rem della app Codex).
- La riga "Worked for" sta sopra la risposta, con una linea divisoria di 1 px sotto; la narrazione raccolta dentro il gruppo è resa in tono attenuato.
- Interlinea 1,625 per tutto il testo della chat.

Stato vuoto:

- Colonna centrata con il logo, il titolo "Let's build" e sotto il nome del progetto in tono attenuato. Nessun suggerimento.
- Compare quando non ci sono messaggi, righe e lavoro in corso. Senza contenuto dedicato: "Send a message to start the conversation.".
- Con i dati ancora in caricamento si mostra uno stato di caricamento con riprova, non lo stato vuoto.
- Per un thread principale vuoto Synara mostra un composer centrato con il logo e "What should we work on?".

Auto-follow:

- Regola (AGENTS.md:24): "Auto-follow represents real assistant text streaming, not generic work, buffering, reconnecting, pending approvals, or tool-only activity. Tool/work rows must not retrigger message-arrival auto-stick behavior."
- `followLiveOutput = hasStreamingAssistantText && !isUserScrollDetached`, dove `hasStreamingAssistantText` è vero se un messaggio dell'assistente ha `streaming`.
- Solo un gesto della persona stacca lo scorrimento. Una perdita del fondo dovuta al layout non stacca.
- Durante lo streaming, se ancora agganciato, uno spostamento dal fondo programma un nuovo scorrimento.
- Il riaggancio avviene solo al vero fondo o all'invio di un messaggio.
- Gli eventi di scorrimento entro 200 ms da uno scorrimento programmatico sono ignorati.
- Il segnale si calcola dal numero di messaggi e dalla chiave dell'ultimo messaggio, mai dalle righe di lavoro (`buildTranscriptTailKey`).

Stato vivo: una sola riga "Thinking" in coda, più l'intestazione "Working for" con il timer; le righe di lavoro non la sostituiscono (sezione 1).

### In Trama

- V06: la colonna centrale della conversazione applica questi comportamenti con i token della app Codex: bolla della persona su sfondo morbido senza bordo, risposta senza bolla, larghezza massima 672 px, interlinea della chat.
- L'auto-follow è una piccola macchina a stati pura (agganciato, staccato dalla persona) con ingressi: streaming del Coordinatore, gesto della persona, arrivo al fondo, invio. Si prova senza viste. In SwiftUI si applica con `ScrollViewReader` o `scrollPosition`, ignorando le variazioni prodotte dal codice.
- Le schede di Trama non riattivano l'auto-follow, come le righe di lavoro. Il testo in streaming del Coordinatore sì.
- Stato vuoto: in Trama il primo messaggio è lo studio del Coordinatore (V02), quindi lo stato vuoto compare solo prima che lo studio arrivi o se il Coordinatore non è collegato. Titolo e invito in italiano.
- Accessibilità: i pulsanti che compaiono al passaggio del puntatore devono essere raggiungibili da tastiera e da VoiceOver anche senza puntatore (azioni accessibili sulla riga).

### Da non portare

- Classi Tailwind, variabili CSS, `-electron-corner-smoothing` e `corner-shape` (in SwiftUI si usa `RoundedRectangle(cornerRadius:style: .continuous)`).
- `maintainScrollAtEnd` di LegendList e la soglia 0,1: meccanica della lista web.
- I colori e le misure di Synara: valgono quelli della app Codex.

### Rischi e scelte aperte

- Il comportamento dei pulsanti al passaggio del puntatore non ha un equivalente diretto con VoiceOver: V06 deve scegliere azioni accessibili.
- La larghezza della colonna differisce fra Synara (46 rem) e la app Codex (42 rem). Vale la app Codex.
- Synara non ha uno stato vuoto con suggerimenti: se Trama li vuole, sono nuovi.

Ticket: V06
