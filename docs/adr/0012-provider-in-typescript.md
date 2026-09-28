# ADR 0012: provider in TypeScript

Stato: richiesta dal Product Owner il 23 settembre 2026. Sostituisce la parte "riscritti in Swift" dell'ADR 0008; il resto dell'ADR 0008 e l'ADR 0009 restano validi.

L'ADR 0008 aveva deciso i nove provider e li voleva riscritti in Swift, perché includere Node in un'app SwiftUI avrebbe portato un secondo runtime. Con l'ADR 0011 Trama è diventata un'app Electron: il processo principale è già Node e TypeScript, lo stesso linguaggio degli adattatori originali. La ragione dell'ADR 0008 non vale più.

Decisione: gli adattatori vivono in `app/src/main/core/providers/` e riprendono la logica di un progetto esterno con licenza MIT, senza il livello Effect; attribuzione e licenza in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Usano gli stessi SDK e le stesse versioni degli adattatori originali: `@anthropic-ai/claude-agent-sdk`, `@agentclientprotocol/sdk`, `@opencode-ai/sdk`, `@earendil-works/pi-coding-agent`. Gli SDK restano fuori dal bundle del processo principale e si caricano solo quando servono.

Tutti i provider, Codex compreso, passano da una forma comune, `AgentRuntime` in `providers/types.ts` (il ticket V08): conto, modelli, accesso, apertura o ripresa della sessione, turno con eventi normalizzati, interruzione e arresto. Il controller non parla più con un protocollo di provider. Ogni adattatore applica le stesse regole:

- nessuna richiesta di permesso arriva alla persona: un turno in sola lettura non modifica file e non esegue comandi che cambiano lo stato; un turno con worktree scrive solo dentro il worktree; la rete è spenta;
- gli strumenti di Trama arrivano come server MCP HTTP sul loopback con un token di sessione; i server MCP globali della persona, i plugin e le impostazioni utente non vengono caricati quando il provider permette di escluderli;
- le credenziali restano nei componenti ufficiali: Trama legge lo stato dell'accesso dalla CLI o dall'SDK del provider, non dai file delle credenziali;
- un blocco per limite d'uso diventa lo stato `blocked`, con la data di sblocco quando il provider la fornisce.

Alternative scartate: tenere il catalogo statico e rimandare gli adattatori (lascia Trama ferma quando Codex si blocca, il problema che ha motivato l'ADR 0009); includere l'intero server del progetto esterno (porta database, WebSocket e funzioni che Trama non usa, come già scartato nell'ADR 0011).

Conseguenze: il pacchetto dell'app cresce per gli SDK di Claude e Pi. Ogni adattatore ha test unitari sulle parti pure (stato dell'accesso, eventi, permessi) con SDK o CLI finti. Le prove reali richiedono gli account dei provider e restano da fare con V09. Dove un provider non può garantire una delle regole sopra, l'adattatore lo dichiara e si rifiuta di aprire la sessione per quel ruolo invece di aggirare la regola.

## Antigravity in sola lettura (P11, 26 settembre 2026)

In modalità print (`agy -p`) la CLI di Antigravity non può fermarsi per le approvazioni, quindi Trama la avvia con `--dangerously-skip-permissions`. All'inizio Trama la usava solo per gli specialisti con un worktree proprio. Ora Antigravity fa tutti i ruoli, come gli altri provider.

Decisione: l'hook di cattura che Trama installa come plugin applica uno di due profili, scelto per turno con la variabile `TRAMA_ANTIGRAVITY_PROFILE`.

- Profilo worktree, per gli specialisti, invariato: strumenti di lettura noti, modifiche ai file solo dentro il worktree, strumenti MCP di Trama.
- Profilo sola lettura, per Coordinatore, pianificatori, revisori e verifiche: strumenti di lettura noti e strumenti MCP di Trama.

In entrambi i profili l'hook nega `run_command`, gli strumenti web e browser, i subagenti e ogni strumento che non riconosce. Un valore del profilo diverso da `worktree`, o assente, vale come sola lettura.

La sola lettura non parte mai senza l'hook:

- prima della sessione Trama esegue l'hook installato con lo stesso comando che usa la CLI e controlla che neghi una modifica e un comando di shell e permetta una lettura;
- durante il turno, se la CLI produce un passo del modello prima di aver chiamato l'hook, Trama ferma il processo. Il messaggio della persona non conta: agy 1.2.12 lo trasmette come passo `user_input` prima di chiamare l'hook PreInvocation (verificato sul Mac il 28 settembre 2026);
- in entrambi i casi Trama prova prima a ripararsi da sola, senza chiedere niente: esegue `agy update` se la versione è più vecchia di quella che serve, reinstalla il plugin con `agy plugin install`, controlla di nuovo l'hook e ripete il turno una volta. La riparazione resta in Attività;
- solo se la riparazione non riesce la sessione o il turno falliscono, con quello che Trama ha provato e l'unica cosa che resta da fare alla persona.

Il flag `--sandbox` della CLI è una difesa in più, non la regola. Trama lo aggiunge ai turni in sola lettura solo quando `agy --help` lo elenca come opzione senza valore. Non abbiamo potuto verificarne il comportamento senza la CLI reale, quindi la regola resta l'hook; la prova dal vivo con `agy` controlla anche questo flag.

Alternative scartate: tenere Antigravity solo per gli specialisti (la persona vuole tutti i ruoli); affidare la sola lettura solo a `--sandbox` (comportamento non documentato e non verificabile nei test).
