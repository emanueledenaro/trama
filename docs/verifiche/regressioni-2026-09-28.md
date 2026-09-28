# Regressioni dopo le PR dal 26 settembre

Data: 28 settembre 2026. Issue #317. Base: `origin/main` 8bf9f4a.

Dal 26 settembre sono entrate su `main` 71 pull request, molte con conflitti risolti a mano. Questo registro dice cosa ho controllato, come e con quale esito. Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`): nessuna esecuzione reale di Codex.

## 1. Controlli su origin/main

Eseguiti in `app/` su 8bf9f4a, prima di ogni modifica.

- `npm ci`: riuscito.
- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 135 file, 1281 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa con Electron sotto xvfb, uscita 0, 351 screenshot.

I 3 test saltati sono gli stessi di prima del 26 settembre, più uno: "saves a goal before reporting it and keeps nothing when the save fails (UX01)" in `controller.test.ts` usa `it.skipIf(process.getuid?.() === 0)` perché chi gira come root ignora i permessi dei file. In CI non gira come root e il test parte; nei container degli agenti viene saltato. Gli altri due (`claudeAgent.argv.test.ts` e `skillBundle.test.ts`) erano già saltati a condizione prima del 26 settembre.

## 2. Come ho cercato le regressioni

- **Merge con conflitti.** Ho elencato i 123 commit di merge dal 25 settembre che hanno una risoluzione propria (`git show --cc` non vuoto). Per ognuno ho rifatto il merge automatico dei due genitori e l'ho confrontato con il risultato registrato, ho cercato le righe aggiunte da un lato e assenti dal risultato, le righe presenti più volte che in entrambi i genitori, i titoli dei test e le `expect` tolte, e gli screenshot di ui-check. Ogni sospetto è stato ricontrollato su 8bf9f4a: conta solo quello che è ancora su `main`.
- **Test.** Ho estratto i titoli di tutti i test a ogni commit di `main` dal 26 settembre e ho seguito ogni titolo sparito fino al commit che lo ha tolto. Nessun `.only`, `.todo` o test commentato.
- **ui-check.** Ho seguito ogni `shot(...)` e ogni `throw new Error(...)` di `app/scripts/ui-check.mjs` a ogni commit di `main`.
- **PR.** Per ogni PR ho letto il corpo e i criteri della issue collegata, poi ho controllato su `main` i test aggiunti dalla PR (stesse asserzioni del suo commit di merge), i passi di ui-check e il codice che la PR introduceva.

## 3. Regressioni trovate e corrette in questa PR

| Dove | Causa | Cosa succedeva | Correzione |
|---|---|---|---|
| `app/src/main/candidate.integration.test.ts` | #226 (26b6c0d) | Il test non controllava più che il revisore tecnico girasse in sola lettura: #226 ha tolto il profilo dal turno (giusto per Codex 0.155) senza spostare il controllo sull'apertura del thread | Il test controlla che il `thread/start` del revisore abbia `permissions: "trama_read"` |
| `app/src/main/focusAudit.integration.test.ts` | #226 (26b6c0d) | Stesso problema per i due assi della focus mode | Il test controlla `permissions: "trama_read"` sull'apertura di entrambi gli assi |
| `app/src/main/core/agentThreads.test.ts` | merge 06f36a0 (#261) | Nel passaggio al cancello del candidato si è perso il caso "una verifica che fallisce anche sulla base non apre la conversazione di regressione" | Nuovo test "opens no regression conversation for a check that fails on the base too" |
| `app/scripts/dbg-full.mjs` | merge 6dc977f (#194) | Il merge ha aggiunto una vecchia copia di ui-check di 1186 righe che nessuno eseguiva, poi modificata da altre PR | File rimosso |
| `app/scripts/ui-check.mjs` | merge 27c789d (#284 con #280) | Due coppie di screenshot con lo stesso numero `18e1`/`18e2` | `18e3-publication-outside-mandate` e `18e4-publication-outside-mandate-dark` |
| `app/scripts/ui-check.mjs` | merge e35bf2b, f5bf344 | Cinque copie dello stesso helper per il tema: `brandLook`, `setLook`, `mandateShots`, `problemShots`, `waitShots` | Restano `setLookTo` e `lookShots`, stessi screenshot con gli stessi nomi |
| `CONTEXT.md`, "Riga di stato" e "Attività" | merge c85ae43 (#282) | Il conflitto ha tenuto la definizione breve e perso quella di #241: la riga diceva di venire "dallo stand-up", mentre `statusLine.ts` la ricava dai dati e mai dal modello | Definizioni riunite, con i dati da cui viene la riga, "Niente in corso." e gli esiti di Attività |
| `app/src/shared/domain.ts`, `AgentThreadKind` | merge 06f36a0 | Il commento parlava ancora della sola revisione tecnica | Il commento nomina i revisori del cancello (W10) |

Nessuna regressione grande: non ho aperto issue nuove.

## 4. Cose viste e non corrette qui

- Molti prefissi numerici degli screenshot sono condivisi da scenari diversi (per esempio `20a-focus-audit` e `20a-github-connected-dark`, `23a-references` e `23a-coordinator-outage-waiting`, `16a`, `22a`, `26a`). I nomi completi sono diversi e nessun file viene sovrascritto. Rinumerarli cambierebbe i nomi citati nei registri di `docs/verifiche/`, quindi li lascio come sono.
- Circa 40 controlli negativi di ui-check usano `if (await x.count()) throw` senza attendere. Passano anche se girano prima che l'interfaccia sia disegnata. Non è una regressione di queste PR.
- Punti aperti già dichiarati nelle PR, non regressioni: #301 resta aperta per i testi in inglese (#303 è la prima parte); con #288 i giri girano solo sul progetto aperto; #274 elenca criteri di #43 non coperti.

## 5. Controlli automatici aggiunti

- **Inventario di test e ui-check** (`app/scripts/check-inventory.mjs`, `app/scripts/inventory.json`, test in `app/scripts/check-inventory.test.ts`). L'inventario registra ogni test (file, blocchi `describe` e titolo, letti con il parser di TypeScript), ogni screenshot di ui-check e ogni messaggio dei suoi controlli. `npx vitest run` fallisce se un merge toglie un test, uno screenshot o un controllo registrato, se compare un nuovo `skip`, `skipIf` o `todo`, se c'è un `.only`, o se lo stesso screenshot è scritto due volte. Togliere o rinominare qualcosa di proposito vuol dire aggiornare `inventory.json` nella stessa PR con `node scripts/check-inventory.mjs --write`, e chi rivede vede le righe tolte nel diff. Le aggiunte passano sempre.
- **Nomi unici in ui-check.** `shot()` ferma ui-check se due screenshot hanno lo stesso nome, anche quando il nome viene da un modello di stringa.

Proposte non implementate: rinumerare i prefissi condivisi insieme ai registri che li citano; far attendere i controlli negativi di ui-check con un `waitFor({ state: "detached" })` o un piccolo helper; un controllo che ogni criterio di accettazione di una issue chiusa citi un test o un passo di ui-check.

## 6. Tabella delle PR

"Regge" vuol dire che i test aggiunti dalla PR ci sono ancora con asserzioni uguali o più forti, i passi di ui-check ci sono (a volte rinominati o adattati da una PR successiva per un cambiamento voluto) e il codice che la PR introduceva è ancora su `main`. Tutti i test citati sono verdi nella corsa del punto 1.

| PR | Cosa garantiva | Come l'ho verificato | Esito |
|---|---|---|---|
| #303 | Scelta italiano o inglese al primo avvio, lingua agli agenti | `i18n.test.ts` "has every key in every language", `language.integration.test.ts`, ui-check `12-settings-en`, `translate` e `settings.language` | regge (#301 resta aperta per la seconda parte) |
| #304 | Cancello fermo solo per veri errori della sandbox, revisori "non partiti" | `gate.test.ts` "ends without an outcome when a check could not run for the sandbox or the machine...", `stopAtEnvironment` in `controller.ts` | regge |
| #308 | Aggiornamento delle dipendenze di `app/` | `package.json` uguale al merge; suite, build e ui-check verdi sul punto 1 | regge |
| #299 | Nomi al posto degli id, glossario, niente gergo | `plainLanguage.test.ts` "keeps the glossary of the documentation and of the code the same", `conventions.test.ts` (issue #270), ui-check `26a-plain-clean-code-card`, `data-record-id` | regge |
| #219 | File della community, Dependabot, CodeQL, licenze, rilascio | `scripts/release/lib.test.mjs`, `scripts/licenses/lib.test.mjs`, file e workflow presenti | regge |
| #302 | Cancello chiuso se una verifica richiesta non gira, niente turni vuoti | Nessun test nella PR (dichiarato); testo "non sono riuscite per la sandbox o la macchina" presente; logica ristretta poi da #304 come voluto | regge |
| #300 | Evidenze del candidato conservate sugli errori della sandbox | `duties.test.ts` "never diagnoses a failure of the sandbox or the machine as a bug of the project (issue #271)" | regge |
| #298 | Cronologia compatta, passi tecnici in Attività | `settledCards.test.ts`, `technicalSteps.test.ts`, ui-check `29a-compact-timeline`, `29b-activity-steps` | regge |
| #296 | Ciclo autonomo dentro il mandato | `autonomousCycle.test.ts` "confirms the shared understanding within a mandate that allows planning, and never without one", ui-check `14b0-block-resolution`, `15b1-activity-step-correct` | regge |
| #297 | Una sola barra di focus, screenshot A09 rinumerati | chiavi `focus-${id}` e `pane-${id}` in `ChatView.tsx`, ui-check `28a`-`28e` | regge |
| #285 | Ogni riferimento è un collegamento | `references.test.ts`, `referenceCheck.test.ts`, ui-check `23a-references`-`23d` | regge |
| #261 | Chat tra agenti visibili, in sola lettura | `agentThreads.test.ts`, ui-check `19j-agent-thread`, `19m-specialist-threads` | regressione nei test dal merge 06f36a0, corretta qui (punto 3) |
| #287 | Titolo della barra dall'obiettivo, errori degli strumenti fuori dalla chat | `toolErrors.test.ts`, ui-check `18a4-activity-tool-errors` | regge |
| #295 | Ripresa dopo i limiti del provider e alla riapertura | `resumeWork.test.ts` "takes up the Coordinator turn that Esci or a crash ended, only the latest one", ui-check `28a`-`28e` | regge |
| #294 | Il Coordinatore apre e smista le issue dei problemi | `problems.test.ts`, `problems.integration.test.ts`, ui-check `27a`-`27c` | regge |
| #293 | Aspetta te conta obiettivi, presenza, percorsi, candidati | `waitingForYou.test.ts`, ui-check `10b-waiting-proposed-goal`, `16a-waiting-presence` | regge |
| #291 | Mandato di progetto e divieti fissi | `fixedBans.test.ts`, `projectMandate.test.ts`, ui-check `26a-project-mandate`-`26d-fixed-ban` | regge |
| #290 | Riepilogo a ogni traguardo o su richiesta | `recap.test.ts` "titles the card by what made it", ui-check `15d`, `15e`, `22c-recap-milestone` | regge |
| #289 | Barra laterale con solo chat, obiettivi, agenti | ui-check `14-sidebar-project-rows`; `sidebarDecisionRows` tolta con il suo test, come dichiarato | regge |
| #288 | Giro periodico e Pausa, niente limite di mosse | `continuousWork.test.ts` "has no limit of automatic moves in a row...(A05)", ui-check `15c-status-line-paused` | regge (i giri girano solo sul progetto aperto, dichiarato) |
| #283 | Aspetta te in un posto unico | `waitingForYou.test.ts`, ui-check `waiting-summary` che sparisce con zero voci | regge |
| #286 | Chat unica, obiettivi come filtri | `singleChat.test.ts`, ui-check `10f-single-chat`, `10g`, `10h` | regge |
| #279 | Divergenza del branch come avviso unico | `branchDivergence.test.ts`, `conflictScope.test.ts`, ui-check `25a-branch-divergence` | regge |
| #282 | Riga di stato e mosse in Attività | `statusLine.test.ts`, `activity.test.ts`, ui-check `15a-status-line-move`, `15b-activity`, `17e-status-line-narrow` | regge nel codice; definizione persa in `CONTEXT.md` dal merge c85ae43, corretta qui |
| #284 | Nessun push fuori mandato, ogni push registrato | `push.test.ts` "runs no git at all when the mandate forbids publishing...", ui-check `18e1-publication-outside-mandate` (ora `18e3`) | regge; numero dello screenshot corretto qui |
| #281 | Differenze nella proposta di mandato, Rifiuta non tocca il mandato | `mandate.test.ts`, ui-check `15m1`-`15m4` | regge |
| #280 | Cancello con i revisori in parallelo | `gate.test.ts`, `gate.integration.test.ts`, ui-check `24a`-`24d`, `18e1-candidate-gate-passed` | regge |
| #278 | Il Coordinatore cita solo pulsanti e stati veri | `coordinatorGrounding.test.ts`, `providerTools.integration.test.ts` | regge |
| #274 | Ripresa dopo limiti, riavvii, rete assente | `providerFailure.test.ts`, ui-check `23a-coordinator-outage-waiting`-`23f` | regge |
| #276 | Documenti sul Coordinatore sempre attivo e sulle squadre Scrum | "Squadre Scrum" in `CONTEXT.md`, ADR 0017 | regge |
| #275 | Apertura del Coordinatore protetta, modello predefinito condiviso | `coordinatorModel.integration.test.ts`, `providers.test.ts` | regge |
| #243 | Nomi dei progetti esterni solo nei file legali | `check-upstream-names.test.ts`, `check:upstream-names` in CI | regge |
| #259 | Rilievi della focus mode con prova e stato | `auditFindings.test.ts`, `focusAudit.integration.test.ts`, ui-check `20e-focus-audit-findings`, `20f` | regge |
| #238 | Studio con il modello scelto dalla persona | `coordinatorModel.integration.test.ts` "studies a new project on the catalogue's default..." | regge |
| #236 | Scelte scritte nel testo riportate a una scheda | `continuousWork.test.ts` "finds numbered or lettered options with a request to pick one" | regge |
| #237 | Guardia sul cambio di progetto, PR chiuse o unite fuori dal triage | `github.test.ts` (issue #231), `duties.test.ts` | regge |
| #232 | Bot animati per ogni agente | `botGeometry.test.ts`, `agentBot.test.ts`, `identity.test.ts`, ui-check `04e2b-specialist-narrow` | regge |
| #235 | Triage solo su issue nuove, `read_team` compatto, avvio su richiesta | `duties.integration.test.ts`, `duties.test.ts`, ui-check `22a-automatic-work`, `22b` | regge |
| #233 | Ogni provider usa gli strumenti di Trama | test dei runtime e `providerTools.integration.test.ts`, `toolRefusal.test.ts` | regge |
| #230 | Separatori dei pannelli come in VS Code | `resizable.test.ts`, ui-check `22-sash-hover-*`, `22-sash-drag` | regge |
| #223 | Cucitura come accento, una per schermata | `seam.test.ts`, ui-check `21-seam-*` | regge |
| #227 | Si avvia il Coordinatore dell'ultimo progetto aperto | `controller.test.ts` (F01), `codexClient.test.ts` | regge |
| #216 | Gli sviluppatori liberi prendono la fetta pronta | `slicePicking.test.ts`, `slices.test.ts`, `worktreeConflicts.test.ts`, ui-check `22a-parallel-developers` | regge |
| #218 | Modelli Antigravity con il livello | `antigravity.test.ts`, `providers.test.ts` | regge |
| #226 | Il turno nomina il profilo di Codex solo per cambiarlo | `codexClient.test.ts` "names a permission profile on a turn only to switch it..." | regge; ha indebolito due test di sola lettura, corretti qui (punto 3) |
| #211 | Candidato dichiarato dopo un incarico concluso | `continuousWork.test.ts`, `coordinatorTools.test.ts`, `candidate.integration.test.ts`, ui-check `18a2`, `18a3` | regge |
| #194 | Ask Trama dentro Trama | `askTrama.test.ts`, `askTrama.integration.test.ts`, ui-check `21-ask-trama-menu`, `21a`-`21c` | regge; il merge 6dc977f aveva aggiunto `dbg-full.mjs`, tolto qui |
| #197 | Controllo in CI di commit, titoli e branch | `scripts/conventional-commits/lib.test.mjs`, workflow `conventional-commits.yml` | regge |
| #225 | Main di nuovo verde | `check-file-names.test.ts`, `tramaMarkPalette.test.ts`, controllo "Tab left the welcome" in ui-check | regge |
| #221 | Sessioni degli agenti dentro il progetto | `readScope.test.ts`, `readScope.integration.test.ts`, ui-check `21-read-outside-project` | regge |
| #224 | README: domande degli sviluppatori, pausa, Clean Code | testo presente nel README riscritto da #219 | regge |
| #212 | README aggiornato | README con focus mode, presenza, standard di pubblicazione | regge |
| #202 | Domande dello sviluppatore e fette in pausa | `developerQuestions.test.ts`, ui-check `19e-developer-question` | regge |
| #201 | Standard Clean Code | `cleanCode.test.ts`, ui-check `18d1-review-findings`-`18d4` | regge |
| #195 | Errori dei provider e di GitHub leggibili | `providerFailure.test.ts`, ui-check `20-github-connected-*`, `20b`, `20c` | regge |
| #208 | Entrata, benvenuto, scelta del progetto | `onboarding.test.ts`, `launchIntro.test.ts`, ui-check `00a`-`00c` | regge |
| #207 | Suite stabile, turni tardivi di Codex ignorati | `codexClient.test.ts` "ignores a late turn/completed of an earlier turn on the same thread" | regge |
| #214 | Logo, icone, TramaMark | `tramaMarkPalette.test.ts`, ui-check `01b-brand-*`, `12b-about-*` | regge |
| #203 | Conventional Commits e standard di pubblicazione | `conventions.test.ts`, `quality.test.ts`, ui-check `18f`-`18i` | regge |
| #198 | Focus mode con verifiche prima e assi in sola lettura | `audit.test.ts`, `focusAudit.integration.test.ts`, ui-check `20a` | sola lettura degli assi non più controllata dopo #226, corretta qui |
| #192 | Antigravity in tutti i ruoli, profilo di sola lettura | `antigravity.test.ts`, ui-check `19-antigravity-picker`, `19a` | regge |
| #191 | Contratto dell'incarico e rapporto dello sviluppatore | `coordinatorTools.test.ts`, `implementation.test.ts`, ui-check `19c`, `19d` | regge |
| #179 | Verifica dei ticket C e T19 | `docs/verifiche/ticket-c-t19.md` | regge |
| #184 | Avvisi di sovrapposizione | `overlap.test.ts` (shared e core), ui-check `16d`-`16h` | regge |
| #182 | Il Coordinatore usa la presenza | `coordinatorPresence.test.ts`, ui-check `16d-presence-coordinator` | regge |
| #183 | Vista Gruppo "Chi lavora su cosa" | `presenceBoard.test.ts`, ui-check `16b-presence-group-*`, `16d-presence-group-wide` | regge |
| #180 | Lo sviluppatore lavora con implement e tdd | `implementation.test.ts`, ui-check `19a`, `19b` | regge |
| #178 | Presenza via git, consenso, freschezza | `presence.test.ts` (shared e core) | regge |
| #171 | Criteri V04 e V05, output originale del controllo fallito | `codexClient.test.ts`, `candidates.test.ts`, `candidate.integration.test.ts`, ui-check `18a`-`18e` | sola lettura del revisore tecnico non più controllata dopo #226, corretta qui |
| #172 | Suite stabile sotto carico | `codexClient.test.ts`, `storage.test.ts`, `conflicts.test.ts` | regge |
| #170 | Verifica dei ticket vecchi | `docs/verifiche/ticket-vecchi.md` | regge |

## 7. Controlli dopo le correzioni

ESITO_BRANCH
