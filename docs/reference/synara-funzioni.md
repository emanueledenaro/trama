# Riferimento funzionale: come Synara risolve ciò che il verticale deve costruire

Data: 18 settembre 2026. Fonte: repository pubblico [Emanuele-web04/synara](https://github.com/Emanuele-web04/synara), commit `9f91d59f182ec03722cb7fe8fe2244ef268c2c39`. I percorsi sotto sono relativi alla radice di quel repository; i numeri di riga valgono per quel commit. Le sezioni 1-6 erano state scritte sul commit precedente `dd88d9272f97e4dda5735281e73ce14de388ad25`; dove Synara è cambiata nel frattempo il documento lo dice nella sottosezione "Modifiche rispetto a dd88d92" della sezione interessata.

## Perché esiste

Chi implementa un ticket V01-V09 parte dal ticket con un contesto pulito. La [specifica del verticale](../spec-coordinatore-verticale.md) dice che da Synara si portano i comportamenti e la forma del collegamento ai provider, ma non dice come Synara li realizza. Senza questo documento ogni implementatore dovrebbe rileggere Synara da capo o, peggio, reinventare regole che Synara ha già messo alla prova: dove finisce un turno, come si fondono le attività di uno strumento, cosa conta come uso della finestra di contesto, come si rifiuta una chiamata MCP.

La regola è una: portiamo logica e comportamento, non codice Electron/React/Effect. Ogni sezione dice cosa Synara fa, con quali forme di dati, dove sta nel codice, come si traduce in Trama e cosa lasciare fuori. Le deviazioni da quanto descritto qui sono ammesse, ma vanno motivate nella pull request del ticket.

Il riferimento estetico resta la [app Codex](design-app-codex.md): colori, font e misure vengono da lì. Da Synara arrivano solo i comportamenti.

Convenzioni:

- I tipi TypeScript sono ridotti ai campi utili. In Synara molti sono schemi Effect (`Schema.Struct`), qui scritti come interfacce.
- "In Trama" indica la traduzione proposta verso Swift e i tipi esistenti (`CodexClient`, `RequestState`, `ProjectMandate`, `PactEngine`, `DesignSystem`). Non descrive codice già scritto, salvo dove è detto.
- Dove un rapporto di ricerca non ha trovato qualcosa, il documento lo dice. Non va dedotto.

Sezioni: [1 timeline](#1-timeline-e-raggruppamento-delle-attività) (V01, V06), [2 canale MCP](#2-canale-agente-host-mcp) (V02, V03), [3 finestra di contesto](#3-finestra-di-contesto) (V07), [4 composer](#4-composer) (V07), [5 adattatore provider](#5-adattatore-provider) (V08, V02), [6 aspetto della chat](#6-aspetto-della-chat-come-comportamenti) (V06), [7 i nove provider](#7-i-nove-provider) (V08, P02-P09), [8 runtime ACP condiviso](#8-runtime-acp-condiviso) (P03-P06), [9 infrastruttura comune](#9-infrastruttura-comune) (V08, P02-P09).

La sezione 5 descrive la forma comune dell'adattatore e cosa è cambiato in Synara rispetto a `dd88d92`. La sezione 7 scende in ogni provider, la 8 nel client ACP che Cursor, Grok, Droid e Devin condividono, la 9 nei servizi comuni a tutti gli adattatori.

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

### Modifiche rispetto a dd88d92

- Lo snapshot del contesto porta un campo nuovo, `claudeCache`, decodificato con lo schema `ClaudeCacheObservation` (`apps/web/src/lib/contextWindow.ts:1-13`, `:120`, `:206`, `:248`). Per Codex resta `null`: il campo esiste per il misuratore di Claude.
- Il misuratore guadagna un pannello di dettaglio della cache (`apps/web/src/components/chat/ContextWindowMeter.tsx:10`, `:28`, `:144-145`) con il componente `ClaudeCacheDetails.tsx` (70 righe), e il composer un pannello di revisione prima di un turno costoso (`apps/web/src/components/chat/ComposerClaudeCacheReviewPanel.tsx`, 121 righe). La soglia e l'avviso di V07 vanno decisi tenendo conto di questa forma, che è nuova in Synara.
- La derivazione e la formattazione non cambiano: restano `deriveLatestUsageContextWindowState`, `deriveContextWindowMeterDisplay` e `formatContextWindowTokens`, con i valori e le regole già descritti sopra.

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

### Modifiche rispetto a dd88d92

- Il composer si blocca mentre è in sospeso una revisione della cache di Claude: l'invio è disabilitato (`apps/web/src/components/chat/ChatComposerFooter.tsx:187-192`, `:202-207`, `:219-224`) e la coda non parte da sola finché `claudeCacheReview` è presente (`apps/web/src/components/chat/useChatQueuedTurns.ts:277-283`, `:300-306`, `:394-397`). Non è una regola di composizione del testo, è una regola di invio: in Trama va decisa insieme al pannello di revisione, non dentro `detectComposerTrigger`.
- Il piè del composer guadagna un comando di compattazione nativa per Claude (`apps/web/src/components/ChatView.tsx:25`, `:60-71`; `apps/web/src/hooks/useClaudeContextCompaction.ts`, 159 righe), che passa dal normale percorso di turno utente (`apps/web/src/lib/claudeCompactionRequests.ts`, 34 righe). Il comando `/compact` esisteva già nel menu: quello che cambia è che ora ha un effetto nativo dichiarato.
- La scoperta di file, menzioni, skill e il punteggio non cambiano.

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

### Modifiche rispetto a dd88d92

Il commit di riferimento è cambiato. Questa sezione resta valida per la forma comune, con quattro gruppi di modifiche fra `dd88d92` e `9f91d59`.

**Osservazione della cache di Claude.** Nuovi file `apps/server/src/provider/claudeCacheObservation.ts` (131 righe), `packages/contracts/src/claudeCache.ts:4-26` e `packages/shared/src/claudeCache.ts:3-56`. L'hook `SessionStart` produce un'osservazione con `nativeSessionId`, `model`, `contextTokens`, `lastResponseAt`, `state` e `estimatedCacheWriteUsd` (`claudeCacheObservation.ts:46-73`); l'uso di una richiesta ne produce un'altra con `ttlSeconds` 300 o 3600 secondo `ephemeral_5m_input_tokens` e `ephemeral_1h_input_tokens` (`:35-44`, `:75-121`). Un cambio di modello marca il prefisso `likely-expired` e butta la stima di prezzo (`:123-131`). L'osservazione viene salvata nel cursore di ripresa (`ClaudeAdapter.ts:2190-2202`) e serve a Synara per chiedere conferma prima di un turno costoso: `assessClaudeCache` dichiara `requiresConfirmation` quando lo stato è `likely-expired` e il contesto supera `CLAUDE_LARGE_CONTEXT_TOKENS = 100_000` (`packages/shared/src/claudeCache.ts:3`, `:50-55`). Il contratto dell'adattatore guadagna `getClaudeCacheObservation` (`provider/Services/ProviderAdapter.ts:238-244`) e il thread porta `claudeCacheReview` (`packages/contracts/src/orchestration.ts:768-781`, `:784`).

**Compattazione nativa di Claude.** `startClaudeCompaction` è nuovo (`provider/Services/ProviderAdapter.ts:236-240`) e `compactThread` resta. Si riconosce `/compact` con `^\/compact(?:\s|$)` (`ClaudeAdapter.ts:1290-1292`), si verifica entro 1 s che `supportedCommands()` contenga `compact`, e si rifiuta con allegati, con lavoro condiviso attivo o senza identità nativa (`ClaudeAdapter.ts:6014-6073`). Il turno di compattazione porta `explicitCompaction = { nativeSessionId, boundaryObserved: false }` (`:6226-6233`), il confine si conferma su `compact_boundary` (`:4431-4437`) e l'esito si dichiara compattato solo se il confine è stato visto e il `session_id` del risultato combacia (`:3193-3198`).

**Revisione di `codexAppServerManager`.** `thread/resume` e `thread/fork` ora mandano `excludeTurns: true` (`apps/server/src/codexAppServerManager.ts:677`, `:684`, `:2050`), cioè non si fanno restituire la cronologia. Questo alza la versione minima della CLI a `0.125.0` per ripresa e fork (`apps/server/src/provider/codexCliVersion.ts:13`), calcolata da `resolveCodexThreadOpenMinimumVersion` insieme al minimo di Auto (`codexAppServerManager.ts:693-707`). La sessione tiene ora `sessionAttemptId`, `terminalFailure` e `teardownError` (`:203-206`, `:1197`), così una causa terminale del trasporto non viene sostituita da un errore generico e lo smontaggio certificato non viene perso; `spawnAppServer` è iniettabile per i test (`:1036`, `:1061`).

**Opzioni di ragionamento di OpenCode.** Nuovo file `apps/server/src/provider/openCodeReasoningOptions.ts` (63 righe): legge le voci `reasoning_options` di models.dev con `type: "effort"`, traduce un valore `null` in `none` e ignora di proposito le voci di tipo toggle e budget, perché il selettore di OpenCode può spedire solo varianti di sforzo discrete (`:25-31`, `:41-58`). Vale sia quando il server normalizza i metadati in `variants` sia quando li espone grezzi (`opencodeRuntime.ts:539-570`; `OpenCodeDiscovery.ts:288-330`). Sempre su OpenCode, il marcatore di server pronto accetta anche la forma nuova `server listening` oltre a `opencode server listening` (`opencodeRuntime.ts:76-80`, `:243-250`) e un server gestito riceve ora una password (`opencodeRuntime.ts:926-939`, `:1093`), che l'adattatore passa al client anche quando il server è interno (`Layers/OpenCodeAdapter.ts:192-198`, `:3405-3417`).

Nessuna di queste modifiche tocca la forma comune descritta sopra: cambiano il contenuto del cursore di Claude, il vocabolario delle capacità di Claude, i parametri di apertura del thread Codex e la lettura del catalogo di OpenCode.

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

## 7. I nove provider

Synara registra nove adattatori dietro lo stesso contratto (`apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`, `apps/server/src/provider/runtimeLayer.ts:80-95`). La forma comune, le forme dati e i controlli di conformità sono nella [sezione 5](#5-adattatore-provider). Qui c'è quello che cambia da provider a provider, con il percorso e la riga di ogni affermazione al commit `9f91d59`.

Il materiale grezzo da cui viene questa sezione sta in `docs/reference/synara-ricerche/`: `codex.md`, `claude.md`, `cursor.md`, `antigravity.md`, `grok.md`, `droid.md`, `pi.md`, `devin.md`, `acp.md`, `infra.md`. Contiene più dettaglio di quello che serve a un ticket, compresi gli elenchi completi dei casi limite.

Convenzione dei percorsi in questa sezione: un nome di file senza cartella si riferisce a `apps/server/src/provider/Layers/`, che è dove stanno le implementazioni; la cartella `provider/Services/` contiene solo le interfacce del servizio. Tutti gli altri percorsi sono relativi alla radice del repository.

### Quadro d'insieme

| Provider | Trasporto | Cambio modello | Rollback | Compattazione | Steering | Cursore di ripresa |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `codex app-server`, JSON-RPC su stdio | in sessione | nativo | sì | sì | `{ threadId }` |
| Claude Agent | programma `claude` via SDK, JSON su stdio | in sessione | riavvio | sì, nativa | sì | oggetto ricco con `resume`, `turnCount`, `claudeCache` |
| Cursor | `cursor-agent acp`, ACP su stdio | in sessione | nessuno | no | no | `{ schemaVersion: 1, sessionId }` |
| Antigravity | `agy -p`, un processo per turno, modalità print | riavvio | riavvio | no | no | id di conversazione (stringa) |
| Grok | `grok ... stdio`, ACP | riavvio | nessuno | sì | no | `{ schemaVersion: 1, sessionId }` |
| Droid | `droid exec --output-format acp`, ACP | riavvio | riavvio | no | no | `{ schemaVersion: 1, sessionId }` |
| OpenCode | server `opencode serve` più client SDK HTTP | in sessione | nativo (`session.revert`) | sì | no | `{ openCodeSessionId, cwd, ... }` |
| Pi | SDK TypeScript dentro il processo del server | in sessione | sì | sì | sì | percorso del file di sessione |
| Devin | `devin acp`, ACP | riavvio | riavvio | sì | no | `{ schemaVersion: 1, sessionId }` |

Quattro provider parlano ACP e condividono un solo runtime: Cursor, Grok, Droid e Devin. È la [sezione 8](#8-runtime-acp-condiviso).

### Codex

Il riferimento completo è la sezione 5: Codex è l'adattatore su cui quella forma è stata scritta. Qui restano i punti che servono a V08 per non rileggere Synara.

**Percorsi dei file.** `provider/Layers/CodexAdapter.ts` (2509 righe); `apps/server/src/codexAppServerManager.ts`, `codexAppServerTransport.ts`, `codexProcessEnv.ts`, `codexHomePaths.ts`, `codexTurnInput.ts`, `codexServiceTier.ts`, `codexErrorClassification.ts`, `codexWorkingDirectory.ts`; `provider/codexDiscoveryCatalog.ts`, `provider/codexCliVersion.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:797-995`; blocco MCP in `agentGateway/mcpInjection.ts:44-53`.

**Trasporto.** Un processo `codex app-server` per thread, JSON-RPC su stdio, framing a byte con limite di 16 MiB per riga e coda di scrittura da 32 MiB (`apps/server/src/codexAppServerTransport.ts:3-12`, `:143-255`). `initialize` dichiara `clientInfo.name: "synara_desktop"` e `capabilities.experimentalApi: true` (`apps/server/src/codexAppServerManager.ts:805-816`). Scadenza di 20 s per richiesta (`:3612-3643`).

**Controllo di accesso.** Due comandi CLI, non app-server: `codex --version` e `codex -c mcp_servers={} login status`, con timeout di 4 s (`apps/server/src/provider/Layers/ProviderHealth.ts:843`, `:923`). Un `model_provider` diverso da `openai` in `config.toml` salta il controllo di login e dà `ready`/`unknown` (`:909-920`). Dentro la sessione `account/read` serve solo a filtrare i modelli per piano (`codexAppServerManager.ts:428-455`). Versioni minime: `0.37.0` generale, `0.124.0` per Auto, `0.125.0` per ripresa e fork (`apps/server/src/provider/codexCliVersion.ts:9-13`).

**Catalogo modelli.** `model/list` con `{ cursor: null, limit: 50, includeHidden: false }` (`codexAppServerManager.ts:2632-2656`); cache LRU di 128 voci senza scadenza nel manager (`:984-1012`), sopra la cache comune da 10 minuti e 64 voci. Catalogo statico di ripiego di otto modelli, predefinito `gpt-6-astra` (`packages/contracts/src/model.ts:579-621`, `:1138-1139`).

**Opzioni.** `CodexModelOptions = { reasoningEffort?: string; fastMode?: boolean }` (`packages/contracts/src/model.ts:99-104`). Sforzo aperto, con elenco noto `low`, `medium`, `high`, `xhigh` (`:5-7`). `fastMode` diventa `serviceTier` (`apps/server/src/codexServiceTier.ts:3-12`). `runtimeMode` diventa `approvalPolicy`, `approvalsReviewer` e sandbox (`codexAppServerManager.ts:613-639`).

**Capacità dichiarate.** `sessionModelSwitch: "in-session"`, skill e plugin sì, comandi nativi no, lista modelli a runtime sì, steering sì, patch del diff dal vivo sì (`apps/server/src/provider/Layers/CodexAdapter.ts:2467-2477`). `conversationRollback` è omesso, cioè nativo.

**Ciclo di vita e cursore di ripresa.** Scelta del metodo con `buildCodexThreadOpenRequest`: `thread/fork`, `thread/resume` o `thread/start`, e ripresa e fork insieme sono un errore (`codexAppServerManager.ts:671-690`). Da `9f91d59` ripresa e fork mandano `excludeTurns: true` (`:677`, `:684`). Ripiego su `thread/start` solo per i messaggi di "thread inesistente" (`:959-966`). Il cursore è `{ threadId }` (`:4516-4526`). Watchdog di inattività a 900 s, controllo ogni 15 s (`provider/Layers/CodexAdapter.ts:102-106`).

**Iniezione degli strumenti host.** Blocco TOML `[mcp_servers.synara]` con `bearer_token_env_var` e `shell_environment_policy.exclude` (`apps/server/src/agentGateway/mcpInjection.ts:44-53`), token solo nell'ambiente del processo (`codexAppServerManager.ts:1073-1087`). La credenziale si ritira a ogni fine turno e il turno dopo riapre la sessione con una credenziale nuova (`:3246-3265`; `provider/Layers/ProviderService.ts:1430-1478`).

**Eventi d'uso.** `thread/tokenUsage/updated` normalizzato da `normalizeCodexTokenUsage` (`provider/Layers/CodexAdapter.ts:278-334`); usato da `last.totalTokens`, massimo da `modelContextWindow`, `compactsAutomatically` sempre vero (`:332`).

**Casi limite dai test.** Framing con UTF-8 spezzato e riga oltre il limite (`apps/server/src/codexAppServerTransport.test.ts:28`); stdout sporco (`codexAppServerManager.test.ts:1523`); ripiego di ripresa solo per "non trovato" (`:1583`); `task_complete` senza `turn/completed` (`:4778`); bearer ritirato prima di ogni evento terminale (`:4886`).

**In Trama.** Vedi la sezione 5, che è già la traduzione di Codex. L'unica aggiunta di `9f91d59` è che il cursore di ripresa dichiara di non volere la cronologia: Trama deve aspettarsi una ripresa senza replay e alimentare il thread nuovo dalla propria trascrizione, che è esattamente il "prior transcript bootstrap" descritto nella sezione 5.

**Da non portare.** Tutto quello della sezione 5.

### Claude Agent

Ticket P02.

**Percorsi dei file.** `apps/server/src/provider/Layers/ClaudeAdapter.ts` (7003 righe); `provider/claudeAgentSdk.ts`, `claudeProcessEnv.ts`, `claudeAuthStatus.ts`, `claudeAuthStatusLock.ts`, `claudeCacheObservation.ts`, `claudeTokenUsage.ts`, `claudeResultUsage.ts`, `claudeRequestUsage.ts`, `claudeCliVersion.ts`, `claudeCredentialKeepalive.ts`, `claudePluginSkills.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:997-1191`; voce MCP in `agentGateway/mcpInjection.ts:190-200`.

**Trasporto.** Synara non scrive framing: chiama `query({ prompt, options })` dell'SDK e consuma un iteratore asincrono di `SDKMessage` (`ClaudeAdapter.ts:1918-1928`). La superficie usata è elencata in un'interfaccia locale: `interrupt`, `stopTask`, `backgroundTasks`, `setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `applyFlagSettings`, `getContextUsage`, `supportedCommands`, `supportedModels`, `supportedAgents`, `close` (`:472-489`). Il processo lo avvia l'SDK, ma con lo spawn di Synara via `spawnClaudeCodeProcess`, con `stdio: ["pipe","pipe","inherit"]` e possesso del processo legato al proprietario (`:546-554`, `:5632`). Il protocollo vero è nella sezione Verifiche.

**Controllo di accesso.** Due comandi CLI con timeout di 20 s: `claude --version` e `claude auth status` (`provider/Layers/ProviderHealth.ts:1017`, `:1073`). La lettura dell'output è una funzione pura con quattro regole in ordine (`provider/claudeAuthStatus.ts:61-116`). `claude auth status` può riscattare un refresh token a uso singolo, quindi le chiamate si serializzano con un lock FIFO di processo (`provider/claudeAuthStatusLock.ts:21-47`). Un `loggedIn:false` con exit 0 senza testo di login è un falso negativo strutturato e si recupera con una prova SDK (`ProviderHealth.ts:999`, `:1119-1149`). Versione minima per Auto: `2.1.111` (`provider/claudeCliVersion.ts:4`).

**Catalogo modelli.** `queryRuntime.supportedModels()` mappato da `mapClaudeModelInfo` (`ClaudeAdapter.ts:926-940`). Ordine: cache di modulo, sessione viva, processo `claude` temporaneo (`:6868-6927`). La cache è una sola variabile senza scadenza (`:1948`). Catalogo statico di dieci modelli, predefinito `claude-sonnet-5` (`packages/contracts/src/model.ts:622-691`, `:1140`).

**Opzioni.** `ClaudeModelOptions = { thinking?, effort?, fastMode?, autoCompactWindow?, contextWindow? }` (`packages/contracts/src/model.ts:106-114`); `ClaudeProviderStartOptions = { binaryPath?, permissionMode?, maxThinkingTokens? }` (`packages/contracts/src/orchestration.ts:194-198`). L'oggetto passato a `query()` è tabellato nel file di ricerca: `settingSources: ["user","project","local"]`, `systemPrompt` con preset `claude_code` e `excludeDynamicSections: true`, `includePartialMessages: true`, `forwardSubagentText: true`, `hooks: { SessionStart, PreToolUse }`, `canUseTool`, `mcpServers` (`ClaudeAdapter.ts:5590-5639`). `canUseTool` applica cinque regole in ordine, con `AskUserQuestion` e `ExitPlanMode` come casi a parte (`:5326-5490`).

**Capacità dichiarate.** `sessionModelSwitch: "in-session"`, `conversationRollback: "restart-session"`, skill e plugin no, comandi nativi sì, lista modelli a runtime sì, steering sì, patch del diff dal vivo no (`ClaudeAdapter.ts:6959-6970`). Il composer aggiunge `supportsThreadCompaction: false` e `supportsThreadImport: true` (`:6852-6862`). Metodi propri: `getClaudeCacheObservation`, `startClaudeCompaction` (`provider/Services/ClaudeAdapter.ts:21-29`).

**Ciclo di vita e cursore di ripresa.** Cursore `{ claudeCache?, threadId, resume?, resumeSessionAt?, turnCount, trackedTasks?, processedTokenTotal?, tokenAccountingVersion? }` (`ClaudeAdapter.ts:2190-2202`), con lettura difensiva: `resume` solo se è un UUID, `claudeCache` solo se il suo `nativeSessionId` coincide con `resume` (`:942-997`). Prima di ogni avvio si smonta l'orfano precedente e si ferma la sessione esistente, perché una sostituzione fallita deve essere una sessione ferma (`:5571-5582`). Interruzione con tetto di 10 s (`:6443-6456`). `rollbackThread` fallisce sempre con `ProviderAdapterValidationError` e il messaggio "Claude rollback requires a session restart for thread '<id>'.": il riavvio lo fa `ProviderService`, che possiede anche il bootstrap della trascrizione (`:6524-6532`).

**Iniezione degli strumenti host.** Una voce MCP HTTP con header `Authorization` (`agentGateway/mcpInjection.ts:190-200`), passata in memoria dentro le opzioni, non in un file né in una variabile d'ambiente. La lease si prende prima di `createQuery` e si rilascia su fallimento, fine flusso o stop (`ClaudeAdapter.ts:5585-5589`, `:5673`, `:5922`).

**Eventi d'uso.** Un solo tipo canonico, `thread.token-usage.updated`, emesso da quattro sorgenti (`ClaudeAdapter.ts:2574`, `:3029`, `:3132`, `:3999`). I token di prompt sono `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` (`provider/claudeTokenUsage.ts:90-128`). Il massimo effettivo è `autoCompactThreshold`, poi `maxTokens` (`:208-250`). Tre avvisi fissi: oltre 50.000 token di ingresso non in cache, oltre l'80% del budget, oltre 200.000 token di prompt (`:252-303`).

**Casi limite dai test.** Modalità bypass da `full-access` (`provider/Layers/ClaudeAdapter.test.ts:734`); Auto rifiutata su binario vecchio prima dello start (`:815`); `setPermissionMode` saltato solo al primo turno (`:1287`); `AskUserQuestion` instradata anche in `full-access` (`:10887`); fork rifiutato con un turno in volo (`:11592`); compattazione bloccata con approvazione o domanda in sospeso (`:12112`); `/compactly` non scambiato per compattazione (`:11920`); evidenza di cache persistita attraverso un riavvio (`:12319`).

**In Trama.** `ClaudeClient` implementa il protocollo della sezione 5. La differenza grossa è il trasporto: Trama non ha l'SDK, quindi deve parlare lei il protocollo a messaggi JSON su stdio, e i nomi dei messaggi stanno nella sezione Verifiche. `actor ClaudeSession` per thread possiede processo, coda dei prompt, permessi in sospeso, osservazione della cache e contabilità. Le richieste di controllo diventano metodi `async` con scadenza (1 s per l'uso di contesto, 10 s per l'interruzione). Il lock FIFO di `claude auth status` è la parte più facile da dimenticare. Cursore e funzioni di token e cache si portano quasi riga per riga come funzioni pure.

**Da non portare.** Effect-TS e Node; il pacchetto SDK come dipendenza; la gestione Windows; il keepalive della credenziale (`provider/claudeCredentialKeepalive.ts`), che serve a un server sempre acceso; workflow, plugin e skill dei plugin; la prova SDK dentro il controllo di salute (`ProviderHealth.ts:458-499`).

**Non trovato.** Il protocollo effettivo su stdio non è scritto da nessuna parte in Synara: sta nella sezione Verifiche. `maxTurns`, `plugins`, `appendSystemPrompt`, `strictMcpConfig`, `extraArgs`, `allowedTools` di sessione, `stderr` come callback e `abortController` non compaiono nelle opzioni di sessione. La cache dei modelli non ha scadenza.

### Cursor

Ticket P03. Condivide il runtime ACP della sezione 8.

**Percorsi dei file.** `provider/Layers/CursorAdapter.ts` (1919 righe); `provider/acp/CursorAcpCommand.ts`, `CursorAcpSupport.ts`, `CursorAcpExtension.ts`; `provider/cursorSkillsDiscovery.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1585-1787`. Non esiste un modulo `CursorAcpCliProbe.ts`: la sonda facoltativa contro una CLI reale vive solo nel test `CursorAcpCliProbe.test.ts`, attivo con `SYNARA_CURSOR_ACP_PROBE=1` (`CursorAcpCliProbe.test.ts:23`).

**Trasporto.** `cursor-agent acp` su stdio, con endpoint opzionale da `apiEndpoint` (`provider/acp/CursorAcpCommand.ts:20`; `CursorAcpSupport.ts:88-108`). La risoluzione dell'eseguibile distingue `cursor-agent` dal vecchio `agent` e considera i percorsi di Cursor.app (`CursorAcpCommand.ts:59-68`, `:152-164`). Le sonde forzano l'ambiente headless (`CursorAcpCommand.test.ts:327`).

**Controllo di accesso.** Tre comandi con timeout di 4 s: `--version`, `status`, `models` (`ProviderHealth.ts:1585-1787`). Il parsing è una funzione pura con quattro gruppi di frasi (`:705-767`). `models` senza righe `slug - nome` è un avviso, non un errore (`:1764-1775`). Nessun comando di login separato: `cursor-agent login` è solo suggerito nel messaggio.

**Catalogo modelli.** Prima una sessione ACP usa e getta con `cursor/list_available_models` (`CursorAcpSupport.ts:433`, `:557-574`; `CursorAdapter.ts:1695-1711`), con `source: "cursor.acp"`; ripiego su `cursor-agent models` con `source: "cursor.cli"` (`CursorAdapter.ts:1738-1748`). Entrambe con timeout 15 s, nessuna cache, e una lista vuota è un errore (`:1663-1669`, `:1704-1710`). Ogni modello porta i propri `configOptions`, da cui escono sforzo, finestra, `thinking` e `fast` (`CursorAcpSupport.ts:471-536`). L'id ACP `default` diventa lo slug `auto` (`:437`). Catalogo statico di 33 voci, predefinito `auto` (`packages/contracts/src/model.ts:900-1097`, `:1141`).

**Opzioni.** `CursorModelOptions = { reasoningEffort?, fastMode?, thinking?, contextWindow? }` (`packages/contracts/src/model.ts:132-138`); avvio con `binaryPath` e `apiEndpoint` (`packages/contracts/src/orchestration.ts:204-207`). Cursor accetta id parametrizzati come `modello[context=1m,effort=high,fast=false]`, letti da `parseCursorModelParameters` e riscritti da `buildCursorParameterizedModelSlug` (`CursorAcpSupport.ts:212-245`). Ordine di scrittura delle config option: `fast`, `thinking`, `context`, infine `effort`, perché le varianti fast abbassano lo sforzo (`:995-1004`). La risoluzione degrada invece di abortire: `Resolved`, `Fallback`, `Unavailable` (`:1163-1245`), e dopo un `Fallback` le opzioni richieste non si applicano (`:1358-1364`).

**Capacità dichiarate.** `{ sessionModelSwitch: "in-session", supportsRuntimeModelList: true }` (`CursorAdapter.ts:1888-1891`). Il composer: skill sì, plugin no, comandi nativi no, compattazione no, import della cronologia sì (`:1592-1605`). Le skill si leggono dal filesystem di Cursor (`provider/cursorSkillsDiscovery.ts:18-28`).

**Ciclo di vita e cursore di ripresa.** Cursore `{ schemaVersion: 1, sessionId }`, scartato se la versione è diversa o l'id è vuoto (`CursorAdapter.ts:143`, `:310-315`). Un fallimento di avvio conserva il testo dell'agente e il campo `data` del JSON-RPC invece di passare per la mappatura generica (`:341-359`, `:968-979`). La sessione si registra prima che il replay si chiuda e l'attesa gira fuori dal lock, così uno stop la sblocca (`:1164-1178`). Fork con `session/fork` sulla sessione attiva o su una ripresa temporanea, rifiutato con un turno in corso (`:1773-1873`). Rollback: taglia i turni in memoria, senza cursore nativo (`:1558-1571`).

**Iniezione degli strumenti host.** Voce HTTP `synara` con header `Authorization` se l'agente dichiara `mcpCapabilities.http`, altrimenti voce stdio con il proxy e le due variabili del gateway (`agentGateway/mcpInjection.ts:264-291`). Lease per thread, rilasciata allo stop e all'uscita del processo (`CursorAdapter.ts:720-724`, `:787`).

**Eventi d'uso.** `UsageUpdated` registra il costo cumulativo di sessione e pubblica l'uso token con il turno attivo (`CursorAdapter.ts:272-281`, `:1125-1144`). Il costo resta cumulativo e viene allegato a ogni `turn.completed` (`:283-290`, `:1421-1423`). Ogni evento in arrivo aggiorna l'orologio del watchdog (`:1028-1030`).

**Casi limite dai test.** La politica host consegnata una volta sola per sessione nuova, load o fork (`CursorAdapter.test.ts:11`); niente politica senza connessione (`:21`); mappatura del vecchio `agent` ambiguo su `cursor-agent` (`CursorAcpCommand.test.ts:25`); il modello `auto` mappato sul vecchio `default` (`CursorAcpSupport.test.ts:420`); `fast=true` mantenuto dopo il cambio da Auto (`:590`); nessuna ereditarietà dello sforzo basso attivando fast su Grok (`:1005`); le opzioni richieste non applicate a un modello di ripiego (`:1054`); le opzioni stantie di contesto vengono tolte (`:1330`).

**In Trama.** Cursor è un profilo del client ACP. La risoluzione dell'eseguibile diventa una funzione pura su `URL` provata con un filesystem finto; lo slug parametrizzato diventa un tipo con `init?(rawValue:)` e `description`; `applyCursorAcpModelSelection` diventa una funzione pura che restituisce un `enum Outcome`. L'attore per thread tiene il turno attivo, la mappa `itemId` → turno, le impronte del piano e `sessionConfigReady`.

**Da non portare.** La ricerca dei fratelli Windows e l'avvolgimento PowerShell (`CursorAcpCommand.ts:199-236`); la meccanica Effect di `Layer`, `Scope`, `Deferred`, `Fiber`; i codec `Schema`; il logger NDJSON nativo; `cursor-agent update`.

**Non trovato.** Nessuna cache dei modelli, nessuna compattazione nativa, nessun elenco di comandi o plugin, nessun import di cronologia nonostante `supportsThreadImport: true`, nessun gestore di elicitation, nessun `freshSessionRetry`. `CursorAdapter.test.ts` ha 26 righe e prova solo la politica host: non esiste un test di ciclo di vita completo.

### Antigravity

Ticket P08. Non usa ACP.

**Percorsi dei file.** `provider/Layers/AntigravityAdapter.ts` (2803 righe); `provider/antigravityPrintResult.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1492-1587`; plugin di cattura in `agentGateway/mcpInjection.ts:204-246`; quote in `providerUsage/providers/antigravity.ts`.

**Trasporto.** Un processo `agy` per turno, `stdio: ["ignore","pipe","pipe"]`, senza stdin: il prompt viaggia come argomento `-p` (`AntigravityAdapter.ts:2441-2460`, `:2425-2438`). Il comando è `agy --conversation <id> --dangerously-skip-permissions --model <etichetta> --output-format stream-json --log-file <file> --print-timeout 30m -p <prompt>`. stdout si accumula e passa a un parser incrementale che tiene in sospeso la riga finale incompleta (`antigravityPrintResult.ts:83-93`). Un secondo canale è un file NDJSON di hook, riletto ogni 75 ms (`AntigravityAdapter.ts:77`, `:2486-2488`). Non c'è nessun canale bidirezionale.

**Controllo di accesso.** Solo `agy --version` con timeout di 4 s più `agy models` con timeout di 20 s (`ProviderHealth.ts:1500-1503`, `:1554-1572`). Non esiste un comando di login: l'autenticazione si deduce dal fatto che `agy models` risponda. Versione minima `1.0.12` (`:130`). Un `runtimeMode` diverso da `full-access` fa fallire l'avvio, perché la modalità print non può fermarsi per un'approvazione (`AntigravityAdapter.ts:2200-2207`).

**Catalogo modelli.** `agy models` con timeout di 30 s e `source: "antigravity.cli"` (`AntigravityAdapter.ts:2719-2730`, `:2737-2741`). Il parsing toglie i codici ANSI, taglia sul tab, toglie i prefissi puntati e legge il suffisso fra parentesi come sforzo (`:600-621`); la stessa etichetta unisce gli sforzi in una scala (`:633-666`). Il catalogo statico nei contratti è vuoto di proposito: la lista viene solo dalla CLI (`packages/contracts/src/model.ts:692-694`).

**Opzioni.** `AntigravityModelOptions = { reasoningEffort?: string }` (`packages/contracts/src/model.ts:116-119`); avvio con solo `binaryPath` (`packages/contracts/src/orchestration.ts:200-202`). Modello predefinito `Gemini 3.5 Flash` (`AntigravityAdapter.ts:75`). Precedenza dello sforzo: etichetta, poi opzione richiesta, poi sforzo predefinito scoperto, poi tabella fissa (`:675-679`). Nessuna approvazione interattiva: `respondToRequest` e `respondToUserInput` rispondono `unsupported` (`:2773-2774`).

**Capacità dichiarate.** `sessionModelSwitch: "restart-session"`, `conversationRollback: "restart-session"`, `supportsRuntimeModelList: true`, `supportsLiveTurnDiffPatch: false` (`AntigravityAdapter.ts:2764-2769`). Composer: skill sì, plugin no, comandi nativi no, compattazione no, import no (`:2783-2794`). Il descrittore condiviso dichiara `supportsNativeTurnSteering: false`, `available: true` e `signInCommand: "agy"` (`packages/shared/src/providerMetadata.ts:69-79`). Due comportamenti accompagnano queste capacità: Antigravity è nell'insieme `PROVIDERS_WITH_THREAD_SCOPED_SYNARA_MCP` (`agentGateway/harnessPolicy.ts:73-81`), e `shouldInlineSkillForProvider` restituisce sempre vero per Antigravity, quindi ogni skill invocata viene scritta per esteso nel prompt invece di essere referenziata (`provider/skillPromptInjection.ts:38-42`).

**Ciclo di vita e cursore di ripresa.** Il cursore è l'id di conversazione della CLI, accettato come stringa o come oggetto con `conversationId`, `providerThreadId` o `id` (`AntigravityAdapter.ts:217-225`). L'id si impara dagli hook: alla prima differenza si aggiorna il cursore e si emette un altro `thread.started` (`:1946-1966`). Con un cursore si calcola anche il percorso del transcript sotto `~/.gemini/antigravity-cli/brain/<id>/` (`:227-238`). `rollbackThread` cancella id di conversazione, transcript e cursore (`:2703-2717`).

**Iniezione degli strumenti host.** Un plugin globale installato con `agy plugin install`: quattro file sotto `~/.gemini/antigravity-cli/plugins/synara-capture`, più `mcp_config.json` quando c'è un proxy stdio (`AntigravityAdapter.ts:476-529`; `mcpInjection.ts:228-246`). Il file MCP contiene solo i nomi delle variabili, mai il token: i valori entrano nell'ambiente del singolo processo (`:531-562`). Gli hook sono cinque e devono restare neutri fuori dalle sessioni di Synara (`:269-295`, `:379-392`).

**Eventi d'uso.** Nessuno. Antigravity non emette eventi d'uso dei token e nell'adattatore non esistono campi `usage`, `tokens` o `costUsd`. L'unico dato di consumo è fuori dal turno: le quote dell'abbonamento lette da Cloud Code (`providerUsage/providers/antigravity.ts:1-4`).

**Casi limite dai test.** Un errore terminale vince su una risposta recuperata nel primo turno (`antigravityPrintResult.test.ts:19`); il recupero con stop hook non vale dopo un errore successivo (`:40`); record spezzati fra blocchi e testo prima di una riga incompleta (`:53`); una riga di protocollo malformata non diventa testo legacy (`:133`); errori espliciti di flusso con messaggio vuoto non vengono scartati (`:159`); un'interruzione esplicita resta interrotta e sopprime lo stdout tardivo (`AntigravityAdapter.output.test.ts:143`); il plugin globale resta neutro fuori da Synara (`AntigravityAdapter.test.ts:501`); gli offset avanzano solo oltre record JSONL completi (`:690`).

**In Trama.** Un processo per turno con il prompt negli argomenti. Il parser è un `actor` che accumula `Data` fino a `0x0A`. Gli hook si leggono con un `AsyncStream` alimentato da un `Task` che rilegge il file da un offset. Il plugin di cattura va riscritto: in Trama serve un interprete disponibile al posto di `process.execPath` di Electron. Niente coda di approvazioni e niente contatore di token: la UI deve mostrare il provider come "solo accesso completo" e nascondere l'indicatore di contesto.

**Da non portare.** Effect e le code; il ramo Windows del comando hook con `cmd.exe` e il divieto di virgolette doppie (`AntigravityAdapter.ts:282-292`); `ELECTRON_RUN_AS_NODE`; il limite dei 24.000 caratteri su Windows (`:623-631`); la lettura delle quote OAuth; la macchina dei task in background e delle conversazioni di subagente (`:798-953`).

**Non trovato.** Eventi d'uso dei token; approvazioni interattive; un comando di login; un catalogo statico di ripiego; un trasporto HTTP o SSE.

### Grok

Ticket P04. Condivide il runtime ACP della sezione 8.

**Percorsi dei file.** `provider/Layers/GrokAdapter.ts` (2629 righe); `provider/acp/GrokAcpSupport.ts`, `GrokAcpExtension.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1193-1267`.

**Trasporto.** `grok --permission-mode default agent --no-leader ... stdio` (`GrokAcpSupport.ts:100-130`). In `full-access` si aggiunge `--always-approve`, perché alcune build di Grok negano prima di emettere la richiesta di permesso (`:105-122`). Modello e sforzo sono argomenti di avvio, non config option: cambiarli riavvia il processo (`:226-229`). L'ambiente lascia passare solo `XAI_API_KEY` e `GROK_CODE_XAI_API_KEY` (`:128`). Il client non dichiara capacità proprie; i ganci lato client si registrano dal `_meta` del setup di sessione (`GrokAdapter.ts:1078-1081`).

**Controllo di accesso.** Autenticazione ACP risolta dai metodi annunciati (`GrokAcpSupport.ts:144-191`): `xai.api_key` con una chiave presente, altrimenti `cached_token`, altrimenti un errore con quattro messaggi distinti secondo la situazione (`:157-190`). Lo stato mostrato usa solo `grok --version` con timeout di 4 s (`ProviderHealth.ts:1201-1204`): `authStatus` è `authenticated` con la chiave, `unknown` senza (`:1248-1263`).

**Catalogo modelli.** Prima `grok models` (`GrokAdapter.ts:2397-2421`), con `parseGrokCliModelList` che legge la riga `Default model:` e la sezione `Available models:` (`:473-525`). Ripiego sull'API xAI `GET <base>/language-models` con `Authorization: Bearer`, solo con una chiave e con policy di rete stretta (`:611-654`). La CLI vince perché l'API annuncia ancora slug ritirati (`:562-575`). Nessuna cache. Catalogo statico di una sola voce, `grok-4.6` (`packages/contracts/src/model.ts:695-701`, `:1144`).

**Opzioni.** `GrokModelOptions = { reasoningEffort? }` ristretto a `none`, `low`, `medium`, `high`, `xhigh` (`packages/contracts/src/model.ts:32-33`, `:140-143`); avvio con solo `binaryPath` (`packages/contracts/src/orchestration.ts:209-211`). Uno sforzo non supportato dal modello, o uguale al predefinito, viene scartato (`GrokAdapter.ts:678-692`; `packages/shared/src/model.ts:897-910`). `applyGrokAcpModelSelection` non fa nulla, perché Grok ACP 0.1.210 annuncia i modelli ma non implementa `session/set_config_option` (`GrokAcpSupport.ts:216-229`). La modalità per turno passa da `_meta.mode` su `session/prompt`, scelta idempotente preferita al toggle nativo (`GrokAdapter.ts:255-262`).

**Capacità dichiarate.** `{ sessionModelSwitch: "restart-session" }` (`GrokAdapter.ts:2599-2601`). Composer: skill e plugin no, comandi nativi no, compattazione sì, import no (`:2174-2185`). Metodi: `forkThread`, `respondToUserInput`, `compactThread`, `listModels` (`:2597-2618`).

**Ciclo di vita e cursore di ripresa.** Cursore `{ schemaVersion: 1, sessionId }` (`GrokAdapter.ts:149`, `:441-446`). `freshSessionRetry` ripete una volta `session/new` dopo 100 ms se l'errore è `FS_NOT_FOUND` (`GrokAcpSupport.ts:46-54`). Prima di mandare il prompt una sospensione ricontrolla interruzione e stop, così un turno annullato non viene mai inviato (`GrokAdapter.ts:1876-1889`). Prima di chiudere un turno si attende lo svuotamento della coda di eventi (`:914-920`). Compattazione con `/compact` in modalità agente, e se l'agente annuncia comandi senza `compact` si fallisce con `-32601` (`GrokAcpSupport.ts:70-98`).

**Iniezione degli strumenti host.** Voce HTTP o stdio come per gli altri ACP (`mcpInjection.ts:264-291`), con lease per thread (`GrokAdapter.ts:1017-1021`). La guardia Plan è un hook `PreToolUse` con matcher `*` e id `synara-plan-guard` registrato nel `_meta` di sessione (`GrokAdapter.ts:229-239`); la richiesta `x.ai/hooks/run` passa per una funzione che fuori da Plan, o per strumenti in una lista bianca di 24 nomi di sola lettura, risponde `{}`, altrimenti nega (`:203-228`, `:276-300`).

**Eventi d'uso.** `UsageUpdated` registra il costo e pubblica l'uso token con il turno attivo (`GrokAdapter.ts:1536-1556`). `turn.completed` porta `result.usage` ma non ne deriva un aggiornamento di finestra: `PromptResponse.usage` è spesa cumulativa e usarla farebbe crescere il misuratore a ogni turno (`:1984-2005`). Gli aggiornamenti riconosciuti come compattazione diventano righe `context_compaction` con un id fisso per thread (`:409-415`, `:1421-1459`).

**Casi limite dai test.** Solo gli sforzi supportati dalla famiglia del modello (`GrokAdapter.test.ts:39`); il contesto host privato consegnato una volta (`:62`); Plan nativo idempotente a ogni turno (`:81`) e sostenuto da un hook fail-closed (`:87`); nessun piano inventato da un file di piano vuoto (`:157`); i nomi dei metodi attuali e legacy accettati (`:143`, `:215`); il catalogo vivo della CLI vince sugli slug ritirati dell'API (`:374`); Grok 4.6 usa la scala Extra High e non quella di `grok-build` (`:390`); il processo non riceve l'override di approvazione fuori da Full Access (`GrokAcpSupport.test.ts:98`); la compattazione non chiama un metodo ACP non supportato (`:282`).

**In Trama.** Grok è un profilo ACP. Modello e sforzo stanno in `spawn`, e `capabilities.sessionModelSwitch` è `restartSession`. La guardia Plan è una funzione pura `planHookDecision(mode:payload:)` con la lista bianca come `Set<String>` statico, provata senza processo. La compattazione è un `async` con `withThrowingTaskGroup` e un `Clock` iniettato per le finestre di quiete. La scoperta modelli prova la CLI e, con una chiave, l'API xAI con `URLSession`.

**Da non portare.** Le variabili di debug `SYNARA_GROK_ACP_DEBUG` e `DP_GROK_ACP_DEBUG`; il logger NDJSON nativo e il mirroring dei payload con `grokShell` o `x.ai/fs_notify`; la meccanica Effect di fibre e scope; i codec `Schema`; `applyGrokAcpModelSelection`, che oggi non fa nulla; la politica di rete `outboundHttp` con code e limiti di concorrenza.

**Non trovato.** Nessuna cache dei modelli; nessun comando di login o di stato account, quindi `authStatus: "unauthenticated"` non viene mai prodotto; nessun aggiornamento gestito; nessun file di test per `GrokAcpExtension.ts`; nessuna sonda facoltativa contro una CLI reale; nessuna scoperta di skill, comandi o plugin; nessun `startupTimeouts` proprio.

### Droid

Ticket P05. Condivide il runtime ACP della sezione 8.

**Percorsi dei file.** `provider/Layers/DroidAdapter.ts` (2247 righe); `provider/acp/DroidAcpSupport.ts`, `DroidSessionTeardownGate.ts`, `DroidTurnCancellation.ts`; `provider/FactoryPluginDiscovery.ts`, `FactorySessionHistory.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1269-1345`.

**Trasporto.** `droid exec --output-format acp`, più `--append-system-prompt`, `-m` e `-r` se presenti (`DroidAcpSupport.ts:116-128`). In modalità ACP `droid exec` ignora `-m` e `-r`: modello e sforzo si applicano con `session/set_config_option` (`:182-190`). Il testo aggiunto al prompt di sistema è sempre `DROID_RESOURCE_DISCIPLINE_PROMPT`, che chiede di non sovrapporre build, test e comandi pesanti (`DroidAdapter.ts:164-165`, `:795-807`). Il client dichiara `elicitation: { form: {} }` (`:825`).

**Controllo di accesso.** Autenticazione ACP: `FACTORY_API_KEY` con il metodo `factory-api-key` se disponibile, altrimenti `device-pairing`, altrimenti errore `-32602` (`DroidAcpSupport.ts:62-78`, `:142-161`). `_meta` porta `headless: true` (`:172`). Lo stato mostrato usa solo `droid --version` con timeout di 4 s (`ProviderHealth.ts:1281-1284`): `authenticated` solo con la chiave, altrimenti `unknown` (`:1326-1342`). Nessun `unauthenticated`.

**Catalogo modelli.** Una sessione ACP usa e getta che non entra nell'elenco delle sessioni (`DroidAdapter.ts:448-462`, `:2025-2031`). `discoverDroidAcpModels` cerca l'opzione select con id o categoria `model` (`DroidAcpSupport.ts:295-305`), poi per ogni modello, uno alla volta, imposta il modello e rilegge `reasoning_effort` (`:313-331`), infine ripristina i valori iniziali (`:333-340`). Cache con chiave `binaryPath\0cwd`, 5 minuti, 16 voci (`DroidAdapter.ts:161-163`, `:390-398`). Catalogo statico di 37 voci, predefinito `claude-opus-4-8` (`packages/contracts/src/model.ts:702-889`, `:1145`); l'adattatore non lo importa.

**Opzioni.** `DroidModelOptions = { reasoningEffort?: string }` libero (`packages/contracts/src/model.ts:145-148`); avvio con solo `binaryPath` (`packages/contracts/src/orchestration.ts:213-215`). Applicazione: prima `model`, poi `reasoning_effort` (`DroidAcpSupport.ts:191-213`), all'avvio dopo la riproduzione e di nuovo a ogni turno (`DroidAdapter.ts:1283-1301`, `:1462-1482`). Modalità per turno: piano dà `spec`, `full-access` dà `auto-high`, il resto `normal` (`DroidAcpSupport.ts:57-60`, `:215-234`). `runtimeMode: "auto"` è rifiutato (`DroidAdapter.ts:1452-1458`).

**Capacità dichiarate.** `{ sessionModelSwitch: "restart-session", conversationRollback: "restart-session" }` (`DroidAdapter.ts:2213-2216`). Composer: skill no, comandi nativi sì, plugin sì, compattazione no, import sì (`:1994-2007`). Metodi: `readExternalThread`, `forkThread`, `listCommands`, `listModels`, `listPlugins`, `readPlugin`; manca `compactThread` (`:2217-2235`).

**Ciclo di vita e cursore di ripresa.** Cursore `{ schemaVersion: 1, sessionId }` (`DroidAdapter.ts:140`, `:370-375`). Se si chiedeva una ripresa e il runtime ha creato una sessione nuova, l'avvio fallisce con "Synara refused the fresh fallback" (`:991-998`). La sessione si registra prima della configurazione e i turni attendono `sessionConfigReady` (`:1276-1277`, `:1434-1436`). Interruzione con 5 s di grazia e poi chiusura forzata del processo, perché Factory può confermare prima che i lavori annidati si fermino (`:1764-1782`; `DroidTurnCancellation.ts:7-51`). Piano: lo strumento `Approve Spec` diventa `turn.proposed.completed` e il turno si annulla subito dopo il rifiuto atteso (`:340-360`, `:1149-1188`).

**Iniezione degli strumenti host.** Voce HTTP o stdio come per gli altri ACP (`mcpInjection.ts:264-291`), con lease per thread (`DroidAdapter.ts:765-769`, `:827-836`).

**Eventi d'uso.** `UsageUpdated` registra il costo e pubblica l'uso token solo con un turno attivo (`DroidAdapter.ts:1238-1258`). `turn.completed` porta `result.usage` e il costo del turno (`:1648`, `:1682-1683`). Le righe `Task` diventano `task.started`/`task.completed` con `taskType: "subagent"` (`:513-570`).

**Casi limite dai test.** Il contesto host privato consegnato una volta (`DroidAdapter.test.ts:19`); una `cwd` esplicita preferita a quella della sessione (`:34`); gli id dei segmenti riusati resi unici per turno (`:44`); il rifiuto atteso di `Approve Spec` riconosciuto (`:55`); una cancellazione usata per chiudere un piano catturato trattata come successo (`:78`); l'id dello strumento del provider conservato mentre l'id dell'elemento viene limitato al turno (`:94`); `~/.local/bin/droid` preferito quando esiste (`DroidAcpSupport.test.ts:31`); il modello impostato prima dello sforzo (`:97`); lo sforzo saltato quando non richiesto (`:113`); la porta di chiusura non cancellata da una pulizia vecchia (`DroidSessionTeardownGate.test.ts:37`).

**In Trama.** Droid è un profilo ACP senza un secondo runtime. L'attore per thread tiene il turno attivo, i `Task` annidati, gli id degli strumenti del turno appena chiuso e `sessionConfigReady`. `DroidTeardownGate` e `cancelDroidTurnAndWait` diventano funzioni `async` con `withTaskGroup` e timeout. Catalogo con sessione usa e getta e cache LRU da 16 voci per 5 minuti. `FactorySessionHistory` e `FactoryPluginDiscovery` si portano come lettori di file puri, provabili con cartelle temporanee.

**Da non portare.** Le variabili di debug `SYNARA_DROID_ACP_DEBUG` e `DP_DROID_ACP_DEBUG`; il logger NDJSON nativo e il mirroring dei payload con `droidShell`; la meccanica Effect di fibre e scope; `droid update`.

**Non trovato.** Nessun comando di login o di stato account, quindi `authStatus: "unauthenticated"` non viene mai prodotto; nessuno scarto con avviso delle voci malformate nel catalogo; nessun test di ciclo di vita completo (`DroidAdapter.test.ts` ha 155 righe e solo funzioni pure); nessun comando nativo di compattazione; nessun uso lato server del catalogo statico.

### OpenCode

Ticket P07.

**Percorsi dei file.** `provider/Layers/OpenCodeAdapter.ts` (4598 righe); `provider/opencodeRuntime.ts`, `OpenCodeDiscovery.ts`, `openCodeReasoningOptions.ts`, `openCodeAuthPaths.ts`, `openCodeMessageState.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1348-1413`; voce MCP in `agentGateway/mcpInjection.ts:75-85`.

**Trasporto.** Non è un protocollo su stdio: Synara avvia un server `opencode serve --hostname <h> --port <p>` e ci parla con il client dell'SDK OpenCode via HTTP, con eventi in streaming (`opencodeRuntime.ts:923-940`, `:1307-1315`). Il server è "pronto" quando l'output contiene il marcatore `server listening`, accettato anche nella vecchia forma `opencode server listening` (`:76-80`, `:243-250`). Un server esterno configurato con `serverUrl` è usato così com'è, marcato `external: true` (`:1270-1275`). Un server gestito riceve ora username e password propri (`:926-939`), e la password viene passata al client anche quando il server è interno (`Layers/OpenCodeAdapter.ts:192-198`, `:3405-3417`). Timeout predefinito del server: 20 s (`opencodeRuntime.ts:57`).

**Controllo di accesso.** Solo `opencode --version` con il timeout di salute (`ProviderHealth.ts:1355-1360`). `authStatus` è sempre `unknown` e il messaggio invita a configurare le credenziali dentro OpenCode (`:1399-1409`). Non esiste un comando di login interrogabile.

**Catalogo modelli.** Due fonti: i modelli della CLI e l'inventario del server, con la CLI preferita (`Layers/OpenCodeAdapter.ts:121-122`; `OpenCodeDiscovery.ts:497-535`). Il descrittore porta `variants` e, dalle versioni nuove, `reasoning_options` grezzi (`OpenCodeDiscovery.ts:40-47`). Le opzioni di ragionamento si leggono con `parseOpenCodeReasoningOptions` quando il server non normalizza i `variants`, altrimenti dai `variants` stessi (`:288-330`). Il catalogo statico nei contratti non è vuoto (`packages/contracts/src/model.ts:891`), predefinito `openai/gpt-5` (`:1146`).

**Opzioni.** `OpenCodeModelOptions = { variant?: string; agent?: string }` (`packages/contracts/src/model.ts:121-125`); avvio con `binaryPath`, `serverUrl` e `experimentalWebSockets` (`packages/contracts/src/orchestration.ts:217-222`). La variante è lo sforzo discreto che il selettore di OpenCode sa spedire: è il motivo per cui le voci di tipo toggle e budget vengono ignorate (`openCodeReasoningOptions.ts:25-31`). Le regole di permesso si costruiscono per turno: `full-access` dà `allow` su tutto, altrimenti `ask` su tutto con `allow` sulla sola domanda (`opencodeRuntime.ts:770-783`).

**Capacità dichiarate.** `{ sessionModelSwitch: "in-session", supportsRuntimeModelList: true, supportsNativeSlashCommandDiscovery: true }` (`Layers/OpenCodeAdapter.ts:4563-4567`). Composer: skill e plugin no, comandi nativi sì, compattazione sì, import sì (`:4526-4535`). Metodi: `readExternalThread`, `rollbackThread`, `compactThread`, `forkThread`, `listModels`, `listAgents`, `listCommands`, più `didResumeSession` (`:4568-4584`).

**Ciclo di vita e cursore di ripresa.** Cursore `{ openCodeSessionId, cwd, harnessPolicyDelivery? }` (`Layers/OpenCodeAdapter.ts:956-971`). `didResumeSession` confronta l'id richiesto con quello della sessione e non presume: restituisce vero solo se coincidono (`:4554-4560`). La cartella di ripresa si riprende dal cursore persistito (`:1683` nel test). La politica host si consegna una volta sola e lo stato si conserva nel cursore, così non si ripete a una ripresa (`:984-998`).

**Iniezione degli strumenti host.** Voce MCP `type: "remote"` con header `Authorization` e `oauth: false` (`mcpInjection.ts:75-85`), passata nella configurazione del server o della sessione (`Layers/OpenCodeAdapter.ts:215`). La lease si prende per sessione, si revoca una volta sola e si revoca anche all'uscita inattesa del server (`:1517`, `:1554` nel test). Le sessioni gestite con la stessa `cwd` restano isolate e ricevono token distinti (`:1132` nel test); un server esterno condiviso resta senza token installato (`:1196`).

**Eventi d'uso.** `normalizeOpenCodeTokenUsage` converte l'uso dell'assistente in un'istantanea di contesto (`Layers/OpenCodeAdapter.ts:1130-1165`), con i token usati limitati al massimo del modello e `totalProcessedTokens` conservato (`:525` nel test). L'evento `thread.token-usage.updated` parte da tre punti (`:1846`, `:2170`, `:2873`). Uso mancante, malformato, negativo, infinito o tutto a zero dà `undefined` (`:486` nel test).

**Casi limite dai test.** La password del server gestito arriva al client SDK (`OpenCodeAdapter.test.ts:551`); la politica host si inietta una volta sola per sessione nuova (`:568`), non si ripete a un riavvio della stessa sessione nativa (`:609`), si ritenta se il primo prompt è rifiutato (`:654`) e si reinietta se la versione della politica è vecchia (`:715`); i modelli si leggono dalla CLI prima di ripiegare sull'inventario del server (`:866`, `:948`); un server esterno non riceve token (`:1196`); l'installazione MCP bloccata viene annullata e la sessione parte con il gateway dichiarato non disponibile (`:1423`); i turni passano dall'endpoint asincrono di prompt (`:1475`); i permessi di ripresa sono fail-closed e Full Access si ripristina al turno nuovo (`:1748`); se i permessi Plan non si applicano si fallisce e si annulla (`:1793`).

**In Trama.** OpenCode è l'unico provider, oltre a Codex e Claude, che non passa da ACP. La differenza è che il suo confine è un server HTTP locale con un SDK, non un processo con un protocollo a righe. In Swift: un `Process` che avvia `opencode serve`, una lettura dell'output per il marcatore di prontezza, un client HTTP verso l'URL annunciato, e un `AsyncStream` di eventi. Il cursore porta la `cwd` perché una sessione OpenCode è legata alla cartella. Le regole di permesso per turno si costruiscono come dati e si mandano nella richiesta.

**Da non portare.** La meccanica Effect e i pool di server; `ELECTRON_RUN_AS_NODE` e il proxy stdio; le variabili di debug; i codec `Schema`.

**Non trovato.** Nessuna cache dei modelli nel codice dell'adattatore oltre la cache comune del servizio; nessun comando di login o di stato account; nessuna versione minima dichiarata per OpenCode; nessun aggiornamento gestito.

### Pi

Ticket P09.

**Percorsi dei file.** `provider/Layers/PiAdapter.ts` (3290 righe); `provider/piOpenCodeCatalog.ts`, `OpenRouterDiscovery.ts`, `piTurnFailure.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1417-1491`.

**Trasporto.** Synara importa l'SDK come libreria e non avvia nessun processo Pi per la conversazione: `@earendil-works/pi-coding-agent` `^0.85.1`, `@earendil-works/pi-agent-core` `^0.85.1`, `@earendil-works/pi-ai` `^0.85.1` (`apps/server/package.json:32-34`). Usa `ModelRuntime.create`, `SessionManager.open`/`create`, `createAgentSessionServices`, `createAgentSessionRuntime`, `defineTool` (`PiAdapter.ts:1265`, `:2521-2523`, `:2453`, `:2497`, `:2483`). Sulla sessione usa `prompt`, `followUp`, `steer`, `abort`, `clearQueue`, `abortRetry`, `setModel`, `setThinkingLevel`, `reload`, `compact`, `subscribe`, `getSessionStats` (`:1865-1874`, `:1964`, `:1979`, `:2083-2084`, `:2109`, `:1939`, `:1950`, `:2005`, `:3054`, `:2658`, `:1745`). L'unico processo figlio è la shell dello strumento `bash` (`:211-346`).

**Controllo di accesso.** Solo `pi --version`, senza importare l'SDK (`ProviderHealth.ts:1419-1434`). `available` è sempre vero e `authStatus` sempre `unknown`: la CLI mancante dà solo un avviso, perché l'SDK è incluso (`:1434-1447`). Synara non verifica le credenziali: le gestisce Pi nel file `auth.json` della cartella agente (`PiAdapter.ts:1265-1268`).

**Catalogo modelli.** `listModels` crea un `ModelRuntime` nuovo, aggiorna il catalogo OpenCode, aggiorna OpenRouter e legge il registro (`PiAdapter.ts:3070-3091`); `source` è `"pi.sdk+extensions"` o `"pi.sdk"` (`:3093-3097`). OpenCode scarica due URL in parallelo con timeout di 5 s e tiene il risultato per 60 s (`piOpenCodeCatalog.ts:6-8`, `:92-123`); OpenRouter scarica `GET https://openrouter.ai/api/v1/models` con timeout di 5 s e filtra su testo, `tools`, contesto e prezzi validi (`OpenRouterDiscovery.ts:23-39`, `:63-93`). Nel contratto Pi non ha modelli statici: la scoperta possiede il catalogo vivo (`packages/contracts/src/model.ts:898-899`).

**Opzioni.** `PiModelOptions = { thinkingLevel? }` con sette livelli, `off` … `max` (`packages/contracts/src/model.ts:20-29`, `:127-130`); predefinito `medium` (`PiAdapter.ts:100`). Avvio con `binaryPath` e `agentDir` (`packages/contracts/src/orchestration.ts:223-226`). I livelli per modello dipendono da `thinkingLevelMap`: un livello mappato a `null` è escluso, e `xhigh` e `max` compaiono solo se mappati (`:115-121`, `:553-585`). Cambio di modello a sessione aperta con `setModel` e poi `setThinkingLevel` (`:1928-1952`).

**Capacità dichiarate.** `sessionModelSwitch: "in-session"`, skill sì, plugin no, comandi nativi sì, lista modelli a runtime sì, steering sì (`PiAdapter.ts:3255-3264`). Composer con `supportsThreadCompaction: true` e `supportsThreadImport: false` (`:3227-3238`). `respondToRequest` fallisce sempre: Synara non aggiunge permessi né modalità piano a Pi (`:2944-2951`).

**Ciclo di vita e cursore di ripresa.** Il cursore è il percorso del file di sessione (`PiAdapter.ts:780-782`), accettato come stringa o come oggetto con `sessionFile`, `sessionFilePath`, `nativeHandle` o `path` (`:763-778`). L'avvio apre il file con `SessionManager.open(file, undefined, cwd)` o ne crea uno con `SessionManager.create(cwd)` (`:2521-2523`). Un invio durante un turno attivo si accoda con `followUp` e restituisce lo stesso `turnId` invece di fallire (`:2828-2838`); i tre rifiuti espliciti sono l'interruzione in attesa, il testo `/reload` e un'esecuzione non avviata da Synara (`:1921-1926`, `:2833-2842`). La compattazione per overflow tiene il turno aperto finché `prompt` non si risolve (`:2372-2402`).

**Iniezione degli strumenti host.** Pi non ha MCP nativo. Synara prende una lease, legge il catalogo con `tools/list` e trasforma ogni strumento in un `ToolDefinition` con `defineTool`; l'esecuzione chiama `tools/call` sul gateway e inoltra l'annullamento (`PiAdapter.ts:484-519`; `agentGateway/mcpInjection.ts:144-188`). Gli strumenti entrano in `customTools` accanto allo `bash` supervisionato (`:2482-2491`). Un catalogo vuoto è un errore e un'installazione fallita lascia la sessione senza strumenti con un avviso (`:498-500`, `:2546-2583`).

**Eventi d'uso.** `normalizeTokenUsage` legge `getSessionStats()` e compone finestra e token usati (`PiAdapter.ts:801-856`); se tutto è zero e non c'è finestra non emette nulla (`:833-842`). Gli eventi grezzi hanno `source: "pi.sdk.event"` (`packages/contracts/src/providerRuntime.ts:33`). Mappatura: `agent_start`, `turn_start`, `text_delta`, `thinking_delta`, `tool_execution_*`, `auto_retry_start` (`PiAdapter.ts:2146-2432`).

**Casi limite dai test.** Schemi MCP canonici e token distinti per thread con la stessa `cwd` (`PiAdapter.test.ts:31`); annullamento di uno strumento Pi inoltrato alla richiesta MCP in corso (`:100`); comando interrotto tenuto in sospeso finché l'uscita dell'albero non è provata (`:150`); `xhigh` e `max` dichiarati solo se il modello concreto li supporta (`:515`); un turno tenuto attraverso un tentativo vero dell'SDK (`PiAdapter.lifecycle.test.ts:415`); steering durante il backoff dentro lo stesso turno logico (`:533`); invio accodato come follow-up invece di errore (`:557`); turno tenuto vivo attraverso la compattazione per overflow (`:774`).

**In Trama.** Il trasporto dipende dalla verifica: vedi la sezione Verifiche. Trama non può caricare librerie TypeScript, ma Pi offre un confine di processo documentato con `pi --mode rpc` su stdin/stdout a JSONL, che copre prompt, steering, follow-up, abort, modello, livelli di thinking, compattazione, fork, lettura dei turni e statistiche. Il cursore resta il percorso del file di sessione. L'iniezione degli strumenti host richiede un'estensione Pi, perché Pi non ha MCP nativo.

**Da non portare.** Il caricamento pigro del modulo e la nota sul modulo nativo degli appunti (`PiAdapter.ts:348-353`); il supervisore della shell `bash` (`:211-346`) e il ponte UI delle estensioni con il tema senza colori, se Pi gira fuori da Trama; i modelli Anthropic garantiti con prezzi scritti a mano (`:122-181`); la serializzazione Effect e il registro NDJSON.

**Non trovato.** Cache di 60 secondi per OpenRouter: esiste solo per il catalogo OpenCode. Avviso per voci di catalogo malformate: si scartano in silenzio. Percorso predefinito dei file di sessione e della cartella agente: li decide l'SDK. Controllo di autenticazione: `authStatus` è sempre `unknown`. Richieste di approvazione: nessun evento `request.opened` nasce in `PiAdapter.ts`. Canale nativo verso altre app: era fuori da quella ricerca, è nella sezione Verifiche.

### Devin

Ticket P06. Condivide il runtime ACP della sezione 8.

**Percorsi dei file.** `provider/Layers/DevinAdapter.ts` (3466 righe); `provider/acp/DevinAcpSupport.ts`, `DevinSessionConfig.ts`; controllo di accesso in `provider/Layers/ProviderHealth.ts:1789-1869`; nomi e variabili riusate in `agentGateway/mcpInjection.ts:24-27`.

**Trasporto.** `devin acp`, più `--model <uid>` se il modello risolto non è vuoto; il `runtimeMode` non produce nessun flag, perché i permessi passano da `session/request_permission` (`DevinAcpSupport.ts:332-345`). L'ambiente concede solo `DEVIN_API_KEY` e `WINDSURF_API_KEY`, e la variante minuscola `windsurf_api_key` viene normalizzata (`:347-357`; `providerChildEnvironment.ts:60`). Devin è l'unico provider che usa `normalizeIncomingMessage`: `normalizeDevinGetOutputToolCall` toglie il campo booleano `block` dagli argomenti delle richieste `get_output` (`:69-95`).

**Controllo di accesso.** `authPolicy: "on-demand"`: prima il setup, e solo se fallisce con un errore di autenticazione si chiama `authenticate` (`DevinAcpSupport.ts:440`). `validateInitializeResult` risolve subito dopo `initialize`, così un agente senza metodi headless fallisce prima di creare la sessione (`:443-446`). La risoluzione del metodo ha sei passi, compreso il caso in cui l'agente annuncia solo `devin-browser` e si usa comunque `windsurf-api-key` (`:373-418`). `validateDevinApiServerUrl` accetta solo HTTPS o HTTP su loopback (`:247-275`). Lo stato mostrato usa solo `devin --version` con timeout di 4 s (`ProviderHealth.ts:1800-1803`); `authenticated` con una chiave in ambiente o nel file, altrimenti `unknown`.

**Catalogo modelli.** `devin models list --format json` come processo separato (`DevinAdapter.ts:1396-1402`). Il parser prova prima l'output intero, poi la sottostringa fra la prima parentesi e l'ultima chiusura, togliendo il BOM (`:873-897`). Le famiglie con `variants` non si riattraversano sulle varianti, per non perdere la matrice degli sforzi (`:825-887`). Gli sforzi, la modalità veloce e il toggle di pensiero si inferiscono dai nomi delle varianti (`:973-1060`). Cache con chiave il percorso del binario, 5 minuti, 16 voci; i risultati con `error` non si mettono in cache (`:689-733`). Catalogo statico di tre voci, predefinito `adaptive` (`packages/contracts/src/model.ts:1101-1129`, `:1142`), e l'adattatore lo importa davvero (`DevinAdapter.ts:1063-1080`).

**Opzioni.** `DevinModelOptions = { reasoningEffort?, fastMode?, thinking?, contextWindow?, modelVariant? }` (`packages/contracts/src/model.ts:150-160`); avvio con solo `binaryPath` (`packages/contracts/src/orchestration.ts:228-230`). La sessione proiettata tiene lo slug della famiglia, non lo UID concreto, per non far riavviare Devin a ogni turno (`DevinAdapter.ts:2071-2076`). La modalità si risolve per alias, con corrispondenza esatta per il piano e per parola intera per gli altri (`:556-586`), e dopo `setMode` la modalità si rilegge: se non è quella chiesta il turno fallisce (`:591-646`).

**Capacità dichiarate.** `{ sessionModelSwitch: "restart-session", conversationRollback: "restart-session", supportsRuntimeModelList: true }` (`DevinAdapter.ts:3434-3438`). Composer: skill e plugin no, comandi nativi sì, compattazione sì, import no (`:3111-3122`). Metodi: `listCommands`, `compactThread`, `listModels` (`:3448-3452`).

**Ciclo di vita e cursore di ripresa.** Cursore `{ schemaVersion: 1, sessionId }` (`DevinAdapter.ts:160`, `:482-495`). Se si chiedeva una ripresa e l'agente risponde esattamente "failed to load session data", l'errore diventa `ProviderAdapterProcessError` con `reason: "resume-state-unavailable"` (`:2040-2053`). Dopo `session/load` la soppressione del replay dura finché lo stream non è quieto per 200 ms, l'avvio si sblocca dopo 1,5 s e il tetto di 30 s scrive un avviso (`:1699-1730`, `:2366-2375`). Un fallimento del prompt chiude sempre la sessione, perché il figlio ACP resta inutilizzabile (`:2858-2862`). Rollback sempre rifiutato: "Devin does not support conversation rollback." (`:3078-3086`).

**Iniezione degli strumenti host.** Devin non usa `buildAcpSynaraMcpServers` e non mette `mcpServers` in `session/new`: il gateway arriva da un file di configurazione. `createDevinSessionConfig` crea una radice temporanea `synara-devin-` con permessi `0700`, vi ricollega con symlink le cartelle `skills` e scrive `devin/mcp_config.json` con modo `0o600` e `flag: "wx"` (`DevinSessionConfig.ts:79-130`). La voce `synara` è stdio con il proxy e le due variabili più `ELECTRON_RUN_AS_NODE` (`:110-125`); nel file non finisce mai il bearer di sessione, solo il gettone monouso. Il figlio riceve `XDG_CONFIG_HOME` puntato alla radice temporanea (`:134-137`).

**Eventi d'uso.** `UsageUpdated` registra il costo e pubblica l'uso token solo con un turno attivo e fuori dal replay (`DevinAdapter.ts:2306-2326`). Un `ToolCallUpdated` già mappato su un turno precedente resta su quel turno, e la provenienza si pota a un turno indietro (`:1218-1246`, `:2216-2242`). Un timeout di inattività emette `turn.completed` `failed`, forka `session/cancel` senza attenderlo e interrompe la fibra del prompt (`:2413-2462`).

**Casi limite dai test.** Zero trattato come disattivazione esplicita (`DevinAdapter.test.ts:326`); il segnale di stallo scatta per lo spawn più vecchio non ancora pronto (`:372`); i recuperi fuori dalla finestra scorrevole si dimenticano (`:407`); un blocco di spawn si recupera quando un comando non arriva mai a shell-ready (`:492`); esaurito il budget del thread il turno fallisce invece di recuperare (`:554`); l'annullamento della persona vince su un recupero in corso (`:704`); nessuna sessione lasciata se il riavvio di recupero fallisce (`:755`); un invio sovrapposto viene rifiutato senza sostituire il turno attivo (`:822`); aggiornamenti di strumenti di un turno precedente non rinfrescano il turno corrente (`:909`); la modalità fallisce chiusa quando Plan non è disponibile (`:1106`); le corrispondenze parziali ambigue si rifiutano (`:1178`).

**In Trama.** Devin è un profilo ACP con due pezzi propri: la configurazione MCP su disco e il supervisore dei blocchi. `DevinSessionConfig` diventa un tipo con pulizia esplicita (cartella `0o700`, JSON con `O_EXCL` e `0o600`, `XDG_CONFIG_HOME` nel figlio, symlink con `FileManager.createSymbolicLink`). `parseDevinCredentialsToml` e `validateDevinApiServerUrl` sono funzioni pure. Il recupero dai blocchi: `evaluateDevinWedgeSignal` resta puro, il supervisore è un `Task` con un `Clock` iniettato, il tap su stderr è un `AsyncStream<String>` di righe.

**Da non portare.** Le variabili di debug `SYNARA_DEVIN_ACP_DEBUG` e `DP_DEVIN_ACP_DEBUG`; il logger NDJSON nativo; i rami Windows (`devin.exe` sotto LocalAppData, `%APPDATA%`, junction al posto dei symlink); la meccanica Effect di fibre e scope.

**Non trovato.** Nessun uso di `buildMcpServers` per Devin; nessun fork nativo, nessun `readExternalThread`, nessun `listPlugins`; nessuna chiamata a `setModel` o `setConfigOption`; nessun aggiornamento gestito; nessun `authStatus: "unauthenticated"`; `DEVIN_WEDGE_SUPERVISOR_INTERVAL_MS` non è una variabile d'ambiente ma una costante fissa a 5000 ms (`DevinAdapter.ts:181`).

## 8. Runtime ACP condiviso

Ticket P03, usato anche da P04, P05 e P06. Cursor, Grok, Droid e Devin parlano tutti lo stesso protocollo e condividono un solo runtime.

### Dove sta in Synara

Tutto in `apps/server/src/provider/acp/`. La libreria è `@agentclientprotocol/sdk` fissata alla versione esatta `1.2.1` (`apps/server/package.json:29`), caricata in modo pigro alla prima sessione (`AcpSdk.ts:10-19`).

| File | Ruolo |
| --- | --- |
| `AcpSessionRuntime.ts` | Processo figlio, connessione JSON-RPC, avvio, stato di sessione, flusso eventi (2615 righe) |
| `AcpRuntimeModel.ts` | Parser puro di `session/update` e delle richieste di permesso |
| `AcpCoreRuntimeEvents.ts` | Costruttori degli eventi normalizzati |
| `AcpNotificationDispatcher.ts` | Coda limitata delle notifiche prima dei gestori |
| `AcpLoadReplayGate.ts` | Soppressione del replay dopo `session/load` |
| `AcpTurnIdleWatchdog.ts` | Watchdog di inattività del turno |
| `AcpElicitationSupport.ts` | Da form di elicitation a domande della UI e ritorno |
| `acpFork.ts` | `forkViaAcpRuntime`, fork nativo con controlli |
| `AcpAdapterSupport.ts`, `AcpAdapterSessionSupport.ts` | Errori, scelta delle opzioni di permesso, esito del turno, contabilità di sessione |
| `AcpErrors.ts`, `AcpExtensions.ts` | Errori tipizzati e codec delle config option |
| `AcpNativeLogging.ts` | Log NDJSON nativi con redazione dei segreti |

Non esiste un file `AcpJsonRpcConnection.ts`: la connessione vive in `makeOfficialSdkClient` (`AcpSessionRuntime.ts:600-925`) e il nome sopravvive solo nel test `AcpJsonRpcConnection.test.ts`.

### Connessione

- Avvio: `spawner.spawn(...)` con `cwd` ed `env` (`AcpSessionRuntime.ts:1454-1470`). L'ambiente è un insieme esatto e non viene fuso con `process.env` (`:1447-1453`). Un errore diventa `AcpSpawnError`.
- Chiusura: un finalizzatore chiama `teardownAcpChildProcess`, che fallisce come difetto se non prova la morte dell'albero (`:571-585`). stderr si legge sempre, anche senza consumatore, perché una pipe non letta blocca il figlio (`:172-199`).
- Code: `ndJsonStream` più `clientApp.connect`, creati alla prima richiesta (`:788-792`). Un JSON per riga, con limite di 8 MiB per riga contato fra un `\n` e l'altro anche su blocchi spezzati (`:53`, `:262-288`). Coda in uscita di 256 blocchi, in entrata di 64 frame (`:684-694`, `:50`).
- Ogni richiesta porta un `cancellationSignal`: interrompere la fibra annulla la richiesta con `$/cancel_request` (`:800-822`).
- Errori: `RequestError` diventa `AcpRequestError` con `code`, `message`, `data`; il resto `AcpTransportError` (`:587-598`).

Metodi agente usati (`:841-876`): `initialize`, `authenticate`, `session/new`, `session/resume`, `session/load`, `session/prompt`, `session/cancel` come notifica, `session/set_config_option`, `session/fork`, `session/close` sulla sola sessione sonda scartata, più `request` e `notify` per metodi arbitrari come `cursor/list_available_models`. `session/set_mode` e `session/set_model` non vengono mai inviati: modalità e modello passano da `session/set_config_option`.

Metodi client registrati (`:742-778`): `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`, `elicitation/create` come richieste; `session/update` ed `elicitation/complete` come notifiche. Senza gestore la risposta è `methodNotFound`. Le capacità client dichiarano `fs.readTextFile` e `fs.writeTextFile` a `false`, `terminal` a `false`, più `auth`, `elicitation` e `_meta` solo se l'adattatore li passa (`:1566-1578`); nessuno dei quattro adattatori registra `fs/*` o `terminal/*`.

### Sessione

Avvio in `startOnce` (`:1759-2046`): `initialize` con validazione opzionale, scelta dei server MCP in base alle capacità dichiarate, poi autenticazione e setup secondo `authPolicy`. Con `"always"` (predefinito) si autentica prima; con `"on-demand"` si prova prima il setup e si autentica solo se l'errore è di autenticazione verificato (`:2006-2015`). Il setup preferisce `session/resume`, poi `session/load`, e un fallimento è terminale: non ricade su `session/new`, per non creare una seconda conversazione (`:1869-1918`).

Timeout di avvio (`:80-85`): `initialize` 20 s, `authenticate` 30 s, setup 20 s, totale 60 s, volutamente minore della somma. Lo scadere produce un `AcpRequestError` con codice `-32001` e `data.reason = "acp-startup-timeout"`. `start()` è idempotente: le chiamate concorrenti attendono lo stesso `Deferred` (`:2052-2079`).

Ogni sostituzione di sessione incrementa una generazione, e ogni scrittura di stato ricontrolla l'epoca, così un gestore in ritardo non tocca la sessione nuova (`:243-260`). Prima che l'id sia noto le notifiche restano in un buffer limitato a 512 per sessione e 2048 in totale (`:55-56`, `:1201-1237`).

### Eventi

`processSessionUpdate` riceve ogni `session/update` e `parseSessionUpdateEvent` lo traduce in un evento interno (`:2345-2469`; `AcpRuntimeModel.ts:620-725`). La tabella completa è nel file di ricerca `acp.md`; in breve: `agent_message_chunk` e `agent_thought_chunk` diventano `content.delta` con `assistant_text` e `reasoning_text`; `tool_call` e `tool_call_update` diventano `item.started`/`item.updated`/`item.completed`; `plan` diventa `turn.tasks.updated`; `usage_update` diventa `thread.token-usage.updated` con `compactsAutomatically: true`; `current_mode_update` aggiorna lo stato; `available_commands_update` e `config_option_update` non producono eventi.

I segmenti del messaggio li sintetizza il runtime: un tool call chiude il segmento aperto, il testo successivo ne apre uno nuovo con id `assistant:<sessionId>:<runtimeInstanceId>:segment:<n>`, e un `messageId` dell'agente vince sul sintetico (`:1137-1139`, `:2503-2615`). Il ragionamento non apre segmenti.

Lo stato di un tool call si fonde per `toolCallId` e si scarta a `completed` o `failed` (`AcpRuntimeModel.ts:565-591`; `AcpSessionRuntime.ts:2418-2428`). Un aggiornamento esce solo se cambia stato, titolo o dettaglio, o se è terminale. Il titolo generico viene sostituito da un titolo d'azione (`AcpRuntimeModel.ts:319-334`). I tipi canonici sono in `AcpAdapterSupport.ts:25-41`: `agent` diventa `collab_agent_tool_call`, `execute` `command_execution`, `edit`/`delete`/`move` `file_change`, `fetch` `web_search`, il resto `dynamic_tool_call`.

### Modelli e modalità

L'id del modello è la prima config option con `category === "model"` (`AcpRuntimeModel.ts:105-114`); `setModel` fallisce con `-32602` se manca. `setMode` cerca una option `select` con categoria o id `mode` che contenga il valore (`AcpSessionRuntime.ts:2174-2196`). `setConfigOption` attende il gate di replay, valida il valore e salta la scrittura se è già corrente (`:1591-1638`, `:1691-1737`). Se l'agente risponde `{}`, il runtime aspetta fino a 5 s una `config_option_update` con il valore chiesto (`:1648-1684`). La modalità per turno si risolve per alias: Plan con `plan`, approvazione con `approval`, poi `implement`, poi la prima non Plan, poi la corrente (`AcpAdapterSessionSupport.ts:22-102`); un turno senza modalità vale `default`, mai Plan ereditato.

### Watchdog di inattività

`evaluateAcpTurnIdleTick` è una funzione pura (`AcpTurnIdleWatchdog.ts:75-88`): `stop` se il turno non è più attivo, `touch` se si attende una persona, `timeout` se l'inattività supera la soglia, altrimenti `continue`. Contano come progresso solo `ContentDelta`, `ToolCallUpdated`, `PlanUpdated`, `AssistantItemStarted`, `AssistantItemCompleted`; modalità, comandi e uso no (`:24-41`). Le soglie dei quattro provider sono tabellate nel file `acp.md`: Cursor e Grok 600 s, Droid 600 s che diventano 3600 s con un task annidato attivo, Devin 30 min che diventano 60 con uno strumento attivo. Tutte sovrascrivibili da variabile d'ambiente, con i valori vuoti, non numerici o non positivi che ricadono sul default (`:90-106`).

### Elicitation e permessi

Permessi ed elicitation arrivati durante l'avvio restano in coda (massimo 256) finché l'adattatore non registra il gestore; in caso di fallimento o nuova generazione la risposta sicura è `{ outcome: "cancelled" }` per i permessi e `{ action: "decline" }` per le elicitation (`AcpSessionRuntime.ts:938-1114`). `selectAcpPermissionOptionId` sceglie l'`optionId` reale: `acceptForSession` preferisce `allow_always`, `accept` preferisce `allow_once`, il rifiuto `reject_once` (`AcpAdapterSupport.ts:97-119`). `resolveAcpPermissionPolicy` in Plan rifiuta sempre, senza turno attivo annulla, in `full-access` accetta senza chiedere, altrimenti chiede alla persona (`:139-164`). Le elicitation sono solo `mode: "form"` con schema oggetto: ogni proprietà diventa una domanda e le risposte tornano al tipo nativo (`AcpElicitationSupport.ts:25-146`).

### Fork e replay al caricamento

`forkViaAcpRuntime` fallisce se l'agente non dichiara `sessionCapabilities.fork` o non sa riaprire una sessione; il chiamante allora ricostruisce il fork dalla trascrizione di Synara (`acpFork.ts:20-57`).

Dopo `session/load` l'agente può riprodurre tutta la trascrizione. Il gate ha quiete 350 ms e tetto 30 s (`AcpSessionRuntime.ts:51-52`, `:1965-1984`) e i suoi orologi partono solo quando un consumatore si collega (`AcpLoadReplayGate.ts:149-170`). `session/resume` non attiva il gate. Durante la soppressione gli eventi di trascrizione non escono, ma comandi, config option e modalità sì (`AcpSessionRuntime.ts:1555-1557`).

### Traduzione proposta in Swift

- `actor ACPConnection` possiede un `Process` con tre `Pipe`. Legge stdout in un `Task` che accumula byte fino a `\n`, applica il limite di 8 MiB per riga e smista richieste, risposte e notifiche. stderr si legge sempre, anche senza consumatore.
- Codifica con `Codable`: `enum JSONRPCMessage { case request(id, method, params), response(id, result|error), notification(method, params) }`, un `JSONEncoder` per riga. Le risposte in attesa stanno in `[JSONRPCID: CheckedContinuation]`; l'annullamento del `Task` manda `$/cancel_request` e chiude la continuation.
- API dell'actor come in `AcpSessionRuntimeShape`: `start() async throws`, `prompt`, `cancel`, `setMode`, `setModel`, `setConfigOption`, `forkSession`, `request(method:params:)`, `notify`. `start` idempotente con un `Task` condiviso e i tre timeout più il totale.
- `events: AsyncStream<ACPSessionEvent>` con `bufferingPolicy: .bufferingNewest(2048)`. Il parser di `session/update` è una funzione pura, provata con gli stessi JSON di esempio dei test di Synara.
- L'epoca di sessione è un `UInt64` dentro l'actor, ricontrollato dopo ogni `await` per la rientranza degli actor.
- Il gate di replay e il watchdog sono tipi a parte con un `Clock` iniettato (`ContinuousClock` in produzione, un orologio di test nei test), così i 350 ms, i 30 s e i 15 s si provano senza attese reali.
- `protocol ACPTransport { func send(_ line: Data) async throws; var lines: AsyncThrowingStream<Data, Error> { get } }`, con `ProcessTransport` e `InMemoryTransport`. Il secondo sostituisce `acp-mock-agent.ts` e permette di scrivere le sequenze dei casi limite.
- `protocol ACPProviderExtension { var spawn: ACPSpawn; var clientCapabilities: ClientCapabilities; func resolveAuthMethod(_: InitializeResult) throws -> String?; var authPolicy: ACPAuthPolicy; var sessionMeta: JSONObject?; func normalizeIncoming(_: JSONValue) -> JSONValue; func register(on: ACPConnection) async }`, con implementazioni di default vuote. Cursor, Grok, Droid e Devin implementano solo quello che serve.
- `ACPError` come enum `spawn`, `transport`, `request(code:message:data:)`, con `isAuthRequired` e `isStartupTimeout`. La redazione dei log diventa una funzione pura su `JSONValue` con gli stessi test.

### Casi limite dai test

- `AcpJsonRpcConnection.test.ts:31` (le capacità client personalizzate si fondono e fs e terminal restano `false`); `:116` (un fallimento di setup ripetibile si ritenta una volta); `:259` (il replay tardivo si sopprime prima di un primo prompt immediato); `:563` (si preferisce `session/resume` quando l'agente lo annuncia); `:678` (un cursore di fork si rifiuta se l'agente non sa riaprire sessioni); `:921` (il testo si segmenta attorno ai tool call); `:1173` (le scritture di configurazione che non cambiano nulla si saltano); `:1255` (i valori di config option non validi si rifiutano prima di inviare).
- `AcpSessionRuntime.test.ts:142` (limite di frame su blocchi spezzati, azzerato a ogni newline); `:441` (un dispatch di una generazione precedente riceve la risposta predefinita); `:512` (i dispatch si rifiutano quando il buffer è esaurito); `:544` (una menzione di api-key non è una richiesta di autenticazione); `:780` (timeout di `initialize`, `authenticate` e setup con chiusura del figlio).
- `AcpLoadReplayGate.test.ts:67` (gli orologi partono solo quando il consumatore si collega); `:92` (tutti gli attendenti si liberano se l'avvio fallisce).
- `AcpTurnIdleWatchdog.test.ts:19` (heartbeat e tag sconosciuti non sono progresso); `:94` (un override non positivo non disattiva la rete di sicurezza).
- `AcpAdapterSupport.test.ts:68` (Plan resta sopra Full Access e il gate si libera per il turno predefinito successivo); `:132` (un turno annullato dal provider con strumenti falliti è fallito).
- `AcpAdapterSessionSupport.test.ts:94` (Plan non si eredita quando il turno successivo omette la modalità); `:289` (l'attesa è limitata, così un consumatore fermo non blocca la chiusura).
- `AcpNotificationDispatcher.test.ts:5` (l'overflow si rifiuta per byte o per numero e un arretrato fermo si libera).

### In Trama

Vedi la traduzione qui sopra. Le tre cose da non sbagliare: il framing è per riga con il limite di 8 MiB, il replay dopo `session/load` va soppresso finché lo stream non è quieto, e un fallimento di setup su una ripresa non deve mai ricadere su una sessione nuova.

### Da non portare

Effect e le sue code; il caricamento pigro dell'SDK; la traduzione fra `ReadableStream` e `Stream` di Effect; i codec `Schema` e i controlli di compatibilità dei tipi; i seam di test `__testTransitionReached` e `__testTransitionPause`; la conversione dei percorsi UNC di WSL (`AcpSessionRuntime.ts:297-306`), inutile su macOS; `logout` e `listSessions` sul runtime, mai usati.

### Non trovato

Non esiste un file `AcpJsonRpcConnection.ts`. Non ci sono chiamate a `session/set_mode` o `session/set_model`. Nessuno dei quattro adattatori registra gestori `fs/*` o `terminal/*`. `user_message_chunk` e gli altri tipi di `session/update` fuori tabella cadono nel `default` e si ignorano. `handleElicitationComplete` non è usato dagli adattatori. Non esiste un timeout generico per `session/prompt`: c'è solo il watchdog degli adattatori.

## 9. Infrastruttura comune

Ticket V08, P02-P09. Questi servizi stanno attorno agli adattatori e valgono per tutti e nove. Il dettaglio completo è in `docs/reference/synara-ricerche/infra.md`.

### Conformità e attivazione

`assertProviderAdapterConformance` all'avvio lega i flag ai metodi: `supportsTurnSteering` richiede `steerTurn`, `supportsSkillDiscovery` richiede `listSkills`, `supportsRuntimeModelList` richiede `listModels`, e così via (`provider/providerAdapterConformance.ts:81`, `:116-123`). Il confronto è `!== true`, quindi solo il valore vero esatto attiva il requisito. I problemi si accumulano tutti in un solo messaggio, con due formati: `<flag> requires <metodo>()` e `required method <metodo>() is missing`. `providerAdapterRegistrationIssues` rileva a parte un provider registrato due volte (`:96-108`). `enabledProviderAdapter` nega l'adattatore di un provider disattivato prima di consegnarlo, con errore HTTP 409 e messaggio `<Nome> is disabled in Settings > Providers.` (`enabledProviderAdapter.ts:14-40`).

### Cache dello stato su disco

Un file JSON per provider: `${stateDir}/provider-status/${provider}.json` (`providerStatusCache.ts:41-46`). Il contenuto è un `ServerProviderStatus` serializzato con rientro di due spazi e newline finale (`:80-83`), scritto in modo atomico con modo `0o600` (`apps/server/src/atomicWrite.ts:88-96`, `privatePathPermissions.ts:13`). La lettura è volutamente indulgente: file assente o vuoto danno `undefined`, un JSON non valido produce un avviso e ancora `undefined` (`:50-74`).

L'ordine dei nove provider è fisso: codex, claudeAgent, cursor, antigravity, grok, droid, devin, opencode, pi (`:13-23`); un provider fuori elenco finisce in fondo (`:29-32`). Si legge una volta sola, alla costruzione del layer `ProviderHealth` (`Layers/ProviderHealth.ts:2091-2109`), così la schermata mostra qualcosa subito. Si scrive solo dentro un refresh e solo se lo stato proiettato è cambiato (`:2442-2446`).

Un solo controllo alla volta: `ensureRefreshFiber` tiene una fibra condivisa in un `Ref` (`:2113`, `:2451-2498`), e il flag `refreshNeedsFollowUpRef` è il "serve un altro giro", alzato quando le impostazioni cambiano a metà refresh (`:2426`) e consumato a fine ciclo e nel finalizzatore (`:2463-2466`, `:2477-2492`).

### Cache dei modelli

I cinque numeri del ticket sono confermati nel codice, tutti in `provider/providerModelDiscoveryCache.ts`: fresco 10 minuti (`:18`), vecchio 24 ore (`:24`), ripetizione del fallimento 30 secondi (`:30`), timeout 45 secondi (`:36`), 64 voci (`:37`). Tutti sovrascrivibili dalle opzioni della fabbrica (`:99-112`), cosa che i test usano.

La chiave ha cinque campi: `provider`, `binaryPath`, `apiEndpoint`, `agentDir`, `cwd`, con `null` al posto di `undefined` (`:39-45`, `:75-85`), serializzati come array JSON di cinque elementi (`:87-88`). Quindi due repository o due binari diversi non condividono mai un catalogo. Tre mappe separate: cataloghi, fallimenti, voli in corso (`:114-116`).

`lookup` (`:224-249`): catalogo entro 10 minuti, risposta immediata senza toccare l'adattatore; oltre 10 minuti ma entro 24 ore, risposta immediata più riconvalida in sottofondo, saltata se c'è un fallimento recente; nessun catalogo con un volo in corso, si attende quello; nessun catalogo e un fallimento recente, si ripete quell'esito; altrimenti si avvia la scoperta e si attende. Il volo è singolo, con un `Deferred` per chiave e la scoperta su una fibra staccata, così il client che si disconnette non annulla il lavoro che altri attendono (`:182-214`). Il timeout è applicato dentro il volo e la scadenza diventa un errore con testo `Model discovery timed out after 45s.` (`:196-203`).

Solo un catalogo non vuoto e senza `error` è buono (`:96-97`). Una risposta vuota ma senza errore è autorevole: cancella il catalogo precedente e si registra tra i fallimenti (`:169-174`), così i modelli rimossi dal provider non restano nel selettore. I cataloghi si reinseriscono a ogni scrittura per usare l'ordine di iterazione della `Map` come ordine LRU, poi si tolgono i più vecchi oltre 64 (`:138-148`).

Chi la usa: una sola istanza per layer di scoperta (`Layers/ProviderDiscoveryService.ts:101`), applicata dentro `listModels` (`:295-303`). Prima della cache ci sono due uscite anticipate: provider disattivato dà `{ models: [], source: "disabled" }` (`:279-285`) e adattatore senza `listModels` dà `source: "unsupported"` (`:287-293`). Non esiste una cache analoga per `listAgents`, `listSkills`, `listCommands` o `listPlugins`.

### Directory delle sessioni

Il record `ProviderRuntimeBinding` ha nove campi (`Services/ProviderSessionDirectory.ts:15-25`) e sei operazioni: `upsert`, `getProvider`, `getBinding`, `remove`, `listThreadIds`, `listBindings` (`:33-59`). In Synara la persistenza è una riga per thread nella tabella SQLite `provider_session_runtime` (`apps/server/src/persistence/Migrations/004_ProviderSessionRuntime.ts:8-18`).

Le regole di `upsert` (`Layers/ProviderSessionDirectory.ts:92-132`) sono quelle da portare: `lastSeenAt` è sempre ora (`:106`, `:121`); un cambio di provider azzera i campi ereditati e riporta `adapterKey` al nome del nuovo provider (`:107-116`); i valori per difetto sono `runtimeMode: "full-access"`, `status: "running"`, `lifecycleGeneration: "legacy"` (`:117-120`); il cursore di ripresa si conserva a meno che il chiamante non ne passi uno (`:122-125`); il `runtimePayload` si fonde campo per campo quando entrambe le parti sono oggetti, altrimenti si sostituisce (`:40-51`, `:126-129`). Un provider persistito ma sconosciuto non fa fallire la lettura: `getBinding` lo tratta come nessun legame (`:77-86`) e `listBindings` lo salta (`:182-188`).

### Riconciliazione

`planProviderRuntimeReconciliation` è una funzione pura (`providerRuntimeReconciliation.ts:185-374`) che confronta sessioni vive, legami durevoli e proiezione della UI, e produce quattro tipi di piano (`:34-68`): `align-running-turn`, `settle-interrupted`, `settle-terminal-projection`, `settle-error`. Due soglie: staleness a 15 secondi (`:22`) e abbandono a 45 minuti (`:32`). Il piano gira ogni 5 secondi (`Layers/ProviderRuntimeReconciler.ts:41`, `:294`).

L'età considerata è la più recente fra quella della sessione e quella del thread (`:135-148`), quindi un turno che sta scrivendo non diventa mai stantio. Tre freni contro il falso positivo, tutti scavalcati dall'abbandono: nessun legame e thread figlio nativo (`:233`), pompa degli eventi non sana (`:259-260`), journal runtime con righe non ancora ingerite (`:265`). Il principio dichiarato è non inventare mai un completamento riuscito: in caso ambiguo si chiude come interrotto. Un errore del provider non si attribuisce mai a un turno diverso da quello proiettato (`:301-318`). Gli id di turno vuoti si trattano come assenti dappertutto (`:83-86`).

### Chiusura delle sessioni inattive

Due valori esatti (`Layers/ProviderSessionReaper.ts:11-12`): soglia di inattività 30 minuti, intervallo di spazzata 5 minuti, entrambi sovrascrivibili e passati per un `Math.max(1, ...)` (`:25-29`). La spazzata salta i legami già `stopped`, quelli senza `lastSeenAt`, quelli con data non analizzabile, quelli inattivi da meno della soglia e quelli il cui thread ha ancora un turno attivo nella proiezione (`:43-62`). Il resto si chiude, e un errore di chiusura diventa un avviso invece di fermare il giro (`:64-72`).

### Versioni minime e risoluzione degli eseguibili

`cliVersion.ts` è il confronto condiviso: estrazione con `CLI_VERSION_PATTERN`, normalizzazione che completa `x.y` in `x.y.0` (`:21-33`) e confronto semver con prerelease, dove l'assenza di prerelease vince (`:51-74`). `probeProviderCliVersion` classifica la sonda in cinque esiti: `missing`, `failure`, `timeout`, `nonzero`, `success` (`providerCliVersionProbe.ts:5-31`).

Versioni minime dichiarate, cinque su nove provider: Codex `0.37.0` più `0.124.0` per Auto e `0.125.0` per ripresa e fork (`provider/codexCliVersion.ts:9-13`), Claude `2.1.111` per Auto (`provider/claudeCliVersion.ts:4`), Antigravity `1.0.12` (`Layers/ProviderHealth.ts:130`). Cursor, Grok, Droid, OpenCode, Pi e Devin non ne hanno una.

`providerBinaryResolution.ts` cerca l'eseguibile su PATH con i candidati di piattaforma (`:32-41`) e, solo su Windows, dentro `LOCALAPPDATA` (`:43-61`).

### Altri servizi comuni

- `Layers/ProviderService.ts` è la facciata: risolve l'adattatore per thread dalla directory e lo chiede al registro. Dopo un avvio riuscito calcola `nativeResumeAttempted` e `nativeResumeSucceeded` chiedendo all'adattatore `didResumeSession`, che vale vero per difetto se il metodo manca (`:1860-1864`). Il "prior transcript bootstrap" è un booleano persistito nel `runtimePayload` sotto la chiave `priorTranscriptBootstrapPending` (`:215`, `:1884-1888`).
- `providerLifecycleCoordinator.ts` serializza le mutazioni del ciclo di vita per thread e dà a ognuna una generazione unica, provvisoria finché la corsa non chiama `commit()`, `adopt()` o `retire()` (`:7-24`). `runCurrentUrgent` attende il lock al massimo 5 secondi con polling ogni 25 ms, poi procede senza (`:35-52`).
- `providerStartupLifecycle.ts` rende esplicite otto fasi di avvio e sette motivi di fallimento (`:8-25`), con classificazione che mette l'eseguibile mancante davanti alle euristiche sul messaggio (`:170`, `:177-188`).
- `providerRuntimeEventIngress.ts` limita la coda dei callback: 32 MB di buffer, 64 posti riservati agli eventi terminali, 512 kB per evento (`:3-5`).
- `providerRuntimeEventPump.ts` sorveglia `streamEvents`: riprova lo stesso evento finché non viene elaborato, con attesa da 25 ms a 2 secondi (`:18-19`), e guarisce dallo stato `degraded` dopo 100 elaborazioni riuscite consecutive (`:26`).
- `providerRuntimeEventIdentity.ts` dà id distinti agli eventi derivati dalla stessa notifica nativa, nella forma `<eventId>:<tipo>:<ordinale>`, e lascia intatti quelli unici (`:8-27`).
- `settleConcurrentTeardowns.ts` avvia tutte le chiusure in concorrenza, attende che ognuna si sia posata e solo dopo riporta il primo fallimento (`:5-19`).
- `keyedLock.ts` serializza il lavoro per chiave con una catena FIFO di `Deferred`; un attendente interrotto lascia il suo nodo agganciato al predecessore, così nessuno scavalca chi tiene il lock (`:18-74`).
- `unmappedProviderEvents.ts` ripulisce e limita gli eventi non mappati: 16 000 caratteri per il JSON dei dati, 500 per il dettaglio, 200 per il tipo nativo, 2000 per l'anteprima, profondità 64 (`:5-10`), con redazione di cookie, credenziali in URL e assegnazioni di segreti (`:21-27`) e un cancello che limita i messaggi ripetuti a 128 combinazioni (`:542`).

### Casi limite dai test

- `providerStatusCache.test.ts:26` (scrittura e rilettura con modo `0o600` fuori da Windows); `:54` (un file malformato si ignora invece di fallire); `:77` (l'ordine dei provider resta stabile).
- `providerModelDiscoveryCache.test.ts:47` (catalogo fresco senza rieseguire la scoperta); `:67` (catalogo vecchio servito subito e riconvalidato in sottofondo); `:96` (scoperte concorrenti unite in un solo volo); `:155` (nessun riuso con un `binaryPath` diverso); `:172` (fallimento ripetuto brevemente); `:262` (risposta vuota autorevole che sostituisce un catalogo vecchio); `:293` (errore oltre il tetto del timeout); `:310` (la scoperta si completa per gli altri quando il primo chiamante viene interrotto); `:332` (sfratto LRU oltre il tetto).
- `providerAdapterConformance.test.ts:34` (steering dichiarato pretende `steerTurn`); `:89` (tutte le dichiarazioni non valide in un solo errore); `:104` (registrazione doppia segnalata); `:113` (metodo obbligatorio mancante rifiutato).
- `Layers/ProviderSessionDirectory.test.ts:91` (campi runtime persistiti e payload fuso); `:136` (`adapterKey` riportato al nuovo provider); `:167` (legami reidratati dopo un riavvio del layer); `:241`, `:272` (provider sconosciuto saltato o trattato come nessun legame).
- `Layers/ProviderSessionReaper.test.ts:161` (sessioni inattive chiuse conservando il cursore); `:209` (sessioni con un turno attivo saltate); `:258` (spazzata saltata se `stopRuntimeSession` non è disponibile); `:302` (cursore Codex conservato dopo una spazzata).
- `providerRuntimeReconciliation.test.ts:164` (un errore vivo terminale vince sui metadati stantii); `:265` (un avvio in coda senza turno concreto non si recupera); `:441` (l'errore non si attribuisce a un turno diverso); `:609` (un id di turno vuoto è assente); `:663`, `:687` (non si chiude nulla con la pompa non sana o il journal in ritardo); `:704` (un thread abbandonato si chiude comunque); `:771` (un turno che trasmette non è stantio).
- `keyedLock.test.ts:83` (un attendente interrotto non fa scavalcare chi tiene il lock); `providerStartupLifecycle.test.ts:85` (una scadenza si registra come `HandshakeTimeout`); `providerLifecycleCoordinator.test.ts:71` (la generazione precedente si ripristina se la corsa fallisce); `providerRuntimeEventPump.test.ts:108` (un errore permanente va in quarantena e si continua); `providerRuntimeEventIngress.test.ts:40` (chiusura dei task e abort di turno conservati sotto pressione).
- `Layers/ProviderDiscoveryService.test.ts:335` (la seconda scoperta modelli viene dalla cache condivisa); `:291` (l'adattatore non si invoca per un provider disattivato).

### In Trama

- Cache dello stato: un `actor ProviderStatusStore` con un file JSON per provider in `Application Support/.../provider-status/<provider>.json`, scritto con `Data.write(to:options: .atomic)` e permessi `0o600`. Lettura una volta all'avvio, scrittura solo quando lo stato cambia, `Codable` al posto di `Schema`, un file illeggibile ignorato.
- Un solo controllo alla volta: un `actor` che tiene un `Task<[ProviderStatus], Never>?` e lo restituisce a chi arriva durante il controllo, più un booleano `needsFollowUp`.
- Cache dei modelli: un `actor ModelCatalogCache` con `[Key: Entry]` e `[Key: Task<...>]` per il volo singolo. La chiave è una `struct Hashable` con gli stessi cinque campi, i cinque tempi sono costanti statiche, il timeout di 45 secondi si fa con un gruppo di task e un `Task.sleep` concorrente. Lo sfratto LRU non può usare l'ordine di iterazione di un `Dictionary` Swift: serve una lista di chiavi in ordine di inserimento accanto al dizionario.
- Conformità: in Swift un protocollo con requisiti opzionali non esiste. Le cinque coppie diventano un controllo su una `struct ProviderCapabilities` più metodi che restituiscono `nil` per difetto, verificato in un test di conformità invece che al lancio.
- Directory delle sessioni: nessuna tabella SQLite. Il legame per thread va nel documento del progetto, con `resumeCursor` come `Data` opaca del provider, come già deciso in V02. Restano utili le regole di `upsert`: cambio di provider che azzera i campi ereditati, fusione del payload, `lastSeenAt` sempre aggiornato.
- Chiusura delle sessioni inattive: un `Task` periodico ogni 5 minuti che chiude i thread fermi da 30 minuti senza turno attivo. I due valori vanno confermati sui turni lunghi del Coordinatore.
- Riconciliazione: la funzione di pianificazione è pura e si porta quasi alla lettera. I freni contro il falso positivo vanno tenuti, altrimenti la chat dichiara interrotto un turno che sta lavorando.

### Da non portare

Effect e tutta la sua impalcatura (`Layer`, `Ref`, `Deferred`, `Fiber`, `PubSub`, `Scope`, `Schedule`, `Exit`, `Schema`); la tabella `provider_session_runtime` e le sue migrazioni; `EventNdjsonLogger` e la rotazione dei log per thread; `providerBinaryResolution.ts` nella parte Windows; la pompa degli eventi con quarantena e stati di salute, che serve perché Synara persiste ogni evento in un journal; `unmappedProviderEvents.ts` per intero, perché le sue espressioni regolari di redazione sono tarate sui log di nove CLI. Serve la redazione, non queste regole.

### Non trovato

- I flag di capacità chiesti da V08, cioè thread persistente, ripresa, strumenti host, override per turno e uso token, non esistono in `ProviderAdapterCapabilities`. Conferma la nota già presente in sezione 5.
- Nessuna versione minima dichiarata per Cursor, Grok, Droid, OpenCode, Pi e Devin.
- Nessuna cache per `listAgents`, `listSkills`, `listCommands` o `listPlugins`: solo `listModels` passa dalla cache condivisa.
- Non esiste una costante di timeout globale per il controllo di stato equivalente al tetto dei 45 secondi della scoperta modelli.
- `Layers/EventNdjsonLogger.test.ts` esiste ma non contiene casi `it(...)` individuabili con una ricerca sul nome.

Ticket: V08, P02-P09
