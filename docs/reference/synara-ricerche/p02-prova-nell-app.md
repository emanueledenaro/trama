# P02: in-app proof with Claude Agent

## Nuova prova sulla build release, 20 settembre 2026

La build release del worktree è stata aperta davvero da `build/Trama.app`. Il commit locale `fa6dc66` e la head della PR `28444f5` identificano lo stesso tree `24d71df3284575cea7fb10326298dd99311c9843`.

### Osservato

- Il progetto si è riaperto con la cronologia esistente e il Coordinatore ripreso su Codex. La schermata mostrava `Codex di OpenAI · GPT-5.6-Luna` e il composer era disponibile.
- Il composer è un selettore unico. Il menu ha mostrato provider, modelli e opzioni per provider. Codex esponeva gli sforzi `Predefinito`, `Basso`, `Medio`, `Alto`, `Molto alto`, `max` e `ultra`.
- Claude Agent era presente nello stesso menu, ma disabilitato con il motivo `Claude non è autenticato. Esegui \`claude auth login\` e riprova.`
- La schermata Collegamenti ha mostrato Codex collegato e Claude Agent come `Accesso richiesto`, con la stessa motivazione. Il testo della schermata dichiara che Trama non copia le credenziali.
- È stata selezionata nel composer la combinazione `Codex di OpenAI · GPT-5.6-Luna · Medio`. La selezione è stata letta subito dopo l’azione dal testo accessibile del composer.
- `claude auth status` eseguito senza modificare credenziali ha restituito `loggedIn: false`, `authMethod: none`, `apiProvider: firstParty`.

Schermata realmente osservata del composer release: [09](p02-in-app/p02-09-release-composer-codex.jpeg).

### Non eseguito per blocco di accesso

Non ho inviato un turno Claude, non ho verificato la preferenza Claude separata, il passaggio di consegne, l’attribuzione effettiva Claude, la riapertura dopo un turno Claude o l’indisponibilità di un modello Claude senza fallback. Questi passaggi richiedono un account Claude autenticato.

Passaggio umano esatto: eseguire `claude auth login` con il comando ufficiale e completare l’accesso nel browser. Non ho inserito, copiato o letto credenziali. Dopo l’accesso occorre riaprire `build/Trama.app` e ripetere la prova con `haiku`; il confronto Codex deve usare `gpt-5.6-luna` con sforzo `medium`.

Questa sezione è una prova nuova e parziale. La prova completa del 18 settembre resta sotto e non viene riutilizzata come evidenza della build corrente.

Run of 18 September 2026 for #81, on the head of PR #95. Real component: the `claude` CLI 2.1.276 with the account of the person, model `haiku` for the Coordinator and for the specialist. Codex was used only for the switch step, which hit its real usage limit (see below).

## Setup

- The app was built from the branch with a temporary hook, removed before any commit. It is a state machine subscribed to store changes: when the precondition of a step holds it performs the step and schedules one capture with `NSView.cacheDisplay`. No wait loop on the main actor.
- `CFFIXED_USER_HOME=/tmp/trama-p02-home`, a clone of the branch as the project, no data from the real Application Support. `TRAMA_CLAUDE_BINARY` points the isolated home at the real binary (the isolated home hides `~/.local/bin`).
- The project document started with Claude as the last turn provider and `haiku` remembered for the Coordinator and the specialists.
- Captures have the known `cacheDisplay` limits: the sidebar and translucent materials are drawn white or faint. The state of each step is also in the project document.

## Results

1. The Coordinator opens a thread on Claude, studies the project and answers with the study card. [01](p02-in-app/p02-01-coordinator-on-claude.png)
2. Asked to call `propose_team`, the Coordinator on Claude shows the team proposal card through Trama's local MCP tool server. [01b](p02-in-app/p02-01b-team-proposal.png) The person confirms it. [02](p02-in-app/p02-02-team-confirmed.png)
3. Asked to remember a code word and to assign work, the Coordinator writes the memory (`ginestra`, revision 1) and calls `assign_task`. The mandate gate refuses the first call with `outside_scope` (`executeInWorktree` not granted) and the Coordinator asks for a mandate. [03](p02-in-app/p02-03-mandate-card.png) The person grants it; the Coordinator asks once for a corrected mandate, which is granted too.
4. The assignment starts on Claude in its own worktree and branch. The document records `provider: claudeAgent` on the assignment and on the turn (`claudeAgent:haiku:completed`); the specialist wrote `docs/verifiche/p02-nota-specialista.md` in its worktree. The clone's checkout stayed clean. [04](p02-in-app/p02-04-assignment-card.png) [05](p02-in-app/p02-05-specialist-done.png)
5. The person switches the Coordinator to Codex. The thread and the conversation stay, a card says the Coordinator restarts in a new session with transcript, memory and study, and Codex opens a session. Its first turn hits the real usage limit (available again on 19 September 14:59). The phase becomes `unavailable` with that message. [06](p02-in-app/p02-06-switched-to-codex.png)
6. The person switches back to Claude: a new session opens with the handover and the study card. Asked for the code word and the specialist who worked so far, Claude answers "Parola in codice: ginestra. Specialista che ha lavorato: Ingegnere Provider, ha completato l'incarico A-86451B53". [07](p02-in-app/p02-07-back-on-claude.png) [08](p02-in-app/p02-08-handover-answer.png)
7. CPU at rest after the run: samples of 0.0 to 7.0% (the repository watcher on a background thread), and `sample` shows the main thread waiting in `mach_msg2_trap` with no layout transactions.

## Bugs found and fixed by the run

- `assign_task` had no `provider` argument, so no assignment could start on Claude. It now takes an optional provider (default: the Coordinator's), validates the model against that provider's catalogue and offers only an authenticated provider. Tests in `CoordinatorTeamToolsTests`.
- The specialist turn was recorded with a fixed `.codex` provider. It now records the provider of the assignment.
- Reopening on Claude with an unknown access state stopped with "connect Claude", because the check ran only after the Codex connection. The check now runs first.

## Limits

- A blocked-provider card was not triggered on Claude: a Claude usage limit cannot be forced safely. It is covered by the adapter tests with the simulated transport and by the real-process test for the usage limit. What was observed live is the Codex usage limit at the switch; the Codex Coordinator path reports it as an unavailable phase, not as the `providerBlocked` card and status strip.
- The composer selector and the header still show "GPT-5.6-Luna" while the Coordinator runs on Claude/haiku. The activity line and the turn record show `haiku`.
- `haiku` did not call `propose_team` when asked in general terms; it answered in prose. The run used an explicit request for the tool.
- With the real `~/.codex` (5.4 GB), the Codex client spent up to a minute at high CPU in `receiveStdout` (`firstIndex(of:)` on a growing buffer) after launch. It is in the Codex client of V01 and outside this ticket.
- Restart resume of a Claude Coordinator was not part of this run; it is covered by the real-session tests of the adapter.
