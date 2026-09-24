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
- Verifiche Node (aggiunte dopo la prova): `node_test` e `node_typecheck` girano sul worktree, con le
  dipendenze prestate dal checkout quando `package-lock.json` coincide. Il worktree dello specialista
  riceve le stesse dipendenze. Su Windows i test che aprono un server locale falliscono ancora (vedi
  sotto).
- Un risultato AI non è un'evidenza: lo specialista aveva dichiarato test mai eseguiti.
- Documenti di pianificazione non aggiornati (`docs/piano-operativo.md`, spec del verticale):
  il Coordinatore li legge e ne trae un quadro sbagliato.
- Provider non provati: Cursor, Antigravity, Grok, Devin, OpenCode. Droid non è collegato.
- Il passaggio di provider non ha un test automatico: il Codex finto dei test gestisce un solo
  provider. È verificato solo dal vivo.
- CI: verde sulla PR [#112](https://github.com/emanueledenaro/trama/pull/112) al commit `a1989e6` (test, build e prova dell'interfaccia). Il primo giro era fallito sulla prova dell'interfaccia per un selettore ambiguo, corretto in `a1989e6`.

## Sandbox delle verifiche Node

Il problema: Trama deve eseguire i test del candidato da sola, senza fidarsi di quello che dice il
modello. I test girano in una sandbox che non può scrivere nel progetto e non può andare su internet.
La sandbox di Codex blocca anche la rete locale (127.0.0.1), e molti test di Trama aprono un server
locale: nel primo giro 29 test fallivano per questo, con il codice corretto.

Ora le verifiche Node usano una sandbox di Trama che lascia solo la rete locale:

- macOS: `sandbox-exec` con un profilo che permette la scrittura solo nella cartella temporanea della
  verifica e la rete solo verso localhost. Provato con una connessione diretta a 1.1.1.1: una regola
  ampia sulla rete locale (`network*` con `local ip`) riapriva anche internet, quindi bind, ingresso e
  uscita sono permessi uno per uno. Un test automatico controlla i tre casi (rete locale sì, internet
  no, scrittura nel checkout no) a ogni esecuzione della suite su macOS;
- Linux: `bubblewrap` con tutto il sistema in sola lettura, la cartella temporanea scrivibile e una
  rete privata (`--unshare-net`) che contiene solo il loopback. Trama lo prova all'avvio della prima
  verifica; se manca o il kernel lo rifiuta (alcune distribuzioni bloccano i namespace senza
  privilegi), torna alla sandbox di Codex. Non provato su una macchina Linux reale;
- Windows: resta la sandbox di Codex, senza rete locale. L'output lo dice.

Esito sul worktree del primo incarico, con il codice di Trama: 383 test verdi su 386, in 35 secondi
invece di 100. Nessun fallimento di rete. I tre rimasti: due superano i 5 secondi del worktree (che
parte da un commit senza il limite a 20 secondi), uno è il test sbagliato dello specialista. Checkout
invariato.

Come fanno altri progetti:

- Synara confina con `sandbox-exec` solo l'helper del simulatore iOS, e solo su macOS; su Linux e
  Windows lo esegue senza sandbox. Da Synara vengono due scelte: i percorsi passati al profilo sono
  risolti (Seatbelt confronta il percorso reale, `/var` è `/private/var`), e l'output nomina la
  sandbox quando può essere la causa di un fallimento. Synara però, se il profilo manca, parte senza
  sandbox; Trama invece torna alla sandbox di Codex, perché una verifica non deve poter scrivere.
- Pi usa `@anthropic-ai/sandbox-runtime` (Apache 2.0): `sandbox-exec` su macOS, `bubblewrap` su
  Linux, un proxy per i domini permessi. Su Linux toglie la rete come Trama; su macOS la rete locale
  è un'opzione (`allowLocalBinding`). Su Windows l'estensione di Pi non si attiva.
- La stessa libreria ha un supporto Windows in alpha: un utente locale dedicato e un filtro della
  Windows Filtering Platform, installati una volta con i permessi di amministratore. Il filtro lascia
  la rete locale solo verso le porte del proxy, quindi un test che apre un server su una porta
  qualsiasi resterebbe bloccato anche lì.
- Hermes esegue i comandi in un container (Docker, e altri backend remoti) con `--network=none`: il
  container ha solo il loopback, che è proprio la rete locale che serve ai test. Su Windows passa da
  Docker.

Opzioni per Windows, da decidere:

1. lasciare la sandbox di Codex e segnalare i test che falliscono per la rete (stato attuale);
2. eseguire le verifiche in WSL 2 con `bubblewrap`, quando WSL è installato: stessa sandbox di Linux;
3. eseguirle in un container con `--network=none`, come Hermes, quando c'è Docker;
4. un utente dedicato con un filtro WFP scritto per Trama, che permetta tutto il loopback: richiede
   i permessi di amministratore una volta ed è il lavoro più grande.

