# V09 — Trama su Trama, prima prova reale

Data: 24 settembre 2026. Ticket: [#72](https://github.com/emanueledenaro/trama/issues/72).
Ramo: `feature/v09-real-run`, sopra `main` a `25b6f16`.

## Esito

Prova parziale. Il percorso di base funziona con Claude e con Pi su account veri: avvio, messaggio,
strumento di Trama, interruzione, riavvio dell'app e ripresa. Il percorso completo con Codex non si
può provare: l'account ChatGPT collegato ha il piano gratuito con l'utilizzo esaurito fino al 24
ottobre 2026 alle 7:47. Il candidato verificato non è stato raggiunto: nessun candidato è stato
dichiarato. Gli altri sei provider non sono stati provati. V09 resta aperto.

La prova ha trovato difetti che i test non vedevano. Quelli corretti sono elencati sotto con il
commit; quelli aperti sono nei limiti.

## Ambiente

- macOS, Node 26.7.0 (la CI usa Node 22). App avviata dalla build del ramo con una cartella dati
  isolata (`TRAMA_DATA_DIR`) e un profilo Electron separato.
- Progetto aperto: un clone di `emanueledenaro/trama` a `25b6f16`, con il push disattivato.
- Provider rilevati dalla guida: Codex, Claude, Cursor, Antigravity (CLI 1.2.10), Grok, Devin,
  OpenCode, Pi. Droid non compare. Devin ora ha la CLI: il limite scritto nel ticket ("Devin senza
  alcuna CLI") non vale più.

## Clone pulito

`npm ci`, `npm run typecheck` e `npm run build` riusciti. `npm test` dava 7 fallimenti su 385:

- due deterministici su macOS, dove `tmpdir()` è un collegamento a `/private/var`: l'app non
  riconosceva un progetto recente salvato con un percorso non risolto e perdeva la conversazione
  importata dalla versione SwiftUI; il test di Antigravity confrontava un percorso non risolto.
  Corretti in `1005d83`;
- cinque test con molte operazioni git superavano i 5 secondi con la suite in parallelo. Il limite
  è ora 20 secondi (`1005d83`). Con l'app aperta sulla stessa macchina qualche test li supera
  ancora; da soli passano.

Dopo le correzioni del ramo: 392 test, 391 verdi a suite completa, il restante verde da solo.

## Percorso con Codex

Non eseguito. Al primo avvio il Coordinatore ha scelto `gpt-5.6-luna` e Codex ha risposto con il
limite di utilizzo raggiunto. `account/read` riporta il piano "pro", preso dal token salvato al
login; `account/rateLimits/read`, che arriva dal server, riporta il piano "free", utilizzo al 100%
su una finestra di 30 giorni e uso ordinario non consentito. Trama ora legge il piano dai limiti e
mostra ChatGPT come bloccato fino al reset (`050c8e7`). Con questo account Codex rifiuta anche
`gpt-6-sol`.

## Percorso con Claude (Haiku)

| Passo | Esito |
| --- | --- |
| Studio del progetto | Riuscito. Lo studio si basa su documenti non aggiornati: il Coordinatore credeva che sei provider fossero ancora da implementare. |
| Proposta del team | Riuscita, due specialisti. Corretta dalla persona a uno. |
| Mandato | v1 concesso: piani ed esecuzione in worktree sul modulo `app`. |
| Assegnazione | Il Coordinatore ha assegnato lavoro da solo subito dopo il mandato, in sola lettura. Haiku ha sbagliato due volte i parametri di `assign_task` (id del provider, nome del modello): Trama li ha rifiutati con errori chiari e il terzo tentativo è riuscito. |
| Modifica piccola | Secondo incarico, con worktree: correzione corretta del confronto dei percorsi, test scritto male (spia ESM su `realpath`, fallisce anche senza correzione). Lo specialista dichiarava di aver eseguito i test, ma nel worktree mancano le dipendenze. |
| Controllo fallito | Fallimento trovato eseguendo il test fuori da Trama. Trama da solo non può: le sue verifiche sono `git_status`, `git_diff_check`, `swift_build` e `swift_test`, e il repository ora è Node. |
| Candidato | Non dichiarato: `declare_candidate` richiede una decisione del Patto; il Coordinatore ha aperto la decisione, la persona ha risposto, il terzo incarico è stato fermato dalla persona. |
| Identità | Dopo `5e1cb4b` il Coordinatore risponde "Sono il Coordinatore di Trama per il progetto trama-target. Sto usando Claude Haiku 4.5." |

## Percorso di base con Pi (DeepSeek V4.1 Flash via OpenRouter)

| Passo | Esito |
| --- | --- |
| Avvio e messaggio | Riuscito: "Sono il Coordinatore del progetto trama-target. In questa sessione sto usando Pi con il modello DeepSeek V4.1 Flash." |
| Strumento autorizzato | `read_mandate` chiamato; la risposta corrisponde al mandato v1. |
| Interruzione | Turno fermato dopo 6 secondi mentre leggeva file: stato `interrupted`, niente rimasto in esecuzione. |
| Riavvio e ripresa | Dopo il riavvio Trama riapre la stessa sessione di Pi; il Coordinatore ricorda la richiesta interrotta e i file già letti. |

## Difetti corretti durante la prova

- `1005d83`: progetti recenti riconosciuti anche con percorsi non risolti; test macOS.
- `5e1cb4b`: il Coordinatore si presenta come Coordinatore e nomina provider e modello in uso,
  indicati da Trama a ogni messaggio; l'intestazione segue il modello scelto.
- `050c8e7`: un turno fallito compare in chat al posto della risposta, con il motivo e "Riprova";
  un modello rifiutato per l'account resta disattivato nel selettore; dopo un cambio di provider
  il messaggio della persona riceve una sola risposta, normale, invece di una scheda di studio e
  una seconda risposta; il piano Codex viene dai limiti del server.

Il ramo contiene anche il lavoro grafico chiesto durante la prova (vetro, luce del provider, nuovo
selettore di provider, modello e sforzo, modalità veloce di Codex): `53e0595`..`b850f12`, `3948171`.

## Limiti e lavoro aperto

- Percorso completo con Codex: da ripetere dopo il reset del 24 ottobre 2026, con `gpt-5.6-luna`.
- Verifiche del candidato per progetti Node: servono controlli di test e typecheck che girino nel
  worktree, con le dipendenze. Senza, il passo "controllo fallito e corretto" non è possibile dentro
  Trama sul suo stesso repository.
- Gli specialisti non hanno le dipendenze nel worktree e possono dichiarare test mai eseguiti:
  un risultato AI non è un'evidenza.
- Documenti di pianificazione non aggiornati (`docs/piano-operativo.md`, spec del verticale):
  il Coordinatore li legge e ne trae un quadro sbagliato.
- Provider non provati: Cursor, Antigravity, Grok, Devin, OpenCode. Droid non è collegato.
- Il passaggio di provider non ha un test automatico: il Codex finto dei test gestisce un solo
  provider. È verificato solo dal vivo.
- CI: verde sulla PR [#112](https://github.com/emanueledenaro/trama/pull/112) al commit `a1989e6` (test, build e prova dell'interfaccia). Il primo giro era fallito sulla prova dell'interfaccia per un selettore ambiguo, corretto in `a1989e6`.
