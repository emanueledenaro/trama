# L04: ogni provider usa gli strumenti di Trama (2026-09-26)

Controllo di #228 sul branch `bugfix/issue-228-provider-github-tools`. Nella prova in locale il Coordinatore girava su Devin (ACP) e chiamava lo strumento GitHub di Devin ("devin: Calling list_issues from github"). Trama lo rifiutava senza dire perché, e il Coordinatore chiedeva alla persona di eseguire `gh issue list` nel terminale.

## Causa

- `decidePermission` in `acpRuntime.ts` rifiuta ogni strumento che non è di Trama né una lettura con un percorso controllabile. Il rifiuto è giusto (#206), ma la risposta ACP a una richiesta di permesso porta solo l'opzione scelta: l'agente non sapeva perché né cosa usare al suo posto.
- `mcpServers()` passava il server di Trama solo se l'agente dichiarava `mcpCapabilities.http`. Un agente ACP senza HTTP restava senza `read_issues` e senza gli altri strumenti di Trama.
- Le istruzioni del Coordinatore dicevano di usare gli strumenti di Trama, ma non che quelli del provider sono bloccati né che non va chiesto alla persona di usare il terminale.

## Cosa cambia

- Trasporto per ACP: se l'agente dichiara HTTP, Trama passa il server MCP in HTTP come prima; altrimenti lo passa in stdio, che ogni agente ACP deve supportare. Il server stdio è il proxy già usato da Antigravity, spostato in `app/src/main/core/providers/hostToolProxy.ts`: Trama lo avvia come Node e gli passa URL e percorso di un file privato con il token. Il token non va né negli argomenti né nei messaggi ACP. Il file sparisce quando la sessione si chiude.
- Rifiuti con motivo: `app/src/main/core/providers/toolRefusal.ts` riconosce gli strumenti GitHub, web, comandi e connettori, e scrive il motivo con lo strumento di Trama da usare, per esempio "Gli strumenti GitHub del provider sono bloccati: per le issue usa read_issues di Trama". Il testo cambia in base agli strumenti della sessione: il Coordinatore ha `read_issues` e `run_readonly_check`, uno sviluppatore ha `ask_coordinator`, gli altri specialisti nessuno.
- Dove il provider porta un messaggio insieme al rifiuto, il motivo va lì: Claude (`canUseTool` e hook PreToolUse), OpenCode (`permission.reply`), Grok (`systemMessage` dell'hook). Dove non può (permessi ACP, hook di Antigravity, sandbox di Codex), l'agente lo legge all'inizio del turno successivo: "Nel turno precedente Trama ha bloccato questi strumenti del provider: ...".
- Ogni rifiuto diventa l'evento `toolRefused` e un'attività "Strumento del provider bloccato", con la richiesta e il motivo, nel dialogo del Coordinatore o nel lavoro dello specialista.
- Istruzioni: il Coordinatore e gli specialisti leggono che gli strumenti GitHub, web, connettori e MCP del provider sono bloccati, quale strumento di Trama usare, e che non devono mai chiedere alla persona di eseguire un comando nel terminale per leggere dati che Trama può leggere. Lo dicono anche le istruzioni del server MCP di Trama.
- Scelta del provider: `coordinatorUnavailableReason` in `app/src/shared/providers.ts` esclude dal ruolo di Coordinatore un provider senza sessioni in sola lettura o senza gli strumenti di Trama. Il motivo compare nella scelta del provider, in Impostazioni e nell'avviso del Coordinatore; le proposte di cambio provider usano la stessa regola. La capacità si chiama ora "Strumenti di Trama". Oggi tutti i nove provider li ricevono, quindi nessuno è escluso per questo.

## Uscita strutturata

Nella prova in locale con Claude Haiku in sola lettura (triage dei ruoli fissi), in 3 incarichi su 6 l'agente scriveva "Il tool StructuredOutput non è disponibile in questa sessione Trama (read-only)" e Trama non leggeva la risposta. Con `outputFormat` l'SDK di Claude restituisce la risposta attraverso lo strumento `StructuredOutput`, e il filtro degli strumenti lo rifiutava come uno strumento sconosciuto. Ora `decideToolPermission` lo ammette sempre: è l'uscita che Trama stessa chiede. Codex usa lo schema nativo di app-server senza strumenti; Pi, OpenCode, Antigravity e gli agenti ACP chiedono il JSON nel testo del prompt e Trama lo estrae dalla risposta, quindi non c'è uno strumento da ammettere. Test: `claudeAgent.test.ts` ("lets a read-only turn return the structured answer Trama asked for"), con il fake dell'SDK; per ACP resta il test esistente dello schema in `acpRuntime.test.ts`.

## Provider per provider

"Fake" indica l'agente o la CLI di prova in `app/test-fixtures` o i finti SDK dei test. "Reale" indica il binario o l'SDK del provider. In questa verifica nessun binario reale è stato eseguito: l'ambiente non ha le CLI dei provider né gli accessi.

| Provider | Strumenti di Trama | Strumenti propri del provider | Motivo all'agente | Test | Reale | Fake |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | HTTP (`mcp_servers.trama`) | web search, app, plugin e MCP della persona spenti; la sandbox in sola lettura non ha rete, quindi `gh` fallisce | turno successivo, per i comandi `gh`, `curl`, `wget` e `git fetch/pull/push/clone` falliti | `codex.test.ts`, `providerTools.integration.test.ts` | no | sì: `gh issue list` fallisce, attività registrata, il turno dopo chiama `read_issues` |
| Claude | SDK in processo | impostazioni, plugin e MCP della persona esclusi; WebFetch e WebSearch tolti; niente shell in sola lettura | nel rifiuto (`canUseTool` e hook) | `claudeAgent.test.ts` | no | sì: `mcp__github__list_issues` rifiutato con il motivo, poi `read_issues` nello stesso turno |
| Pi | strumenti personalizzati dell'SDK | non esistono: elenco chiuso di strumenti, niente bash né estensioni | non serve | `pi.test.ts` | no | sì: nessuno strumento bash, web o GitHub nella sessione |
| OpenCode | MCP remoto | regole che partono da `deny` su tutto; MCP della persona spenti | nel rifiuto (`permission.reply`) | `opencode.test.ts` | no | sì: `bash gh issue list` rifiutato con il motivo, poi `trama_read_issues` |
| Antigravity | proxy stdio del plugin | l'hook nega tutto tranne letture, modifiche nel worktree e strumenti di Trama | turno successivo | `antigravity.test.ts` | no | sì: `mcp_github_list_issues` negato, il turno dopo usa `mcp_trama_read_issues` |
| Cursor | HTTP o stdio | permessi rifiutati | turno successivo | `acpRuntime.test.ts` | no | sì, con entrambi i trasporti |
| Devin | HTTP o stdio | permessi rifiutati | turno successivo | `acpRuntime.test.ts` | no | sì, con entrambi i trasporti |
| Droid | HTTP o stdio | permessi rifiutati | turno successivo | `acpRuntime.test.ts` | no | sì, con entrambi i trasporti |
| Grok | HTTP o stdio | hook PreToolUse e permessi | nel rifiuto dell'hook (`systemMessage`) e al turno successivo | `acpRuntime.test.ts`, `providers.test.ts` | no | sì, con entrambi i trasporti |

## Da verificare con i binari reali

- Devin: quale trasporto MCP dichiara `devin acp` in `initialize` e se avvia davvero il server stdio di Trama. Con il fake Trama passa stdio quando HTTP manca; resta da vedere che Devin elenchi `trama` fra i suoi strumenti.
- Gli stessi controlli con Cursor, Droid e Grok reali.
- Il testo esatto con cui ogni agente ACP chiede il permesso per il suo strumento GitHub: il riconoscimento usa titolo, `rawInput` e tipo; un titolo molto diverso finisce nella voce generica ("strumenti propri del provider"), sempre con l'indicazione di usare gli strumenti di Trama.

## Comandi

Da `app/`: `npx tsc --noEmit -p .`, `npx vitest run`, `npm run build`, `node scripts/ui-check.mjs` (con `xvfb-run -a` su Linux).
